#!/usr/bin/env -S deno test --allow-read --allow-write --allow-env
import {
	assertEquals,
	assertGreater,
	assertStringIncludes,
} from "jsr:@std/assert@^1";

import os from "node:os";
import nodepath from "node:path";
import { Path } from "../../dist/index.js";

const test = Deno.test;

test("deno smoke: write/read text", async () => {
	const tmpBase = nodepath.join(
		os.tmpdir(),
		`pathlibts-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	const dir = new Path(tmpBase);
	await dir.mkdir({ parents: true, existOk: true });

	const file = new Path(nodepath.join(tmpBase, "hello-deno.txt"));
	await file.writeText("hello from deno e2e");
	const content = await file.readText();
	assertEquals(content, "hello from deno e2e");

	await file.unlink();
	await dir.rmdir();
});

test("deno smoke: bytes/stream/rglob", async () => {
	const tmpBase = nodepath.join(
		os.tmpdir(),
		`pathlibts-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	const dir = new Path(tmpBase);
	await dir.mkdir({ parents: true, existOk: true });

	// bytes
	const bytesFile = new Path(nodepath.join(tmpBase, "bytes.bin"));
	const arr = new Uint8Array([5, 6, 7, 8]);
	await bytesFile.writeBytes(arr);
	const readBuf = await bytesFile.readBytes();
	assertEquals(Array.from(readBuf), Array.from(arr));

	// stream test: fully consume and then close/destroy the stream
	const streamFile = new Path(nodepath.join(tmpBase, "stream.txt"));
	await streamFile.writeText("stream-some-text");
	const rs = await streamFile.open();
	let collected = "";
	for await (const chunk of rs) {
		if (typeof chunk === "string") collected += chunk;
		else if (chunk instanceof Uint8Array)
			collected += new TextDecoder().decode(chunk);
		else collected += String(chunk ?? "");
	}
	assertStringIncludes(collected, "stream-some-text");

	// rglob
	const matches = await dir.rglob("*.txt");
	if (!Array.isArray(matches)) throw new Error("rglob should return array");
	assertGreater(matches.length, 0);

	// cleanup
	await bytesFile.unlink();
	await streamFile.unlink();
	await dir.rmdir();
});
