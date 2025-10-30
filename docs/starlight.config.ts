import type { StarlightUserConfig } from "@astrojs/starlight/types";

const starlightConfig: StarlightUserConfig = {
	title: "pathlib-ts",
	description:
		"Async-first TypeScript port of CPython's pathlib with rich documentation.",
	sidebar: [
		{
			label: "Guide",
			collapsed: false,
			items: [
				{ label: "Overview", link: "/" },
				{ label: "Getting Started", link: "/getting-started/" },
				{ label: "API Reference", link: "/api-reference/" },
				{ label: "Usage Patterns", link: "/usage-patterns/" },
				{ label: "Caveats & Gotchas", link: "/caveats/" },
			],
		},
		{
			label: "Reference",
			items: [
				{ label: "API", link: "/reference/api/pathlib-ts/" },
				{ label: "Path", link: "/reference/api/path/" },
				{ label: "PurePath", link: "/reference/api/purepath/" },
			],
		},
	],
};

export default starlightConfig;
