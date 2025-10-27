import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import nodepath from "node:path";
import { Path, UnsupportedOperation } from "../src/index.js";
import { makeSandbox } from "./helpers.js";

const sandbox = makeSandbox();

beforeAll(() => {
	fs.existsSync(sandbox.root);
});

afterAll(() => {
	sandbox.cleanup();
});

// Sync read/query tests
describe("Path read (sync)", () => {
	test("existsSync on base path", () => {
		const base = new Path(sandbox.root);
		expect(base.existsSync()).toBeTrue();
	});

	test("existsSync on missing file returns false", () => {
		const missing = new Path(sandbox.root).joinpath("missing.txt") as Path;
		expect(missing.existsSync()).toBeFalse();
	});

	test("existsSync with followSymlinks=false on base", () => {
		const base = new Path(sandbox.root);
		expect(base.existsSync({ followSymlinks: false })).toBeTrue();
	});

	test("isDirSync on dirB", () => {
		const dirB = new Path(sandbox.root).joinpath("dirB") as Path;
		expect(dirB.isDirSync()).toBeTrue();
	});

	test("isFileSync on fileA", () => {
		const fileA = new Path(sandbox.root).joinpath("fileA") as Path;
		expect(fileA.isFileSync()).toBeTrue();
	});

	if (sandbox.canSymlink) {
		test("isSymlinkSync on linkA", () => {
			const linkA = new Path(sandbox.root).joinpath("linkA") as Path;
			expect(linkA.isSymlinkSync()).toBeTrue();
		});

		test("statSync followSymlinks=false identifies symlink", () => {
			const linkA = new Path(sandbox.root).joinpath("linkA") as Path;
			expect(
				linkA.statSync({ followSymlinks: false }).isSymbolicLink(),
			).toBeTrue();
		});

		test("statSync followSymlinks=true identifies target file", () => {
			const linkA = new Path(sandbox.root).joinpath("linkA") as Path;
			expect(linkA.statSync({ followSymlinks: true }).isFile()).toBeTrue();
		});
	}

	test("readTextSync reads existing fileA", () => {
		const fileA = new Path(sandbox.root).joinpath("fileA") as Path;
		expect(fileA.readTextSync()).toContain("hello A");
	});

	test("readBytesSync reads existing fileA as bytes", () => {
		const fileA = new Path(sandbox.root).joinpath("fileA") as Path;
		expect(fileA.readBytesSync().toString("utf8")).toContain("hello A");
	});

	test("openSync opens a readable stream", () => {
		const fileA = new Path(sandbox.root).joinpath("fileA") as Path;
		const s = fileA.openSync("r");
		s.close();
		expect(Boolean(s)).toBeTrue();
	});

	describe("iterdir option (sync)", () => {
		test("iterdirSync returns Path instances by default", () => {
			const base = new Path(sandbox.root);
			const entries = base.iterdirSync();
			expect(entries.length).toBeGreaterThan(0);
			expect(entries.every((entry) => entry instanceof Path)).toBeTrue();
		});

		test("iterdirSync treats withFileTypes=false as Path[]", () => {
			const base = new Path(sandbox.root);
			const entries = base.iterdirSync({ extra: { withFileTypes: false } });
			expect(entries.length).toBeGreaterThan(0);
			expect(entries.every((entry) => entry instanceof Path)).toBeTrue();
		});

		test("iterdirSync with withFileTypes=true returns Dirent[]", () => {
			const base = new Path(sandbox.root);
			const entries = base.iterdirSync({ extra: { withFileTypes: true } });
			expect(entries.length).toBeGreaterThan(0);
			expect(entries.every((entry) => entry instanceof fs.Dirent)).toBeTrue();
			const names = entries.map((entry) => entry.name).sort();
			expect(names).toContain("fileA");
		});

		test("iterdirSync with withFileTypes=true throws when Dirent unsupported", () => {
			const originalHasDirentSupport = Reflect.get(
				Path,
				"hasDirentSupport",
			) as () => boolean;
			Reflect.set(Path, "hasDirentSupport", () => false);
			try {
				const base = new Path(sandbox.root);
				expect(() =>
					base.iterdirSync({ extra: { withFileTypes: true } }),
				).toThrow(UnsupportedOperation);
			} finally {
				Reflect.set(Path, "hasDirentSupport", originalHasDirentSupport);
			}
		});

		test("iterdirStreamSync yields Path instances by default", () => {
			const base = new Path(sandbox.root);
			const entries = Array.from(base.iterdirStreamSync());
			expect(entries.length).toBeGreaterThan(0);
			expect(entries.every((entry) => entry instanceof Path)).toBeTrue();
		});

		test("iterdirStreamSync treats withFileTypes=false as Path", () => {
			const base = new Path(sandbox.root);
			const entries = Array.from(
				base.iterdirStreamSync({ extra: { withFileTypes: false } }),
			);
			expect(entries.length).toBeGreaterThan(0);
			expect(entries.every((entry) => entry instanceof Path)).toBeTrue();
		});

		test("iterdirStreamSync with withFileTypes=true yields Dirent entries", () => {
			const base = new Path(sandbox.root);
			const entries = Array.from(
				base.iterdirStreamSync({ extra: { withFileTypes: true } }),
			);
			expect(entries.length).toBeGreaterThan(0);
			expect(entries.every((entry) => entry instanceof fs.Dirent)).toBeTrue();
		});

		test("iterdirStreamSync with withFileTypes=true throws when Dirent unsupported", () => {
			const originalHasDirentSupport = Reflect.get(
				Path,
				"hasDirentSupport",
			) as () => boolean;
			Reflect.set(Path, "hasDirentSupport", () => false);
			try {
				const base = new Path(sandbox.root);
				const iterator = base
					.iterdirStreamSync({
						extra: { withFileTypes: true },
					})
					[Symbol.iterator]();
				expect(() => iterator.next()).toThrow(UnsupportedOperation);
			} finally {
				Reflect.set(Path, "hasDirentSupport", originalHasDirentSupport);
			}
		});
	});

	test("globSync finds txt files", () => {
		const base = new Path(sandbox.root);
		const files = base.globSync("**/*.txt");
		const got = new Set(
			files.map((p) => nodepath.relative(sandbox.root, p.toString())),
		);
		expect(got.has(nodepath.join("dirC", "novel.txt"))).toBeTrue();
	});

	test("rglobSync finds txt files", () => {
		const base = new Path(sandbox.root);
		const files = base.rglobSync("*.txt");
		const got = new Set(
			files.map((p) => nodepath.relative(sandbox.root, p.toString())),
		);
		expect(got.has(nodepath.join("dirC", "novel.txt"))).toBeTrue();
	});

	if (sandbox.canSymlink) {
		test("readlinkSync returns relative target", () => {
			const linkA = new Path(sandbox.root).joinpath("linkA") as Path;
			const target = linkA.readlinkSync();
			expect(target.toString()).toBe("fileA");
		});
	}

	test("absoluteSync on '.' yields absolute path", () => {
		const rel = new Path(".");
		const abs = rel.absoluteSync();
		expect(nodepath.isAbsolute(abs.toString())).toBeTrue();
	});

	test("absoluteSync returns same instance when already absolute", () => {
		const already = new Path(sandbox.root);
		expect(already.absoluteSync()).toBe(already);
	});

	test("resolveSync yields absolute path", () => {
		const abs = new Path(sandbox.root).absoluteSync();
		const resolved = abs.resolveSync();
		expect(nodepath.isAbsolute(resolved.toString())).toBeTrue();
	});

	test("expandUserSync returns same instance for non-tilde path", () => {
		const p = new Path(sandbox.root);
		expect(p.expandUserSync()).toBe(p);
	});

	test("Path.cwdSync returns absolute path", () => {
		expect(nodepath.isAbsolute(Path.cwdSync().toString())).toBeTrue();
	});

	test("Path.homeSync returns absolute path", () => {
		expect(nodepath.isAbsolute(Path.homeSync().toString())).toBeTrue();
	});

	test("walkSync (top-down) returns records", () => {
		const base = new Path(sandbox.root);
		const records = base.walkSync();
		expect(records.length).toBeGreaterThan(0);
	});

	test("walkSync bottom-up returns records", () => {
		const base = new Path(sandbox.root);
		const records = base.walkSync({ topDown: false });
		expect(records.length).toBeGreaterThan(0);
	});

	test("walkSync bottom-up includes root last", () => {
		const base = new Path(sandbox.root);
		const records = base.walkSync({ topDown: false });
		const last = records[records.length - 1]?.[0].toString();
		expect(last).toBe(base.toString());
	});
});

// Async read/query tests
describe("Path read (async)", () => {
	test("exists() on base path", async () => {
		const base = new Path(sandbox.root);
		expect(base.exists()).resolves.toBeTrue();
	});

	test("exists() on missing file returns false", async () => {
		const missing = new Path(sandbox.root).joinpath("missing.txt") as Path;
		expect(missing.exists()).resolves.toBeFalse();
	});

	test("exists({followSymlinks:false}) on base", async () => {
		const base = new Path(sandbox.root);
		expect(base.exists({ followSymlinks: false })).resolves.toBeTrue();
	});

	test("isDir() on dirB", async () => {
		const dirB = new Path(sandbox.root).joinpath("dirB") as Path;
		expect(dirB.isDir()).resolves.toBeTrue();
	});

	test("isFile() on fileA", async () => {
		const fileA = new Path(sandbox.root).joinpath("fileA") as Path;
		expect(fileA.isFile()).resolves.toBeTrue();
	});

	if (sandbox.canSymlink) {
		test("isSymlink() on linkA", async () => {
			const linkA = new Path(sandbox.root).joinpath("linkA") as Path;
			expect(linkA.isSymlink()).resolves.toBeTrue();
		});

		test("lstat() returns stats object", async () => {
			const linkA = new Path(sandbox.root).joinpath("linkA") as Path;
			expect(linkA.lstat()).resolves.toBeDefined();
		});

		test("stat({followSymlinks:false}) identifies symlink", async () => {
			const linkA = new Path(sandbox.root).joinpath("linkA") as Path;
			const st = await linkA.stat({ followSymlinks: false });
			expect(st.isSymbolicLink()).toBeTrue();
		});

		test("stat({followSymlinks:true}) identifies target file", async () => {
			const linkA = new Path(sandbox.root).joinpath("linkA") as Path;
			const st = await linkA.stat({ followSymlinks: true });
			expect(st.isFile()).toBeTrue();
		});
	}

	test("readText() reads existing fileA", async () => {
		const fileA = new Path(sandbox.root).joinpath("fileA") as Path;
		expect(fileA.readText()).resolves.toContain("hello A");
	});

	test("readBytes() reads existing fileA as bytes", async () => {
		const fileA = new Path(sandbox.root).joinpath("fileA") as Path;
		const buf = await fileA.readBytes();
		expect(buf.toString("utf8")).toContain("hello A");
	});

	test("open() reads some data via stream", async () => {
		const f = new Path(sandbox.root).joinpath("fileA") as Path;
		const s = await f.open("r");
		await new Promise<void>((resolve, reject) => {
			let buf = "";
			s.setEncoding("utf8");
			s.on("data", (chunk) => {
				buf += String(chunk);
			});
			s.on("end", () => {
				try {
					expect(buf.length).toBeGreaterThan(0);
					resolve();
				} catch (e) {
					reject(e);
				}
			});
			s.on("error", reject);
		});
	});

	describe("iterdir option (async)", () => {
		async function collectAsync<T>(
			iterable: AsyncIterable<T>,
			limit = Infinity,
		) {
			const results: T[] = [];
			for await (const item of iterable) {
				results.push(item);
				if (results.length >= limit) {
					break;
				}
			}
			return results;
		}

		test("iterdir() returns Path[] by default", async () => {
			const base = new Path(sandbox.root);
			const entries = await base.iterdir();
			expect(entries.length).toBeGreaterThan(0);
			expect(entries.every((entry) => entry instanceof Path)).toBeTrue();
		});

		test("iterdir() respects withFileTypes=false", async () => {
			const base = new Path(sandbox.root);
			const entries = await base.iterdir({ extra: { withFileTypes: false } });
			expect(entries.length).toBeGreaterThan(0);
			expect(entries.every((entry) => entry instanceof Path)).toBeTrue();
		});

		test("iterDir() still returns Path[] even without Dirent support", async () => {
			const originalHasDirentSupport = Reflect.get(
				Path,
				"hasDirentSupport",
			) as () => boolean;
			Reflect.set(Path, "hasDirentSupport", () => false);
			try {
				const base = new Path(sandbox.root);
				const entries = await base.iterdir({ extra: { withFileTypes: false } });
				expect(entries.length).toBeGreaterThan(0);
				expect(entries.every((entry) => entry instanceof Path)).toBeTrue();
			} finally {
				Reflect.set(Path, "hasDirentSupport", originalHasDirentSupport);
			}
		});

		test("iterdir() returns Dirent[] with withFileTypes=true", async () => {
			const base = new Path(sandbox.root);
			const entries = await base.iterdir({ extra: { withFileTypes: true } });
			expect(entries.length).toBeGreaterThan(0);
			expect(entries.every((entry) => entry instanceof fs.Dirent)).toBeTrue();
		});

		test("iterdir() with withFileTypes=true rejects when Dirent unsupported", async () => {
			const originalHasDirentSupport = Reflect.get(
				Path,
				"hasDirentSupport",
			) as () => boolean;
			Reflect.set(Path, "hasDirentSupport", () => false);
			try {
				const base = new Path(sandbox.root);
				expect(
					base.iterdir({ extra: { withFileTypes: true } }),
				).rejects.toThrow(UnsupportedOperation);
			} finally {
				Reflect.set(Path, "hasDirentSupport", originalHasDirentSupport);
			}
		});

		test("iterdirStream yields Path instances by default", async () => {
			const base = new Path(sandbox.root);
			const entries = await collectAsync(base.iterdirStream(), 3);
			expect(entries.length).toBeGreaterThan(0);
			expect(entries.every((entry) => entry instanceof Path)).toBeTrue();
		});

		test("iterdirStream respects withFileTypes=false", async () => {
			const base = new Path(sandbox.root);
			const entries = await collectAsync(
				base.iterdirStream({ extra: { withFileTypes: false } }),
				3,
			);
			expect(entries.length).toBeGreaterThan(0);
			expect(entries.every((entry) => entry instanceof Path)).toBeTrue();
		});

		test("iterdirStream yields Dirent entries with withFileTypes=true", async () => {
			const base = new Path(sandbox.root);
			const entries = await collectAsync(
				base.iterdirStream({ extra: { withFileTypes: true } }),
				3,
			);
			expect(entries.length).toBeGreaterThan(0);
			expect(entries.every((entry) => entry instanceof fs.Dirent)).toBeTrue();
		});

		test("iterdirStream with withFileTypes=true rejects when Dirent unsupported", async () => {
			const originalHasDirentSupport = Reflect.get(
				Path,
				"hasDirentSupport",
			) as () => boolean;
			Reflect.set(Path, "hasDirentSupport", () => false);
			try {
				const base = new Path(sandbox.root);
				const iterable = base.iterdirStream({
					extra: { withFileTypes: true },
				});
				expect(iterable[Symbol.asyncIterator]().next()).rejects.toThrow(
					UnsupportedOperation,
				);
			} finally {
				Reflect.set(Path, "hasDirentSupport", originalHasDirentSupport);
			}
		});
	});

	test("glob() finds txt files", async () => {
		const base = new Path(sandbox.root);
		const files = await base.glob("**/*.txt");
		const got = new Set(
			files.map((p) => nodepath.relative(sandbox.root, p.toString())),
		);
		expect(got.has(nodepath.join("dirC", "novel.txt"))).toBeTrue();
	});

	test("rglob() finds txt files", async () => {
		const base = new Path(sandbox.root);
		const files = await base.rglob("*.txt");
		const got = new Set(
			files.map((p) => nodepath.relative(sandbox.root, p.toString())),
		);
		expect(got.has(nodepath.join("dirC", "novel.txt"))).toBeTrue();
	});

	if (sandbox.canSymlink) {
		test("readlink() returns relative target", async () => {
			const linkA = new Path(sandbox.root).joinpath("linkA") as Path;
			const target = await linkA.readlink();
			expect(target.toString()).toBe("fileA");
		});
	}

	test("absolute('.') yields absolute path", async () => {
		const rel = new Path(".");
		const abs = await rel.absolute();
		expect(nodepath.isAbsolute(abs.toString())).toBeTrue();
	});

	test("resolve(abs) yields absolute path", async () => {
		const abs = await new Path(".").absolute();
		const resolved = await abs.resolve();
		expect(nodepath.isAbsolute(resolved.toString())).toBeTrue();
	});

	test("Path.cwd() returns absolute path", async () => {
		expect(
			Path.cwd().then((p) => nodepath.isAbsolute(p.toString())),
		).resolves.toBeTrue();
	});

	test("Path.home() returns absolute path", async () => {
		expect(
			Path.home().then((p) => nodepath.isAbsolute(p.toString())),
		).resolves.toBeTrue();
	});

	test("expandUser('~', 'docs') expands into homedir", async () => {
		const expanded = await new Path("~", "docs").expandUser();
		expect(expanded.toString().startsWith(os.homedir())).toBeTrue();
	});

	test("walk() returns records", async () => {
		const base = new Path(sandbox.root);
		const records = await base.walk();
		expect(records.length).toBeGreaterThan(0);
	});
});

// Special cases
describe("glob unsupported fallback", () => {
	test("throws UnsupportedOperation when fs.globSync missing", () => {
		const base = new Path(sandbox.root);
		const ref = fs as { globSync?: unknown };
		const original = ref.globSync;
		ref.globSync = undefined;
		try {
			expect(() => base.globSync("**/*.txt")).toThrow(UnsupportedOperation);
		} finally {
			// restore
			ref.globSync = original;
		}
	});
});

describe("rglobSync and walkSync bottom-up", () => {
	const base = new Path(sandbox.root);

	test("rglobSync finds txt files", () => {
		const files = base.rglobSync("*.txt");
		const rel = new Set(
			files.map((p) => p.toString().slice(sandbox.root.length + 1)),
		);
		expect(rel.has(nodepath.join("dirC", "novel.txt"))).toBeTrue();
	});

	test("walkSync bottom-up order includes root last", () => {
		const records = base.walkSync({ topDown: false });
		const last = records[records.length - 1]?.[0].toString();
		expect(last).toBe(base.toString());
	});
});

// Focused read-option tests (async)
describe("Path read options (async)", () => {
	test("readText with explicit encoding returns string", async () => {
		const f = new Path(sandbox.root).joinpath("fileA");
		const txt = await f.readText("utf8");
		expect(typeof txt).toBe("string");
		expect(txt).toContain("hello A");
	});

	test("readBytes returns a Buffer", async () => {
		const f = new Path(sandbox.root).joinpath("fileA");
		const buf = await f.readBytes();
		expect(Buffer.isBuffer(buf)).toBeTrue();
		expect(buf.toString("utf8")).toContain("hello A");
	});

	test("stat({followSymlinks:false}) works async", async () => {
		if (!sandbox.canSymlink) return;
		const linkA = new Path(sandbox.root).joinpath("linkA");
		const st = await linkA.stat({ followSymlinks: false });
		expect(st.isSymbolicLink()).toBeTrue();
	});

	test("exists({followSymlinks:false}) resolves correctly", async () => {
		const base = new Path(sandbox.root);
		expect(base.exists({ followSymlinks: false })).resolves.toBeTrue();
	});

	test("open stream can setEncoding and emit data", async () => {
		const f = new Path(sandbox.root).joinpath("fileA");
		const s = await f.open("r");
		await new Promise<void>((resolve, reject) => {
			let buf = "";
			s.setEncoding("utf8");
			s.on("data", (chunk) => {
				buf += String(chunk);
			});
			s.on("end", () => {
				try {
					expect(buf.length).toBeGreaterThan(0);
					resolve();
				} catch (e) {
					reject(e);
				}
			});
			s.on("error", reject);
		});
	});
});
