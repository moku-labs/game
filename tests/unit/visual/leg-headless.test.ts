import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UiNode } from "../../../src/plugins/ui/types";
import { defineVisualTest } from "../../../src/visual/define";
import { runHeadlessLeg } from "../../../src/visual/leg-headless";
import { resolveVisualOptions } from "../../../src/visual/run";
import type { VisualApp, VisualSetup, VisualStep } from "../../../src/visual/types";
import { createTinyGame } from "./game";

// ---------------------------------------------------------------------------
// Unit (the tiny game in plain Bun): the headless leg plays a test live,
// restores its start, settles at gates, lands every motion at a checkpoint
// and writes or compares state.json and describe.json
// ---------------------------------------------------------------------------

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "moku-visual-leg-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const setup: VisualSetup = { app: createTinyGame };

/**
 * The resolved options of a run into the temp dir.
 *
 * @param update - Whether to rewrite the baselines.
 * @returns The options.
 */
function runInto(update = false) {
  return resolveVisualOptions(setup, { argv: [], dir, pixels: false, update });
}

/**
 * A test that opens the reward popup from Home with a number of coins.
 *
 * @param coins - The coins of the starting player.
 * @param steps - The steps; by default a tap on Open and the checkpoint "open".
 * @returns The test.
 */
function openPopup(
  coins: number,
  steps: VisualStep[] = [{ tap: { key: "open" } }, { checkpoint: "open" }]
) {
  return defineVisualTest("open-popup", {
    start: { player: { coins }, checkpoint: "home" },
    steps
  });
}

/**
 * Reads one baseline file of the temp dir.
 *
 * @param test - The test name.
 * @param checkpoint - The checkpoint name.
 * @param file - `state.json` or `describe.json`.
 * @returns The parsed JSON.
 */
async function baseline(test: string, checkpoint: string, file: string) {
  return JSON.parse(await readFile(path.join(dir, test, checkpoint, file), "utf8"));
}

/**
 * Collects every key of a ui tree.
 *
 * @param node - The top of the tree.
 * @returns The keys, depth first.
 */
function keysOf(node: UiNode): string[] {
  return [
    ...(node.key === undefined ? [] : [node.key]),
    ...node.children.flatMap(child => keysOf(child))
  ];
}

describe("the headless leg", () => {
  it("writes state.json and describe.json on the first run, and answers same on the second", async () => {
    const first = await runHeadlessLeg(setup, [openPopup(7)], runInto());

    expect(first).toEqual([
      {
        name: "open-popup",
        checkpoints: [{ name: "open", state: "written", describe: "written", pixels: "skipped" }]
      }
    ]);

    const state = await baseline("open-popup", "open", "state.json");
    const described = await baseline("open-popup", "open", "describe.json");

    expect(state).toEqual({
      path: "reward",
      player: { coins: 7 },
      session: {},
      rng: { seed: 1, streams: {} }
    });
    expect(keysOf(described.ui)).toEqual(
      expect.arrayContaining(["coins", "open", "reward", "claim"])
    );
    expect(described.views).toContainEqual(
      expect.objectContaining({ projection: "hud", key: "hud" })
    );

    const second = await runHeadlessLeg(setup, [openPopup(7)], runInto());

    expect(second[0]?.checkpoints).toEqual([
      { name: "open", state: "same", describe: "same", pixels: "skipped" }
    ]);
  });

  it("answers different with the first path after the coins of the start changed", async () => {
    // The ui tree holds rects and styles, not label text: the same layout describes the same.
    await runHeadlessLeg(setup, [openPopup(7)], runInto());

    const changed = await runHeadlessLeg(setup, [openPopup(9)], runInto());

    expect(changed[0]?.checkpoints).toEqual([
      {
        name: "open",
        state: "different",
        describe: "same",
        pixels: "skipped",
        first: "player.coins"
      }
    ]);
  });

  it("rewrites every file with update", async () => {
    await runHeadlessLeg(setup, [openPopup(7)], runInto());

    const updated = await runHeadlessLeg(setup, [openPopup(9)], runInto(true));

    expect(updated[0]?.checkpoints[0]).toMatchObject({ state: "written", describe: "written" });
    const state = await baseline("open-popup", "open", "state.json");

    expect(state.player).toEqual({ coins: 9 });
  });

  it("plays the steps after a checkpoint: Claim credits the reward and closes the popup", async () => {
    const test = openPopup(7, [
      { tap: { key: "open" } },
      { checkpoint: "open" },
      { tap: { key: "claim" } },
      { checkpoint: "claimed" }
    ]);
    const [result] = await runHeadlessLeg(setup, [test], runInto());

    expect(result?.checkpoints.map(checkpoint => checkpoint.name)).toEqual(["open", "claimed"]);

    const state = await baseline("open-popup", "claimed", "state.json");
    const described = await baseline("open-popup", "claimed", "describe.json");

    expect(state).toMatchObject({ path: "home", player: { coins: 12 } });
    expect(keysOf(described.ui)).not.toContain("reward");
  });

  it("does not mount a popup that the last node of a walk opens", async () => {
    const test = openPopup(7, [
      { walk: { route: [{ at: "home", intent: "open" }] } },
      { checkpoint: "walked" }
    ]);
    const [result] = await runHeadlessLeg(setup, [test], runInto());

    expect(result?.error).toBeUndefined();

    const state = await baseline("open-popup", "walked", "state.json");
    const described = await baseline("open-popup", "walked", "describe.json");

    expect(state.path).toBe("reward");
    expect(keysOf(described.ui)).not.toContain("reward");
    expect(keysOf(described.ui)).not.toContain("claim");
  });

  it("lands every motion at a checkpoint: anim.active() is 0 when the screen is read", async () => {
    const seen: { before?: number; read?: number } = {};
    const watched: VisualSetup = {
      app: (): VisualApp => {
        const app = createTinyGame();

        return {
          ...app,
          anim: {
            ...app.anim,
            finishAll: () => {
              seen.before = app.anim.active();
              app.anim.finishAll();
            }
          },
          ui: {
            ...app.ui,
            tree: () => {
              seen.read = app.anim.active();

              return app.ui.tree();
            }
          }
        };
      }
    };

    await runHeadlessLeg(watched, [openPopup(7)], runInto());

    expect(seen.before).toBeGreaterThan(0);
    expect(seen.read).toBe(0);
  });

  it("ends a test at a failing step, naming the step and the command", async () => {
    const test = openPopup(7, [
      { checkpoint: "home" },
      { tap: { key: "missing" } },
      { checkpoint: "never" }
    ]);
    const [result] = await runHeadlessLeg(setup, [test], runInto());

    expect(result?.checkpoints.map(checkpoint => checkpoint.name)).toEqual(["home"]);
    expect(result?.error).toBe(
      '[game] Visual test "open-popup", step 2 (tap) failed.\n  No element with the key "missing" is on screen. Read sources.ui for the keys on screen.'
    );
  });

  it("ends a test on a failure that is not an engine error, closing its reason with a period", async () => {
    const throwing: VisualSetup = {
      app: (): VisualApp => {
        const app = createTinyGame();

        return {
          ...app,
          input: {
            ...app.input,
            tap: () => {
              throw new Error("no pointer");
            }
          }
        };
      }
    };
    const [result] = await runHeadlessLeg(throwing, [openPopup(7)], runInto());

    expect(result?.error).toBe(
      '[game] Visual test "open-popup", step 1 (tap) failed.\n  no pointer.'
    );
  });

  it("reports a loop that rejected with a value that is not an error", async () => {
    const failing: VisualSetup = {
      app: (): VisualApp => {
        const app = createTinyGame();

        return { ...app, flow: { ...app.flow, run: () => Promise.reject("offline") } };
      }
    };
    const [result] = await runHeadlessLeg(failing, [openPopup(7)], runInto());

    expect(result?.error).toBe("offline");
  });

  it("ends a test whose start cannot be restored", async () => {
    const test = defineVisualTest("nowhere", {
      start: { player: { coins: 1 }, checkpoint: "nowhere" },
      steps: [{ checkpoint: "never" }]
    });
    const [result] = await runHeadlessLeg(setup, [test], runInto());

    expect(result?.checkpoints).toEqual([]);
    expect(result?.error).toMatch(/^\[game\] Visual test "nowhere", the start failed\.\n {2}\S/u);
  });

  it("re-throws a fatal error of the loop as the test's error", async () => {
    const failing: VisualSetup = {
      app: (): VisualApp => {
        const app = createTinyGame();

        return {
          ...app,
          flow: {
            ...app.flow,
            run: () => Promise.reject(new Error("[game] The graph broke.\n  Fix the graph."))
          }
        };
      }
    };
    const [result] = await runHeadlessLeg(failing, [openPopup(7)], runInto());

    expect(result?.error).toBe("[game] The graph broke.\n  Fix the graph.");
  });

  it("keeps a test that started its own loop from running it twice", async () => {
    let runs = 0;
    const started: VisualSetup = {
      app: (): VisualApp => {
        const app = createTinyGame();

        return {
          ...app,
          start: async () => {
            await app.start();
            app.flow.run().catch(() => undefined);
          },
          flow: {
            ...app.flow,
            run: () => {
              runs += 1;

              return app.flow.run();
            }
          }
        };
      }
    };
    const [result] = await runHeadlessLeg(started, [openPopup(7)], runInto());

    expect(result?.error).toBeUndefined();
    expect(runs).toBe(0);
  });

  it("sets the dev flag for the run only", async () => {
    const before = Object.hasOwn(globalThis, "__MOKU_GAME_DEV__");

    await runHeadlessLeg(setup, [openPopup(7)], runInto());

    expect(Object.hasOwn(globalThis, "__MOKU_GAME_DEV__")).toBe(before);

    globalThis.__MOKU_GAME_DEV__ = false;

    try {
      const [result] = await runHeadlessLeg(setup, [openPopup(7)], runInto());

      expect(result?.error).toBeUndefined();
      expect(globalThis.__MOKU_GAME_DEV__).toBe(false);
    } finally {
      Reflect.deleteProperty(globalThis, "__MOKU_GAME_DEV__");
    }
  });
});
