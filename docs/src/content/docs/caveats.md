---
title: Caveats & Gotchas
description: Behavioural differences, feature detection, and migration pitfalls to watch for.
---

A few behaviours in `pathlib-ts` are intentionally different from both CPython and Node's builtins. Understanding them upfront saves debugging time.

## Async-first surface

- Methods that touch the filesystem are async by default. If you forget to `await` calls like `exists()`, your conditionals will always see a truthy promise. Reach for the `Sync` variants when you truly need blocking behaviour.
- `Path.relativeTo()` and `Path.isRelativeTo()` can also return promises when `extra.policy === "auto"`. TypeScript will flag this, but plain JavaScript migrations should double-check.

## Lexical vs filesystem semantics

- `PurePath.relativeTo()` mirrors CPython: it throws when the anchors differ or when the target is not a true descendant (unless `walkUp: true`). Node's `path.relative()` never throws, so migrations should add `walkUp` and pick an appropriate policy on `Path.relativeTo()`.
- `PurePath.match()` and `fullMatch()` operate on normalised path strings. They will not consult the filesystem and they treat case sensitivity according to the underlying parser (`posix` is case-sensitive, `win32` is not).

## PurePath.name vs Dirent.name

Both values are strings but reference different concepts:

- `PurePath.name` gives you the final component of the path (including suffixes).
- `Dirent.name` is the filename/descriptor as read from the parent directory entry.

When you iterate with `iterdir()` (returning `Path`), `entry.name` delegates to the underlying `PurePath.name`, which is safe for joins and string comparisons. When you request native `Dirent` objects, keep using `dirent.name` as before. Mixing them up can introduce subtle bugs when handling trailing dots on Windows or UNC prefixes.

## Runtime feature detection

- `UnsupportedOperation` is raised when the host runtime lacks an API (e.g. `fs.globSync`, `fs.readdir(..., { withFileTypes: true })`, or `fs.opendir`). Catch it if you must support older Node versions.
- `Path.copy()` relies on `fs.cpSync`. On Node < 18.13 (or platforms without `cpSync`) you will also receive `UnsupportedOperation`.

## Normalization differences

- Like CPython, `PurePath` collapses duplicated separators and single dots but leaves `..` segments in place. Call `Path.resolve()` if you need them eliminated.
- `Path.absolute()` simply resolves the path against the current working directory without touching symlinks or `..` segments. Use `resolve()` for a fully canonical result.

## Policy pitfalls

`Path.relativeTo()` supports three policies for handling symlinks and directory semantics:

- `extra.policy: "auto"` (default) treats the right-hand operand as a directory when it exists as such on the filesystem. If it is a symlink to a directory, the link target is used. This matches JS/Node conventions but can differ from CPython behaviour.
- `extra.policy: "parent"` ignores the filesystem entirely. If the right-hand operand is a symlink to a directory, you may get results that differ from `policy: "auto"`.
- `extra.followSymlinks` only applies when `policy === "auto"`. Passing it with other policies is harmless but has no effect.

## Glob behaviour

- Recursive globbing (`**`) follows CPython's rules but requires Node 20+ (or Bun/Deno equivalents). Without `fs.glob`, glob calls throw `UnsupportedOperation`.
- Patterns are interpreted relative to the receiver; passing absolute patterns mirrors Python but can be surprising in procedural code.

## Copying and metadata

- `Path.copy()` sets `recursive: true` and delegates to `fs.cp`. Metadata preservation (`preserveMetadata` / `followSymlinks`) is best-effort and ultimately depends on the host runtime.
- Low-level cloning strategies from CPython `_os.py` (reflink, `copy_file_range`, etc.) are intentionally omitted for portability. For advanced use cases prefer manual streaming via Node APIs or the `copyFileObj` helper in `src/os.ts`.

## Cross-platform paths

- Instantiating `WindowsPath` on POSIX (or `PosixPath` on Windows) throws `UnsupportedOperation`, matching CPython. Use `PureWindowsPath`/`PurePosixPath` when you need to manipulate foreign-flavour paths without I/O.
- UNC paths and drive-letter nuances follow `node:path.win32` semantics. Tests cover common edge cases, but be cautious when converting between native strings and URIs.

## PathLike (pathlib-ts vs Node)

This library's `PathLike` (in `src/purepath.ts`) is `string | PurePath` — an alias used to accept either raw strings or other path objects from `pathlib-ts`.

Node's `PathLike` (the one in `node:fs` typings) is `string | Buffer | URL`. They are not the same type.

## Handling optional runtime features

Node < 20 (and some other runtime builds) do not ship `fs.glob`/`fs.globSync`. In those environments, calling `Path.glob()` raises `UnsupportedOperation`.

Same story for `withFileTypes: true`. The library mirrors the runtime capability rather than polyfilling it.
