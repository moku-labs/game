import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    // Subpaths: pure merge rules usable without the engine, and the headless test helpers.
    merge: "src/merge.ts",
    testing: "src/testing.ts"
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  tsconfig: "tsconfig.build.json"
});
