import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import { Path } from "../src/index.js";
import { makeSandbox } from "./helpers.js";

const sandbox = makeSandbox();

beforeAll(() => {
	fs.existsSync(sandbox.root);
});

afterAll(() => {
	sandbox.cleanup();
});

// Sync write/mutation tests
describe("Path write (sync)", () => {
	test("writeTextSync writes content", () => {
		const f = new Path(sandbox.root).joinpath("rw-sync.txt") as Path;
		f.writeTextSync("hello world", "utf8");
		expect(f.readTextSync()).toBe("hello world");
	});

	test("writeBytesSync writes bytes", () => {
		const f = new Path(sandbox.root).joinpath("bytes-sync.txt") as Path;
		f.writeBytesSync(Buffer.from("bytes\n"));
		expect(f.readBytesSync().toString("utf8")).toBe("bytes\n");
	});

	test("openSync can open file for read", () => {
		const f = new Path(sandbox.root).joinpath("streaming-sync.txt") as Path;
		f.writeTextSync("streaming");
		const s = f.openSync("r");
		s.close();
		expect(Boolean(s)).toBeTrue();
	});

	test("touchSync creates file", () => {
		const f = new Path(sandbox.root).joinpath("newfile-sync.txt") as Path;
		f.touchSync();
		expect(f.existsSync()).toBeTrue();
	});

	test("mkdirSync creates directory", () => {
		const d = new Path(sandbox.root).joinpath("newdir-sync") as Path;
		d.mkdirSync({ existOk: true });
		expect(d.isDirSync()).toBeTrue();
	});

	test("unlinkSync removes file", () => {
		const f = new Path(sandbox.root).joinpath("todelete-sync.txt") as Path;
		f.writeTextSync("tmp");
		f.unlinkSync();
		expect(f.existsSync()).toBeFalse();
	});

	test("rmdirSync removes directory", () => {
		const d = new Path(sandbox.root).joinpath("todeldir-sync") as Path;
		d.mkdirSync({ existOk: true });
		d.rmdirSync();
		expect(d.existsSync()).toBeFalse();
	});

	test("renameSync moves file", () => {
		const base = new Path(sandbox.root);
		const a = base.joinpath("a-sync.txt") as Path;
		const b = base.joinpath("b-sync.txt") as Path;
		a.writeTextSync("A");
		const res = a.renameSync(b);
		expect(res.toString()).toBe(b.toString());
	});

	test("replaceSync overwrites file", () => {
		const base = new Path(sandbox.root);
		const b = base.joinpath("b2-sync.txt") as Path;
		const c = base.joinpath("c2-sync.txt") as Path;
		b.writeTextSync("B");
		c.writeTextSync("C");
		const replaced = b.replaceSync(c);
		expect(replaced.toString()).toBe(c.toString());
	});

	test("copySync copies file", () => {
		const base = new Path(sandbox.root);
		const src = base.joinpath("fileA") as Path;
		const dest = base.joinpath("copyA-sync.txt") as Path;
		src.copySync(dest);
		expect(dest.readTextSync()).toContain("hello A");
	});

	test("copySync copies directory recursively", () => {
		const base = new Path(sandbox.root);
		const srcDir = base.joinpath("dirC") as Path;
		const destDir = base.joinpath("copyDirC-sync") as Path;
		srcDir.copySync(destDir);
		expect((destDir.joinpath("dirD", "fileD") as Path).existsSync()).toBeTrue();
	});
});

// Async write/mutation tests
describe("Path write (async)", () => {
	test("writeText writes content", async () => {
		const f = new Path(sandbox.root).joinpath("rw.txt") as Path;
		await f.writeText("bytes\n");
		expect(f.readText()).resolves.toBe("bytes\n");
	});

	test("writeBytes writes bytes", async () => {
		const f = new Path(sandbox.root).joinpath("bytes.txt") as Path;
		await f.writeBytes(Buffer.from("BYTES\n"));
		expect(f.readBytes()).resolves.toEqual(Buffer.from("BYTES\n"));
	});

	test("open reads some data via stream", async () => {
		const f = new Path(sandbox.root).joinpath("streaming.txt") as Path;
		await f.writeText("some data");
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

	test("touch creates file", async () => {
		const f = new Path(sandbox.root).joinpath("newfile.txt") as Path;
		await f.touch();
		expect(f.existsSync()).toBeTrue();
	});

	test("mkdir creates directory", async () => {
		const d = new Path(sandbox.root).joinpath("newdir") as Path;
		await d.mkdir();
		expect(d.isDirSync()).toBeTrue();
	});

	test("unlink removes file", async () => {
		const f = new Path(sandbox.root).joinpath("todelete.txt") as Path;
		await f.writeText("tmp");
		await f.unlink();
		expect(f.existsSync()).toBeFalse();
	});

	test("rmdir removes directory", async () => {
		const d = new Path(sandbox.root).joinpath("todeldir") as Path;
		await d.mkdir();
		await d.rmdir();
		expect(d.existsSync()).toBeFalse();
	});

	test("rename moves file", async () => {
		const base = new Path(sandbox.root);
		const a = base.joinpath("a.txt") as Path;
		const b = base.joinpath("b.txt") as Path;
		await a.writeText("A");
		const res = await a.rename(b);
		expect(res.toString()).toBe(b.toString());
	});

	test("replace overwrites file", async () => {
		const base = new Path(sandbox.root);
		const b = base.joinpath("b2.txt") as Path;
		const c = base.joinpath("c2.txt") as Path;
		await b.writeText("B");
		await c.writeText("C");
		const replaced = await b.replace(c);
		expect(replaced.toString()).toBe(c.toString());
	});

	test("copy copies file", async () => {
		const base = new Path(sandbox.root);
		const src = base.joinpath("fileA") as Path;
		const dest = base.joinpath("copyA.txt") as Path;
		await src.copy(dest);
		expect(dest.readTextSync()).toContain("hello A");
	});

	test("copy copies directory recursively", async () => {
		const base = new Path(sandbox.root);
		const srcDir = base.joinpath("dirC") as Path;
		const destDir = base.joinpath("copyDirC") as Path;
		await srcDir.copy(destDir);
		expect((destDir.joinpath("dirD", "fileD") as Path).existsSync()).toBeTrue();
	});
});
