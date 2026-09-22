import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    // Subpath: the headless test helpers.
    testing: "src/testing.ts",
    // Subpath: the build-time asset key scanner, node and bun only.
    "assets-scan": "src/assets-scan.ts"
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  tsconfig: "tsconfig.build.json"
});
