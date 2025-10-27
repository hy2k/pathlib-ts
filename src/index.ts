/**
 * Object-oriented filesystem paths.
 *
 * This module provides classes to represent abstract paths and concrete
 * paths with operations that have semantics appropriate for different
 * operating systems.
 *
 * The primary classes are:
 * - PurePath: base class for manipulating paths without I/O.
 * - PurePosixPath / PureWindowsPath: platform-specific PurePath subclasses.
 * - Path: concrete subclass that performs system calls (stat, mkdir, etc.).
 *
 * Parity note:
 * This TypeScript port follows CPython's `pathlib` design closely but
 * diverges where language and runtime differences require it:
 * - Async-first API: filesystem methods are asynchronous by default and
 *   expose sync counterparts suffixed with `Sync`.
 * - Runtime portability: some low-level OS features from CPython are
 *   intentionally omitted (see `src/os.ts`) to avoid native bindings.
 * - Globbing: CPython's internal glob implementation is preserved where
 *   possible; when a runtime provides `fs.globSync` it is used, otherwise
 *   behavior may differ.
 *
 * @see https://github.com/python/cpython/blob/3.14/Lib/pathlib/__init__.py
 */

import { DefaultPath, Path, PosixPath, WindowsPath } from "./path.js";
import {
	PurePath,
	PurePosixPath,
	PureWindowsPath,
	UnsupportedOperation,
} from "./purepath.js";

export type { ResolutionPolicy } from "./path.js";
export { DefaultPath, Path, PosixPath, WindowsPath } from "./path.js";
export {
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
};
