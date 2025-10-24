import nodepath from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const isWindows = nodepath.sep === "\\";
export const posixParser = nodepath.posix;
export const windowsParser = nodepath.win32;

function escapeRegExp(value: string): string {
	return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

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

export type PathLike = string | PurePath;

/**
 * Base class for manipulating paths without I/O.
 *
 * PurePath represents a filesystem path and offers operations which don't
 * imply any actual filesystem I/O. Depending on your system, instantiating a
 * PurePath will return either a PurePosixPath or a PureWindowsPath object.
 * You can also instantiate either of these classes directly, regardless of
 * your system.
 *
 * Docstring copied from CPython 3.14 pathlib.PurePath.
 * @see https://docs.python.org/3/library/pathlib.html#pure-paths
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
	 * Construct a new path object from any number of path-like objects.
	 *
	 * Subclasses may override this method to customize how new path objects are
	 * created from methods like `iterdir()`.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.with_segments.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.with_segments
	 */
	withSegments<T extends PurePath>(this: T, ...segments: Array<PathLike>): T {
		const ctor = this.constructor as new (...args: Array<PathLike>) => T;
		return new ctor(...segments);
	}

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
	 * Combine this path with one or several arguments, and return a new path
	 * representing either a subpath (if all arguments are relative paths) or a
	 * totally different path (if one of the arguments is anchored).
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.joinpath.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.joinpath
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
	 * Return the string representation of the path with forward (/) slashes.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.as_posix.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.as_posix
	 */
	asPosix(): string {
		const parser = (this.constructor as typeof PurePath).parser;
		if (parser === posixParser) return this.toString();
		return this.toString().replace(/\\/g, "/");
	}

	/**
	 * The drive prefix (letter or UNC path), if any.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.drive.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.drive
	 */
	get drive(): string {
		this.ensureParsed();
		return this.driveCache ?? "";
	}

	/**
	 * The root of the path, if any.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.root.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.root
	 */
	get root(): string {
		this.ensureParsed();
		return this.rootCache ?? "";
	}

	/**
	 * The concatenation of the drive and root, or ''.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.anchor.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.anchor
	 */
	get anchor(): string {
		return this.drive + this.root;
	}

	/**
	 * An object providing sequence-like access to the components in the filesystem
	 * path.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.parts.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.parts
	 */
	get parts(): string[] {
		const tail = this.tailParts();
		const anchor = this.anchor;
		return anchor ? [anchor, ...tail] : [...tail];
	}

	/**
	 * The logical parent of the path.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.parent.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.parent
	 */
	get parent(): PurePath {
		const tail = this.tailParts();
		if (tail.length === 0) return this;
		const { drive, root } = this.anchorParts();
		return this.cloneFromParts(drive, root, tail.slice(0, -1));
	}

	/**
	 * A sequence of this path's logical parents.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.parents.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.parents
	 */
	get parents(): PathParents {
		return new PathParents(this);
	}

	/**
	 * The final path component, if any.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.name.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.name
	 */
	get name(): string {
		const tail = this.tailParts();
		if (tail.length === 0) return "";
		const last = tail[tail.length - 1];
		return last ?? "";
	}

	/**
	 * The final component's last suffix, if any, including the leading period.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.suffix.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.suffix
	 */
	get suffix(): string {
		const name = this.name;
		if (!name) return "";
		const trimmed = name.replace(/^(\.+)(?!\.)/, "");
		const idx = trimmed.lastIndexOf(".");
		return idx !== -1 ? trimmed.slice(idx) : "";
	}

	/**
	 * The final component's suffixes, if any, including the leading periods.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.suffixes.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.suffixes
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
	 * The final path component, minus its last suffix.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.stem.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.stem
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
	 * Return a new path with the file name changed.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.with_name.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.with_name
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
	 * Docstring copied from CPython 3.14 pathlib.PurePath.with_suffix.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.with_suffix
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
	 * Return a new path with the stem changed.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.with_stem.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.with_stem
	 */
	withStem(stem: string): PurePath {
		const currentSuffix = this.suffix;
		if (!currentSuffix) return this.withName(stem);
		if (!stem) throw new Error(`${this.toString()} has a non-empty suffix`);
		return this.withName(`${stem}${currentSuffix}`);
	}

	/**
	 * Return the relative path to another path identified by the passed
	 * arguments. If the operation is not possible (because this is not related
	 * to the other path), raise ValueError.
	 *
	 * The *walk_up* parameter controls whether `..` may be used to resolve the
	 * path.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.relative_to.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.relative_to
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
	 * Return True if the path is relative to another path or False.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.is_relative_to.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.is_relative_to
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
	 * True if the path is absolute (has both a root and, if applicable, a drive).
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.is_absolute.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.is_absolute
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
	/**
	 * Return True if this path matches the given glob-style pattern. The pattern
	 * is matched against the entire path.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.full_match.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.full_match
	 */
	fullMatch(pattern: PathLike, options?: { caseSensitive?: boolean }): boolean {
		return this.matchAgainst(pattern, options?.caseSensitive, true);
	}

	/**
	 * Return True if this path matches the given pattern. If the pattern is
	 * relative, matching is done from the right; otherwise the entire path is
	 * matched. The recursive wildcard '**' is not supported by this method.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.match.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.match
	 */
	match(pattern: PathLike, options?: { caseSensitive?: boolean }): boolean {
		return this.matchAgainst(pattern, options?.caseSensitive, false);
	}

	/**
	 * Return the path as a URI.
	 *
	 * Docstring copied from CPython 3.14 pathlib.PurePath.as_uri.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.as_uri
	 */
	asURI(): string {
		if (!this.isAbsolute()) {
			throw new Error("relative path can't be expressed as a file URI");
		}
		return pathToFileURL(this.toString()).toString();
	}

	/**
	 * Return a new path from the given 'file' URI.
	 *
	 * Docstring copied from CPython 3.14 pathlib.Path.from_uri.
	 * @see https://docs.python.org/3/library/pathlib.html#pathlib.Path.from_uri
	 */
	static fromURI(uri: string): PurePath {
		const resolved = fileURLToPath(uri);
		return new PurePath(resolved);
	}
}

/**
 * PurePath subclass for non-Windows systems. On a POSIX system, instantiating a
 * PurePath should return this object. However, you can also instantiate it
 * directly on any system.
 *
 * Docstring copied from CPython 3.14 pathlib.PurePosixPath.
 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PurePosixPath
 */
export class PurePosixPath extends PurePath {
	static override parser = posixParser;
}

/**
 * PurePath subclass for Windows systems. On a Windows system, instantiating a
 * PurePath should return this object. However, you can also instantiate it
 * directly on any system.
 *
 * Docstring copied from CPython 3.14 pathlib.PureWindowsPath.
 * @see https://docs.python.org/3/library/pathlib.html#pathlib.PureWindowsPath
 */
export class PureWindowsPath extends PurePath {
	static override parser = windowsParser;
}

/**
 * An exception that is raised when an unsupported operation is attempted.
 *
 * Docstring copied from CPython 3.14 pathlib.UnsupportedOperation.
 * @see https://docs.python.org/3/library/pathlib.html#pathlib.UnsupportedOperation
 */
export class UnsupportedOperation extends Error {}
