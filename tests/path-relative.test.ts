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
