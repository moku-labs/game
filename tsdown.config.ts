import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    // Subpath: the headless test helpers.
    testing: "src/testing.ts",
    // Subpath: the build-time asset key scanner, node and bun only.
    assets: "src/assets.ts",
    // Subpaths: the JSX runtimes `jsxImportSource: "@moku-labs/game"` names; re-exports only.
    "jsx-runtime": "src/jsx-runtime.ts",
    "jsx-dev-runtime": "src/jsx-dev-runtime.ts"
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  tsconfig: "tsconfig.build.json"
});
