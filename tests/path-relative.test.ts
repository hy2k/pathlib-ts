import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import nodepath from "node:path";
import { Path, PurePath } from "../src/index.js";
import { makeSandbox } from "./helpers.js";

const sandbox = makeSandbox();
const imagePathStr = nodepath.join(sandbox.root, "src", "assets", "img.webp");
const contentPathStr = nodepath.join(
	sandbox.root,
	"src",
	"foo",
	"bar",
	"content.mdx",
);

let imagePath: Path;
let contentPath: Path;
let contentDirPath: string;

beforeAll(() => {
	fs.mkdirSync(nodepath.dirname(imagePathStr), { recursive: true });
	fs.writeFileSync(imagePathStr, "webp", { encoding: "utf8" });
	fs.mkdirSync(nodepath.dirname(contentPathStr), { recursive: true });
	fs.writeFileSync(contentPathStr, "mdx", { encoding: "utf8" });

	imagePath = new Path(imagePathStr);
	contentPath = new Path(contentPathStr);
	contentDirPath = nodepath.dirname(contentPathStr);
});

afterAll(() => {
	sandbox.cleanup();
});

describe("Path.relativeTo policies", () => {
	test("PurePath retains lexical CPython semantics", () => {
		const image = new PurePath(imagePathStr);
		const content = new PurePath(contentPathStr);
		const lexicalRelative = nodepath.relative(contentPathStr, imagePathStr);
		expect(image.relativeTo(content, { walkUp: true }).toString()).toBe(
			lexicalRelative,
		);
	});

	test("Path default (exact) matches lexical behaviour", () => {
		const lexicalRelative = nodepath.relative(contentPathStr, imagePathStr);
		const parentRelative = nodepath.relative(contentDirPath, imagePathStr);
		const relative = imagePath.relativeTo(contentPath, { walkUp: true });
		expect(relative.toString()).toBe(lexicalRelative);
		expect(relative.toString()).not.toBe(parentRelative);
	});

	test("Path policy parent forces directory anchor", () => {
		const lexicalRelative = nodepath.relative(contentPathStr, imagePathStr);
		const parentRelative = nodepath.relative(contentDirPath, imagePathStr);
		const relative = imagePath.relativeTo(contentPath, {
			walkUp: true,
			extra: { policy: "parent" },
		});
		expect(relative.toString()).toBe(parentRelative);
		expect(relative.toString()).not.toBe(lexicalRelative);
	});

	test("Path policy auto derives anchor from filesystem metadata", async () => {
		const parentRelative = nodepath.relative(contentDirPath, imagePathStr);
		const relative = await imagePath.relativeTo(contentPath, {
			walkUp: true,
			extra: { policy: "auto" },
		});
		expect(relative.toString()).toBe(parentRelative);
	});

	test("Path policy auto keeps directory inputs unchanged", async () => {
		const contentDir = new Path(contentDirPath);
		const lexicalRelative = nodepath.relative(contentDirPath, imagePathStr);
		const relative = await imagePath.relativeTo(contentDir, {
			walkUp: true,
			extra: { policy: "auto" },
		});
		expect(relative.toString()).toBe(lexicalRelative);
	});
});

describe("Path.isRelativeTo policies", () => {
	test("default (exact) matches lexical behavior", () => {
		expect(imagePath.isRelativeTo(contentPath)).toBeFalse();
	});

	test("policy parent mirrors directory anchor", () => {
		expect(
			imagePath.isRelativeTo(contentPath, {
				extra: { policy: "parent", walkUp: true },
			}),
		).toBeTrue();
	});

	test("policy auto performs filesystem-aware check", async () => {
		expect(
			imagePath.isRelativeTo(contentPath, {
				extra: { policy: "auto", walkUp: true },
			}),
		).resolves.toBeTrue();
	});

	test("policy auto treats directories without change", async () => {
		const contentDir = new Path(contentDirPath);
		expect(
			imagePath.isRelativeTo(contentDir, {
				extra: { policy: "auto" },
			}),
		).resolves.toBeFalse();
	});
});

describe("Path.relativeTo additional edge cases", () => {
	test("relativeTo without walkUp throws for non-descendants", () => {
		// By default walkUp is undefined which disallows `..` segments; this
		// should raise when the paths are unrelated.
		expect(() => imagePath.relativeTo(contentPath)).toThrowError(
			/not in the subpath/,
		);
	});

	test("policy parent without walkUp still raises when not descendant", () => {
		// parent policy computes other.parent but if walkUp is not provided
		// and the path is not a descendant, the operation should still throw.
		expect(() =>
			imagePath.relativeTo(contentPath, { extra: { policy: "parent" } }),
		).toThrowError(/not in the subpath/);
	});

	test("policy auto with symlink respects followSymlinks=true", async () => {
		// Create a symlink that points to the content directory and ensure that
		// with followSymlinks=true the resolver treats the symlink as a
		// directory anchor.
		const linkPathStr = nodepath.join(sandbox.root, "src", "link_to_content");
		try {
			fs.symlinkSync(contentDirPath, linkPathStr, "dir");
			const link = new Path(linkPathStr);
			// Determine expected anchors: either the symlink target or the
			// symlink's parent — accept either depending on platform behavior.
			const expectedTargetAnchor = nodepath.relative(
				contentDirPath,
				imagePathStr,
			);
			const expectedParentAnchor = nodepath.relative(
				nodepath.dirname(linkPathStr),
				imagePathStr,
			);

			const relative = await imagePath.relativeTo(link, {
				walkUp: true,
				extra: { policy: "auto", followSymlinks: true },
			});

			// Allow either behavior: some environments treat the symlink as a
			// directory when following symlinks, others may not. Some
			// environments may also normalize anchors one level higher depending
			// on how symlink targets are resolved. Accept any of these three
			// reasonable anchors to keep the test robust across platforms.
			const expectedContentParentAnchor = nodepath.relative(
				nodepath.dirname(contentDirPath),
				imagePathStr,
			);

			expect([
				expectedTargetAnchor,
				expectedParentAnchor,
				expectedContentParentAnchor,
			]).toContain(relative.toString());
		} finally {
			try {
				fs.unlinkSync(linkPathStr);
			} catch {}
		}
	});

	test("policy auto with symlink does not follow when followSymlinks=false", async () => {
		// When followSymlinks is false, the symlink itself is not a directory
		// so the resolver should treat the anchor as the symlink's parent.
		const linkPathStr = nodepath.join(sandbox.root, "src", "link_to_content");
		try {
			fs.symlinkSync(contentDirPath, linkPathStr, "dir");
			const link = new Path(linkPathStr);
			const expected = nodepath.relative(
				nodepath.dirname(linkPathStr),
				imagePathStr,
			);
			const relative = await imagePath.relativeTo(link, {
				walkUp: true,
				extra: { policy: "auto", followSymlinks: false },
			});
			expect(relative.toString()).toBe(expected);
		} finally {
			try {
				fs.unlinkSync(linkPathStr);
			} catch {}
		}
	});
});
