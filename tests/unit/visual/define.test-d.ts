import { describe, expectTypeOf, it } from "vitest";
import { defineVisualTest } from "../../../src/visual/define";
import type { StepCommand, VisualStep, VisualTest } from "../../../src/visual/types";

// The step union is typed from the /control catalogue minus bookmark, capture and debug.
// Checked by `tsc`.

const start = { player: { coins: 40 } };

describe("VisualStep", () => {
  it("lists the catalogue minus the three commands that are not steps", () => {
    expectTypeOf<"answer" | "tap" | "walk" | "restore" | "step">().toExtend<StepCommand>();
    expectTypeOf<"pause" | "resume" | "reducedMotion" | "drag" | "key">().toExtend<StepCommand>();
    expectTypeOf<"bookmark">().not.toExtend<StepCommand>();
    expectTypeOf<"capture">().not.toExtend<StepCommand>();
    expectTypeOf<"debug">().not.toExtend<StepCommand>();
  });

  it("types the input of each command from its schema", () => {
    const steps: VisualStep[] = [
      { tap: { key: "play" } },
      { answer: { intent: "deliver", payload: { orderId: "o1" } } },
      { step: { frames: 3 } },
      { pause: {} },
      { reducedMotion: { on: true } },
      { checkpoint: "open" }
    ];

    expectTypeOf(defineVisualTest("popup", { start, steps })).toEqualTypeOf<VisualTest>();
  });

  it("takes an optional webgl flag and answers it as a boolean", () => {
    expectTypeOf(
      defineVisualTest("glow", { start, steps: [], webgl: true }).webgl
    ).toEqualTypeOf<boolean>();
  });

  it("rejects a step outside the catalogue", () => {
    // @ts-expect-error capture is not a step: the runner captures by itself
    const capture: VisualStep = { capture: {} };
    // @ts-expect-error debug drawing would enter a baseline
    const debug: VisualStep = { debug: { nineSlice: true } };
    // @ts-expect-error bookmark only reads
    const bookmark: VisualStep = { bookmark: {} };
    // @ts-expect-error no such command
    const jump: VisualStep = { jump: { level: 3 } };

    expectTypeOf([capture, debug, bookmark, jump]).toEqualTypeOf<VisualStep[]>();
  });

  it("rejects an input of the wrong shape", () => {
    // @ts-expect-error step takes a frame count, not a key
    const frames: VisualStep = { step: { key: "play" } };
    // @ts-expect-error answer needs its intent
    const answer: VisualStep = { answer: { payload: 1 } };

    expectTypeOf([frames, answer]).toEqualTypeOf<VisualStep[]>();
  });
});
