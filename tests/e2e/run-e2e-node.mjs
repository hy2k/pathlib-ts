#!/usr/bin/env -S node --test
import assert from "node:assert/strict";
import os from "node:os";
import nodepath from "node:path";
import test from "node:test";
import { Path, UnsupportedOperation } from "../../dist/index.js";

test("node smoke: write/read text", async () => {
	const tmpBase = nodepath.join(
		os.tmpdir(),
		`pathlibts-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	const dir = new Path(tmpBase);
	await dir.mkdir({ parents: true, existOk: true });

	const file = new Path(nodepath.join(tmpBase, "hello-node-read.txt"));
	await file.writeText("hello node read");
	const content = await file.readText();
	assert.equal(content, "hello node read");

	await file.unlink();
	await dir.rmdir();
});

test("node smoke: bytes/stream/rglob", async () => {
	const tmpBase = nodepath.join(
		os.tmpdir(),
		`pathlibts-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	const dir = new Path(tmpBase);
	await dir.mkdir({ parents: true, existOk: true });

	// bytes write/read
	const bytesFile = new Path(nodepath.join(tmpBase, "bytes.bin"));
	const arr = Buffer.from([1, 2, 3, 4]);
	await bytesFile.writeBytes(arr);
	const readBuf = await bytesFile.readBytes();
	assert.equal(Buffer.from(readBuf).toString("hex"), arr.toString("hex"));

	// stream: open returns a readable stream; consume a small chunk
	const textFile = new Path(nodepath.join(tmpBase, "stream.txt"));
	await textFile.writeText("stream-data-xyz");
	const rs = await textFile.open();
	let seen = false;
	for await (const chunk of rs) {
		if (chunk?.length) {
			seen = true;
			break;
		}
	}
	assert.ok(seen, "should read at least one chunk from stream");

	// rglob: newer fs APIs (glob) may not be available in some runtimes; library may
	// fall back or throw UnsupportedOperation. Accept either.
	try {
		const matches = await dir.rglob("*.txt");
		assert.ok(Array.isArray(matches));
	} catch (err) {
		if (
			err instanceof UnsupportedOperation ||
			err?.name === "UnsupportedOperation"
		) {
			// acceptable: runtime does not support glob APIs
		} else {
			throw err;
		}
	}

	// cleanup
	await bytesFile.unlink();
	await textFile.unlink();
	await dir.rmdir();
});
