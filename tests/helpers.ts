import fs from "node:fs";
import os from "node:os";
import nodepath from "node:path";

export type Sandbox = {
	root: string;
	cleanup: () => void;
	canSymlink: boolean;
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
	fs.writeFileSync(nodepath.join(base, "dirC", "dirD", "fileD"), "hello D\n", {
		encoding: "utf8",
	});
	fs.writeFileSync(nodepath.join(base, "dirC", "novel.txt"), "lorem ipsum\n", {
		encoding: "utf8",
	});

	let canSymlink = true;
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

	return { root: base, cleanup, canSymlink };
}
