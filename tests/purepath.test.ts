import { describe, expect, test } from "bun:test";
import nodepath from "node:path";
import { PurePath, PurePosixPath, PureWindowsPath } from "../src/index.js";

const isWindows = nodepath.sep === "\\";

describe("PurePath basics", () => {
	test("construct and stringify", () => {
		const P = PurePath;
		const p = new P("a", "b", "c");
		// On POSIX this is a/b/c, on Windows uses backslashes
		expect(p.toString()).toBe(["a", "b", "c"].join(nodepath.sep));
		expect(String(p)).toBe(p.toString());
		expect(p.valueOf()).toBe(p.toString());
		expect(p.toJSON()).toBe(p.toString());
	});

	test("parts, name, suffix, suffixes, stem", () => {
		const P = PurePath;
		const p = new P("/tmp", "dir", "file.tar.gz");
		expect(p.parts.at(-1)).toBe(`file.tar.gz`);
		expect(p.name).toBe("file.tar.gz");
		expect(p.suffix).toBe(".gz");
		expect(p.suffixes).toEqual([".tar", ".gz"]);
		expect(p.stem).toBe("file.tar");
		expect(p.parent.toString()).toBe(nodepath.join("/tmp", "dir"));
		// parents iterator terminates
		expect([...p.parents].length).toBeGreaterThan(0);
	});

	test("withName/withSuffix/withStem", () => {
		const P = PurePath;
		const p = new P("/root", "a", "b.txt");
		expect(p.withName("c.md").toString()).toBe(
			nodepath.join("/root", "a", "c.md"),
		);
		expect(p.withSuffix(".md").toString()).toBe(
			nodepath.join("/root", "a", "b.md"),
		);
		expect(p.withStem("new").toString()).toBe(
			nodepath.join("/root", "a", "new.txt"),
		);
	});

	test("joinpath and dropSegments", () => {
		const P = PurePath;
		const p = new P("/", "a");
		const q = p.joinpath("b", "c");
		expect(q.toString()).toBe(nodepath.join(nodepath.sep, "a", "b", "c"));
		expect(q.dropSegments(1).toString()).toBe(
			nodepath.join(nodepath.sep, "a", "b"),
		);
	});

	test("relativeTo and isRelativeTo", () => {
		const P = PurePath;
		const p = new P("/a/b/c");
		const base = new P("/a");
		expect(p.relativeTo(base).toString()).toBe(nodepath.join("b", "c"));
		expect(p.isRelativeTo("/a/b")).toBeTrue();
		expect(p.isRelativeTo("/x")).toBeFalse();
	});

	test("isAbsolute and asPosix", () => {
		const P = PurePath;
		const rel = new P("a", "b");
		expect(rel.isAbsolute()).toBeFalse();
		const abs = new P(nodepath.join(nodepath.sep, "a"));
		expect(abs.isAbsolute()).toBeTrue();
		if (isWindows) {
			const w = new PureWindowsPath("C:\\a\\b");
			expect(w.asPosix()).toBe("C:/a/b");
		} else {
			const pos = new PurePosixPath("/a/b");
			expect(pos.asPosix()).toBe("/a/b");
		}
	});

	test("match and fullMatch", () => {
		const P = PurePath;
		const p = new P("/root/dir/file.py");
		expect(p.match("*.py")).toBeTrue();
		expect(p.match("dir/*.py")).toBeTrue();
		expect(p.fullMatch("/root/*/*.py")).toBeTrue();
		expect(p.fullMatch("/root/*.py")).toBeFalse();
	});

	test("asURI and fromURI absolute only", () => {
		const P = PurePath;
		const abs = new P(nodepath.join(nodepath.sep, "a", "b"));
		const uri = abs.asURI();
		expect(uri.startsWith("file:")).toBeTrue();
		const round = P.fromURI(uri);
		expect(round.toString()).toBe(abs.toString());
	});
});

describe("PathParents iteration", () => {
	test("iterable, at(), length", () => {
		const p = new PurePath(nodepath.join("a", "b", "c"));
		const parents = p.parents;
		const list = Array.from(parents).map((q) => q.toString());
		expect(list[0]).toBe(nodepath.join("a", "b"));
		expect(list[1]).toBe("a");
		expect(parents.at(0)?.toString()).toBe(nodepath.join("a", "b"));
		expect(parents.length).toBeGreaterThanOrEqual(2);
	});
});

describe("PurePath invalid inputs", () => {
	test("withName rejects empty/sep/dot", () => {
		const p = new PurePath(nodepath.join(nodepath.sep, "a", "b.txt"));
		expect(() => p.withName("")).toThrow();
		expect(() => p.withName(".")).toThrow();
		expect(() => p.withName(`a${nodepath.sep}b`)).toThrow();
	});

	test("withSuffix rejects non-dot prefix", () => {
		const p = new PurePath("file.txt");
		expect(() => p.withSuffix("txt")).toThrow();
	});

	test("withStem rejects empty when suffix exists", () => {
		const p = new PurePath("file.txt");
		expect(() => p.withStem("")).toThrow();
	});
});

describe("PurePath.relativeTo walkUp behavior", () => {
	test("without walkUp throws when target is not prefix", () => {
		const p = new PurePath(nodepath.join("/", "a", "b"));
		expect(() => p.relativeTo("/x")).toThrow();
	});

	test("with walkUp allows .. to escape", () => {
		const p = new PurePath(nodepath.join("/", "a", "b", "c"));
		const out = p.relativeTo("/a/x", { walkUp: true });
		expect(out.toString()).toBe(nodepath.join("..", "b", "c"));
	});
});

describe("PurePath.match invalid patterns", () => {
	test("empty or '.' pattern returns false per port", () => {
		const p = new PurePath("a");
		expect(p.match("")).toBeFalse();
		expect(p.match(".")).toBeFalse();
	});

	test("asURI throws on relative path", () => {
		const p = new PurePath("rel/path");
		expect(() => p.asURI()).toThrow();
	});
});
