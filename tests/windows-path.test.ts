import { describe, expect, test } from "bun:test";
import { PureWindowsPath } from "../src/pathlib.js";

// These tests are platform-agnostic by constructing Windows paths via PureWindowsPath

describe("PureWindowsPath basics", () => {
	test("drive letter, case-insensitive matching", () => {
		const a = new PureWindowsPath("C:/Users/Name");
		// Use posix view for stable comparison across host OS
		expect(a.asPosix()).toBe("C:/Users/Name");
		// match is case-insensitive by default on Windows (relative pattern)
		expect(a.match("users/name")).toBeTrue();
		// anchor is drive + root
		expect(a.drive).toBe("C:");
		expect(a.root).toBe("\\");
		expect(a.anchor).toBe("C:\\");
	});

	test("UNC path parts", () => {
		const p = new PureWindowsPath("//server/share/folder/file.txt");
		// UNC drive + root makes the anchor
		expect(p.drive).toBe("\\\\server\\share");
		expect(p.root).toBe("\\");
		expect(p.parts[0]).toBe("\\\\server\\share\\");
		expect(p.suffix).toBe(".txt");
		expect(p.name).toBe("file.txt");
	});
});

describe("match/fullMatch case sensitivity options", () => {
	test("Windows path with explicit caseSensitive true/false", () => {
		const w = new PureWindowsPath("C:/Users/Name/file.TXT");
		// case-insensitive
		expect(w.match("users/name/*.txt", { caseSensitive: false })).toBeTrue();
		// force case-sensitive failure
		expect(w.match("users/name/*.txt", { caseSensitive: true })).toBeFalse();
		// fullMatch also supports option
		expect(
			w.fullMatch("C:/Users/Name/*.TXT", { caseSensitive: true }),
		).toBeTrue();
		expect(
			w.fullMatch("C:/Users/Name/*.txt", { caseSensitive: true }),
		).toBeFalse();
	});
});

describe("PureWindowsPath relativeTo", () => {
	test("relativeTo across drives throws without walkUp", () => {
		const p = new PureWindowsPath("C:/A/B");
		expect(() => p.relativeTo("D:/A")).toThrow();
	});

	test("relativeTo across drives still throws with walkUp (different anchors)", () => {
		const p = new PureWindowsPath("C:/A/B");
		expect(() => p.relativeTo("D:/A", { walkUp: true })).toThrow();
	});
});

describe("PureWindowsPath URI", () => {
	test("asURI produces file:// and encodes special chars", () => {
		const p = new PureWindowsPath("C:/A B/C#D.txt");
		const uri = p.asURI();
		expect(uri.startsWith("file://")).toBeTrue();
		expect(uri).toContain("%20");
		expect(uri).toContain("%23");
	});
});
