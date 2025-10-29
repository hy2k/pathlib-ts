import fs, { type Dir, type Dirent, type Stats } from "node:fs";
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

/**
 * Tuple returned by {@link Path.walk} mirroring CPython's `(dirpath, dirnames, filenames)` shape.
 *
 * @remarks
 *
 * The first element is the directory being visited, followed by shallow copies of the names reported in
 * that directory. Mutating the `dirnames` array during a top-down walk prevents traversal into the removed
 * entries, aligning with CPython's documented behaviour.
 */
export type WalkTuple = [Path, string[], string[]];

/**
 * Policy for resolving how the `other` argument should be treated.
 *
 * @remarks
 *
 * Applied by {@link Path.relativeTo} and {@link Path.isRelativeTo} when computing relationships between
 * concrete paths. Policies extend CPython's lexical semantics with an optional asynchronous probe for JS
 * module resolution scenarios.
 *
 * - `"exact"` (default): perform a purely lexical comparison, matching CPython's behaviour.
 * - `"parent"`: anchor relative operations to `other.parent` without touching the filesystem.
 * - `"auto"`: probe the filesystem to decide whether `other` should be treated as a directory. This may
 *   require I/O and therefore produces a `Promise`.
 */
export type ResolutionPolicy = "auto" | "parent" | "exact";

type PathRelativeToOptions = {
	walkUp?: boolean;
	extra?: {
		policy?: ResolutionPolicy;
		followSymlinks?: boolean;
	};
};

type PathIsRelativeToOptions = {
	extra?: {
		policy?: ResolutionPolicy;
		followSymlinks?: boolean;
		walkUp?: boolean;
	};
};

type PathOptionsArg<T> = T | undefined;

type ExtractPolicy<T> = T extends { extra: { policy: infer P } }
	? P
	: T extends { extra?: { policy?: infer P } }
		? P
		: undefined;

type PathRelativeToReturn<
	Options extends PathOptionsArg<PathRelativeToOptions>,
> = ExtractPolicy<Options> extends "auto" ? Promise<PurePath> : PurePath;

type PathIsRelativeToReturn<
	Options extends PathOptionsArg<PathIsRelativeToOptions>,
> = ExtractPolicy<Options> extends "auto" ? Promise<boolean> : boolean;

type PathRelativeToFn = <
	Options extends PathOptionsArg<PathRelativeToOptions> = undefined,
>(
	other: PathLike,
	options?: Options,
) => PathRelativeToReturn<Options>;

type PathIsRelativeToFn = <
	Options extends PathOptionsArg<PathIsRelativeToOptions> = undefined,
>(
	other: PathLike,
	options?: Options,
) => PathIsRelativeToReturn<Options>;

function selectPurePathCtor(): typeof PurePath {
	return isWindows ? PureWindowsPath : PurePosixPath;
}

/**
 * Concrete path that layers filesystem I/O on top of {@link PurePath} semantics.
 *
 * @remarks
 *
 * Mirrors {@link https://docs.python.org/3/library/pathlib.html#concrete-paths | CPython's `pathlib.Path`}.
 * The runtime selects {@link PosixPath} or {@link WindowsPath} during construction so the instance can call
 * into Node's filesystem APIs safely. Each I/O method provides an asynchronous default that resolves to a
 * promise, alongside a synchronous companion suffixed with `Sync`, preserving ergonomic parity with the
 * reference implementation while embracing JavaScript's async-first patterns.
 *
 * `Path` also introduces {@link ResolutionPolicy | policy-driven} behaviour for relative computations to
 * accommodate module-resolution workflows common in the JS ecosystem. The lexical defaults remain faithful
 * to CPython.
 *
 * @example Reading text from a sibling file
 * ```ts
 * import { Path } from "pathlib-ts";
 *
 * const readme = new Path("./README.md");
 * const contents = await readme.readText();
 *
 * console.log(contents.slice(0, 40));
 * ```
 *
 * @see https://docs.python.org/3/library/pathlib.html#concrete-paths
 *
 * @privateRemarks
 *
 * PurePath subclass that can make system calls. Path represents a filesystem
 * path but unlike PurePath, also offers methods to do system calls on path
 * objects. Depending on your system, instantiating a Path will return either a
 * PosixPath or a WindowsPath object. You can also instantiate a PosixPath or
 * WindowsPath directly, but cannot instantiate a WindowsPath on a POSIX system
 * or vice versa.
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
	 * Return the relative path to another path identified by the passed
	 * arguments. If the operation is not possible (because this is not related
	 * to the other path), raise ValueError.
	 *
	 * @remarks
	 *
	 * The *walkUp* parameter controls whether `..` may be used to resolve the
	 * path.
	 *
	 * - `"parent"` — do not touch the filesystem, always anchor at
	 * `other.parent`.
	 * - `"exact"` — unchanged CPython semantics (default).
	 * - `"auto"` — uses `stat`/`lstat` under the hoodset `extra.followSymlinks` to control how symlinks are treated.
	 *
	 * By default the method behaves like CPython (`policy: "exact"`). Specify
	 * `options.extra.policy` to opt into import-friendly behaviour (`"auto"`) or a lexical parent anchor (`"parent"`).
	 * When `policy === "auto"` the operation may consult the filesystem and therefore returns a promise. See
	 * `docs/caveats.md` for nuance around symlinks and module resolution.
	 *
	 * @example Relative path for colocated assets while mirroring JS module semantics
	 *
	 * ```ts
	 * const asset = new Path("/src/assets/img.webp");
	 * const content = new Path("/src/foo/bar/content.mdx");
	 * const relative = await asset.relativeTo(content, {
	 *   walkUp: true,
	 *   extra: { policy: "auto" }
	 * });
	 * console.log(relative.toString()); // '../../assets/img.webp'
	 * ```
	 *
	 * @param other - The anchor path to compare against.
	 * @param options - Behavioural toggles controlling lexical vs filesystem-based policies.
	 * @returns A {@link PurePath} or `Promise<PurePath>` depending on the selected policy.
	 * @throws {@link Error} When the paths are unrelated and `walkUp` is not permitted.
	 */
	override relativeTo: PathRelativeToFn = ((
		other: PathLike,
		options?: PathRelativeToOptions,
	) => {
		const policy: ResolutionPolicy = options?.extra?.policy ?? "exact";
		const walkUp = options?.walkUp;
		const followSymlinks = options?.extra?.followSymlinks ?? true;
		const target = this.coerceToPath(other);

		const applyRelative = (base: PurePath): PurePath => {
			if (walkUp === undefined) {
				return super.relativeTo(base);
			}
			return super.relativeTo(base, { walkUp });
		};

		if (policy === "parent") {
			const parent = target.dropSegments(1);
			return applyRelative(parent);
		}

		if (policy === "auto") {
			return (async () => {
				const directory = await target.isDir({ followSymlinks });
				const base = directory ? target : target.dropSegments(1);
				return applyRelative(base);
			})() satisfies Promise<PurePath>;
		}

		return applyRelative(target);
	}) as PathRelativeToFn; // cast keeps overload resolution intact while allowing union return

	/**
	 * Determines whether this path can be expressed relative to another according to the selected policy.
	 *
	 * @remarks
	 *
	 * Policies mirror {@link Path.relativeTo}. `policy: "auto"` triggers asynchronous I/O to validate the
	 * anchor, so the method returns a promise in that case. Use this before attempting a relative conversion to avoid
	 * handling exceptions.
	 *
	 * @param other - Anchor path used to test relativity.
	 * @param options - Behavioural options (including {@link ResolutionPolicy}) controlling how `other` is interpreted.
	 * @returns Either a boolean or a `Promise<boolean>` depending on the selected policy.
	 */
	override isRelativeTo: PathIsRelativeToFn = ((
		other: PathLike,
		options?: PathIsRelativeToOptions,
	) => {
		const extraOptions = options?.extra;
		const policy: ResolutionPolicy = extraOptions?.policy ?? "exact";
		const followSymlinks = extraOptions?.followSymlinks ?? true;
		const walkUp = extraOptions?.walkUp;
		const target = this.coerceToPath(other);

		// If policy is not "auto", no filesystem I/O is needed and we can
		// delegate to PurePath's lexical implementation. This keeps behavior
		// fast and deterministic. For the "parent" policy, use the
		// parent's PurePath before delegating.
		if (policy !== "auto") {
			const base: PurePath =
				policy === "parent" ? target.dropSegments(1) : target;

			// PurePath.isRelativeTo expects a PathLike and performs purely
			// lexical checks; it does not accept walkUp options. When
			// walkUp is requested we need to call relativeTo with the walkUp
			// option and catch exceptions (still synchronous for non-auto).
			if (walkUp === undefined) {
				return super.isRelativeTo(base);
			}

			try {
				// Call the existing synchronous relativeTo with walkUp option
				// to determine relativity when upward traversal is allowed.
				this.relativeTo(base, { walkUp });
				return true;
			} catch {
				return false;
			}
		}

		// For "auto" we must perform I/O to decide whether to treat the
		// anchor as a directory or its parent. This is asynchronous.
		return (async () => {
			try {
				await this.relativeTo(target, {
					...(walkUp !== undefined ? { walkUp } : {}),
					extra: { policy: "auto", followSymlinks },
				});
				return true;
			} catch {
				return false;
			}
		})();
	}) as PathIsRelativeToFn; // cast keeps overload resolution intact while allowing union return

	private coerceToPath(value: PathLike): Path {
		if (value instanceof Path) {
			return value;
		}
		if (value instanceof PurePath) {
			return this.withSegments(value.toString()) satisfies Path;
		}
		return this.withSegments(value) satisfies Path;
	}

	/**
	 * Provides cached stat-like information gathered during directory iteration.
	 *
	 * @remarks
	 *
	 * When the path originates from {@link Path.iterdir} with `withFileTypes: true`, this accessor exposes the
	 * cached {@link DirEntryInfo}. Calling {@link Path.isDir} or {@link Path.stat} refreshes data when necessary.
	 *
	 * @returns A cached {@link PathInfo} or {@link DirEntryInfo} object.
	 */
	get info(): PathInfo | DirEntryInfo {
		if (!this.infoCache) {
			this.infoCache = new PathInfo(this.toString());
		}
		return this.infoCache;
	}

	/**
	 * Retrieves filesystem metadata synchronously.
	 *
	 * @remarks
	 *
	 * Pass `followSymlinks: false` to mirror `lstat`. Mirrors Node's `fs.statSync`/`fs.lstatSync` while
	 * preserving CPython semantics.
	 *
	 * @privateRemarks
	 *
	 * Synchronous variant of {@link Path.stat}.
	 *
	 * @param options - Optional follow-symlink toggle.
	 * @returns Node.js {@link Stats} describing the path.
	 */
	statSync(options?: { followSymlinks?: boolean }): Stats {
		const follow = options?.followSymlinks ?? true;
		return follow
			? fs.statSync(this.toString())
			: fs.lstatSync(this.toString());
	}

	/**
	 * Returns filesystem metadata asynchronously.
	 *
	 * @remarks
	 *
	 * Accepts `followSymlinks` to align with CPython behaviour.
	 *
	 * @privateRemarks
	 *
	 * Resolves through the runtime's promise helper so it matches the async-first design.
	 *
	 * @param options - Optional follow-symlink toggle.
	 * @returns A promise that resolves with {@link Stats} information.
	 */
	stat(options?: { followSymlinks?: boolean }): Promise<Stats> {
		return toPromise(() => this.statSync(options));
	}

	/**
	 * Retrieves symlink metadata synchronously.
	 *
	 * @remarks
	 *
	 * Delegates to `fs.lstatSync`, exposing the symlink's own information even when it points elsewhere.
	 *
	 * @privateRemarks
	 *
	 * Synchronous variant of {@link Path.lstat}.
	 *
	 * @returns {@link Stats} describing the link entry.
	 */
	lstatSync(): Stats {
		return fs.lstatSync(this.toString());
	}

	/**
	 * Asynchronously retrieves metadata about a symlink rather than its target.
	 * Like {@link Path.stat}, except if the path points to a symlink, the
	 * symlink's status information is returned, rather than its target's.
	 *
	 * @remarks
	 *
	 * Mirrors CPython's `Path.lstat()` and Node's `fs.lstat` behaviour.
	 *
	 * @returns A promise resolving to {@link Stats} for the link itself.
	 */
	lstat(): Promise<Stats> {
		return toPromise(() => this.lstatSync());
	}

	/**
	 * Checks for path existence synchronously.
	 *
	 * @remarks
	 *
	 * Supports `followSymlinks: false` to test dangling links, matching CPython's API.
	 *
	 * @privateRemarks
	 *
	 * Synchronous variant of {@link Path.exists}.
	 *
	 * @param options - Optional follow-symlink toggle.
	 * @returns `true` if the path exists (following symlinks by default).
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
	 * Resolves to `true` when the path exists.
	 *
	 * @remarks
	 *
	 * Follows symlinks by default; pass `followSymlinks: false` to check whether symlink exists.
	 *
	 * @param options - Optional follow-symlink toggle.
	 * @returns A promise resolving to a boolean indicating existence.
	 */
	exists(options?: { followSymlinks?: boolean }): Promise<boolean> {
		return toPromise(() => this.existsSync(options));
	}

	/**
	 * Tests whether the path is a directory synchronously.
	 *
	 * @remarks
	 *
	 * Returns `false` for missing paths and surfaces symlink handling via `followSymlinks`.
	 *
	 * @privateRemarks
	 *
	 * Synchronous variant of {@link Path.isDir}.
	 *
	 * @param options - Optional follow-symlink toggle.
	 * @returns `true` when the path is a directory.
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
	 * Resolves to `true` when the path points to a directory.
	 *
	 * @remarks
	 *
	 * Promise wrapper around {@link Path.isDirSync}; match CPython semantics with `followSymlinks`.
	 *
	 * @param options - Optional follow-symlink toggle.
	 * @returns Promise resolving to `true` when the path is a directory.
	 */
	isDir(options?: { followSymlinks?: boolean }): Promise<boolean> {
		return toPromise(() => this.isDirSync(options));
	}

	/**
	 * Tests whether the path is a regular file synchronously.
	 *
	 * @remarks
	 *
	 * Control symlink resolution with `followSymlinks`, mirroring CPython.
	 *
	 * @privateRemarks
	 *
	 * Synchronous variant of {@link Path.isFile}.
	 *
	 * @param options - Optional follow-symlink toggle.
	 * @returns `true` when the path points at a file.
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
	 * Resolves to `true` when the path points to a regular file (`also` true for
	 * symlinks pointing to regular files).
	 *
	 * @remarks
	 *
	 * Follows symlinks by default; pass `followSymlinks: false` to interrogate the link itself.
	 *
	 * @param options - Optional follow-symlink toggle.
	 * @returns Promise resolving to `true` when the path is a regular file.
	 */
	isFile(options?: { followSymlinks?: boolean }): Promise<boolean> {
		return toPromise(() => this.isFileSync(options));
	}

	/**
	 * Determines synchronously whether the path points to a symbolic link.
	 *
	 * @remarks
	 *
	 * Wraps `fs.lstatSync` to mirror CPython semantics.
	 *
	 * @privateRemarks Synchronous variant of {@link Path.isSymlink}.
	 *
	 * @returns `true` when the entry is a symbolic link.
	 */
	isSymlinkSync(): boolean {
		try {
			return fs.lstatSync(this.toString()).isSymbolicLink();
		} catch {
			return false;
		}
	}

	/**
	 * Resolves to `true` when the path is a symbolic link.
	 *
	 * @remarks Promise wrapper around {@link Path.isSymlinkSync}.
	 *
	 * @returns Promise resolving to `true` when the entry is a symbolic link.
	 */
	isSymlink(): Promise<boolean> {
		return toPromise(() => this.isSymlinkSync());
	}

	/**
	 * Enumerates directory contents synchronously.
	 *
	 * @remarks
	 *
	 * Set `extra.withFileTypes` to receive native {@link Dirent} objects;
	 * otherwise {@link Path} instances are returned, mirroring CPython.
	 *
	 * @remarks Synchronous variant of {@link Path.iterdir}.
	 *
	 * @param options - Optional flags controlling the return type.
	 * @returns Directory entries as {@link Path} objects or {@link Dirent}s.
	 * @throws {@link UnsupportedOperation} When requesting `withFileTypes` on a runtime without support.
	 */
	iterdirSync(options?: { extra?: { withFileTypes?: false } }): Path[];
	iterdirSync(options: { extra?: { withFileTypes: true } }): Dirent[];
	iterdirSync(options?: {
		extra?: { withFileTypes?: boolean };
	}): Path[] | Dirent[] {
		const root = this.toString();
		const withFileTypes = options?.extra?.withFileTypes === true;

		if (withFileTypes) {
			Path.ensureDirentSupport();
			return fs.readdirSync(root, { withFileTypes: true });
		}

		if (Path.hasDirentSupport()) {
			const entries = fs.readdirSync(root, { withFileTypes: true });
			return entries.map((entry) => this.createChildFromDirent(entry, root));
		}

		const dirnames = fs.readdirSync(root);
		return dirnames.map((dirname) =>
			this.createChildFromDirname(dirname, root),
		);
	}

	/**
	 * Resolves directory entries asynchronously as {@link Path} instances or native {@link Dirent}s.
	 *
	 * @remarks
	 *
	 * Pass `extra.withFileTypes: true` to receive {@link Dirent} objects. Throws
	 * {@link UnsupportedOperation} when the runtime does not support `withFileTypes`.
	 *
	 * @param options - Optional flags controlling the return type.
	 * @returns Promise resolving to directory entries as {@link Path} objects or {@link Dirent}s.
	 * @throws {@link UnsupportedOperation} When requesting `withFileTypes` on a runtime without support.
	 */
	iterdir(options?: { extra?: { withFileTypes?: false } }): Promise<Path[]>;
	iterdir(options: { extra?: { withFileTypes: true } }): Promise<Dirent[]>;
	async iterdir(options?: {
		extra?: { withFileTypes?: boolean };
	}): Promise<Path[] | Dirent[]> {
		const root = this.toString();
		const withFileTypes = options?.extra?.withFileTypes === true;
		const fsPromises = fs.promises;

		if (!fsPromises || typeof fsPromises.readdir !== "function") {
			if (withFileTypes) {
				Path.ensureDirentSupport();
				return Promise.resolve(fs.readdirSync(root, { withFileTypes: true }));
			}

			if (Path.hasDirentSupport()) {
				const entries = fs.readdirSync(root, { withFileTypes: true });
				return Promise.resolve(
					entries.map((entry) => this.createChildFromDirent(entry, root)),
				);
			}

			const dirnames = fs.readdirSync(root);
			return Promise.resolve(
				dirnames.map((dirname) => this.createChildFromDirname(dirname, root)),
			);
		}

		if (withFileTypes) {
			Path.ensureDirentSupport();
			return fsPromises.readdir(root, { withFileTypes: true });
		}

		if (Path.hasDirentSupport()) {
			const entries = await fsPromises.readdir(root, {
				withFileTypes: true,
			});
			return entries.map((entry) => this.createChildFromDirent(entry, root));
		}

		const dirnames = await fsPromises.readdir(root);
		return dirnames.map((dirname) =>
			this.createChildFromDirname(dirname, root),
		);
	}

	/**
	 * Streams directory entries lazily using async iteration without
	 * materialising the entire directory listing.
	 *
	 * @remarks
	 *
	 * Shares the same `extra.withFileTypes` behaviour as {@link Path.iterdir}. Uses `fs.opendir` when
	 * available to avoid materialising the whole directory; otherwise falls back to buffered reads.
	 * Throws {@link UnsupportedOperation} when `withFileTypes` is requested but not supported.
	 *
	 * @privateRemarks
	 *
	 * Async generator variant of {@link Path.iterdir}.
	 *
	 * @param options - Optional flags controlling the yielded value type.
	 * @returns An async iterable yielding {@link Path} objects or {@link Dirent}s.
	 * @throws {@link UnsupportedOperation} When requesting `withFileTypes` without runtime support.
	 */
	iterdirStream(options?: {
		extra?: { withFileTypes?: false };
	}): AsyncIterable<Path>;
	iterdirStream(options: {
		extra?: { withFileTypes: true };
	}): AsyncIterable<Dirent>;
	iterdirStream(options?: {
		extra?: { withFileTypes?: boolean };
	}): AsyncIterable<Path | Dirent>;
	async *iterdirStream(options?: {
		extra?: { withFileTypes?: boolean };
	}): AsyncIterable<Path | Dirent> {
		const root = this.toString();
		const withFileTypes = options?.extra?.withFileTypes === true;
		const fsPromises = fs.promises;

		if (withFileTypes) {
			Path.ensureDirentSupport();
		}

		if (!fsPromises || typeof fsPromises.readdir !== "function") {
			for (const entry of this.iterdirStreamSync(options)) {
				yield entry;
			}
			return;
		}

		const supportsDirent = Path.hasDirentSupport();

		if (withFileTypes) {
			if (typeof fsPromises.opendir === "function") {
				let dirHandle: Dir | undefined;
				try {
					dirHandle = await fsPromises.opendir(root);
					for await (const entry of dirHandle) {
						yield entry;
					}
				} finally {
					if (dirHandle) {
						try {
							await dirHandle.close();
						} catch {
							// ignore close errors
						}
					}
				}
				return;
			}

			const entries = await fsPromises.readdir(root, {
				withFileTypes: true,
			});
			for (const entry of entries) {
				yield entry;
			}
			return;
		}

		if (supportsDirent && typeof fsPromises.opendir === "function") {
			let dirHandle: Dir | undefined;
			try {
				dirHandle = await fsPromises.opendir(root);
				for await (const entry of dirHandle) {
					yield this.createChildFromDirent(entry, root);
				}
			} finally {
				if (dirHandle) {
					try {
						await dirHandle.close();
					} catch {
						// ignore close errors
					}
				}
			}
			return;
		}

		if (supportsDirent) {
			const entries = await fsPromises.readdir(root, {
				withFileTypes: true,
			});
			for (const entry of entries) {
				yield this.createChildFromDirent(entry, root);
			}
			return;
		}

		const dirnames = await fsPromises.readdir(root);
		for (const dirname of dirnames) {
			yield this.createChildFromDirname(dirname, root);
		}
	}

	/**
	 * Streams directory entries synchronously using generators.
	 *
	 * @remarks
	 *
	 * Prefers `fs.opendirSync` for efficient iteration and falls back to `fs.readdirSync`.
	 *
	 * @privateRemarks
	 *
	 * Synchronous counterpart of {@link Path.iterdirStream}. Uses `fs.opendirSync`
	 * when available and falls back to `fs.readdirSync` otherwise.
	 *
	 * @param options - Optional flags controlling the yielded value type.
	 * @returns An iterable emitting {@link Path} objects or {@link Dirent}s.
	 * @throws {@link UnsupportedOperation} When requesting `withFileTypes` without runtime support.
	 */
	iterdirStreamSync(options?: {
		extra?: { withFileTypes?: false };
	}): Iterable<Path>;
	iterdirStreamSync(options: {
		extra?: { withFileTypes: true };
	}): Iterable<Dirent>;
	iterdirStreamSync(options?: {
		extra?: { withFileTypes?: boolean };
	}): Iterable<Path | Dirent>;
	*iterdirStreamSync(options?: {
		extra?: { withFileTypes?: boolean };
	}): Iterable<Path | Dirent> {
		const root = this.toString();
		const withFileTypes = options?.extra?.withFileTypes === true;
		const supportsDirent = Path.hasDirentSupport();

		if (withFileTypes) {
			Path.ensureDirentSupport();
		}

		if (typeof fs.opendirSync === "function") {
			const dirHandle = fs.opendirSync(root);
			try {
				while (true) {
					const entry = dirHandle.readSync();
					if (!entry) {
						break;
					}
					if (withFileTypes) {
						yield entry;
					} else if (supportsDirent) {
						yield this.createChildFromDirent(entry, root);
					} else {
						yield this.createChildFromDirname(entry.name, root);
					}
				}
			} finally {
				try {
					dirHandle.closeSync();
				} catch {
					// ignore close errors
				}
			}
			return;
		}

		if (withFileTypes) {
			Path.ensureDirentSupport();
			const entries = fs.readdirSync(root, { withFileTypes: true });
			for (const entry of entries) {
				yield entry;
			}
			return;
		}

		if (supportsDirent) {
			const entries = fs.readdirSync(root, { withFileTypes: true });
			for (const entry of entries) {
				yield this.createChildFromDirent(entry, root);
			}
			return;
		}

		const dirnames = fs.readdirSync(root);
		for (const dirname of dirnames) {
			yield this.createChildFromDirname(dirname, root);
		}
	}

	private static hasDirentSupport(): boolean {
		return typeof (fs as { Dirent?: unknown }).Dirent === "function";
	}

	private static ensureDirentSupport(): void {
		if (!Path.hasDirentSupport()) {
			throw new UnsupportedOperation(
				"fs.readdir with { withFileTypes: true } is not supported by this runtime",
			);
		}
	}

	private createChildFromDirent(entry: Dirent, parentPath: string): Path {
		const childPath =
			parentPath === "." ? entry.name : nodepath.join(parentPath, entry.name);
		const child = this.withSegments(childPath) as Path;
		child.infoCache = new DirEntryInfo(entry, parentPath);
		return child;
	}

	private createChildFromDirname(dirname: string, parentPath: string): Path {
		const childPath =
			parentPath === "." ? dirname : nodepath.join(parentPath, dirname);
		const child = this.withSegments(childPath) as Path;
		child.infoCache = new PathInfo(childPath);
		return child;
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
	 * Performs a blocking glob search relative to this subtree and yield all
	 * existing files (of any kind, including directories) matching the given
	 * relative pattern.
	 *
	 * @remarks
	 *
	 * Requires runtime support for `fs.globSync`; otherwise {@link UnsupportedOperation} is thrown.
	 *
	 * @privateRemarks
	 *
	 * Synchronous variant of {@link Path.glob}.
	 *
	 * @param pattern - Glob pattern interpreted relative to this path.
	 * @param options - Options forwarded to Node's `fs.globSync`.
	 * @returns Matching paths as {@link Path} objects.
	 * @throws {@link UnsupportedOperation} If `fs.globSync` is unavailable.
	 */
	globSync(pattern: string, options?: fs.GlobOptions): Path[] {
		return this.globSyncInternal(pattern, options);
	}

	/**
	 * Globs files within this subtree asynchronously. Iterate over this subtree
	 * and yields all existing files (of any kind, including directories)
	 * matching the given relative pattern.
	 *
	 * @remarks
	 *
	 * Matches CPython behaviour but relies on `fs.glob`. Throws {@link UnsupportedOperation} when the runtime
	 * lacks glob support. Options are forwarded to the underlying Node implementation.
	 *
	 * @param pattern - Glob pattern interpreted relative to this path.
	 * @param options - Options forwarded to Node's `fs.glob` implementation.
	 * @returns Promise resolving to matching {@link Path} objects.
	 * @throws {@link UnsupportedOperation} If globbing is not supported.
	 */
	glob(pattern: string, options?: fs.GlobOptions): Promise<Path[]> {
		return toPromise(() => this.globSyncInternal(pattern, options));
	}

	/**
	 * Performs a recursive glob search synchronously.
	 *
	 * @remarks
	 *
	 * Delegates to {@link Path.globSync} using a pattern that prepends the recursive `"**"` segment.
	 *
	 * @privateRemarks
	 *
	 * Synchronous variant of {@link Path.rglob}.
	 *
	 * @param pattern - Glob pattern to evaluate recursively.
	 * @param options - Options forwarded to Node's glob implementation.
	 * @returns Matching {@link Path} objects.
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
	 * Asynchronously performs a recursive glob in this subtree, and yields all
	 * existing files (of any kind, including directories) matching the given
	 * relative pattern.
	 *
	 * @remarks
	 *
	 * Equivalent to prefixing the pattern with the recursive `"**"` segment and calling {@link Path.glob}.
	 * `fs.glob` support.
	 *
	 * @param pattern - Glob pattern to evaluate recursively.
	 * @param options - Options forwarded to Node's glob implementation.
	 * @returns Promise resolving to matching {@link Path} objects.
	 * @throws {@link UnsupportedOperation} If globbing is not supported by the runtime.
	 */
	rglob(pattern: string, options?: fs.GlobOptions): Promise<Path[]> {
		return toPromise(() => this.rglobSync(pattern, options));
	}

	/**
	 * Read the file as text using the provided encoding.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.readText} but executes synchronously.
	 *
	 * @param encoding - Text encoding (defaults to `"utf8"`).
	 * @returns File contents as a string.
	 */
	readTextSync(encoding: BufferEncoding = "utf8"): string {
		return fs.readFileSync(this.toString(), { encoding });
	}

	/**
	 * Read the file as text using the provided encoding and return a promise
	 * that resolves to the decoded contents of pointed-to file as a string.
	 *
	 * @param encoding - Text encoding (defaults to `"utf8"`).
	 * @returns Promise resolving to the text contents.
	 */
	readText(encoding: BufferEncoding = "utf8"): Promise<string> {
		return toPromise(() => this.readTextSync(encoding));
	}

	/**
	 * Read the file as raw bytes.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.readBytes} but executes synchronously.
	 *
	 * @returns File contents as a {@link Buffer}.
	 */
	readBytesSync(): Buffer {
		return fs.readFileSync(this.toString());
	}

	/**
	 * Read the file as raw bytes and return a promise that resolves to the
	 * binary contents of the pointed-to file as a bytes object.
	 *
	 * @returns Promise resolving to the binary contents.
	 */
	readBytes(): Promise<Buffer> {
		return toPromise(() => this.readBytesSync());
	}

	/**
	 * Write the given text to the file using the provided encoding.
	 *
	 * An existing file of the same name is overwritten.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.writeText} but executes synchronously.
	 *
	 * @param data - Text to persist.
	 * @param encoding - Encoding to use (defaults to `"utf8"`).
	 */
	writeTextSync(data: string, encoding: BufferEncoding = "utf8"): void {
		fs.writeFileSync(this.toString(), data, { encoding });
	}

	/**
	 * Asynchronously write the given text to the file using the provided encoding.
	 *
	 * An existing file of the same name is overwritten.
	 *
	 * @param data - Text to persist.
	 * @param encoding - Encoding to use (defaults to `"utf8"`).
	 * @returns Promise that settles once the write completes.
	 */
	writeText(data: string, encoding: BufferEncoding = "utf8"): Promise<void> {
		return toPromise(() => this.writeTextSync(data, encoding));
	}

	/**
	 * Write raw bytes to the file.
	 *
	 * An existing file of the same name is overwritten.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.writeBytes} but executes synchronously.
	 *
	 * @param data - Data to persist.
	 */
	writeBytesSync(data: Buffer | Uint8Array): void {
		fs.writeFileSync(this.toString(), data);
	}

	/**
	 * Asynchronously write raw bytes to the file.
	 *
	 * An existing file of the same name is overwritten.
	 *
	 * @param data - Data to persist.
	 * @returns Promise that settles once the write completes.
	 */
	writeBytes(data: Buffer | Uint8Array): Promise<void> {
		return toPromise(() => this.writeBytesSync(data));
	}

	/**
	 * Open the file with the given mode using the synchronous helper.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.open} but executes synchronously.
	 *
	 * @param mode - CPython-style mode string (for example `"r"`, `"wb"`).
	 * @returns A Node {@link fs.ReadStream} configured for the provided mode.
	 */
	openSync(mode = "r"): fs.ReadStream {
		return magicOpen(this.toString(), { mode });
	}

	/**
	 * Open the file with the given mode and return a Node.js stream-like handle.
	 *
	 * @remarks
	 *
	 * Delegates to {@link magicOpen} to match CPython defaults while
	 * still returning a Node.js compatible stream proxy.
	 *
	 * @param mode - CPython-style mode string (for example `"r"`, `"wb"`).
	 * @returns Promise resolving to a {@link fs.ReadStream}.
	 */
	open(mode = "r"): Promise<fs.ReadStream> {
		return toPromise(() => this.openSync(mode));
	}

	/**
	 * Create the file or update its timestamps synchronously.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.touch} but executes synchronously.
	 *
	 * @param options - File creation behaviour flags (`mode`, `existOk`).
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
	 * Create the file or update its timestamps with optional mode overrides.
	 *
	 * @remarks
	 *
	 * Implements CPython semantics where `existOk` controls whether
	 * existing files are tolerated.
	 *
	 * @param options - File creation behaviour flags (`mode`, `existOk`).
	 * @returns Promise that settles once the touch operation completes.
	 */
	touch(options?: { mode?: number; existOk?: boolean }): Promise<void> {
		return toPromise(() => this.touchSync(options));
	}

	/**
	 * Create a directory synchronously with optional `parents` and `existOk`.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.mkdir} but executes synchronously.
	 *
	 * @param options - POSIX-style creation options (`parents`, `existOk`, `mode`).
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
	 * Create a directory with optional `parents` and `existOk` semantics.
	 *
	 * @remarks
	 *
	 * Delegates to Node's `fs.mkdir` while matching CPython defaults
	 * for parent creation and error handling.
	 *
	 * @param options - POSIX-style creation options (`parents`, `existOk`, `mode`).
	 * @returns Promise that settles once the directory exists.
	 */
	mkdir(options?: {
		parents?: boolean;
		existOk?: boolean;
		mode?: number;
	}): Promise<void> {
		return toPromise(() => this.mkdirSync(options));
	}

	/**
	 * Remove the file or link synchronously.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.unlink} but executes synchronously.
	 *
	 * @param options - Deletion behaviour flags (`missingOk`).
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
	 * Remove this file or link. Use {@link Path.rmdir} for directories.
	 *
	 * @remarks
	 *
	 * Matches CPython behavior for `missingOk`, mapping `ENOENT` to the
	 * expected silent outcome.
	 *
	 * @param options - Deletion behaviour flags (`missingOk`).
	 * @returns Promise that settles once the file is removed.
	 */
	unlink(options?: { missingOk?: boolean }): Promise<void> {
		return toPromise(() => this.unlinkSync(options));
	}

	/**
	 * Remove the directory synchronously.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.rmdir} but executes synchronously.
	 */
	rmdirSync(): void {
		fs.rmdirSync(this.toString());
	}

	/**
	 * Remove this directory; the directory must already be empty.
	 *
	 * @remarks
	 *
	 * Uses Node's `fs.rmdir` to mirror CPython semantics.
	 *
	 * @returns Promise that settles once the directory is removed.
	 */
	rmdir(): Promise<void> {
		return toPromise(() => this.rmdirSync());
	}

	/**
	 * Rename the file or directory to a new target synchronously.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.rename} but executes synchronously.
	 *
	 * @param target - Destination path or string.
	 * @returns A {@link Path} representing the destination.
	 */
	renameSync(target: PathLike): Path {
		const destination =
			target instanceof PurePath ? target.toString() : String(target);
		fs.renameSync(this.toString(), destination);
		return this.withSegments(destination) as Path;
	}

	/**
	 * Rename this path to the given target and return the new path instance.
	 *
	 * @remarks
	 *
	 * Matches CPython semantics while returning a new {@link Path}
	 * pointing at the destination.
	 *
	 * @param target - Destination path or string.
	 * @returns Promise resolving to a {@link Path} representing the destination.
	 */
	rename(target: PathLike): Promise<Path> {
		return toPromise(() => this.renameSync(target));
	}

	/**
	 * Replace the file or directory synchronously, overwriting the destination.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.replace} but executes synchronously.
	 *
	 * @param target - Destination path or string.
	 * @returns A {@link Path} representing the destination.
	 */
	replaceSync(target: PathLike): Path {
		const destination =
			target instanceof PurePath ? target.toString() : String(target);
		fs.renameSync(this.toString(), destination);
		return this.withSegments(destination) as Path;
	}

	/**
	 * Replace the target path, overwriting it if necessary, and return the new
	 * {@link Path}.
	 *
	 * @remarks
	 *
	 * Overwrite behavior matches CPython while relying on Node's rename.
	 *
	 * @param target - Destination path or string.
	 * @returns Promise resolving to a {@link Path} representing the destination.
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
	 * Recursively copy the file or directory tree to the destination synchronously.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.copy} but executes synchronously.
	 *
	 * @param target - Destination path or string.
	 * @param options - Behaviour flags for metadata preservation and symlink handling.
	 * @returns The destination {@link Path}.
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
	 * Recursively copy this file or directory tree to the destination.
	 *
	 * @remarks
	 *
	 * Uses Node's `fs.cp` to match CPython's recursive behavior while
	 * exposing options for metadata and symlink handling.
	 *
	 * @param target - Destination path or string.
	 * @param options - Behaviour flags for metadata preservation and symlink handling.
	 * @returns Promise resolving to the destination {@link Path}.
	 */
	copy(
		target: PathLike,
		options?: { preserveMetadata?: boolean; followSymlinks?: boolean },
	): Promise<Path> {
		return toPromise(() => this.copySync(target, options));
	}

	/**
	 * Read the target of a symbolic link synchronously.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.readlink} but executes synchronously.
	 *
	 * @returns A {@link Path} representing the symlink target.
	 */
	readlinkSync(): Path {
		const resolved = fs.readlinkSync(this.toString());
		return this.withSegments(resolved) as Path;
	}

	/**
	 * Return the path to which the symbolic link points.
	 *
	 * @remarks
	 *
	 * Resolves the link via Node's `fs.readlink` and wraps it in a
	 * {@link Path} instance.
	 *
	 * @returns Promise resolving to a {@link Path} representing the symlink target.
	 */
	readlink(): Promise<Path> {
		return toPromise(() => this.readlinkSync());
	}

	/**
	 * Resolve the path synchronously, following symlinks and normalizing.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.resolve} but executes synchronously.
	 *
	 * @returns A {@link Path} pointing to the resolved location.
	 */
	resolveSync(): Path {
		const resolved = nodepath.resolve(this.toString());
		return this.withSegments(resolved) as Path;
	}

	/**
	 * Make the path absolute, resolving symlinks and normalizing segments.
	 *
	 * @remarks
	 *
	 * Uses Node's resolver to match CPython behavior, including symlink
	 * expansion.
	 *
	 * @returns Promise resolving to a {@link Path} pointing to the resolved location.
	 */
	resolve(): Promise<Path> {
		return toPromise(() => this.resolveSync());
	}

	/**
	 * Return an absolute path without resolving symlinks, synchronously.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.absolute} but executes synchronously.
	 *
	 * @returns An absolute {@link Path}.
	 */
	absoluteSync(): Path {
		return this.isAbsolute() ? (this as Path) : this.resolveSync();
	}

	/**
	 * Return an absolute version of this path without resolving symlinks.
	 *
	 * @remarks
	 *
	 * Delegates to {@link Path.resolve} when the path is relative,
	 * mirroring CPython's `absolute()` behavior.
	 *
	 * @returns Promise resolving to an absolute {@link Path}.
	 */
	absolute(): Promise<Path> {
		return toPromise(() => this.absoluteSync());
	}

	/**
	 * Expand leading `~` markers synchronously.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.expandUser} but executes synchronously.
	 *
	 * @returns A {@link Path} with user-home prefixes expanded.
	 * @throws {@link Error} When the home directory cannot be determined.
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
	 * Return a new path with expanded `~` and `~user` constructs.
	 *
	 * @remarks
	 *
	 * Uses the current platform home directory lookup to mirror CPython
	 * semantics.
	 *
	 * @returns Promise resolving to a {@link Path} with user-home prefixes expanded.
	 * @throws {@link Error} When the home directory cannot be determined.
	 */
	expandUser(): Promise<Path> {
		return toPromise(() => this.expandUserSync());
	}

	/**
	 * Create a {@link Path} pointing to the current working directory synchronously.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.cwd} but executes synchronously.
	 *
	 * @returns A {@link Path} instance targeting the current working directory.
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
	 * @remarks
	 *
	 * Mirrors the CPython API and caches the string representation for
	 * parity with the synchronous constructor.
	 *
	 * @returns Promise resolving to a {@link Path} instance targeting the current working directory.
	 */
	static cwd(): Promise<Path> {
		return toPromise(() => Path.cwdSync());
	}

	/**
	 * Return the user's home directory synchronously.
	 *
	 * @remarks Mirrors {@link Path.home} but executes synchronously.
	 *
	 * @returns A {@link Path} instance targeting the user's home directory.
	 * @throws {@link Error} When the home directory cannot be determined.
	 */
	static homeSync(): Path {
		const home = nodeos.homedir();
		if (!home) throw new Error("Could not determine home directory");
		return new Path(home);
	}

	/**
	 * Return a new path pointing to the user's home directory.
	 *
	 * @remarks
	 *
	 * Leverages Node's home directory detection to match CPython.
	 *
	 * @returns Promise resolving to a {@link Path} instance targeting the user's home directory.
	 * @throws {@link Error} When the home directory cannot be determined.
	 */
	static home(): Promise<Path> {
		return toPromise(() => Path.homeSync());
	}

	/**
	 * Traverse the directory tree synchronously and return the walk tuples.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.walk} but executes synchronously.
	 *
	 * @param options - Control for traversal order (`topDown`).
	 * @returns An array of {@link WalkTuple} entries.
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
	 * Walk the directory tree from this directory.
	 *
	 * @remarks
	 *
	 * Returns {@link WalkTuple} entries while delegating to the
	 * synchronous walker via {@link toPromise}.
	 *
	 * @param options - Control for traversal order (`topDown`).
	 * @returns Promise resolving to an array of {@link WalkTuple} entries.
	 */
	walk(options?: { topDown?: boolean }): Promise<WalkTuple[]> {
		return toPromise(() => this.walkSync(options));
	}
}

/**
 * POSIX-flavored {@link Path} implementation.
 *
 * @remarks Instantiated automatically when the runtime reports a POSIX
 * platform. Instantiate directly to manipulate POSIX paths on any host.
 *
 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PosixPath
 */
export class PosixPath extends Path {
	static override parser = posixParser;
}

/**
 * Windows-flavored {@link Path} implementation.
 *
 * @remarks Instantiated automatically when the runtime reports a Windows
 * platform. Instantiate directly to manipulate Windows paths on any host.
 *
 * @see https://docs.python.org/3/library/pathlib.html#pathlib.WindowsPath
 */
export class WindowsPath extends Path {
	static override parser = windowsParser;
}

/**
 * Alias for the platform-appropriate concrete path class ({@link WindowsPath} on Windows, otherwise {@link PosixPath}).
 */
export const DefaultPath = isWindows ? WindowsPath : PosixPath;
