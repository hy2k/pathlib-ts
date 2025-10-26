import nodeos from "node:os";

/**
 * Small ErrnoError class that matches Node's ErrnoException shape.
 * Use the factory makeErrnoError to create instances consistently.
 */
export class ErrnoError extends Error implements NodeJS.ErrnoException {
	errno?: number;
	// NodeJS.ErrnoException declares `code?: string`, keep that shape for
	// compatibility while allowing callers to pass numbers into the
	// constructor which will be mapped to errno.
	code?: string;
	path?: string;
	dest?: string;

	constructor(
		message: string,
		code?: string | number,
		fields?: { path?: unknown; dest?: unknown },
	) {
		super(message);
		this.name = "ErrnoError";

		if (code !== undefined) {
			this.code = String(code);
			const n = mapCodeToErrno(code);
			if (n !== undefined) this.errno = n;
		}

		if (fields?.path !== undefined) this.path = formatFilename(fields.path);
		if (fields?.dest !== undefined) this.dest = formatFilename(fields.dest);
	}
}

function mapCodeToErrno(code?: string | number): number | undefined {
	if (typeof code === "number") return code;
	if (!code) return undefined;
	try {
		// Access nodeos.constants.errno defensively without assuming TS types.
		const maybeConsts = nodeos as unknown as { constants?: unknown };
		const c = maybeConsts.constants;
		if (c && typeof c === "object") {
			const maybeErrno = (c as Record<string, unknown>).errno;
			if (maybeErrno && typeof maybeErrno === "object") {
				const errnoMap = maybeErrno as Record<string, number>;
				if (String(code) in errnoMap) return errnoMap[String(code)];
			}
		}
	} catch {
		// ignore mapping errors
	}
	return undefined;
}

/**
 * Safely format a value for use as a filename-like field in errors.
 * Prefer common properties, fall back to constructor name to avoid
 * producing '[object Object]'.
 */
function formatFilename(v: unknown): string {
	if (v === null) return "null";
	if (v === undefined) return "undefined";
	if (typeof v === "string") return v;
	// Streams and many Node objects have a 'path' or 'name' property
	try {
		const asUnknown = v as unknown;
		if (asUnknown && typeof asUnknown === "object") {
			const obj = asUnknown as Record<string, unknown>;
			if (typeof obj.path === "string") return obj.path as string;
			if (typeof obj.name === "string") return obj.name as string;
		}
	} catch {
		// ignore
	}
	// Use constructor name if available
	try {
		const asUnknown = v as unknown;
		if (asUnknown && typeof asUnknown === "object") {
			const ctor = (asUnknown as { constructor?: { name?: string } })
				.constructor?.name;
			if (typeof ctor === "string" && ctor !== "Object") return `<${ctor}>`;
		}
	} catch {
		// ignore
	}
	// Fallback to JSON if it serializes reasonably
	try {
		const j = JSON.stringify(v);
		if (typeof j === "string" && j !== "{}") return j;
	} catch {
		// ignore
	}
	return String(v);
}
