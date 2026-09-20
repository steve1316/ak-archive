import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { baseTrailingSlash, spaFallback } from "archive-kit/config";

// Pages serves the site from /ak-archive/, while Docker and local previews serve it from the root. VITE_BASE lets the same source produce both.
const BASE = process.env.VITE_BASE ?? "/ak-archive/";

export default defineConfig({
	base: BASE,
	plugins: [react(), spaFallback(), baseTrailingSlash()],
	build: {
		outDir: "build",
		sourcemap: true
	}
});
