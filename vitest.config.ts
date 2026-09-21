import { defineConfig } from "vitest/config";

export default defineConfig({
  // The fixture game in tests/integration imports the engine by its package name, as a real game
  // does. The name must resolve to the source, not to a built dist.
  resolve: {
    alias: [
      {
        find: "@moku-labs/game/testing",
        replacement: new URL("src/testing.ts", import.meta.url).pathname
      },
      { find: "@moku-labs/game", replacement: new URL("src/index.ts", import.meta.url).pathname }
    ]
  },
  test: {
    projects: [
      {
        // An inline project inherits the root config only with `extends: true`.
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "src/plugins/**/__tests__/unit/**/*.test.ts"]
        }
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: [
            "tests/integration/**/*.test.ts",
            "src/plugins/**/__tests__/integration/**/*.test.ts"
          ]
        }
      }
    ],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: ["src/**/types.ts", "src/**/types/**", "src/**/__tests__/**"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 }
    }
  }
});
