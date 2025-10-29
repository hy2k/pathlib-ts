import nodepath from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Indicates whether the current runtime reports Windows-style path semantics.
 *
 * @remarks
 *
 * This is derived from {@link nodepath.sep}. Consumers typically use the flag to toggle
 * platform-specific logic such as case folding or default slash direction. The value is
 * computed once at module evaluation time and cached for subsequent imports.
 *
 * @see https://docs.python.org/3/library/pathlib.html#module-pathlib
 */
export const isWindows = nodepath.sep === "\\";

/**
 * POSIX `node:path` parser used to mirror CPython's POSIX flavour.
 *
 * @remarks
 *
 * Exposed for advanced scenarios that need to parse strings using the same low-level
 * implementation as {@link PurePosixPath}. Use {@link PurePath.parser} instead when you
 * merely need to inspect the active parser for a path instance.
 */
export const posixParser = nodepath.posix;

/**
 * Windows `node:path` parser used to mirror CPython's Windows flavour.
 *
 * @remarks
 *
 * This exposes the native join, normalize, and split rules that back {@link PureWindowsPath}.
 * It is primarily useful for integrations that must interoperate with `PurePath` internals.
 */
export const windowsParser = nodepath.win32;

function escapeRegExp(value: string): string {
	return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

/**
 * Normalizes a path string so that it is safe to pass to the provided parser.
 *
 * @remarks
 *
 * CPython accepts both forward and backward slashes when parsing Windows paths. This helper
 * mirrors that behaviour by rewriting alternate separators (`/`) to the parser's separator
 * before further processing. POSIX parsers are returned unchanged because they do not have an
 * alternate separator.
 *
 * @param parser - The platform-aware parser associated with the target path flavour.
 * @param value - The raw path string supplied by the caller.
 * @returns A normalized string that can be safely parsed or joined via `node:path` helpers.
 */
export function normalizeForParser(
	parser: nodepath.PlatformPath,
	value: string,
): string {
	// For Windows paths, accept '/' as an alternate separator and
	// normalize it to the parser's separator. For POSIX there is no
	// alternate separator to consider.
	const altSep = parser === windowsParser ? "/" : undefined;
	if (!altSep) return value;
	const pattern = new RegExp(escapeRegExp(altSep), "g");
	return value.replace(pattern, parser.sep);
}

type ParsedPathParts = {
	drive: string;
	root: string;
	tail: string[];
};

function parsePathString(
	parser: nodepath.PlatformPath,
	value: string,
): ParsedPathParts {
	if (!value) return { drive: "", root: "", tail: [] };
	const normalized = normalizeForParser(parser, value);
	const sep = parser.sep;
	let drive = "";
	let root = "";
	let remainder = normalized;

	if (parser === windowsParser) {
		const uncMatch = remainder.match(/^\\\\([^\\]+)\\([^\\]+)(.*)$/);
		if (uncMatch) {
			drive = `\\\\${uncMatch[1]}\\${uncMatch[2]}`;
			remainder = uncMatch[3] ?? "";
			if (remainder.startsWith("\\")) {
				root = "\\";
				remainder = remainder.slice(1);
			}
		} else {
			const driveMatch = remainder.match(/^[A-Za-z]:/);
			if (driveMatch) {
				drive = driveMatch[0];
				remainder = remainder.slice(drive.length);
			}
			while (remainder.startsWith(sep)) {
				root = sep;
				remainder = remainder.slice(1);
			}
		}
	} else {
		while (remainder.startsWith(sep)) {
			root = sep;
			remainder = remainder.slice(1);
		}
	}

	const tail = remainder
		.split(sep)
		.filter((fragment) => fragment.length > 0 && fragment !== ".");

	return { drive, root, tail };
}

function formatPathString(
	parser: nodepath.PlatformPath,
	drive: string,
	root: string,
	tail: string[],
): string {
	const sep = parser.sep;
	if (drive || root) {
		const body = tail.join(sep);
		return drive + root + body;
	}
	return tail.join(sep);
}

function normalizeCase(parser: nodepath.PlatformPath, value: string): string {
	return parser === windowsParser ? value.toLowerCase() : value;
}

function globToRegExp(
	parser: nodepath.PlatformPath,
	pattern: string,
	caseSensitive: boolean,
	full: boolean,
): RegExp {
	const sep = parser.sep;
	const normalized = normalizeForParser(parser, pattern);
	const sepEscaped = escapeRegExp(sep);
	let regex = full ? "^" : "";
	let i = 0;
	while (i < normalized.length) {
		const char = normalized.charAt(i);
		if (char === "*") {
			if (normalized.charAt(i + 1) === "*") {
				regex += ".*";
				i += 2;
				continue;
			}
			regex += `[^${sepEscaped}]*`;
			i += 1;
			continue;
		}
		if (char === "?") {
			regex += `[^${sepEscaped}]`;
			i += 1;
			continue;
		}
		if (char === sep) {
			regex += sepEscaped;
			i += 1;
			continue;
		}
		regex += escapeRegExp(char);
		i += 1;
	}
	if (full) regex += "$";
	return new RegExp(regex, caseSensitive ? "" : "i");
}

class PathParents implements Iterable<PurePath> {
	private readonly listing: PurePath[];

	constructor(origin: PurePath) {
		const result: PurePath[] = [];
		let current = origin.parent;
		const seenAnchor = origin.toString();
		while (current.toString() !== seenAnchor) {
			result.push(current);
			const next = current.parent;
			if (next.toString() === current.toString()) break;
			current = next;
		}
		this.listing = result;
	}

	[Symbol.iterator](): Iterator<PurePath> {
		return this.listing[Symbol.iterator]();
	}

	at(index: number): PurePath | undefined {
		return this.listing.at(index);
	}

	get length(): number {
		return this.listing.length;
	}
}

/**
 * Union of string-like inputs accepted by path constructors and helpers.
 *
 * @remarks
 *
 * CPython accepts both `str` and path objects for most APIs. The TypeScript port mirrors this
 * behaviour by accepting plain strings alongside {@link PurePath} instances. Concrete
 * {@link Path} objects also satisfy the contract because they extend `PurePath`.
 */
export type PathLike = string | PurePath;

/**
 * Immutable filesystem path that never performs I/O.
 *
 * @remarks
 *
 * This mirrors CPython's {@link https://docs.python.org/3/library/pathlib.html#pure-paths | `pathlib.PurePath`}.
 * Separators are normalised according to the active parser (POSIX vs Windows), parts are exposed via
 * flavour-aware casing, and joining semantics match the reference implementation. Prefer this class when you
 * need deterministic, purely lexical path manipulation. Use {@link Path} to add filesystem-aware operations.
 *
 * The constructor preserves the concrete subclass by default: instantiating {@link PurePath} chooses the
 * flavour for the current runtime, whereas {@link PurePosixPath} and {@link PureWindowsPath} can be requested
 * explicitly for cross-platform tooling.
 *
 * @example Creating a nested PurePath without touching the filesystem
 * ```ts
 * import { PurePath } from "pathlib-ts";
 *
 * const project = new PurePath("/srv/app");
 * const config = project.joinpath("pyproject.toml");
 *
 * console.log(config.toString()); // '/srv/app/pyproject.toml'
 * console.log(config.isAbsolute()); // true
 * ```
 *
 * @see https://docs.python.org/3/library/pathlib.html#pure-paths
 *
 * @privateRemarks
 *
 * Base class for manipulating paths without I/O.
 *
 * PurePath represents a filesystem path and offers operations which don't
 * imply any actual filesystem I/O. Depending on your system, instantiating a
 * PurePath will return either a PurePosixPath or a PureWindowsPath object.
 * You can also instantiate either of these classes directly, regardless of
 * your system.
 */
export class PurePath {
	static parser: nodepath.PlatformPath = isWindows
		? windowsParser
		: posixParser;

	protected rawPaths: string[];
	protected driveCache?: string;
	protected rootCache?: string;
	protected tailCache?: string[];
	protected strCache?: string;
	protected normCaseCache?: string;
	protected normPartsCache?: string[];

	constructor(...segments: Array<PathLike>) {
		const parser = (this.constructor as typeof PurePath).parser;
		const parts: string[] = [];
		for (const segment of segments) {
			if (segment instanceof PurePath) {
				const other = segment.toString();
				parts.push(normalizeForParser(parser, other));
			} else {
				parts.push(normalizeForParser(parser, String(segment)));
			}
		}
		this.rawPaths = parts;
	}

	protected cloneFromParts(
		drive: string,
		root: string,
		tail: string[],
	): PurePath {
		const ctor = this.constructor as typeof PurePath;
		const formatted = formatPathString(ctor.parser, drive, root, tail);
		const target = formatted || ".";
		const instance = new ctor(target);
		instance.driveCache = drive;
		instance.rootCache = root;
		instance.tailCache = [...tail];
		instance.strCache = formatted || ".";
		return instance;
	}

	protected ensureParsed(): void {
		if (this.tailCache) return;
		const parser = (this.constructor as typeof PurePath).parser;
		const raw = this.rawPath();
		const { drive, root, tail } = parsePathString(parser, raw);
		this.driveCache = drive;
		this.rootCache = root;
		this.tailCache = tail;
	}

	protected tailParts(): string[] {
		this.ensureParsed();
		return [...(this.tailCache ?? [])];
	}

	protected anchorParts(): { drive: string; root: string } {
		this.ensureParsed();
		return {
			drive: this.driveCache ?? "",
			root: this.rootCache ?? "",
		};
	}

	protected rawPath(): string {
		const parser = (this.constructor as typeof PurePath).parser;
		if (this.rawPaths.length === 0) return "";
		if (this.rawPaths.length === 1) {
			const [first] = this.rawPaths;
			return first ?? "";
		}
		return parser.join(...this.rawPaths);
	}

	/**
	 * Builds a sibling path instance of the same type by combining additional segments.
	 *
	 * @remarks
	 *
	 * This helper powers APIs such as {@link PurePath.joinpath} and directory iteration. Override it in
	 * subclasses when you need to preserve extra metadata on derived paths (for example, custom session identifiers).
	 *
	 * @param segments - Additional path fragments to combine. Absolute or anchored segments replace the
	 * accumulated path, mirroring CPython semantics.
	 * @returns A new path instance of the same concrete type.
	 */
	withSegments<T extends PurePath>(this: T, ...segments: Array<PathLike>): T {
		const ctor = this.constructor as new (...args: Array<PathLike>) => T;
		return new ctor(...segments);
	}

	/**
	 * Removes trailing segments from the path while preserving the anchor.
	 *
	 * @remarks
	 *
	 * This is primarily used internally to synthesise parent anchors, but it can be useful when you need
	 * to truncate an arbitrary number of lexical components without re-parsing the string form.
	 *
	 * @param drop - Number of segments to discard from the right-hand side. Values greater than the path
	 * length clamp to zero.
	 * @returns A new path of the same type with the requested segments removed.
	 */
	dropSegments<T extends PurePath>(this: T, drop: number): T {
		const { drive, root } = this.anchorParts();
		const tail = this.tailParts();
		return this.cloneFromParts(
			drive,
			root,
			tail.slice(0, Math.max(0, tail.length - drop)),
		) as T;
	}

	/**
	 * Produces a new path by appending additional segments to the current instance.
	 *
	 * @remarks
	 *
	 * Relative segments extend the existing location, while an absolute or anchored segment replaces the
	 * accumulated path, matching CPython and Node path joining semantics. The return type preserves the concrete
	 * subclass (Posix or Windows).
	 *
	 * @param segments - Path fragments to append in order.
	 * @returns A new path instance with the appended segments.
	 */
	joinpath<T extends PurePath>(this: T, ...segments: Array<PathLike>): T {
		return this.withSegments(this, ...segments);
	}

	toString(): string {
		if (this.strCache !== undefined) return this.strCache;
		const { drive, root } = this.anchorParts();
		const tail = this.tailParts();
		const parser = (this.constructor as typeof PurePath).parser;
		const formatted = formatPathString(parser, drive, root, tail);
		this.strCache = formatted || ".";
		return this.strCache;
	}

	valueOf(): string {
		return this.toString();
	}

	toJSON(): string {
		return this.toString();
	}

	[Symbol.toPrimitive](): string {
		return this.toString();
	}

	/**
	 * Returns the string representation of the path with forward (/) slashes, regardless of platform.
	 *
	 * @remarks
	 *
	 * Useful when emitting URLs or interoperating with tooling that expects POSIX separators. On POSIX hosts
	 * the string is returned unchanged; on Windows, backslashes are converted.
	 *
	 * @returns The path rendered with `/` separators.
	 */
	asPosix(): string {
		const parser = (this.constructor as typeof PurePath).parser;
		if (parser === posixParser) return this.toString();
		return this.toString().replace(/\\/g, "/");
	}

	/**
	 * Gets the drive prefix for Windows-style paths, or an empty string on POSIX.
	 *
	 * @remarks
	 *
	 * UNC shares are treated as drives. On non-Windows parsers this value is always empty unless manually
	 * constructed via {@link PureWindowsPath}.
	 *
	 * @returns Drive text for Windows paths or an empty string when no drive is present.
	 */
	get drive(): string {
		this.ensureParsed();
		return this.driveCache ?? "";
	}

	/**
	 * A string representing the (local or global) root, if any.
	 *
	 * @remarks
	 *
	 * Gets the root component (such as `/` or `\\`) following the drive, when present.
	 * For UNC paths the root reflects the separator after the host/share. POSIX roots collapse repeated
	 * slashes according to CPython rules.
	 *
	 * @returns Root component following the drive (for example `/` or `\\`).
	 */
	get root(): string {
		this.ensureParsed();
		return this.rootCache ?? "";
	}

	/**
	 * The concatenation of the drive and root, or ''.
	 *
	 * @remarks
	 *
	 * The anchor uniquely identifies the starting point of the path, allowing callers to detect rooted
	 * inputs before manipulating relative segments.
	 *
	 * @returns The drive followed by the root (for example `c:\\`) or an empty string.
	 */
	get anchor(): string {
		return this.drive + this.root;
	}

	/**
	 * Returns the normalized path components as an array of strings.
	 *
	 * @remarks
	 *
	 * The first element is the anchor when present. Use this when you need positional access to segments
	 * without re-parsing the representation.
	 *
	 * @example
	 *
	 * ```ts
	 * const p = new PurePath('/usr/bin/python3')
	 * p.parts // ['/', 'usr', 'bin', 'python3']
	 *
	 * const p = new PureWindowsPath('c:/Program Files/PSF')
	 * p.parts // ['c:\\', 'Program Files', 'PSF']
	 * ```
	 *
	 * @returns An array of canonical segments including the anchor when present.
	 */
	get parts(): string[] {
		const tail = this.tailParts();
		const anchor = this.anchor;
		return anchor ? [anchor, ...tail] : [...tail];
	}

	/**
	 * Returns the lexical (logical) parent of the current path.
	 *
	 * @remarks
	 *
	 * Anchors (e.g. `/` or drive roots) are idempotent parents of themselves. To walk physical directories,
	 * combine this with {@link Path.resolve} to eliminate `..` components and symlinks.
	 *
	 * @returns The lexical parent, or `this` when already at an anchor.
	 */
	get parent(): PurePath {
		const tail = this.tailParts();
		if (tail.length === 0) return this;
		const { drive, root } = this.anchorParts();
		return this.cloneFromParts(drive, root, tail.slice(0, -1));
	}

	/**
	 * Provides indexed access to the sequence of lexical (logical) ancestors of the path.
	 *
	 * @remarks
	 *
	 * The returned object implements {@link Iterable}, enabling constructs like `for (const parent of
	 * path.parents)`. This mirrors CPython behaviour and honours flavour-specific casing rules.
	 *
	 * @returns A sequence-like view over ancestor paths.
	 */
	get parents(): PathParents {
		return new PathParents(this);
	}

	/**
	 * Returns the final path component as a string, excluding any anchor, if any.
	 *
	 * @remarks
	 *
	 * This mirrors CPython's `name` property and respects flavour casing. For directory entries surfaced via
	 * {@link Path.iterdir}, prefer this over {@link fs.Dirent.name} when you need canonical path semantics.
	 *
	 * @returns Final segment of the path without drive or root information.
	 */
	get name(): string {
		const tail = this.tailParts();
		if (tail.length === 0) return "";
		const last = tail[tail.length - 1];
		return last ?? "";
	}

	/**
	 * Returns the rightmost suffix (including the leading dot) for the last path segment.
	 *
	 * @remarks
	 *
	 * Matches CPython semantics, including treating a standalone dot as a valid suffix in 3.14+. Use this
	 * when you need to dispatch on file extensions without mutating the path.
	 *
	 * @returns The final suffix (for example `.ts`) or an empty string when absent.
	 */
	get suffix(): string {
		const name = this.name;
		if (!name) return "";
		const trimmed = name.replace(/^(\.+)(?!\.)/, "");
		const idx = trimmed.lastIndexOf(".");
		return idx !== -1 ? trimmed.slice(idx) : "";
	}

	/**
	 * Lists all suffixes (extensions) attached to the final path component, if any.
	 *
	 * @remarks
	 *
	 * Useful for detecting compound extensions like `.tar.gz`. The behaviour matches CPython and keeps case
	 * sensitivity aligned with the underlying parser.
	 *
	 * @returns An array of suffix strings in left-to-right order.
	 */
	get suffixes(): string[] {
		const name = this.name;
		if (!name) return [];
		const trimmed = name.startsWith(".") ? name.slice(1) : name;
		const parts = trimmed.split(".");
		if (parts.length <= 1) return [];
		return parts.slice(1).map((fragment) => `.${fragment}`);
	}

	/**
	 * Returns the final component without its last suffix.
	 *
	 * @remarks
	 *
	 * If the name has multiple suffixes, only the final one is removed. Use {@link PurePath.withSuffix} or
	 * {@link PurePath.withStem} to create modified paths.
	 *
	 * @returns The last component minus its rightmost suffix.
	 */
	get stem(): string {
		const name = this.name;
		if (!name) return "";
		const idx = name.lastIndexOf(".");
		if (idx === -1) return name;
		const candidate = name.slice(0, idx);
		return candidate || name;
	}

	/**
	 * Returns a new path with the final component replaced by the provided name.
	 *
	 * @remarks
	 *
	 * Input validation mirrors CPython: path separators and empty names are rejected. Use this when you need to
	 * replace the leaf node while keeping the same directory.
	 *
	 * @param name - Replacement leaf component. Must not contain path separators.
	 * @returns A new path with the same anchor and parent but a different final component.
	 * @throws {@link Error} If the name is empty, `.` or contains separators.
	 */
	withName(name: string): PurePath {
		const parser = (this.constructor as typeof PurePath).parser;
		const sep = parser.sep;
		const altSep = parser === windowsParser ? "/" : undefined;
		if (
			!name ||
			name.includes(sep) ||
			(altSep && name.includes(altSep)) ||
			name === "."
		) {
			throw new Error(`Invalid name ${name}`);
		}
		const { drive, root } = this.anchorParts();
		const tail = this.tailParts();
		if (tail.length === 0)
			throw new Error(`${this.toString()} has an empty name`);
		tail[tail.length - 1] = name;
		return this.cloneFromParts(drive, root, tail);
	}

	/**
	 * Return a new path with the file suffix changed. If the path has no suffix,
	 * add the given suffix. If the given suffix is an empty string, remove the
	 * suffix from the path.
	 *
	 * @remarks
	 *
	 * Provide `""` to strip the suffix entirely. The argument must start with a dot unless it is empty.
	 * Behaviour matches CPython, including validation of empty stems.
	 *
	 * @param suffix - New suffix starting with a dot, or an empty string to remove it.
	 * @returns A new path with the updated suffix.
	 * @throws {@link Error} If the suffix does not start with `.` or the path lacks a stem.
	 */
	withSuffix(suffix: string): PurePath {
		if (suffix && !suffix.startsWith(".")) {
			throw new Error(`Invalid suffix ${suffix}`);
		}
		const stem = this.stem;
		if (!stem) throw new Error(`${this.toString()} has an empty name`);
		return this.withName(`${stem}${suffix}`);
	}

	/**
	 * Returns a new path with the stem component changed.
	 *
	 * @remarks
	 *
	 * The current suffix is preserved. Passing an empty stem is only allowed when the path has no suffix,
	 * matching CPython behaviour.
	 *
	 * @param stem - New stem string.
	 * @returns A new path where the last component has the provided stem.
	 * @throws {@link Error} If the path has a suffix and `stem` is empty.
	 */
	withStem(stem: string): PurePath {
		const currentSuffix = this.suffix;
		if (!currentSuffix) return this.withName(stem);
		if (!stem) throw new Error(`${this.toString()} has a non-empty suffix`);
		return this.withName(`${stem}${currentSuffix}`);
	}

	/**
	 * Return the relative path to another path identified by the passed
	 * arguments.
	 *
	 * @remarks
	 *
	 * By default the operation is purely lexical and raises if the target is not an ancestor. Pass
	 * `options.walkUp = true` to allow `..` segments. This mirrors CPython and is the foundation for
	 * {@link Path.relativeTo} policies.
	 *
	 * @param other - Anchor path used as the reference point.
	 * @param options - Optional lexical behaviour toggles (`walkUp` mirrors CPython 3.12+).
	 * @returns A new path relative to `other`.
	 * @throws {@link Error} When anchors differ or no lexical relationship exists (and `walkUp` is false).
	 */
	relativeTo(other: PathLike, options?: { walkUp?: boolean }): PurePath {
		const target = other instanceof PurePath ? other : this.withSegments(other);
		if (
			normalizeCase(this.parser, this.anchor) !==
			normalizeCase(target.parser, target.anchor)
		) {
			throw new Error(
				`${this.toString()} and ${target.toString()} have different anchors`,
			);
		}
		const thisTail = this.tailParts();
		const otherTail = target.tailParts();
		let index = 0;
		const max = Math.min(thisTail.length, otherTail.length);
		while (index < max) {
			const leftSegment = thisTail[index];
			const rightSegment = otherTail[index];
			if (leftSegment === undefined || rightSegment === undefined) break;
			const left = normalizeCase(this.parser, leftSegment);
			const right = normalizeCase(this.parser, rightSegment);
			if (left !== right) break;
			index += 1;
		}
		if (index < otherTail.length && !options?.walkUp) {
			throw new Error(
				`${this.toString()} is not in the subpath of ${target.toString()}`,
			);
		}
		const ups = new Array(Math.max(0, otherTail.length - index)).fill("..");
		const remainder = thisTail.slice(index);
		return this.cloneFromParts("", "", ups.concat(remainder));
	}

	/**
	 * Returns `true` when the path can be expressed relative to another path without leaving its subtree.
	 *
	 * @remarks
	 *
	 * This is a lexical check that does not hit the filesystem. It aligns with CPython's `is_relative_to` and
	 * powers {@link Path.isRelativeTo} before the async policy layer.
	 *
	 * @param other - Anchor used to determine lexical containment.
	 * @returns `true` when `other` is a lexical ancestor or the same path.
	 */
	isRelativeTo(other: PathLike): boolean {
		const target = other instanceof PurePath ? other : this.withSegments(other);
		try {
			this.relativeTo(target);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Indicates whether the path is anchored (has a root and optional drive).
	 *
	 * @remarks
	 *
	 * Matches CPython semantics and honours the active parser.
	 *
	 * @returns `true` when the path has a root (and drive for Windows), otherwise `false`.
	 */
	isAbsolute(): boolean {
		return Boolean(this.root) || !!this.drive;
	}

	protected get parser(): nodepath.PlatformPath {
		return (this.constructor as typeof PurePath).parser;
	}

	protected get caseSensitive(): boolean {
		return this.parser === posixParser;
	}

	private matchAgainst(
		pattern: PathLike,
		caseSensitive?: boolean,
		full = false,
	): boolean {
		const patternPath =
			pattern instanceof PurePath ? pattern : this.withSegments(pattern);
		const parser = (this.constructor as typeof PurePath).parser;
		const chosen = caseSensitive ?? parser === posixParser;
		const patternString = patternPath.toString();
		const subject = full
			? this.toString()
			: this.parts.slice(-patternPath.parts.length).join(parser.sep);
		const regex = globToRegExp(parser, patternString, chosen, true);
		return regex.test(subject);
	}

	/**
	 * Tests whether the entire path matches a glob-style pattern.
	 *
	 * @remarks
	 *
	 * Case sensitivity defaults to the flavour (POSIX vs Windows) but can be overridden. No filesystem access
	 * occurs; matching is lexical.
	 *
	 * @param pattern - Glob-style pattern to check. Accepts strings or other pure paths.
	 * @param options - Optional case sensitivity override.
	 * @returns `true` when the entire path matches the pattern.
	 */
	fullMatch(pattern: PathLike, options?: { caseSensitive?: boolean }): boolean {
		return this.matchAgainst(pattern, options?.caseSensitive, true);
	}

	/**
	 * Checks whether the path matches a non-recursive glob pattern.
	 *
	 * @remarks
	 *
	 * Relative patterns are matched from the right-hand side; recursive `**` is not supported, mirroring
	 * CPython. Use {@link PurePath.fullMatch} when you need to inspect the entire path.
	 *
	 * @param pattern - Pattern to evaluate. Recursive wildcards are treated like `*`.
	 * @param options - Optional case sensitivity override.
	 * @returns `true` when the suffix of the path satisfies the pattern.
	 */
	match(pattern: PathLike, options?: { caseSensitive?: boolean }): boolean {
		return this.matchAgainst(pattern, options?.caseSensitive, false);
	}

	/**
	 * Converts the path to a `file://` URI string.
	 *
	 * @remarks
	 *
	 * The path must be absolute. The output is suitable for environments that consume RFC 8089 URIs.
	 *
	 * @returns RFC 8089 compliant file URI.
	 * @throws {@link Error} If the path is relative.
	 */
	asURI(): string {
		if (!this.isAbsolute()) {
			throw new Error("relative path can't be expressed as a file URI");
		}
		return pathToFileURL(this.toString()).toString();
	}

	/**
	 * Creates a path from a `file://` URI string.
	 *
	 * @remarks
	 *
	 * Mirrors {@link Path.fromURI} but returns a pure path instance so no filesystem checks occur.
	 *
	 * @param uri - URI starting with `file:`.
	 * @returns A new {@link PurePath} matching the URI.
	 * @throws {@link TypeError} If `uri` cannot be converted into a file path.
	 */
	static fromURI(uri: string): PurePath {
		const resolved = fileURLToPath(uri);
		return new PurePath(resolved);
	}
}

/**
 * Pure-path flavour that uses POSIX parsing rules.
 *
 * @remarks
 *
 * Instantiated automatically on POSIX hosts, but can be constructed explicitly to manipulate POSIX paths on
 * other systems. However, you can also instantiate it directly on any system.
 */
export class PurePosixPath extends PurePath {
	static override parser = posixParser;
}

/**
 * Pure-path flavour that uses Windows drive and separator semantics.
 *
 * @remarks
 *
 * Instantiated automatically on Windows hosts, but available everywhere for lexical Windows path work.
 * However, you can also instantiate it directly on any system.
 */
export class PureWindowsPath extends PurePath {
	static override parser = windowsParser;
}

/**
 * Error thrown when the host runtime lacks a required filesystem capability.
 *
 * @remarks
 *
 * This mirrors CPython's `pathlib.UnsupportedOperation` and is raised, for example, when `fs.glob` is
 * missing.
 */
export class UnsupportedOperation extends Error {}
