/**
 * @file The project index on the episodes game, read-only: it records the folder of every
 * feature, top-level or nested, the parent of each sub-feature, and the door of a sub-feature
 * under its `feature:` key. The fixture has no code-only sub-feature, so its units are its
 * owners; the index's handling of a code-only one is `tests/unit/project-watch.test.ts`.
 */
import { openProject } from "@moku-labs/game/project";
import { describe, expect, it } from "vitest";
import { EPISODES_GAME } from "./episodes-helpers";

describe("project-episodes-game — the index of a game with sub-features", () => {
  it("the index records every feature's folder and the parent of each sub-feature", async () => {
    const project = await openProject({ root: EPISODES_GAME });

    try {
      expect(project.index.features).toEqual({
        episodes: { dir: "features/episodes" },
        ep01: { dir: "features/episodes/ep01", parent: "episodes" },
        ep02: { dir: "features/episodes/ep02", parent: "episodes" },
        "episodes-kit": { dir: "features/episodes/episodes-kit", parent: "episodes" },
        home: { dir: "features/home" }
      });
      expect(project.index.symbols["feature:ep01"]?.def[0]?.path).toBe(
        "features/episodes/ep01/index.ts"
      );
    } finally {
      project.close();
    }
  });
});
