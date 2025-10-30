---
title: Usage Patterns
description: Recipes and migration tips for adopting pathlib-ts in real projects.
---

These recipes demonstrate idiomatic `pathlib-ts` usage drawn from the library's internal tests and real-world migrations.

## Enumerating a directory

```ts
import { Path } from "pathlib-ts";

const root = new Path("./src");

for (const entry of await root.iterdir()) {
  if (await entry.isDir()) {
    console.log(`dir  ${entry.name}`);
  } else if (await entry.isFile()) {
    console.log(`file ${entry.name}`);
  }
}
```

Need `Dirent` metadata such as native type flags? Opt in explicitly:

```ts
const dirents = await root.iterdir({ extra: { withFileTypes: true } });
for (const dirent of dirents) {
  console.log(dirent.name, dirent.isDirectory());
}
```

## Streaming large folders

`iterdirStream()` yields entries lazily via `fs.opendir` when available:

```ts
const logDir = new Path("/var/logs");

for await (const entry of logDir.iterdirStream()) {
  if (await entry.isFile()) {
    const size = (await entry.stat()).size;
    console.log(`${entry.name}: ${size} bytes`);
  }
}
```

If the runtime lacks `fs.readdir(..., { withFileTypes: true })`, attempting to request `withFileTypes: true` throws `UnsupportedOperation`, matching the behaviour exercised in `tests/path-read.test.ts`.

## Reading and writing files

```ts
const cacheFile = new Path("./.cache.json");

async function loadCache() {
  if (!(await cacheFile.exists())) return null;
  return JSON.parse(await cacheFile.readText());
}

async function saveCache(data: unknown) {
  await cacheFile.parent.mkdir({ parents: true, existOk: true });
  await cacheFile.writeText(JSON.stringify(data, null, 2));
}
```

Switch to synchronous operations in CLI bootstrap code where blocking is acceptable:

```ts
cacheFile.writeTextSync(JSON.stringify({ warmed: Date.now() }));
```

## Computing relative asset paths

The `Path.relativeTo()` policies provide flexibility when working with module-style imports or content pipelines, as tested in `tests/path-relative.test.ts`:

```ts
const asset = new Path("/site/assets/cover.webp");
const article = new Path("/site/content/2024/launch.mdx");

// Purely lexical (matches CPython)
asset.relativeTo(article, { walkUp: true }).toString();
// '../assets/cover.webp'

// Treat `article` as a file and anchor to its parent directory
asset.relativeTo(article, {
  walkUp: true,
  extra: { policy: "parent" },
});
// '../../assets/cover.webp'

// Auto-detect using filesystem metadata (async)
await asset.relativeTo(article, {
  walkUp: true,
  extra: { policy: "auto", followSymlinks: true },
});
```

Remember: `policy: "auto"` returns a promise because it stats the right-hand operand.

## Walking trees and copying artefacts

```ts
const buildDir = new Path("./build");
const publicDir = new Path("./public");

for (const [dir, dirs, files] of await buildDir.walk()) {
  const rel = dir.relativeTo(buildDir, { walkUp: true });
  const outDir = publicDir.joinpath(rel) as Path;
  await outDir.mkdir({ parents: true, existOk: true });

  for (const name of files) {
    const src = dir.joinpath(name) as Path;
    await src.copy(outDir.joinpath(name));
  }
}
```

`Path.copy()` wraps `fs.cpSync` and performs sanity checks via `ensureDistinctPaths`. For fine-grained control you can drop to Node streams and use the `copyFileObj` helper from `src/os.ts`.

## Working with virtual paths

Use `PurePath` when you need deterministic string manipulation without filesystem access:

```ts
import { PurePath } from "pathlib-ts";

const rel = new PurePath("assets", "2024", "hero.png");

rel.parts; // ["assets", "2024", "hero.png"]
rel.name; // "hero.png"
rel.suffixes; // [".png"]
rel.withStem("hero@2x").toString(); // 'assets/2024/hero@2x.png'

// Works cross-flavour
const win = new PurePath("C:/data", rel);
```

`PurePath.match()` and `fullMatch()` accept glob-style patterns and reuse the same normalisation rules as Python. Tests in `tests/purepath.test.ts` cover edge cases such as hidden files and dot-prefixed suffixes.

## When to choose sync APIs

- Boot-time scaffolding (e.g. CLI commands) where sequential operations are acceptable.
- Unit tests that avoid async/await noise.
- Scripts running under environments without `fs.promises` (the sync methods delegate to classic `fs` calls).

Every sync variant is exercised alongside async coverage in `tests/path-read.test.ts`, ensuring both stay in lockstep.

## Comparison to Node builtins

| Node builtin                                        | pathlib-ts equivalent                                                        | Notes                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `fs.promises.readFile(path, "utf8")`                | `await new Path(path).readText()`                                            | Use `readBytes()` for binary data.                               |
| `fs.promises.writeFile(path, data, "utf8")`         | `await new Path(path).writeText(data)`                                       | Sync variants available via `writeTextSync`.                     |
| `fs.promises.readdir(dir, { withFileTypes: true })` | `await new Path(dir).iterdir({ extra: { withFileTypes: true } })`            | Returns `Dirent[]`; omit `withFileTypes` for `Path[]`.           |
| `path.join(a, b, c)`                                | `new Path(a).joinpath(b, c)`                                                 | Works on `PurePath` too; honours Windows vs POSIX automatically. |
| `path.relative(from, to)`                           | `new Path(to).relativeTo(from, { walkUp: true, extra: { policy: "auto" } })` | `policy:"auto"` anchors at the parent when `from` is a file.     |
| `fs.promises.mkdir(dir, { recursive: true })`       | `await new Path(dir).mkdir({ parents: true, existOk: true })`                | `mode` maps to the same option name.                             |
| `fs.promises.stat(path)`                            | `await new Path(path).stat()`                                                | Specify `followSymlinks: false` to mimic `lstat`.                |
| `dirent.isDirectory()`                              | `await entry.isDir()`                                                        | `entry` is a `Path` (unless you requested Dirent objects).       |

## Example: collecting files recursively without globbing

**Before (Node builtins)**

```ts
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const files = [];
async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collect(full);
    } else if (entry.isFile()) {
      files.push({ path: full, data: await readFile(full) });
    }
  }
}
```

**After (pathlib-ts)**

```ts
import { Path } from "pathlib-ts";

const files: Array<{ path: Path; data: Buffer }> = [];
async function collect(dir: Path) {
  for (const entry of await dir.iterdir()) {
    const full = dir.joinpath(entry.name);
    if (await entry.isDir()) {
      await collect(full);
    } else if (await entry.isFile()) {
      files.push({ path: full, data: await full.readBytes() });
    }
  }
}
```

Changes at a glance:

- `iterdir()` replaces `readdir()` and yields `Path` objects; call `entry.isDir()` / `entry.isFile()` instead of `dirent.isDirectory()`.
- `joinpath()` keeps joins lexical and platform-aware.
- Reading files moves onto the `Path` instance (`full.readBytes()`), keeping the context close to the path itself.

## Example: computing relative asset paths

**Before**

```ts
import path from "node:path";

const outDir = path.join(assetsRoot, year, stem);
const outFile = path.join(outDir, outputName);
const relative = path.relative(path.dirname(articlePath), outFile);
```

**After**

```ts
import { Path } from "pathlib-ts";

const outDir = assetsRoot.joinpath(year, stem) as Path;
const outFile = outDir.joinpath(outputName) as Path;
const relative = await outFile.relativeTo(articlePath, {
  walkUp: true,
  extra: { policy: "auto" },
});
```

Why the policy? `path.relative()` effectively anchors at the parent directory of a file operand. CPython's `Path.relative_to()` does not, so the port introduces `extra.policy:"auto"` to close the gap. When you know the right-hand side is a directory and want a purely lexical result, stick to the default `policy:"exact"`.

## Console output and logging

`Path` and `PurePath` implements `Symbol.toPrimitive`, so template literals just work:

```ts
const outDir = new Path("./out");
const outFile = outDir.joinpath("file.txt");
const generated = outFile.relativeTo(outDir);
console.log(`Generated ${generated}`); // Generated file.txt
```

Note on Windows/UNC: UNC path formatting and trailing-dot/space handling are platform-sensitive. When exact native semantics matter, convert explicitly and test on the target platform.

If you need POSIX-style separators regardless of host OS (e.g. for URLs), call `asPosix()` on the resulting `PurePath`.

## Checklist for larger migrations

1. Replace `path.resolve()`, `path.join()`, and friends with `PurePath`/`Path` equivalents. Start with lexical operations before touching I/O.
2. Swap `fs` / `fs.promises` calls for instance methods (`readText`, `writeBytes`, `copy`, `mkdir`, ...).
3. Audit code that relied on `Dirent` methods; either opt into `iterdir({ extra: { withFileTypes: true } })` or adjust the logic to call `Path` predicates.
4. Review relative-path logic and pick an appropriate policy (`exact`, `parent`, `auto`). Tests in `tests/path-relative.test.ts` outline expected outcomes.
5. Run the existing test suite—`pathlib-ts` maintains tight parity with CPython, so test failures often highlight assumptions baked into the procedural API.
