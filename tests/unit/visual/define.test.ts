import { describe, expect, it } from "vitest";
import { defineVisualTest } from "../../../src/visual/define";
import type { VisualStep } from "../../../src/visual/types";

// ---------------------------------------------------------------------------
// Unit: defineVisualTest — frozen data, file names, unique checkpoints and
// steps that name one command of the /control catalogue
// ---------------------------------------------------------------------------

const start = { player: { coins: 40 }, checkpoint: "home" };

describe("defineVisualTest", () => {
  it("answers the name, the start and the steps as frozen data", () => {
    const steps: VisualStep[] = [
      { tap: { key: "open" } },
      { answer: { intent: "claim", payload: { orderId: "o1" } } },
      { checkpoint: "open" }
    ];
    const test = defineVisualTest("reward-popup", { start, steps });

    expect(test).toEqual({ name: "reward-popup", start, steps });
    expect(Object.isFrozen(test)).toBe(true);
    expect(Object.isFrozen(test.start)).toBe(true);
    expect(Object.isFrozen(test.start.player)).toBe(true);
    expect(Object.isFrozen(test.steps)).toBe(true);
    expect(Object.isFrozen(test.steps[1])).toBe(true);
  });

  it("copies what it was given, so the caller's objects stay its own", () => {
    const player = { coins: 40 };
    const steps: VisualStep[] = [{ checkpoint: "home" }];
    const test = defineVisualTest("home", { start: { player }, steps });

    player.coins = 1;
    steps.push({ checkpoint: "later" });

    expect(Object.isFrozen(player)).toBe(false);
    expect(test.start.player).toEqual({ coins: 40 });
    expect(test.steps).toHaveLength(1);
  });

  it("refuses a name that is not a file name", () => {
    expect(() => defineVisualTest("Reward Popup", { start, steps: [] })).toThrow(
      '[game] The visual test name "Reward Popup" is not a file name.\n  Use lowercase letters, digits and dashes.'
    );
    expect(() => defineVisualTest("-popup", { start, steps: [] })).toThrow("is not a file name");
    expect(() => defineVisualTest("", { start, steps: [] })).toThrow("is not a file name");
  });

  it("accepts lowercase letters, digits and dashes", () => {
    expect(defineVisualTest("level-2-board", { start, steps: [] }).name).toBe("level-2-board");
  });

  it("refuses a checkpoint name that is not a file name", () => {
    expect(() =>
      defineVisualTest("reward-popup", { start, steps: [{ checkpoint: "Open Popup" }] })
    ).toThrow(
      '[game] Visual test "reward-popup", step 1: the checkpoint name "Open Popup" is not a file name.\n  Use lowercase letters, digits and dashes.'
    );
  });

  it("refuses two checkpoints with one name", () => {
    const steps: VisualStep[] = [
      { checkpoint: "open" },
      { tap: { key: "claim" } },
      { checkpoint: "open" }
    ];

    expect(() => defineVisualTest("reward-popup", { start, steps })).toThrow(
      '[game] Visual test "reward-popup", step 3: the checkpoint "open" is already a step.\n  Give every checkpoint of a test its own name.'
    );
  });

  it("refuses a step that names no command or more than one", () => {
    const empty = {} as VisualStep;
    const two = { tap: { key: "open" }, checkpoint: "open" } as VisualStep;

    expect(() => defineVisualTest("popup", { start, steps: [empty] })).toThrow(
      '[game] Visual test "popup", step 1 is not one command.\n  Write one command by its short name, or { checkpoint: "name" }.'
    );
    expect(() => defineVisualTest("popup", { start, steps: [two] })).toThrow(
      "step 1 is not one command"
    );
  });

  it("refuses a command outside the steps: bookmark, capture, debug and unknown names", () => {
    for (const name of ["bookmark", "capture", "debug", "jump"]) {
      const step = { [name]: {} } as unknown as VisualStep;

      expect(() => defineVisualTest("popup", { start, steps: [step] })).toThrow(
        `[game] Visual test "popup", step 1 names "${name}", which is not a step.\n  Use a checkpoint or one of: answer, tap,`
      );
    }
  });

  it("refuses a command whose input is not an object", () => {
    const step = { tap: "open" } as unknown as VisualStep;
    const list = { pause: [] } as unknown as VisualStep;

    expect(() => defineVisualTest("popup", { start, steps: [step] })).toThrow(
      '[game] Visual test "popup", step 1 (tap) has no input object.\n  Pass the input of the command, like { tap: { key: "play" } }.'
    );
    expect(() => defineVisualTest("popup", { start, steps: [list] })).toThrow(
      "step 1 (pause) has no input object"
    );
  });

  it("refuses a checkpoint whose name is not a string", () => {
    const step = { checkpoint: 3 } as unknown as VisualStep;

    expect(() => defineVisualTest("popup", { start, steps: [step] })).toThrow(
      '[game] Visual test "popup", step 1: the checkpoint name is not a string.\n  Write the checkpoint as { checkpoint: "name" }.'
    );
  });
});
