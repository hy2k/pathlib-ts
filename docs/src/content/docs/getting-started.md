---
title: Getting Started
description: Install pathlib-ts, understand runtime requirements, and explore the core classes.
---

This guide walks through installing `pathlib-ts`, understanding the runtime requirements, and exercising the core primitives (`Path` for I/O + `PurePath` for string-level manipulations).

## Install

```bash
# Node / Bun / pnpm
pnpm add pathlib-ts
npm install pathlib-ts
bun add pathlib-ts
```

The library depends only on standard Node-compatible modules (`node:fs`, `node:path`, `node:url`). Node-compat runtimes (e.g. Bun and Deno) are supported as long as they expose these modules.

## Import and select a path flavour

```ts
import { Path, PurePath, DefaultPath } from "pathlib-ts";

// DefaultPath resolves to PosixPath or WindowsPath based on the host OS.
const cwd = new DefaultPath(".");
const config = new Path("./config.json");
const virtual = new PurePath("/templates", "component.tsx");
```

- `PurePath` manipulates path strings without touching the filesystem.
- `Path` inherits from `PurePath` and adds async-first filesystem APIs.
- `DefaultPath` is aliased to the platform-specific subclass (`PosixPath` or `WindowsPath`).

## Async-first, sync-available

Most filesystem operations are promise-based; sync variants use the same name + `Sync` suffix:

```ts
const settingsPath = new Path("./settings.json");

// Async (preferred)
const text = await settingsPath.readText();
await settingsPath.writeText(JSON.stringify({ theme: "dark" }, null, 2));

// Sync fallback (opt in explicitly)
const snapshot = settingsPath.readTextSync();
settingsPath.writeTextSync(snapshot);
```

This mirrors the design documented in `src/path.ts`: every async method wraps a `toPromise` call around the synchronous implementation to keep the runtime surface minimal.

## First steps in a project

```ts
import { Path } from "pathlib-ts";

const project = new Path(import.meta.dirname, "..", "..");
const srcDir = project.joinpath("src");

for await (const entry of srcDir.iterdirStream()) {
  if (await entry.isFile()) {
    console.log(`${entry.name}: ${await entry.readText()}`);
  }
}
```

Key observations:

- `joinpath()` performs lexical joins and returns a `PurePath`; cast to `Path` (or call `new Path(...)`) when you need I/O helpers.
- `iterdirStream()` streams contents lazily. Use `iterdir()` when you prefer materialised arrays.
- Methods like `isFile()` and `exists()` return promises; add `Sync` to stay synchronous.

## Working with virtual paths only

`PurePath` mirrors CPython semantics closely and is handy for URL builders or in-memory resolution logic:

```ts
const asset = new PurePath("/static", "images", "logo.svg");
console.log(asset.name); // "logo.svg"
console.log(asset.stem); // "logo"
console.log(asset.suffix); // ".svg"
console.log(asset.parts); // ["/", "static", "images", "logo.svg"]
```

You can mix `PurePath` and `Path` instances: combining them via `joinpath()` or constructors normalises separators and honours the target parser (POSIX vs Windows).

## Next steps

- Browse the [API reference](./api-reference/) for a rundown of available methods.
- Read the [usage patterns](./usage-patterns/) for real-world recipes.
