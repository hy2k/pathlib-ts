import { describe, expect, test } from "bun:test";
import { toPromise } from "../src/util.js";

describe("toPromise", () => {
	test("resolves when factory succeeds", async () => {
		const p = toPromise(() => 42);
		expect(p).resolves.toBe(42);
	});

	test("rejects when factory throws", async () => {
		const err = new Error("boom");
		const p = toPromise(() => {
			throw err;
		});
		expect(p).rejects.toBe(err);
	});
});
