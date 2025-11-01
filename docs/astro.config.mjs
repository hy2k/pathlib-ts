import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightConfig from "./starlight.config.ts";

export default defineConfig({
	site: "https://pathlib-ts.hy2k.dev",
	integrations: [starlight(starlightConfig)],
});
