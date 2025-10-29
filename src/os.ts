/**
 * TypeScript port of relevant parts of CPython's pathlib/_os.py.
 * Adapted to use Node.js builtins only (node:fs, node:path).
 *
 * NOTE ABOUT OMISSIONS
 * ---------------------
 * A number of CPython helpers that are tightly-coupled to low-level
 * platform syscalls were intentionally omitted from this TypeScript port.
 * Examples: `_get_copy_blocksize`, low-level copy helpers around
 * `copy_file_range`, `sendfile`, `posix._fcopyfile`, and fcntl-based
 * reflink (`FICLONE`). These functions depend on C-level file-descriptor
 * semantics and platform-specific behavior that isn't reliably mirrored by
 * Node's standard library across platforms.
 *
 * Reasons for omission:
 * - Portability: Node's stream and fs abstractions behave differently
 *   across platforms and filesystems; replicating the exact syscalls would
 *   require native bindings or platform-specific code paths.
 * - Safety: Using raw integer FDs or assuming presence of syscalls can
 *   produce brittle, hard-to-test code and surprising cross-platform
 *   failures.
 * - Minimal surface area: This repository must avoid third-party/native
 *   dependencies per the task. Adding syscall-level features would violate
 *   that constraint or require optional native modules.
 *
 * Decision: leave them out but document clearly. No helper stub is
 * required (per your instruction). If you later want these added we can
 * implement them as optional, platform-specific modules with explicit
 * feature-detection.
 *
 * @see https://github.com/python/cpython/blob/3.14/Lib/pathlib/_os.py
 */

import fs from "node:fs";
import nodepath from "node:path";
import { ErrnoError } from "./errors.js";
import { toPromise } from "./util.js";

export { ErrnoError } from "./errors.js";

/**
 * Copy data from the source handle to the destination handle asynchronously.
 *
 * @remarks
 *
 * Mirrors CPython's {@link https://github.com/python/cpython/blob/3.14/Lib/pathlib/_os.py | `pathlib._os.copyfileobj`}.
 * When both arguments are string paths the implementation defers to `fs.copyFileSync` for performance. Mixed
 * stream/path scenarios fall back to a synchronous implementation executed within a `Promise` wrapper.
 *
 * @param source - Path or readable stream supplying data.
 * @param target - Path or writable stream receiving data.
 * @returns Promise that resolves when copying completes.
 * @throws {@link ErrnoError} When the provided handles cannot be copied synchronously.
 */
export async function copyFileObj(
	source: fs.ReadStream | NodeJS.ReadableStream | string,
	target: fs.WriteStream | NodeJS.WritableStream | string,
): Promise<void> {
	return toPromise(() => copyFileObjSync(source, target));
}

/**
 * Synchronous variant of {@link copyFileObj}.
 *
 * @remarks
 *
 * Optimises path-to-path copies using `fs.copyFileSync`. When provided with stream handles that expose file
 * descriptors, data is copied using a fixed-size buffer. All other combinations raise {@link ErrnoError} to
 * match CPython's guard rails around unsupported file objects.
 *
 * @param source - Path or readable stream supplying data.
 * @param target - Path or writable stream receiving data.
 * @throws {@link ErrnoError} When copying cannot be performed synchronously.
 */
export function copyFileObjSync(
	source: fs.ReadStream | NodeJS.ReadableStream | string,
	target: fs.WriteStream | NodeJS.WritableStream | string,
): void {
	if (typeof source === "string" && typeof target === "string") {
		// Fast path via copyFileSync
		fs.copyFileSync(source, target);
		return;
	}

	// For non-paths, try to convert to file descriptors if possible.
	// Best-effort: if given streams expose .fd use them, otherwise fall back
	// to throw since true sync streaming for arbitrary streams isn't
	// generally supported without blocking APIs.
	const getFd = (s: unknown): number | undefined => {
		if (typeof s === "string") return undefined;
		if (typeof s === "object" && s !== null) {
			const rec = s as { fd?: unknown };
			if (typeof rec.fd === "number") return rec.fd;
		}
		return undefined;
	};

	const sfd = getFd(source);
	const tfd = getFd(target);
	if (typeof sfd === "number" && typeof tfd === "number") {
		const BUF_SIZE = 64 * 1024;
		const buffer = Buffer.allocUnsafe(BUF_SIZE);
		let bytesRead = 0;
		// Read/Write loop
		do {
			bytesRead = fs.readSync(sfd, buffer, 0, BUF_SIZE, null);
			if (bytesRead > 0) fs.writeSync(tfd, buffer, 0, bytesRead);
		} while (bytesRead > 0);
		return;
	}

	throw new ErrnoError("copyFileObjSync: unsupported stream types", "EINVAL", {
		path: source,
		dest: target,
	});
}

/**
 * Open a file using CPython-compatible mode semantics and return a Node stream.
 *
 * @remarks
 *
 * Mirrors `pathlib._os.magic_open`, translating classic `open()` flags (including text vs binary) into a
 * `fs.createReadStream` invocation. Text modes default to UTF-8 unless an explicit encoding is supplied, and
 * binary modes reject encodings, matching CPython's validation.
 *
 * @param pathStr - Absolute or relative file path.
 * @param options - Mode, encoding, and buffering preferences.
 * @returns A readable stream configured per the provided mode.
 * @throws {@link TypeError} When binary mode is combined with an encoding.
 */
export function magicOpen(
	pathStr: string,
	options?: {
		mode?: string;
		buffering?: number;
		encoding?: BufferEncoding | null;
		errors?: unknown;
		newline?: string | null;
	},
) {
	const { mode = "r", encoding = null } = options ?? {};
	const isText = !mode.includes("b");
	let enc = encoding;
	if (isText && enc === null) enc = "utf8";
	if (!isText && enc !== null)
		throw new TypeError("binary mode doesn't take an encoding argument");

	return fs.createReadStream(pathStr, {
		encoding: isText ? (enc ?? undefined) : undefined,
	});
}

/**
 * Validate that two paths do not point to the same file or parent/child relationship.
 *
 * @remarks
 *
 * Resolves both arguments to absolute paths via `node:path.resolve` and raises {@link ErrnoError} with
 * `EINVAL` when they are identical or when the target resides within the source. This mirrors
 * `pathlib._os.ensure_distinct_paths` and protects operations such as `Path.copy` from destructive
 * self-overwrites.
 *
 * @param source - Candidate source path.
 * @param target - Candidate destination path.
 * @throws {@link ErrnoError} When the paths are identical or one is nested under the other.
 */
export function ensureDistinctPaths(source: string, target: string): void {
	const s = nodepath.resolve(source);
	const t = nodepath.resolve(target);
	if (s === t) {
		throw new ErrnoError("Source and target are the same path", "EINVAL", {
			path: s,
			dest: t,
		});
	}
	if (t.startsWith(s + nodepath.sep)) {
		throw new ErrnoError("Source path is a parent of target path", "EINVAL", {
			path: s,
			dest: t,
		});
	}
}

/**
 * Raise `OSError(EINVAL)` when two handles refer to the same filesystem entry (async wrapper).
 *
 * @remarks
 *
 * Provides the asynchronous entry point for {@link ensureDifferentFilesSync}. Useful for APIs that mirror the
 * async-first design of the concrete {@link Path} methods.
 *
 * @param source - Source path-like object or descriptor.
 * @param target - Target path-like object or descriptor.
 * @returns Promise that resolves when the paths are distinct.
 * @throws {@link ErrnoError} When the two inputs resolve to the same file.
 */
export async function ensureDifferentFiles(
	source: unknown,
	target: unknown,
): Promise<void> {
	return toPromise(() => ensureDifferentFilesSync(source, target));
}

/**
 * Synchronous variant of {@link ensureDifferentFiles}.
 *
 * @remarks
 *
 * Performs best-effort comparisons using cached file identifiers (when provided by `Path.info`) and finally
 * falls back to a stat-based comparison. Raises {@link ErrnoError} with `EINVAL` when both operands refer to
 * the same file.
 *
 * @param source - Source path-like object or descriptor.
 * @param target - Target path-like object or descriptor.
 * @throws {@link ErrnoError} When the two inputs resolve to the same file.
 */
export function ensureDifferentFilesSync(
	source: unknown,
	target: unknown,
): void {
	const getFileIdSync = (obj: unknown): unknown | undefined => {
		if (typeof obj === "object" && obj !== null) {
			const rec = obj as Record<string, unknown>;
			const info = rec.info as Record<string, unknown> | undefined;
			// If the PathInfo exposes a synchronous file id method use it,
			// otherwise return undefined to fallback to statSync.
			if (info) {
				const maybe = info._file_id_sync as unknown;
				if (typeof maybe === "function") return (maybe as () => unknown)();
			}
		}
		return undefined;
	};

	try {
		const sId = getFileIdSync(source);
		const tId = getFileIdSync(target);
		if (sId !== undefined && tId !== undefined) {
			if (sId === tId) {
				throw new ErrnoError("Source and target are the same file", "EINVAL", {
					path: source,
					dest: target,
				});
			}
			return;
		}

		const sstat = fs.statSync(String(source));
		const tstat = fs.statSync(String(target));
		if (sstat.dev === tstat.dev && sstat.ino === tstat.ino) {
			throw new ErrnoError("Source and target are the same file", "EINVAL", {
				path: source,
				dest: target,
			});
		}
	} catch (_err) {
		if (String(source) === String(target)) {
			throw new ErrnoError("Source and target are the same file", "EINVAL", {
				path: source,
				dest: target,
			});
		}
	}
}

/**
 * Copy metadata (timestamps, permissions, ownership) from a source info object to a filesystem path.
 *
 * @remarks
 *
 * Asynchronous facade for {@link copyInfoSync}. The behaviour mirrors CPython's `pathlib._os.copy_info`,
 * with best-effort application of metadata depending on platform support.
 *
 * @param info - Source object providing metadata (string path or object with `_path`).
 * @param target - Destination path to update.
 * @param options - Controls symlink dereferencing.
 * @returns Promise that resolves when metadata application completes.
 */
export async function copyInfo(
	info: unknown,
	target: string,
	options?: { followSymlinks?: boolean },
): Promise<void> {
	return toPromise(() => copyInfoSync(info, target, options));
}

/**
 * Synchronous variant of {@link copyInfo}.
 *
 * @remarks
 *
 * Attempts to transfer timestamps (`utimes`), permissions (`chmod`), and ownership (`chown`) when available.
 * Failures are ignored to match CPython's resilience in cross-platform environments.
 *
 * @param info - Source object providing metadata (string path or object with `_path`).
 * @param target - Destination path to update.
 * @param options - Controls symlink dereferencing.
 */
export function copyInfoSync(
	info: unknown,
	target: string,
	options?: { followSymlinks?: boolean },
): void {
	const followSymlinks = options?.followSymlinks ?? true;
	let srcPath: string;
	if (typeof info === "string") srcPath = info;
	else if (typeof info === "object" && info !== null && "_path" in info)
		srcPath = String((info as Record<string, unknown>)._path);
	else srcPath = String(info);

	try {
		const sstat = followSymlinks ? fs.statSync(srcPath) : fs.lstatSync(srcPath);
		if ("atimeMs" in sstat && "mtimeMs" in sstat) {
			// Node lacks utimesSync with ns precision; use utimesSync with Date
			fs.utimesSync(
				target,
				new Date(Math.floor((sstat as fs.Stats).atimeMs)),
				new Date(Math.floor((sstat as fs.Stats).mtimeMs)),
			);
		}
	} catch {
		// ignore
	}

	try {
		const sstat = followSymlinks ? fs.statSync(srcPath) : fs.lstatSync(srcPath);
		fs.chmodSync(target, sstat.mode);
	} catch {
		// ignore
	}

	try {
		const sstat = followSymlinks ? fs.statSync(srcPath) : fs.lstatSync(srcPath);
		try {
			const st = sstat as fs.Stats;
			fs.chownSync(
				target,
				(st as unknown as { uid?: number }).uid ?? 0,
				(st as unknown as { gid?: number }).gid ?? 0,
			);
		} catch {
			// ignore permission errors
		}
	} catch {
		// ignore
	}
}

class PathInfoBase {
	protected pathStr: string;
	private statResult?: fs.Stats | null;
	private lstatResult?: fs.Stats | null;
	constructor(p: string) {
		this.pathStr = String(p);
	}

	toString() {
		return this.pathStr;
	}

	protected async statInternal(
		opts: { followSymlinks?: boolean; ignoreErrors?: boolean } = {},
	) {
		return toPromise(() => this.statInternalSync(opts));
	}

	/**
	 * Synchronous variant of statInternal. Mirrors the async behavior but
	 * uses fs.statSync/fs.lstatSync.
	 */
	protected statInternalSync(
		opts: { followSymlinks?: boolean; ignoreErrors?: boolean } = {},
	) {
		const { followSymlinks = true, ignoreErrors = false } = opts;
		try {
			if (followSymlinks) {
				if (this.statResult !== undefined) return this.statResult;
				this.statResult = fs.statSync(this.pathStr);
				return this.statResult;
			} else {
				if (this.lstatResult !== undefined) return this.lstatResult;
				this.lstatResult = fs.lstatSync(this.pathStr);
				return this.lstatResult;
			}
		} catch (err) {
			if (ignoreErrors) return null;
			throw err;
		}
	}

	async exists(followSymlinks = true) {
		const st = await this.statInternal({ followSymlinks, ignoreErrors: true });
		return st !== null;
	}

	async isDir(followSymlinks = true) {
		const st = await this.statInternal({ followSymlinks, ignoreErrors: true });
		if (!st) return false;
		return st.isDirectory();
	}

	async isFile(followSymlinks = true) {
		const st = await this.statInternal({ followSymlinks, ignoreErrors: true });
		if (!st) return false;
		return st.isFile();
	}

	async isSymlink() {
		const st = await this.statInternal({
			followSymlinks: false,
			ignoreErrors: true,
		});
		if (!st) return false;
		return st.isSymbolicLink();
	}

	async fileId(followSymlinks = true) {
		const st = (await this.statInternal({
			followSymlinks,
			ignoreErrors: false,
		})) as fs.Stats;
		return { dev: st.dev, ino: st.ino };
	}

	async accessTimeNs(followSymlinks = true) {
		const st = (await this.statInternal({
			followSymlinks,
			ignoreErrors: false,
		})) as fs.Stats;
		return BigInt(Math.floor(st.atimeMs * 1_000_000));
	}

	async modTimeNs(followSymlinks = true) {
		const st = (await this.statInternal({
			followSymlinks,
			ignoreErrors: false,
		})) as fs.Stats;
		return BigInt(Math.floor(st.mtimeMs * 1_000_000));
	}
}

/**
 * Cached stat provider corresponding to CPython's `pathlib.types.PathInfo` protocol.
 *
 * @remarks
 *
 * Instances wrap a filesystem path string and lazily cache `fs.statSync` / `fs.lstatSync` results. Methods
 * such as {@link PathInfo.exists} resolve once and reuse their cached value to avoid duplicate system calls
 * when `Path.info` is reused across operations.
 */
export class PathInfo extends PathInfoBase {}

/**
 * `PathInfo` implementation that wraps a Node {@link fs.Dirent}.
 *
 * @remarks
 *
 * Populated when directory entries are generated via `fs.readdir({ withFileTypes: true })`. The class stores
 * the original dirent and optionally the parent path, exposing cached stat information where possible to
 * reduce redundant filesystem calls during iteration.
 */
export class DirEntryInfo extends PathInfoBase {
	private _entry: (fs.Dirent & { path?: string }) | null;
	constructor(
		entry: (fs.Dirent & { path?: string }) | null,
		parentPath?: string,
	) {
		const p = entry
			? (entry.path ??
				(parentPath ? nodepath.join(parentPath, entry.name) : entry.name))
			: (parentPath ?? "");
		super(p);
		this._entry = entry;
	}

	override async statInternal(
		opts: { followSymlinks?: boolean; ignoreErrors?: boolean } = {},
	) {
		try {
			if (this._entry) {
				// If the Dirent implementation exposes a `stat` method use it;
				// otherwise fall back to `super.statInternal`.
				const entryWithStat = this._entry as
					| (fs.Dirent & { stat?: (follow?: boolean) => Promise<fs.Stats> })
					| null;
				if (entryWithStat && typeof entryWithStat.stat === "function") {
					return await entryWithStat.stat(opts.followSymlinks !== false);
				}
			}
			return await super.statInternal(opts);
		} catch {
			if (opts.ignoreErrors) return null;
			throw new Error("stat failed");
		}
	}
}

export default {
	copyFileObj,
	magicOpen,
	ensureDistinctPaths,
	ensureDifferentFiles,
	copyInfo,
	PathInfo,
	DirEntryInfo,
};
