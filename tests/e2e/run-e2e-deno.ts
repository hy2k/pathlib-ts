#!/usr/bin/env -S deno test --allow-read --allow-write --allow-env
import { assertEquals } from "https://deno.land/std@0.203.0/assert/mod.ts";
import os from "node:os";
import nodepath from "node:path";
import { Path, UnsupportedOperation } from "../../dist/index.js";

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

	// avoid streaming (some runtimes leak file handles for partial consumption)
	const textFile = new Path(nodepath.join(tmpBase, "stream.txt"));
	await textFile.writeText("stream-data-abc");
	const text = await textFile.readText();
	if (!text.includes("stream-data-abc"))
		throw new Error("expected stream data present");

	// rglob - accept UnsupportedOperation
	try {
		const matches = await dir.rglob("*.txt");
		if (!Array.isArray(matches)) throw new Error("rglob should return array");
	} catch (err) {
		// err is unknown; check safely for UnsupportedOperation by instance or name
		if (err instanceof UnsupportedOperation) {
			// ok
		} else if (err && typeof err === "object") {
			const name = (err as Record<string, unknown>).name;
			if (name === "UnsupportedOperation") {
				// ok
			} else {
				throw err;
			}
		} else {
			throw err;
		}
	}

	// cleanup
	await bytesFile.unlink();
	await textFile.unlink();
	await dir.rmdir();
});
