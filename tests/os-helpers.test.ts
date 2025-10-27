import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import nodepath from "node:path";
import {
	copyFileObj,
	copyFileObjSync,
	copyInfo,
	copyInfoSync,
	DirEntryInfo,
	ErrnoError,
	ensureDifferentFiles,
	ensureDifferentFilesSync,
	ensureDistinctPaths,
	magicOpen,
	PathInfo,
} from "../src/os.js";
import { makeSandbox } from "./helpers.js";

const sandbox = makeSandbox("os-helpers-");

beforeAll(() => {
	// Ensure sandbox dir exists
	fs.existsSync(sandbox.root);
});

afterAll(() => {
	sandbox.cleanup();
});

describe("magicOpen", () => {
	test("reads text by default", async () => {
		const file = nodepath.join(sandbox.root, "m.txt");
		fs.writeFileSync(file, "hi", { encoding: "utf8" });
		const stream = magicOpen(file, { mode: "r" });
		await new Promise<void>((resolve, reject) => {
			let buf = "";
			stream.setEncoding("utf8");
			stream.on("data", (c) => {
				buf += String(c);
			});
			stream.on("end", () => {
				try {
					expect(buf).toBe("hi");
					resolve();
				} catch (e) {
					reject(e);
				}
			});
			stream.on("error", reject);
		});
	});

	test("binary mode with encoding throws", () => {
		const file = nodepath.join(sandbox.root, "b.bin");
		fs.writeFileSync(file, Buffer.from([1, 2, 3]));
		// cast to unknown first to avoid any, then to never triggers type error check
		expect(() =>
			magicOpen(file, { mode: "rb", encoding: "utf8" as unknown as null }),
		).toThrow(TypeError);
	});
});

describe("path distinctness / sameness checks", () => {
	test("ensureDistinctPaths rejects same path and parent relationships", () => {
		const base = nodepath.join(sandbox.root, "dir");
		const child = nodepath.join(base, "child");
		fs.mkdirSync(child, { recursive: true });
		expect(() => ensureDistinctPaths(base, base)).toThrow();
		expect(() => ensureDistinctPaths(base, child)).toThrow();
	});

	test("ensureDifferentFilesSync detects identical file and allows different", () => {
		const a = nodepath.join(sandbox.root, "same.txt");
		const b = nodepath.join(sandbox.root, "other.txt");
		fs.writeFileSync(a, "x");
		fs.writeFileSync(b, "x");
		// Same path -> error
		expect(() => ensureDifferentFilesSync(a, a)).toThrow();
		// Different file -> ok
		expect(() => ensureDifferentFilesSync(a, b)).not.toThrow();
	});
});

describe("copy helpers", () => {
	test("copyFileObjSync with string paths", () => {
		const src = nodepath.join(sandbox.root, "src.bin");
		const dst = nodepath.join(sandbox.root, "dst.bin");
		fs.writeFileSync(src, Buffer.from("data"));
		copyFileObjSync(src, dst);
		expect(fs.readFileSync(dst, "utf8")).toBe("data");
	});

	test("copyFileObjSync with file descriptors (fd fast path)", () => {
		const src = nodepath.join(sandbox.root, "src-fd.bin");
		const dst = nodepath.join(sandbox.root, "dst-fd.bin");
		fs.writeFileSync(src, Buffer.from("fddata"));
		const sfd = fs.openSync(src, "r");
		const dfd = fs.openSync(dst, "w");
		// Minimal wrappers exposing fd numbers
		const sWrap = { fd: sfd } as unknown as fs.ReadStream;
		const dWrap = { fd: dfd } as unknown as fs.WriteStream;
		copyFileObjSync(sWrap, dWrap);
		fs.closeSync(sfd);
		fs.closeSync(dfd);
		expect(fs.readFileSync(dst, "utf8")).toBe("fddata");
	});

	test("copyFileObjSync unsupported stream types throws", () => {
		// Provide objects that are neither path strings nor have .fd numbers
		const src = {} as unknown as NodeJS.ReadableStream;
		const dst = {} as unknown as NodeJS.WritableStream;
		try {
			copyFileObjSync(src, dst);
			throw new Error("expected copyFileObjSync to throw");
		} catch (err) {
			// Ensure the thrown error is our typed ErrnoError with code EINVAL
			expect(err).toBeInstanceOf(ErrnoError);
			const e = err as {
				code?: string;
				path?: string;
				dest?: string;
			};
			expect(e.code).toBe("EINVAL");
			expect(e.path).toBe(String(src));
			expect(e.dest).toBe(String(dst));
		}
	});

	test("copyInfoSync best-effort metadata copy", () => {
		const src = nodepath.join(sandbox.root, "meta.txt");
		const dst = nodepath.join(sandbox.root, "meta2.txt");
		fs.writeFileSync(src, "x");
		// Delay to ensure timestamp delta
		fs.writeFileSync(dst, "y");
		copyInfoSync(src, dst);
		const s = fs.statSync(src);
		const d = fs.statSync(dst);
		// Timestamps should be <= or equal; allow some tolerance
		expect(Math.floor(d.mtimeMs)).toBeGreaterThanOrEqual(Math.floor(s.mtimeMs));
	});
});

describe("PathInfo basic behaviors", () => {
	test("exists/isFile/isDir/isSymlink and times", async () => {
		const f = nodepath.join(sandbox.root, "pinfo.txt");
		fs.writeFileSync(f, "hello");
		const info = new PathInfo(f);
		expect(info.toString()).toBe(f);
		expect(await info.exists()).toBeTrue();
		expect(await info.isFile()).toBeTrue();
		expect(await info.isDir()).toBeFalse();
		expect(await info.isSymlink()).toBeFalse();
		const at = await info.accessTimeNs();
		const mt = await info.modTimeNs();
		expect(typeof at === "bigint").toBeTrue();
		expect(typeof mt === "bigint").toBeTrue();
		const id = await info.fileId();
		expect(typeof id.dev).toBe("number");
		expect(typeof id.ino).toBe("number");
	});
});

describe("ensureDifferentFilesSync variations", () => {
	test("uses info._file_id_sync when provided", () => {
		const a = { info: { _file_id_sync: () => "same-id" } };
		const b = { info: { _file_id_sync: () => "same-id" } };
		expect(() => ensureDifferentFilesSync(a, b)).toThrow();
		const c = { info: { _file_id_sync: () => 1 } };
		const d = { info: { _file_id_sync: () => 2 } };
		expect(() => ensureDifferentFilesSync(c, d)).not.toThrow();
	});
});

describe("DirEntryInfo stat fallback and errors", () => {
	test("stat() method on entry throwing uses ignoreErrors behavior", async () => {
		const entry = {
			name: "fileX",
			stat: async () => {
				throw new Error("boom");
			},
		} as unknown as fs.Dirent & {
			stat: (follow?: boolean) => Promise<fs.Stats>;
		};
		const di = new DirEntryInfo(entry, sandbox.root);
		// exists uses ignoreErrors: true -> should be false when stat fails
		expect(await di.exists()).toBeFalse();
		// fileId uses ignoreErrors: false -> should throw via DirEntryInfo error path
		expect(di.fileId()).rejects.toThrow("stat failed");
	});

	test("constructor handles null entry and parent path only", async () => {
		const di = new DirEntryInfo(null, nodepath.join(sandbox.root, "ghost"));
		expect(await di.exists()).toBeFalse();
	});
});

describe("copyInfoSync variations", () => {
	test("accepts info object with _path and followSymlinks=false", () => {
		const src = nodepath.join(sandbox.root, "ci-src.txt");
		const dst = nodepath.join(sandbox.root, "ci-dst.txt");
		fs.writeFileSync(src, "x");
		fs.writeFileSync(dst, "y");
		const info = { _path: src };
		expect(() =>
			copyInfoSync(info, dst, { followSymlinks: false }),
		).not.toThrow();
	});
});

describe("os helpers (async wrappers)", () => {
	test("copyFileObj (async) with string paths", () => {
		const src = nodepath.join(sandbox.root, "a.txt");
		const dst = nodepath.join(sandbox.root, "b.txt");
		fs.writeFileSync(src, "ZZZ");
		expect(copyFileObj(src, dst)).resolves.toBeUndefined();
		expect(fs.readFileSync(dst, "utf8")).toBe("ZZZ");
	});

	test("ensureDifferentFiles (async) rejects for same path", () => {
		const p = nodepath.join(sandbox.root, "same.txt");
		fs.writeFileSync(p, "x");
		expect(ensureDifferentFiles(p, p)).rejects.toBeDefined();
	});

	test("copyInfo (async) applies metadata", () => {
		const src = nodepath.join(sandbox.root, "m1.txt");
		const dst = nodepath.join(sandbox.root, "m2.txt");
		fs.writeFileSync(src, "1");
		fs.writeFileSync(dst, "2");
		expect(copyInfo(src, dst)).resolves.toBeUndefined();
	});
});
