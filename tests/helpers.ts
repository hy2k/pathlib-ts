import { expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import nodepath from "node:path";
import type { WalkTuple } from "../src/path.js";

export type Sandbox = {
	root: string;
	cleanup: () => void;
	canSymlink: boolean;
	reset: () => void;
};

export function makeSandbox(prefix = "pathlib-ts-"): Sandbox {
	const base = fs.mkdtempSync(nodepath.join(os.tmpdir(), prefix));
	const cleanup = () => {
		try {
			// fs.rmSync with recursive is available in Node 14+
			fs.rmSync(base, { recursive: true, force: true });
		} catch {
			// ignore
		}
	};

	let canSymlink = true;
	function setup() {
		// Create a small tree similar to CPython tests
		// base/
		//   fileA
		//   dirB/
		//     fileB
		//   dirC/
		//     dirD/
		//       fileD
		//     novel.txt
		//   linkA -> fileA (if possible)
		//   linkB -> dirB (if possible)
		//   brokenLink -> non-existing (if possible)
		fs.mkdirSync(nodepath.join(base, "dirB"), { recursive: true });
		fs.mkdirSync(nodepath.join(base, "dirC", "dirD"), { recursive: true });
		fs.writeFileSync(nodepath.join(base, "fileA"), "hello A\n", {
			encoding: "utf8",
		});
		fs.writeFileSync(nodepath.join(base, "dirB", "fileB"), "hello B\n", {
			encoding: "utf8",
		});
		fs.writeFileSync(
			nodepath.join(base, "dirC", "dirD", "fileD"),
			"hello D\n",
			{
				encoding: "utf8",
			},
		);
		fs.writeFileSync(
			nodepath.join(base, "dirC", "novel.txt"),
			"lorem ipsum\n",
			{
				encoding: "utf8",
			},
		);

		try {
			fs.symlinkSync("fileA", nodepath.join(base, "linkA"));
			fs.symlinkSync("dirB", nodepath.join(base, "linkB"));
			fs.symlinkSync("non-existing", nodepath.join(base, "brokenLink"));
		} catch {
			canSymlink = false;
			// Cleanup any partially created symlinks to avoid flakiness
			for (const name of ["linkA", "linkB", "brokenLink"]) {
				try {
					fs.unlinkSync(nodepath.join(base, name));
				} catch {}
			}
		}
	}

	const reset = () => {
		cleanup();
		fs.mkdirSync(base, { recursive: true });
		setup();
	};

	setup();

	return { root: base, cleanup, canSymlink, reset };
}

const sortStrings = (values: string[]): string[] => [...values].sort();

export function expectWalkSnapshot(
	sandbox: Sandbox,
	records: WalkTuple[],
): void {
	const map = new Map<string, { dirs: string[]; files: string[] }>();
	for (const [path, dirs, files] of records) {
		map.set(path.toString(), { dirs: [...dirs], files: [...files] });
	}

	const expectedPaths = [
		sandbox.root,
		nodepath.join(sandbox.root, "dirB"),
		nodepath.join(sandbox.root, "dirC"),
		nodepath.join(sandbox.root, "dirC", "dirD"),
	];
	if (sandbox.canSymlink) {
		expectedPaths.push(nodepath.join(sandbox.root, "linkB"));
	}
	expect(sortStrings([...map.keys()])).toEqual(sortStrings(expectedPaths));

	const expectEntry = (
		relative: string[],
		expectedDirs: string[],
		expectedFiles: string[],
	) => {
		const key = nodepath.join(sandbox.root, ...relative);
		const entry = map.get(key);
		expect(entry).toBeDefined();
		if (!entry) {
			throw new Error(`Missing walk record for ${key}`);
		}
		expect(sortStrings(entry.dirs)).toEqual(sortStrings(expectedDirs));
		expect(sortStrings(entry.files)).toEqual(sortStrings(expectedFiles));
	};

	const rootDirs = sandbox.canSymlink
		? ["dirB", "dirC", "linkB"]
		: ["dirB", "dirC"];
	const rootFiles = sandbox.canSymlink
		? ["brokenLink", "fileA", "linkA"]
		: ["fileA"];
	expectEntry([], rootDirs, rootFiles);
	expectEntry(["dirB"], [], ["fileB"]);
	expectEntry(["dirC"], ["dirD"], ["novel.txt"]);
	expectEntry(["dirC", "dirD"], [], ["fileD"]);
	if (sandbox.canSymlink) {
		expectEntry(["linkB"], [], ["fileB"]);
	}
}
