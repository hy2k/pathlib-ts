# pathlib-ts

Pathlib for TypeScript — a pragmatic, async-first port of CPython's `pathlib`.

pathlib-ts brings the convenience and expressiveness of Python's `pathlib` to the JavaScript/TypeScript ecosystem. It provides PurePath classes for pure path manipulation and Path classes for filesystem operations, with async-first APIs plus synchronous counterparts.

## Why this project exists

- Familiar API: developers who like Python's `pathlib` can use similar concepts in TypeScript.
- Async-first: most filesystem methods are asynchronous and return Promises; sync variants are available with the `Sync` suffix.
- Runtime-portable: implemented to work on Node, Bun, and Deno without native extensions.
- Small and dependency-free: relies only on Node builtins (`node:fs`, `node:path`, `node:url`, `node:os`) supported on all targeted runtimes.

## Quick start

Basic example

```ts
import { Path } from "pathlib-ts";

const p = new Path("./hello.txt");
await p.writeText("Hello from pathlib-ts\n");
console.log(await p.readText());

const dir = new Path("./");
for (const child of await dir.iterdir()) {
  console.log(child.toString());
}
```

## Highlights

- PurePath / PurePosixPath / PureWindowsPath — path manipulation without any I/O.
- Path / PosixPath / WindowsPath — concrete paths with filesystem operations (stat, read/write, mkdir, glob, copy, rename, etc.).
- Async-first design with synchronous counterparts (e.g. `readText()` / `readTextSync()`).
- Best-effort parity with CPython's `pathlib` where Node APIs permit.
- Relative path policies: opt into JS import-style behaviour via `Path.relativeTo(..., { extra: { policy: "auto" } })` while keeping CPython's default semantics.

## Runtime support

- Targeted runtimes: Node.js, Bun, and Deno.
- Implementation uses Node builtin modules. When a runtime lacks a specific API (for example `fs.globSync`) the library throws `UnsupportedOperation` with a descriptive message.

## Goals and limitations

- Goal: keep API and behavior close to CPython's `pathlib` to make migration and reasoning easier.
- Async-first: prefer Promise-based APIs; sync methods are available.
- Limitations: low-level syscall features (copy_file_range, sendfile, fcntl-based reflink, etc.) are intentionally omitted for portability and safety. See `src/os.ts` for details.
- Globbing: recursive and advanced globbing behavior depends on the runtime's `fs` implementation.

## Module organization

- CPython's `pathlib` keeps `PurePath` and `Path` implementations in a single `__init__.py` module.
- This port now keeps the public surface in `src/index.ts`, re-exporting logic split between `src/purepath.ts` (pure path operations) and `src/path.ts` (filesystem-aware paths).
- The split mirrors the logical separation while preserving the exact runtime exports exposed from `src/index.ts`.

## License and attribution

This project is a port (derived work) of CPython's `pathlib` (derived from the implementation in CPython 3.14). The CPython-derived files in this repository are therefore distributed under the Python Software Foundation License Version 2 (`PSF-2.0`). See [`LICENSE`](./LICENSE) for full terms.

## Development

- Format & lint: `bun fix`
- Typecheck: `bun tsc --noEmit`
- Tests: `bun test`

## Contributing

Contributions, bug reports, and tests are welcome. Please open issues and PRs. Small, incremental improvements and tests that exercise parity with CPython's behavior are particularly helpful.

## Next steps

- Add more tests checking edge-case parity with CPython's `pathlib`.
- Explore optional, platform-optimized copy/reflink strategies behind feature flags.
- Publish to npm with clear runtime compatibility notes.
