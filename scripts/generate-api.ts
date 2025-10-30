import { spawnSync } from "node:child_process";
import { Path } from "../src";

// Base route segment for rendered documentation pages. Store without leading slash so
// the string can be reused for both filesystem paths and URL segments.
const routePrefix = "reference/api";

const repoRoot = new Path(import.meta.dirname, "..");
const docsRoot = repoRoot.joinpath("docs");
const outDir = docsRoot.joinpath("src", "content", "docs", routePrefix);
const apiExtractorConfig = repoRoot.joinpath("api-extractor.json").toString();
const apiExtractorTemp = docsRoot.joinpath("temp").toString();

const workspacePackageName = "pathlib-ts";

if (!(await outDir.exists())) {
	await outDir.mkdir({ parents: true, existOk: true });
}

console.log("Building workspace package for API docs...");
const build = spawnSync("bun", ["run", "build"], {
	stdio: "inherit",
	cwd: repoRoot.toString(),
});

if (build.status !== 0) {
	console.error(`bun build failed for ${workspacePackageName}`);
	process.exit(build.status || 1);
}

console.log("Running API Extractor...");
const ae = spawnSync(
	"bun",
	[
		"api-extractor",
		"run",
		"--local",
		"--verbose",
		"--config",
		apiExtractorConfig,
	],
	{
		stdio: "inherit",
		cwd: docsRoot.toString(),
	},
);

if (ae.status !== 0) {
	console.error("api-extractor failed");
	process.exit(ae.status || 1);
}

console.log("Running API Documenter...");
const ad = spawnSync(
	"bun",
	[
		"api-documenter",
		"markdown",
		"--output",
		outDir.toString(),
		"--input-folder",
		apiExtractorTemp,
	],
	{
		stdio: "inherit",
		cwd: docsRoot.toString(),
	},
);

if (ad.status !== 0) {
	console.error("api-documenter failed");
	process.exit(ad.status || 1);
}

for (const file of await outDir.iterdir()) {
	if (file.suffix !== ".md") continue;

	const raw = await file.readText();
	const body = stripFrontmatter(raw);
	const headingLine = body
		.split(/\r?\n/)
		.find((line) => /^#{1,6}\s+/.test(line.trim()));
	const rawTitle = headingLine
		? headingLine.replace(/^#{1,6}\s+/, "").trim()
		: file.stem;
	const title = escapeTitle(rawTitle);
	const slug = getSlugForFilename(file.name);
	const rewritten = rewriteMarkdownLinks(body);
	const cleaned = removeBreadcrumbs(rewritten);
	const frontmatter = `---\ntitle: "${title}"\nslug: "${slug}"\n---\n\n`;
	await file.writeText(frontmatter + cleaned.replace(/^\s+/, ""));
}

// The top-level index produced by API Documenter duplicates the surrounding docs; drop it.
const indexFile = outDir.joinpath("index.md");
if (await indexFile.exists()) {
	await indexFile.unlink({ missingOk: true });
}

console.log(`API docs generated in ${outDir}`);

function stripFrontmatter(content: string): string {
	// API Documenter may emit its own frontmatter block; discard it so we can inject ours.
	if (!content.startsWith("---")) {
		return content;
	}

	const match = content.match(/^---[\s\S]*?\n---\s*(\r?\n)?/);
	if (!match) {
		return content;
	}

	return content.slice(match[0].length);
}

function escapeTitle(value: string): string {
	return value.replace(/"/g, '\\"').replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function getSlugForFilename(filename: string): string {
	// Mirror Astro's slug rules: index files map to the parent route, other files append sanitized segments.
	if (!filename) return routePrefix;
	const normalizedName = filename.replace(/\\/g, "/");
	const baseName = normalizedName.split("/").pop() ?? normalizedName;
	const stem = baseName.replace(/\.md$/i, "");
	if (stem === "index") {
		return routePrefix;
	}

	const segment = buildSlugSegment(stem);
	if (!segment) {
		return routePrefix;
	}

	return `${routePrefix}/${segment}`;
}

function buildSlugSegment(stem: string): string {
	const prefix = `${workspacePackageName}.`;
	let value = stem;
	if (value.startsWith(prefix)) {
		const remainder = value.slice(prefix.length);
		value = remainder.length > 0 ? remainder : value;
	}

	const normalized = value
		.replace(/[._]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.toLowerCase();

	if (normalized.length === 0) {
		// Fall back to a minimally processed slug if the normalization above strips everything out.
		return stem
			.replace(/[._]+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "")
			.toLowerCase();
	}

	return normalized;
}

function rewriteMarkdownLinks(markdown: string): string {
	// Rewrite relative links emitted by API Documenter to the absolute routes exposed by Astro.
	return markdown.replace(
		/\[([^\]]+)\]\((\.\/[^)]+)\)/g,
		(fullMatch, text: unknown, target: unknown) => {
			const rewritten = rewriteRelativeLink(String(target));
			if (!rewritten) {
				return fullMatch;
			}
			return `[${text}](${rewritten})`;
		},
	);
}

function rewriteRelativeLink(target: string): string | undefined {
	// Only transform links emitted as './file.md'; external or anchor links are left untouched.
	if (!target.startsWith("./")) {
		return undefined;
	}

	let relativePath = target.slice(2);
	let hash = "";
	let search = "";

	const hashIndex = relativePath.indexOf("#");
	if (hashIndex !== -1) {
		hash = relativePath.slice(hashIndex);
		relativePath = relativePath.slice(0, hashIndex);
	}

	const searchIndex = relativePath.indexOf("?");
	if (searchIndex !== -1) {
		search = relativePath.slice(searchIndex);
		relativePath = relativePath.slice(0, searchIndex);
	}

	if (!/\.md$/i.test(relativePath)) {
		return undefined;
	}

	const slug = getSlugForFilename(relativePath);
	const url = `/${slug}/`;
	return `${url}${search}${hash}`;
}

// Remove breadcrumb prefixes generated by API Documenter that duplicate sidebar navigation.
function removeBreadcrumbs(markdown: string): string {
	return markdown.replace(/\[Home\]\(\/reference\/api\/\) &gt; /g, "");
}
