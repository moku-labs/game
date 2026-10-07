import { defineConfig } from "vitest/config";

export default defineConfig({
  // The mini game in tests/fixtures imports the engine by its package name, as a real game does.
  // The name must resolve to the source, not to a built dist.
  resolve: {
    alias: [
      {
        find: "@moku-labs/game/testing",
        replacement: new URL("src/testing.ts", import.meta.url).pathname
      },
      {
        find: "@moku-labs/game/inspect",
        replacement: new URL("src/inspect.ts", import.meta.url).pathname
      },
      {
        find: "@moku-labs/game/control",
        replacement: new URL("src/control.ts", import.meta.url).pathname
      },
      {
        find: "@moku-labs/game/hot",
        replacement: new URL("src/hot.ts", import.meta.url).pathname
      },
      {
        find: "@moku-labs/game/lint",
        replacement: new URL("src/lint.ts", import.meta.url).pathname
      },
      {
        find: "@moku-labs/game/project",
        replacement: new URL("src/project.ts", import.meta.url).pathname
      },
      {
        find: "@moku-labs/game/jsx-dev-runtime",
        replacement: new URL("src/jsx-dev-runtime.ts", import.meta.url).pathname
      },
      {
        find: "@moku-labs/game/jsx-runtime",
        replacement: new URL("src/jsx-runtime.ts", import.meta.url).pathname
      },
      {
        find: "@moku-labs/game/visual",
        replacement: new URL("src/visual.ts", import.meta.url).pathname
      },
      {
        find: "@moku-labs/game/app/page",
        replacement: new URL("src/app/page.ts", import.meta.url).pathname
      },
      {
        find: "@moku-labs/game/app/system",
        replacement: new URL("src/app/system.ts", import.meta.url).pathname
      },
      {
        find: "@moku-labs/game/app",
        replacement: new URL("src/app.ts", import.meta.url).pathname
      },
      {
        find: "@moku-labs/game/cli",
        replacement: new URL("src/cli.ts", import.meta.url).pathname
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
          include: [
            "tests/unit/**/*.test.{ts,tsx}",
            "src/plugins/**/__tests__/unit/**/*.test.{ts,tsx}"
          ]
        }
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: [
            "tests/integration/**/*.test.{ts,tsx}",
            "src/plugins/**/__tests__/integration/**/*.test.{ts,tsx}"
          ]
        }
      }
    ],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/types.ts", "src/**/types/**", "src/**/__tests__/**"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 }
    }
  }
});
