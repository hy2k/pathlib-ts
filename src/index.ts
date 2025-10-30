/**
 * Object-oriented filesystem paths for TypeScript runtimes.
 *
 * @remarks
 *
 * Re-exports the core classes from CPython's `pathlib` module while adapting semantics to JavaScript. The
 * primary entry points are:
 *
 * - {@link PurePath} for lexical operations without touching the filesystem.
 * - {@link PurePosixPath} and {@link PureWindowsPath} for flavour-specific manipulation.
 * - {@link Path} for concrete paths that invoke Node's filesystem APIs (with async-first variants).
 *
 * Differences compared to CPython:
 *
 * 1. Asynchronous by default: every filesystem method returns a `Promise`, with `Sync` suffixed counterparts
 *    for synchronous access.
 * 2. Portability-focused omissions: low-level syscalls that rely on native bindings are intentionally left
 *    out. See `src/os.ts` for details and rationale.
 * 3. Globbing: Node's `fs.glob`/`fs.globSync` is used when available; otherwise the behaviour is implemented
 *    in userland.
 *
 * @see https://github.com/python/cpython/blob/3.14/Lib/pathlib/__init__.py
 */

import { DirEntryInfo, PathInfo } from "./os.js";
import { DefaultPath, Path, PosixPath, WindowsPath } from "./path.js";
import {
	PathParents,
	PurePath,
	PurePosixPath,
	PureWindowsPath,
	UnsupportedOperation,
} from "./purepath.js";

export {
	DirEntryInfo,
	PathInfo,
	PathInfoBase,
} from "./os.js";
export type {
	ExtractPolicy,
	PathIsRelativeToFn,
	PathIsRelativeToOptions,
	PathIsRelativeToReturn,
	PathOptionsArg,
	PathRelativeToFn,
	PathRelativeToOptions,
	PathRelativeToReturn,
	ResolutionPolicy,
	WalkTuple,
} from "./path.js";
export {
	DefaultPath,
	Path,
	PosixPath,
	WindowsPath,
} from "./path.js";
export type { PathLike } from "./purepath.js";
export {
	PathParents,
	PurePath,
	PurePosixPath,
	PureWindowsPath,
	UnsupportedOperation,
} from "./purepath.js";

export default {
	UnsupportedOperation,
	PurePath,
	PurePosixPath,
	PureWindowsPath,
	Path,
	PosixPath,
	WindowsPath,
	DefaultPath,
	PathParents,
	PathInfo,
	DirEntryInfo,
};
