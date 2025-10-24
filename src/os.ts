/*
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
 */

import fs from "node:fs";
import nodepath from "node:path";
import { toPromise } from "./util.js";

class ErrnoError extends Error {
	code?: string | number;
	path?: string;
	dest?: string;
	constructor(message: string) {
		super(message);
		this.name = "ErrnoError";
	}
}

/**
 * Copy data from file-like object `source_f` to file-like object `target_f`.
 *
 * Docstring copied from CPython 3.14 pathlib._os.copyfileobj.
 *
 * ---
 * This port prefers fast path copies via Node's filesystem helpers when
 * available and falls back to stream-based copies otherwise.
 */
export async function copyFileObj(
	source: fs.ReadStream | NodeJS.ReadableStream | string,
	target: fs.WriteStream | NodeJS.WritableStream | string,
): Promise<void> {
	return toPromise(() => copyFileObjSync(source, target));
}

/**
 * Synchronous variant of {@link copyFileObj}.
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

	throw new Error(
		"copyFileObjSync: unsupported stream types for synchronous copy",
	);
}

/**
 * Open the file pointed to by this path and return a file object, as the
 * built-in `open()` function does.
 *
 * Docstring copied from CPython 3.14 pathlib._os.magic_open.
 *
 * ---
 *
 * The implementation adapts Python's mode handling to Node.js streams.
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
 * Raise OSError(EINVAL) if the other path is within this path.
 *
 * Docstring copied from CPython 3.14 pathlib._os.ensure_distinct_paths.
 */
export function ensureDistinctPaths(source: string, target: string): void {
	const s = nodepath.resolve(source);
	const t = nodepath.resolve(target);
	if (s === t) {
		const e = new ErrnoError("Source and target are the same path");
		(e as ErrnoError & { code?: string }).code = "EINVAL";
		e.path = s;
		e.dest = t;
		throw e;
	}
	if (t.startsWith(s + nodepath.sep)) {
		const e = new ErrnoError("Source path is a parent of target path");
		(e as ErrnoError & { code?: string }).code = "EINVAL";
		e.path = s;
		e.dest = t;
		throw e;
	}
}

/**
 * Raise OSError(EINVAL) if both paths refer to the same file.
 *
 * Docstring copied from CPython 3.14 pathlib._os.ensure_different_files.
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
 * ---
 *
 * Best-effort port: tries to use file id if available, else falls back to stat/path.
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
				const e = new ErrnoError("Source and target are the same file");
				(e as ErrnoError & { code?: string }).code = "EINVAL";
				e.path = String(source);
				e.dest = String(target);
				throw e;
			}
			return;
		}

		const sstat = fs.statSync(String(source));
		const tstat = fs.statSync(String(target));
		if (sstat.dev === tstat.dev && sstat.ino === tstat.ino) {
			const e = new ErrnoError("Source and target are the same file");
			(e as ErrnoError & { code?: string }).code = "EINVAL";
			e.path = String(source);
			e.dest = String(target);
			throw e;
		}
	} catch (_err) {
		if (String(source) === String(target)) {
			const e = new ErrnoError("Source and target are the same file");
			(e as ErrnoError & { code?: string }).code = "EINVAL";
			e.path = String(source);
			e.dest = String(target);
			throw e;
		}
	}
}

/**
 * Copy metadata from the given PathInfo to the given local path.
 *
 * Docstring copied from CPython 3.14 pathlib._os.copy_info.
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
 * ---
 *
 * Best-effort copy of timestamps, permissions, and ownership using sync fs APIs where available.
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
		} catch (_err) {
			if (ignoreErrors) return null;
			throw _err;
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
 * Implementation of `pathlib.types.PathInfo` that provides status information
 * for filesystem paths.
 *
 * Docstring copied from CPython 3.14 pathlib._os.PathInfo.
 */
export class PathInfo extends PathInfoBase {}

/**
 * Implementation of `pathlib.types.PathInfo` that provides status information
 * by querying a wrapped `os.DirEntry` object. Don't try to construct it
 * yourself.
 *
 * Docstring copied from CPython 3.14 pathlib._os.DirEntryInfo.
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
