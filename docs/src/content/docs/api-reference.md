---
title: API Reference
description: Summary of pathlib-ts classes, methods, and intentional deviations from CPython.
---

`pathlib-ts` mirrors CPython 3.14's `pathlib` module but adapts it to TypeScript, an async-first programming style, and the Node-compatible runtime surface. This page summarises the major classes and highlights the places where the port intentionally diverges.

## Class overview

- `PurePath` – lexical path manipulation with no I/O. Subclasses: `PurePosixPath`, `PureWindowsPath`.
- `Path` – extends the host `Pure*` flavour and adds filesystem methods. Subclasses: `PosixPath`, `WindowsPath`. `DefaultPath` picks the correct subclass for the current OS.
- `UnsupportedOperation` – thrown when a runtime feature such as `fs.readdir(..., { withFileTypes: true })` or `fs.globSync` is missing.

## PurePath essentials

| Feature                                                                  | CPython parity | Notes                                                                       |
| ------------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------- |
| `parts`, `anchor`, `drive`, `root`, `name`, `suffix`, `suffixes`, `stem` | ✅             | Implemented in `src/purepath.ts`; caches results lazily.                    |
| `joinpath(...segments)`                                                  | ✅             | Always returns the same subclass; use `withSegments` for custom subclasses. |
| `relativeTo(other, { walkUp })`                                          | ✅             | Throws when anchors disagree unless `walkUp` is provided.                   |
| `isRelativeTo(other)`                                                    | ✅             | Wraps `relativeTo` and catches errors.                                      |
| `match()`, `fullMatch()`                                                 | ✅             | Support for `*`, `?`, `**` (full match only), and character classes.        |
| `asPosix()`                                                              | ✅             | Converts separators to `/` on Windows.                                      |
| `asURI()` / `fromURI()`                                                  | ✅             | Requires absolute paths.                                                    |

### TypeScript conveniences

- `withSegments(...segments)` is public and overridable, mirroring CPython 3.14's new hook for derivative paths.
- `dropSegments(count)` is exposed to support policies in `Path.relativeTo()`.

## Path-specific functionality

Every I/O method comes in two flavours:

- Async default (returns `Promise<T>`).
- Sync variant with a `Sync` suffix.

This is achieved via the small `toPromise()` helper in `src/util.ts`, so both flavours always share the same implementation.

### Metadata & stat helpers

- `info` lazily constructs a `PathInfo` (or `DirEntryInfo` when the path originated from a `Dirent`) and caches it per instance.
- `stat`, `lstat`, `exists`, `isDir`, `isFile`, `isSymlink` mirror CPython semantics and accept `followSymlinks` where appropriate.

### Directory listing

`iterdir`, `iterdirSync` and `iterdirStream` support the Node-style dirent toggle:

```ts
const dir = new Path("./dist");

const entries = await dir.iterdir(); // Path[] (default)
const dirents = await dir.iterdir({ extra: { withFileTypes: true } }); // Dirent[]
```

- When `withFileTypes` is `true`, the runtime must provide `fs.readdir(..., { withFileTypes: true })`; otherwise `UnsupportedOperation` is thrown.
- Streaming variants (`iterdirStream`, `iterdirStreamSync`) use `fs.opendir*` when available to reduce memory footprint.

Children created from `iterdir*()` calls inherit cached metadata via `DirEntryInfo`, ensuring that subsequent `isFile()`/`isDir()` checks can avoid extra syscalls when the runtime exposes that data.

### Globbing and tree walking

- `glob(pattern)` and `rglob(pattern)` require Node 20+ (or Bun/Deno equivalents) where `fs.glob`/`fs.globSync` exist. The library raises `UnsupportedOperation` if the feature is missing.
- `walk({ topDown })` mirrors `os.walk()`, yielding tuples of `[Path, dirNames[], fileNames[]]`.

### File I/O

- `readText`, `readBytes`, `writeText`, `writeBytes`, and `open` map directly to `fs.readFile`, `fs.writeFile`, and `fs.createReadStream`. For write operations, sync variants call `fs.writeFileSync`.
- `touch({ mode, existOk })`, `mkdir({ parents, existOk, mode })`, `unlink({ missingOk })`, `rmdir()`, `rename`, `replace`, `copy`, and `readlink` are built atop the matching `fs` methods.
- `copy` leverages `fs.cpSync` (recursive) and performs best-effort validation via `ensureDistinctPaths`.

### Relative path policies

`Path.relativeTo()` and `Path.isRelativeTo()` introduce policy-aware semantics that do not exist in upstream CPython:

```ts
const asset = new Path("/repo/assets/img.png");
const mdx = new Path("/repo/content/post.mdx");

// Purely lexical (default policy)
asset.relativeTo(mdx, { walkUp: true }).toString(); // '../assets/img.png'

// Interpret the right operand as a file and anchor at its parent
asset.relativeTo(mdx, { walkUp: true, extra: { policy: "parent" } }).toString();

// Auto-detect using filesystem metadata (async)
const rel = await asset.relativeTo(mdx, {
  walkUp: true,
  extra: { policy: "auto", followSymlinks: true },
});
```

Policy summary:

| Policy              | Behaviour                                                      | Return type         |
| ------------------- | -------------------------------------------------------------- | ------------------- |
| `"exact"` (default) | CPython lexical semantics.                                     | `PurePath`          |
| `"parent"`          | Treat `other.parent` as the anchor, no I/O.                    | `PurePath`          |
| `"auto"`            | Stat `other` to detect directories; respects `followSymlinks`. | `Promise<PurePath>` |

`Path.isRelativeTo()` accepts the same policy options. When `policy === "auto"`, it returns a `Promise<boolean>`; otherwise it stays synchronous.

### Environment helpers

- `Path.cwd()` / `Path.cwdSync()` and `Path.home()` / `Path.homeSync()` mirror CPython's class methods.
- `absolute()` returns an absolute path without resolving symlinks; `resolve()` resolves symlinks and normalises, just like Python.
- `expandUser()` expands `~` prefixes using `node:os.homedir()`.

## Unsupported and intentionally omitted features

`src/os.ts` documents the omitted low-level syscall helpers (e.g. reflink/`copy_file_range`). The omissions are deliberate to keep the runtime portable. If you attempt to exercise a method that needs a missing runtime primitive, expect `UnsupportedOperation`.

## TypeScript typing tips

- Most APIs return `Path` but TypeScript recognises the inheritance chain, so you can rely on `PurePath` members on `Path` instances without extra casts.
- The promise vs sync overloads preserve narrow return types (`Promise<Path>` vs `Path`) thanks to overload definitions.
- The policy-aware overloads for `relativeTo`/`isRelativeTo` are strongly typed; misuse will surface as a compile-time error before it reaches runtime tests.

For deep dives into behavioural edge cases, study the tests in `tests/`—they mirror CPython's behaviour wherever feasible and document the deliberate deviations.
