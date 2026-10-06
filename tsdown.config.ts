import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    // Subpath: the headless test helpers.
    testing: "src/testing.ts",
    // Subpath: the build-time asset key scanner, node and bun only.
    assets: "src/assets.ts",
    // Subpaths: the editor doors, reads and dev-only commands; re-exports only.
    inspect: "src/inspect.ts",
    control: "src/control.ts",
    // Subpath: the Bun plugin of the dev server that hot swaps views; bun only.
    hot: "src/hot.ts",
    // Subpath: the oxlint JS plugin `moku-game` a game loads in `.oxlintrc.json`.
    lint: "src/lint.ts",
    // Subpath: the project index of a game's sources and `moku-game-index`; node and bun only.
    project: "src/project.ts",
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
