import type { Alias } from "vite";
import { defineConfig } from "vitest/config";

/** The episodes fixture game, absolute, ending in `/`: the only importer of the aliases below. */
const EPISODES_GAME = new URL("tests/fixtures/episodes-game/", import.meta.url).pathname;

/**
 * An alias of the episodes fixture game: it applies only when the importer lies under
 * `tests/fixtures/episodes-game/`. For any other importer the resolver answers nothing, and the
 * import resolves as if the entry did not exist, so no game prefix reaches the engine's sources.
 *
 * @param find - The alias pattern.
 * @param replacement - The target inside the fixture, with `$1` for the captured rest.
 * @returns The alias entry.
 */
function episodesAlias(find: RegExp, replacement: string): Alias {
  return {
    find,
    replacement: `${EPISODES_GAME}${replacement}`,
    customResolver: {
      resolveId(id, importer) {
        if (importer?.startsWith(EPISODES_GAME) !== true) return;

        return this.resolve(id, importer, { skipSelf: true });
      }
    }
  };
}

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
      { find: "@moku-labs/game", replacement: new URL("src/index.ts", import.meta.url).pathname },
      // The aliases of the episodes fixture game, as its own tsconfig.json declares them. It is
      // their only importer: a file outside tests/fixtures/episodes-game/ never gets them.
      episodesAlias(/^@core\/(.*)$/, "core/$1"),
      episodesAlias(/^@features$/, "features/index.ts"),
      episodesAlias(/^@features\/(.*)$/, "features/$1/index.ts"),
      episodesAlias(/^@generated\/(.*)$/, "generated/$1")
    ]
  },
  test: {
    // The engine logs every warning of a test app through ctx.log. A passed test keeps them to
    // itself; a failed one prints them beside its error.
    silent: "passed-only",
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
