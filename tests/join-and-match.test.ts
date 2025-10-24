import { describe, expect, test } from "bun:test";
import nodepath from "node:path";
import { PurePath } from "../src/index.js";

describe("join semantics", () => {
	test("basic joinpath behavior", () => {
		const P = PurePath;
		const p = new P(nodepath.join(nodepath.sep, "a"));
		const pp = p.joinpath("b");
		expect(pp.toString()).toBe(nodepath.join(nodepath.sep, "a", "b"));

		const r1 = new P(nodepath.join(nodepath.sep, "a")).joinpath(
			nodepath.join(nodepath.sep, "c"),
		);
		// In this port, an absolute segment is appended rather than resetting.
		expect(r1.toString()).toBe(nodepath.join(nodepath.sep, "a", "c"));
	});
});

describe("glob-like match vs fullMatch", () => {
	test("relative right-side match", () => {
		const P = PurePath;
		const p = new P(nodepath.join("a", "b", "c.txt"));
		expect(p.match("*.txt")).toBeTrue();
		expect(p.match("b/*.txt")).toBeTrue();
		expect(p.match("a/*.txt")).toBeFalse();
	});

	test("fullMatch requires whole path", () => {
		const P = PurePath;
		const p = new P(nodepath.join(nodepath.sep, "a", "b", "c.py"));
		expect(
			p.fullMatch(nodepath.join(nodepath.sep, "a", "*", "*.py")),
		).toBeTrue();
		expect(p.fullMatch(nodepath.join(nodepath.sep, "a", "*.py"))).toBeFalse();
	});
});
