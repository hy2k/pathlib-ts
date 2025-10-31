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
				{ label: "API Overview", link: "/reference/api/pathlib-ts/" },
				{ label: "Path", link: "/reference/api/path/" },
				{ label: "PathInfo", link: "/reference/api/pathinfo/" },
				{ label: "DirEntryInfo", link: "/reference/api/direntryinfo/" },
				{ label: "PosixPath", link: "/reference/api/posixpath/" },
				{ label: "WindowsPath", link: "/reference/api/windowspath/" },
				{ label: "PurePath", link: "/reference/api/purepath/" },
				{ label: "PathParents", link: "/reference/api/pathparents/" },
				{ label: "PurePosixPath", link: "/reference/api/pureposixpath/" },
				{ label: "PureWindowsPath", link: "/reference/api/purewindowspath/" },
			],
		},
	],
};

export default starlightConfig;
