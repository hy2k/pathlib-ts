#!/usr/bin/env bun
/*
  Release helper using Bun's spawnSync API.
  Usage: bun ./scripts/release.ts [--dry-run] [--no-push]
*/

import { readFileSync } from "node:fs";
import { Path } from "../src";

const ROOT = new Path(import.meta.dirname, "..");

function usage() {
	console.log(
		"Usage: bun ./scripts/release.ts [patch|minor] [--dry-run] [--no-push]",
	);
}

const rawArgs = process.argv.slice(2);
let DRY_RUN = false;
let NO_PUSH = false;
type BumpType = "patch" | "minor";
let BUMP_TYPE: BumpType | undefined;

for (const a of rawArgs) {
	if (a === "--dry-run") DRY_RUN = true;
	else if (a === "--no-push") NO_PUSH = true;
	else if (a === "-h" || a === "--help") {
		usage();
		process.exit(0);
	} else if (a === "patch" || a === "minor") {
		BUMP_TYPE = a;
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

function bumpVersion(version: string, type: BumpType) {
	// minimal semver bump, preserves prerelease/build if present
	const m = version.match(/^(\d+)\.(\d+)\.(\d+)([-+].*)?$/);
	if (!m) throw new Error(`Unrecognized version: ${version}`);
	const major = Number(m[1]);
	let minor = Number(m[2]);
	let patch = Number(m[3]);
	if (type === "patch") {
		patch = patch + 1;
	} else if (type === "minor") {
		minor = minor + 1;
		patch = 0;
	}
	return `${major}.${minor}.${patch}${m[4] ?? ""}`;
}

async function main() {
	if (!BUMP_TYPE) {
		console.error("Error: must specify bump type: patch or minor");
		usage();
		process.exit(2);
	}

	const gr = gitRoot();
	console.log("Repository:", gr ?? "not a git repo");

	const cur = readPackageVersion();
	if (!cur) {
		console.error("Could not read package.json version");
		process.exit(1);
	}

	const expectedNewVer = bumpVersion(cur, BUMP_TYPE);

	if (DRY_RUN) {
		console.log(
			"DRY RUN: would bump version %s -> %s (tag v%s) using npm version %s",
			cur,
			expectedNewVer,
			expectedNewVer,
			BUMP_TYPE,
		);
		process.exit(0);
	}

	if (!isCleanWorkingTree()) {
		console.error(
			"Working tree is dirty. Commit or stash changes before releasing.",
		);
		process.exit(1);
	}

	// Capture pre-release HEAD so we can reset to it deterministically on failure.
	const preHeadRes = runSync(["git", "rev-parse", "HEAD"]);
	const preHead = preHeadRes.success
		? preHeadRes.stdout.toString().trim()
		: null;

	console.log(
		`Running: npm version ${BUMP_TYPE} --no-git-tag-version (updates package.json only)`,
	);
	const npmRes = runSync(["npm", "version", BUMP_TYPE, "--no-git-tag-version"]);
	if (!npmRes.success) {
		console.error("npm version failed:");
		console.error(npmRes.stderr.toString());
		process.exit(npmRes.exitCode ?? 1);
	}

	// npmRes stdout contains the new version (e.g. "1.2.3") but we will base the tag
	// and commit message on the expectedNewVer we computed earlier.

	// Verify package.json actually contains the expected version.
	const updated = readPackageVersion();
	if (!updated) {
		console.error("Could not read package.json after npm version");
		process.exit(1);
	}

	if (updated !== expectedNewVer) {
		console.error(
			"Version mismatch: expected %s but npm updated package.json to %s",
			expectedNewVer,
			updated,
		);
		// Attempt to revert commit and tag created by `npm version`.
		console.error("Attempting to revert package.json changes...");
		if (preHead) {
			const resetRes = runSync(["git", "reset", "--hard", preHead]);
			if (!resetRes.success) {
				console.error("git reset failed:");
				console.error(resetRes.stderr.toString());
			}
		} else {
			console.error(
				"Could not determine pre-release HEAD; please revert package.json manually.",
			);
		}
		process.exit(1);
	}

	// Create commit and tag manually so it's deterministic and easy to revert.
	const tag = `v${updated}`;
	console.log("Committing package.json and creating tag:", tag);
	const addRes = runSync(["git", "add", "package.json"]);
	if (!addRes.success) {
		console.error("git add failed:");
		console.error(addRes.stderr.toString());
		// attempt to revert
		if (preHead) runSync(["git", "reset", "--hard", preHead]);
		process.exit(1);
	}
	const commitRes = runSync([
		"git",
		"commit",
		"-m",
		`chore(release): ${updated}`,
	]);
	if (!commitRes.success) {
		console.error("git commit failed:");
		console.error(commitRes.stderr.toString());
		if (preHead) runSync(["git", "reset", "--hard", preHead]);
		process.exit(1);
	}
	// Create annotated tag for the release
	const tagRes = runSync([
		"git",
		"tag",
		"-a",
		tag,
		"-m",
		`Release v${updated}`,
	]);
	if (!tagRes.success) {
		console.error("git tag failed:");
		console.error(tagRes.stderr.toString());
		// try to undo commit
		if (preHead) runSync(["git", "reset", "--hard", preHead]);
		process.exit(1);
	}

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
