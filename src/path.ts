import fs, { type Dirent, type Stats } from "node:fs";
import nodeos from "node:os";
import nodepath from "node:path";
import {
	DirEntryInfo,
	ensureDistinctPaths,
	magicOpen,
	PathInfo,
} from "./os.js";
import {
	isWindows,
	normalizeForParser,
	type PathLike,
	PurePath,
	PurePosixPath,
	PureWindowsPath,
	posixParser,
	UnsupportedOperation,
	windowsParser,
} from "./purepath.js";
import { toPromise } from "./util.js";

type WalkTuple = [Path, string[], string[]];

function selectPurePathCtor(): typeof PurePath {
	return isWindows ? PureWindowsPath : PurePosixPath;
}

/**
 * PurePath subclass that can make system calls.
 *
 * Path represents a filesystem path but unlike PurePath, also offers
 * methods to do system calls on path objects. Depending on your system,
 * instantiating a Path will return either a PosixPath or a WindowsPath
 * object. You can also instantiate a PosixPath or WindowsPath directly,
 * but cannot instantiate a WindowsPath on a POSIX system or vice versa.
 *
 * Docstring copied from CPython 3.14 pathlib.Path.
 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path
 */
export class Path extends (selectPurePathCtor() as typeof PurePath) {
	// Path.infoCache may store a PathInfo or a DirEntryInfo created by
	// readdir with file-type information. Widen the type to avoid unsafe casts.
	protected infoCache?: PathInfo | DirEntryInfo;

	override withSegments<T extends PurePath>(
		this: T,
		...segments: Array<PathLike>
	): T {
		const ctor = this.constructor as new (...args: Array<PathLike>) => T;
		return new ctor(...segments);
	}

	/**
	 * A PathInfo object that exposes the file type and other file attributes of
	 * this path.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.info.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.info
	 */
	get info(): PathInfo {
		if (!this.infoCache) {
			this.infoCache = new PathInfo(this.toString());
		}
		return this.infoCache;
	}

	/**
	 * Synchronous variant of {@link Path.stat}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.stat
	 */
	statSync(options?: { followSymlinks?: boolean }): Stats {
		const follow = options?.followSymlinks ?? true;
		return follow
			? fs.statSync(this.toString())
			: fs.lstatSync(this.toString());
	}

	/**
	 * Return the result of the `stat()` system call on this path, like
	 * `os.stat()` does.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.stat.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.stat
	 */
	stat(options?: { followSymlinks?: boolean }): Promise<Stats> {
		return toPromise(() => this.statSync(options));
	}

	/**
	 * Synchronous variant of {@link Path.lstat}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.lstat
	 */
	lstatSync(): Stats {
		return fs.lstatSync(this.toString());
	}

	/**
	 * Like {@link Path.stat}, except if the path points to a symlink, the
	 * symlink's status information is returned, rather than its target's.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.lstat.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.lstat
	 */
	lstat(): Promise<Stats> {
		return toPromise(() => this.lstatSync());
	}

	/**
	 * Synchronous variant of {@link Path.exists}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.exists
	 */
	existsSync(options?: { followSymlinks?: boolean }): boolean {
		if (options?.followSymlinks === false) {
			try {
				fs.lstatSync(this.toString());
				return true;
			} catch {
				return false;
			}
		}
		return fs.existsSync(this.toString());
	}

	/**
	 * Whether this path exists. This method normally follows symlinks; to check
	 * whether a symlink exists, add the argument `followSymlinks: false`.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.exists.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.exists
	 */
	exists(options?: { followSymlinks?: boolean }): Promise<boolean> {
		return toPromise(() => this.existsSync(options));
	}

	/**
	 * Synchronous variant of {@link Path.isDir}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.is_dir
	 */
	isDirSync(options?: { followSymlinks?: boolean }): boolean {
		const follow = options?.followSymlinks ?? true;
		try {
			const stats = follow
				? fs.statSync(this.toString())
				: fs.lstatSync(this.toString());
			return stats.isDirectory();
		} catch {
			return false;
		}
	}

	/**
	 * Whether this path is a directory.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.is_dir.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.is_dir
	 */
	isDir(options?: { followSymlinks?: boolean }): Promise<boolean> {
		return toPromise(() => this.isDirSync(options));
	}

	/**
	 * Synchronous variant of {@link Path.isFile}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.is_file
	 */
	isFileSync(options?: { followSymlinks?: boolean }): boolean {
		const follow = options?.followSymlinks ?? true;
		try {
			const stats = follow
				? fs.statSync(this.toString())
				: fs.lstatSync(this.toString());
			return stats.isFile();
		} catch {
			return false;
		}
	}

	/**
	 * Whether this path is a regular file (also true for symlinks pointing to
	 * regular files).
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.is_file.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.is_file
	 */
	isFile(options?: { followSymlinks?: boolean }): Promise<boolean> {
		return toPromise(() => this.isFileSync(options));
	}

	/**
	 * Synchronous variant of {@link Path.isSymlink}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.is_symlink
	 */
	isSymlinkSync(): boolean {
		try {
			return fs.lstatSync(this.toString()).isSymbolicLink();
		} catch {
			return false;
		}
	}

	/**
	 * Whether this path is a symbolic link.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.is_symlink.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.is_symlink
	 */
	isSymlink(): Promise<boolean> {
		return toPromise(() => this.isSymlinkSync());
	}

	/**
	 * Synchronous variant of {@link Path.iterdir}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.iterdir
	 */
	iterdirSync(): Path[] {
		const root = this.toString();
		const entries = fs.readdirSync(root, { withFileTypes: true });
		return entries.map((entry: Dirent) => {
			const childPath =
				root === "." ? entry.name : nodepath.join(root, entry.name);
			const child = this.withSegments(childPath) as Path;
			child.infoCache = new DirEntryInfo(entry, root);
			return child;
		});
	}

	/**
	 * Yield path objects of the directory contents. The children are yielded in
	 * arbitrary order, and the special entries '.' and '..' are not included.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.iterdir.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.iterdir
	 */
	iterdir(): Promise<Path[]> {
		return toPromise(() => this.iterdirSync());
	}

	private globSyncInternal(pattern: string, options?: fs.GlobOptions): Path[] {
		const parser = this.parser;
		const normalizedPattern = normalizeForParser(parser, pattern);
		const anchor = this.toString();
		const targetPattern = parser.join(anchor, normalizedPattern);
		const globOptions = {
			...(options ?? {}),
			withFileTypes: false,
		} as fs.GlobOptions;
		const globFn = fs.globSync;
		if (typeof globFn !== "function") {
			throw new UnsupportedOperation(
				"fs.globSync is unavailable in this runtime",
			);
		}
		const matches = globFn(targetPattern, globOptions) as string[];
		return matches.map((match) => this.withSegments(match) as Path);
	}

	/**
	 * Synchronous variant of {@link Path.glob}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.glob
	 */
	globSync(pattern: string, options?: fs.GlobOptions): Path[] {
		return this.globSyncInternal(pattern, options);
	}

	/**
	 * Iterate over this subtree and yield all existing files (of any kind,
	 * including directories) matching the given relative pattern.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.glob.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.glob
	 *
	 * ---
	 *
	 * Throws UnsupportedOperation if runtime does not provide `fs.glob`
	 */
	glob(pattern: string, options?: fs.GlobOptions): Promise<Path[]> {
		return toPromise(() => this.globSyncInternal(pattern, options));
	}

	/**
	 * Synchronous variant of {@link Path.rglob}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.rglob
	 */
	rglobSync(pattern: string, options?: fs.GlobOptions): Path[] {
		const parser = this.parser;
		const recursivePattern = parser.join(
			"**",
			normalizeForParser(parser, pattern),
		);
		return this.globSync(recursivePattern, options);
	}

	/**
	 * Recursively yield all existing files (of any kind, including directories)
	 * matching the given relative pattern, anywhere in this subtree.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.rglob.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.rglob
	 */
	rglob(pattern: string, options?: fs.GlobOptions): Promise<Path[]> {
		return toPromise(() => this.rglobSync(pattern, options));
	}

	/**
	 * Synchronous variant of {@link Path.readText}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.read_text
	 */
	readTextSync(encoding: BufferEncoding = "utf8"): string {
		return fs.readFileSync(this.toString(), { encoding });
	}

	/**
	 * Open the file in text mode, read it, and close the file.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.read_text.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.read_text
	 */
	readText(encoding: BufferEncoding = "utf8"): Promise<string> {
		return toPromise(() => this.readTextSync(encoding));
	}

	/**
	 * Synchronous variant of {@link Path.readBytes}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.read_bytes
	 */
	readBytesSync(): Buffer {
		return fs.readFileSync(this.toString());
	}

	/**
	 * Open the file in bytes mode, read it, and close the file.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.read_bytes.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.read_bytes
	 */
	readBytes(): Promise<Buffer> {
		return toPromise(() => this.readBytesSync());
	}

	/**
	 * Synchronous variant of {@link Path.writeText}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.write_text
	 */
	writeTextSync(data: string, encoding: BufferEncoding = "utf8"): void {
		fs.writeFileSync(this.toString(), data, { encoding });
	}

	/**
	 * Open the file in text mode, write to it, and close the file.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.write_text.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.write_text
	 */
	writeText(data: string, encoding: BufferEncoding = "utf8"): Promise<void> {
		return toPromise(() => this.writeTextSync(data, encoding));
	}

	/**
	 * Synchronous variant of {@link Path.writeBytes}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.write_bytes
	 */
	writeBytesSync(data: Buffer | Uint8Array): void {
		fs.writeFileSync(this.toString(), data);
	}

	/**
	 * Open the file in bytes mode, write to it, and close the file.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.write_bytes.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.write_bytes
	 */
	writeBytes(data: Buffer | Uint8Array): Promise<void> {
		return toPromise(() => this.writeBytesSync(data));
	}

	/**
	 * Synchronous variant of {@link Path.open}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.open
	 */
	openSync(mode = "r"): fs.ReadStream {
		return magicOpen(this.toString(), { mode });
	}

	/**
	 * Open the file pointed to by this path and return a file object, as the
	 * built-in `open()` function does.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.open.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.open
	 */
	open(mode = "r"): Promise<fs.ReadStream> {
		return toPromise(() => this.openSync(mode));
	}

	/**
	 * Synchronous variant of {@link Path.touch}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.touch
	 */
	touchSync(options?: { mode?: number; existOk?: boolean }): void {
		const existOk = options?.existOk ?? true;
		const mode = options?.mode ?? 0o666;
		try {
			if (existOk) {
				fs.utimesSync(this.toString(), new Date(), new Date());
				return;
			}
		} catch {
			// fall through to create
		}
		const fd = fs.openSync(this.toString(), existOk ? "a" : "wx", mode);
		fs.closeSync(fd);
	}

	/**
	 * Create this file with the given access mode, if it doesn't exist.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.touch.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.touch
	 */
	touch(options?: { mode?: number; existOk?: boolean }): Promise<void> {
		return toPromise(() => this.touchSync(options));
	}

	/**
	 * Synchronous variant of {@link Path.mkdir}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.mkdir
	 */
	mkdirSync(options?: {
		parents?: boolean;
		existOk?: boolean;
		mode?: number;
	}): void {
		const parents = options?.parents ?? false;
		const existOk = options?.existOk ?? false;
		try {
			fs.mkdirSync(this.toString(), {
				recursive: parents,
				mode: options?.mode,
			});
		} catch (error) {
			const err = error as NodeJS.ErrnoException;
			if (!(existOk && err?.code === "EEXIST")) {
				throw error;
			}
		}
	}

	/**
	 * Create a new directory at this given path.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.mkdir.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.mkdir
	 */
	mkdir(options?: {
		parents?: boolean;
		existOk?: boolean;
		mode?: number;
	}): Promise<void> {
		return toPromise(() => this.mkdirSync(options));
	}

	/**
	 * Synchronous variant of {@link Path.unlink}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.unlink
	 */
	unlinkSync(options?: { missingOk?: boolean }): void {
		try {
			fs.unlinkSync(this.toString());
		} catch (error) {
			const err = error as NodeJS.ErrnoException;
			if (!(options?.missingOk && err?.code === "ENOENT")) {
				throw error;
			}
		}
	}

	/**
	 * Remove this file or link. If the path is a directory, use {@link Path.rmdir}
	 * instead.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.unlink.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.unlink
	 */
	unlink(options?: { missingOk?: boolean }): Promise<void> {
		return toPromise(() => this.unlinkSync(options));
	}

	/**
	 * Synchronous variant of {@link Path.rmdir}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.rmdir
	 */
	rmdirSync(): void {
		fs.rmdirSync(this.toString());
	}

	/**
	 * Remove this directory. The directory must be empty.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.rmdir.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.rmdir
	 */
	rmdir(): Promise<void> {
		return toPromise(() => this.rmdirSync());
	}

	/**
	 * Synchronous variant of {@link Path.rename}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.rename
	 */
	renameSync(target: PathLike): Path {
		const destination =
			target instanceof PurePath ? target.toString() : String(target);
		fs.renameSync(this.toString(), destination);
		return this.withSegments(destination) as Path;
	}

	/**
	 * Rename this path to the target path. Returns the new path instance pointing
	 * to the target path.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.rename.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.rename
	 */
	rename(target: PathLike): Promise<Path> {
		return toPromise(() => this.renameSync(target));
	}

	/**
	 * Synchronous variant of {@link Path.replace}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.replace
	 */
	replaceSync(target: PathLike): Path {
		const destination =
			target instanceof PurePath ? target.toString() : String(target);
		fs.renameSync(this.toString(), destination);
		return this.withSegments(destination) as Path;
	}

	/**
	 * Rename this path to the target path, overwriting if that path exists.
	 * Returns the new path instance pointing to the target path.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.replace.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.replace
	 */
	replace(target: PathLike): Promise<Path> {
		return toPromise(() => this.replaceSync(target));
	}

	private ensureCopyTargets(destination: Path): void {
		ensureDistinctPaths(this.toString(), destination.toString());
		try {
			const a = fs.statSync(this.toString());
			const b = fs.statSync(destination.toString());
			if (a.dev === b.dev && a.ino === b.ino) {
				throw new Error("Source and target are the same file");
			}
		} catch {
			// ignore errors from stat mismatches
		}
	}

	/**
	 * Synchronous variant of {@link Path.copy}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.copy
	 */
	copySync(
		target: PathLike,
		options?: { preserveMetadata?: boolean; followSymlinks?: boolean },
	): Path {
		const destination =
			target instanceof Path ? target : (this.withSegments(target) as Path);
		this.ensureCopyTargets(destination);
		fs.cpSync(this.toString(), destination.toString(), {
			recursive: true,
			dereference: options?.followSymlinks ?? true,
			preserveTimestamps: options?.preserveMetadata ?? false,
		});
		return destination;
	}

	/**
	 * Recursively copy this file or directory tree to the given destination.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.copy.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.copy
	 */
	copy(
		target: PathLike,
		options?: { preserveMetadata?: boolean; followSymlinks?: boolean },
	): Promise<Path> {
		return toPromise(() => this.copySync(target, options));
	}

	/**
	 * Synchronous variant of {@link Path.readlink}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.readlink
	 */
	readlinkSync(): Path {
		const resolved = fs.readlinkSync(this.toString());
		return this.withSegments(resolved) as Path;
	}

	/**
	 * Return the path to which the symbolic link points.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.readlink.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.readlink
	 */
	readlink(): Promise<Path> {
		return toPromise(() => this.readlinkSync());
	}

	/**
	 * Synchronous variant of {@link Path.resolve}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.resolve
	 */
	resolveSync(): Path {
		const resolved = nodepath.resolve(this.toString());
		return this.withSegments(resolved) as Path;
	}

	/**
	 * Make the path absolute, resolving all symlinks on the way and also
	 * normalizing it.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.resolve.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.resolve
	 */
	resolve(): Promise<Path> {
		return toPromise(() => this.resolveSync());
	}

	/**
	 * Synchronous variant of {@link Path.absolute}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.absolute
	 */
	absoluteSync(): Path {
		return this.isAbsolute() ? (this as Path) : this.resolveSync();
	}

	/**
	 * Return an absolute version of this path. No normalization or symlink
	 * resolution is performed. Use {@link Path.resolve} to resolve symlinks and
	 * remove '..' segments.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.absolute.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.absolute
	 */
	absolute(): Promise<Path> {
		return toPromise(() => this.absoluteSync());
	}

	/**
	 * Synchronous variant of {@link Path.expandUser}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.expanduser
	 */
	expandUserSync(): Path {
		const tail = this.tailParts();
		const first = tail[0];
		if (!this.drive && !this.root && first && first.startsWith("~")) {
			const home = nodeos.homedir();
			if (!home) throw new Error("Could not determine home directory");
			const segments = [...tail];
			segments[0] = first.replace(/^~[\w-]*/, home);
			return this.cloneFromParts("", "", segments) as Path;
		}
		return this as Path;
	}

	/**
	 * Return a new path with expanded `~` and `~user` constructs (as returned by
	 * `os.path.expanduser`).
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.expanduser.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.expanduser
	 */
	expandUser(): Promise<Path> {
		return toPromise(() => this.expandUserSync());
	}

	/**
	 * Synchronous variant of {@link Path.cwd}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.cwd
	 */
	static cwdSync(): Path {
		const cwd = process.cwd();
		const instance = new Path(cwd);
		instance.strCache = cwd;
		return instance;
	}

	/**
	 * Return a new path pointing to the current working directory.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.cwd.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.cwd
	 */
	static cwd(): Promise<Path> {
		return toPromise(() => Path.cwdSync());
	}

	/**
	 * Synchronous variant of {@link Path.home}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.home
	 */
	static homeSync(): Path {
		const home = nodeos.homedir();
		if (!home) throw new Error("Could not determine home directory");
		return new Path(home);
	}

	/**
	 * Return a new path pointing to `expanduser('~')`.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.home.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.home
	 */
	static home(): Promise<Path> {
		return toPromise(() => Path.homeSync());
	}

	/**
	 * Synchronous variant of {@link Path.walk}.
	 *
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.walk
	 */
	walkSync(options?: { topDown?: boolean }): WalkTuple[] {
		const topDown = options?.topDown ?? true;
		const records: WalkTuple[] = [];
		const visit = (current: Path) => {
			const dirs: string[] = [];
			const files: string[] = [];
			for (const entry of current.iterdirSync()) {
				if (entry.isDirSync()) dirs.push(entry.name);
				else files.push(entry.name);
			}
			if (topDown) records.push([current, [...dirs], [...files]]);
			for (const dir of dirs) visit(current.joinpath(dir) as Path);
			if (!topDown) records.push([current, [...dirs], [...files]]);
		};
		visit(this);
		return records;
	}

	/**
	 * Walk the directory tree from this directory, similar to `os.walk()`.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.walk.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.walk
	 */
	walk(options?: { topDown?: boolean }): Promise<WalkTuple[]> {
		return toPromise(() => this.walkSync(options));
	}
}

/**
 * Path subclass for non-Windows systems. On a POSIX system, instantiating a
 * Path should return this object.
 *
 * Docstring copied from CPython 3.14 pathlib.PosixPath.
 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PosixPath
 */
export class PosixPath extends Path {
	static override parser = posixParser;
}

/**
 * Path subclass for Windows systems. On a Windows system, instantiating a Path
 * should return this object.
 *
 * Docstring copied from CPython 3.14 pathlib.WindowsPath.
 * @see https://docs.python.org/3/library/pathlib.html#pathlib.WindowsPath
 */
export class WindowsPath extends Path {
	static override parser = windowsParser;
}

export const DefaultPath = isWindows ? WindowsPath : PosixPath;
