#!/usr/bin/env bun
/*
  Release helper using Bun's spawnSync API.
  Usage: bun ./scripts/release-patch.ts [--dry-run] [--no-push]
*/

import { readFileSync } from "node:fs";
import { Path } from "../src";

const ROOT = new Path(import.meta.dirname, "..");

function usage() {
	console.log("Usage: bun ./scripts/release-patch.ts [--dry-run] [--no-push]");
}

const args = process.argv.slice(2);
let DRY_RUN = false;
let NO_PUSH = false;

for (const a of args) {
	if (a === "--dry-run") DRY_RUN = true;
	else if (a === "--no-push") NO_PUSH = true;
	else if (a === "-h" || a === "--help") {
		usage();
		process.exit(0);
	} else {
		console.error("Unknown arg:", a);
		usage();
		process.exit(2);
	}
}

function runSync(cmd: string[], opts: { cwd?: string } = {}) {
	const r = Bun.spawnSync({
		cmd,
		cwd: opts.cwd ?? ROOT.toString(),
		stdout: "pipe",
		stderr: "pipe",
	});
	return r;
}

function gitRoot() {
	const r = runSync(["git", "rev-parse", "--show-toplevel"]);
	if (!r.success) return null;
	return r.stdout.toString().trim();
}

function isCleanWorkingTree() {
	const d1 = runSync(["git", "diff", "--quiet"]);
	const d2 = runSync(["git", "diff", "--cached", "--quiet"]);
	return d1.success && d2.success;
}

function readPackageVersion() {
	const pkg = JSON.parse(
		readFileSync(ROOT.joinpath("package.json").toString(), "utf8"),
	) as { version?: string };
	return pkg.version ?? null;
}

function bumpPatch(version: string) {
	// minimal semver patch bump, preserves prerelease/build if present
	const m = version.match(/^(\d+)\.(\d+)\.(\d+)([-+].*)?$/);
	if (!m) throw new Error(`Unrecognized version: ${version}`);
	const major = Number(m[1]);
	const minor = Number(m[2]);
	const patch = Number(m[3]) + 1;
	return `${major}.${minor}.${patch}${m[4] ?? ""}`;
}

async function main() {
	const gr = gitRoot();
	console.log("Repository:", gr ?? "not a git repo");

	const cur = readPackageVersion();
	if (!cur) {
		console.error("Could not read package.json version");
		process.exit(1);
	}

	const newVer = bumpPatch(cur);

	if (DRY_RUN) {
		console.log(
			"DRY RUN: would bump version %s -> %s (tag v%s)",
			cur,
			newVer,
			newVer,
		);
		process.exit(0);
	}

	if (!isCleanWorkingTree()) {
		console.error(
			"Working tree is dirty. Commit or stash changes before releasing.",
		);
		process.exit(1);
	}

	console.log('Running: npm version patch -m "chore(release): %s"');
	const npmRes = runSync([
		"npm",
		"version",
		"patch",
		"-m",
		"chore(release): %s",
	]);
	if (!npmRes.success) {
		console.error("npm version failed:");
		console.error(npmRes.stderr.toString());
		process.exit(npmRes.exitCode ?? 1);
	}

	const tag =
		npmRes.stdout.toString().trim() || npmRes.stderr.toString().trim();
	console.log("Created tag:", tag);

	if (NO_PUSH) {
		console.log("--no-push specified; skipping git push");
		process.exit(0);
	}

	console.log("Pushing commit and tags to origin");
	const pushRes = runSync(["git", "push", "origin", "--follow-tags"]);
	if (!pushRes.success) {
		console.error("git push failed:");
		console.error(pushRes.stderr.toString());
		process.exit(pushRes.exitCode ?? 1);
	}

	console.log("Release complete:", tag);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
