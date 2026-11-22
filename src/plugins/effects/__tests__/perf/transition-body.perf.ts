import * as pixi from "pixi.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PixiGpuProgram, PixiModule, PixiUniformGroup } from "../../../renderer/types";
import { createTransitionBody } from "../../filters/transition";
import type { FilterDefinition } from "../../filters/types";
import { Dissolve } from "../../set/dissolve";
import { RevealLine } from "../../set/reveal-line";
import { RevealRound } from "../../set/reveal-round";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf (change 2026-11-22-f126-s4-transitions): the group of a transition body `effects` hands the renderer, built by
// the real `pixi.js` `UniformGroup` of `createWarmFilter`. The renderer writes its uniforms by name every frame of a
// transition (`progress`, `radius`, ...) with a changing double; Pixi's upload reads them back by name. Neither the
// write nor the read may allocate: V8 boxes a double it stores into, or reads out of, a field of the wrong form.
// ---------------------------------------------------------------------------

// Pixi asks a test canvas for the GLSL precision when it builds a GL program; Node has no DOM, so the environment
// adapter, Pixi's own seam for other runtimes, hands out a canvas with no WebGL.
const browser = pixi.DOMAdapter.get();

beforeAll(() => {
  pixi.DOMAdapter.set({
    ...browser,
    // eslint-disable-next-line unicorn/no-null -- a canvas answers null for a context it cannot make.
    createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement
  });
});

afterAll(() => {
  pixi.DOMAdapter.set(browser);
});

const REAL = pixi as unknown as PixiModule;

/** The values of a body's uniform group, by uniform name. */
type Values = PixiUniformGroup["uniforms"];

/** The eased progress of the frame and the place of the walk, in a typed array: a closure variable would box. */
const EASED = new Float64Array(2);

/**
 * The next eased progress of the walk, 0..1 in steps of 0.00731: a double that never repeats the one before.
 *
 * @returns The progress, also in `EASED[0]`.
 */
function advance(): number {
  EASED[1] = (EASED[1] ?? 0) + 0.007_31;
  if ((EASED[1] ?? 0) >= 1) EASED[1] = 0.000_37;
  EASED[0] = EASED[1] ?? 0;

  return EASED[0];
}

/**
 * The uniform values of the group `effects` hands for a member: the real group of a warm filter of its definition.
 *
 * @param definition - The member's definition.
 * @returns The values of its group.
 */
function handedValues(definition: FilterDefinition): Values {
  const body = createTransitionBody(REAL, definition, {} as unknown as PixiGpuProgram);
  const group = body.quad.fu;

  if (group === undefined) throw new Error("perf fixture: the warm filter has no uniform group");

  return group.uniforms;
}

/** The number uniforms of each member the renderer writes by name. */
const WIPE = ["progress", "angle", "soft"] as const;
const IRIS = ["radius", "x", "y", "soft"] as const;
const DISSOLVE = ["progress", "scale", "edge"] as const;

/**
 * The write of one wipe frame, as the renderer makes it (`writeWipe`): the eased progress, the rest where they differ.
 *
 * @param uniforms - The values of the body's group.
 * @returns The step.
 */
function writeWipe(uniforms: Values): () => void {
  return (): void => {
    uniforms.progress = 1 - advance();
    if (uniforms.angle !== 0.7) uniforms.angle = 0.7;
    if (uniforms.soft !== 0.1) uniforms.soft = 0.1;
  };
}

/**
 * The write of one iris frame, as the renderer makes it (`writeIris`).
 *
 * @param uniforms - The values of the body's group.
 * @returns The step.
 */
function writeIris(uniforms: Values): () => void {
  return (): void => {
    uniforms.radius = 1.3 * (1 - advance());
    if (uniforms.x !== 0.4) uniforms.x = 0.4;
    if (uniforms.y !== 0.6) uniforms.y = 0.6;
    if (uniforms.soft !== 0.1) uniforms.soft = 0.1;
  };
}

/**
 * The write of one dissolve frame, as the renderer makes it (`writeDissolve`), the colour into its own array.
 *
 * @param uniforms - The values of the body's group.
 * @returns The step.
 */
function writeDissolve(uniforms: Values): () => void {
  return (): void => {
    uniforms.progress = advance();
    if (uniforms.scale !== 12) uniforms.scale = 12;
    if (uniforms.edge !== 0.12) uniforms.edge = 0.12;

    const color = uniforms.edgeColor;

    if (color instanceof Float32Array) color[0] = EASED[0] ?? 0;
  };
}

/** The buffer the generated upload writes into, as the UBO's `data`. */
const DATA = new Float32Array(16);

/**
 * The upload of Pixi's UBO sync (`compileBufferSync`): a function made with `new Function` that reads each `f32` of the
 * group by its name, `v = uv.progress`, and stores it into the buffer. Built the same way here, from the same template
 * (`pixi.js/lib/rendering/renderers/shared/shader/utils/compileBufferSync.mjs`), so its read site is a real one.
 *
 * @param uniforms - The values of the body's group.
 * @param names - The `f32` uniforms.
 * @returns The step.
 */
function uploadAsPixiDoes(uniforms: Values, names: readonly string[]): () => void {
  const body = names.map(name => `v = uv.${name};\noffset += 1;\ndata[offset] = v;`).join("\n");
  const sync = new Function("uv", "data", `var v = null;\nvar offset = 0;\n${body}`) as (
    uv: Values,
    data: Float32Array
  ) => void;

  return (): void => sync(uniforms, DATA);
}

/** A member's case: its definition, its write and the uniforms the upload reads. */
type Case = {
  name: string;
  definition: FilterDefinition;
  write: (values: Values) => () => void;
  names: readonly string[];
};

const CASES: readonly Case[] = [
  { name: "wipe (RevealLine)", definition: RevealLine.filter, write: writeWipe, names: WIPE },
  { name: "iris (RevealRound)", definition: RevealRound.filter, write: writeIris, names: IRIS },
  {
    name: "dissolve (Dissolve)",
    definition: Dissolve.filter,
    write: writeDissolve,
    names: DISSOLVE
  }
];

describe("the group of a transition body, heap bytes per frame", () => {
  for (const { name, definition, write, names } of CASES) {
    // Bug it guards: a write of the changing progress into a field V8 keeps in tagged form boxes a double: 16 B a frame.
    it(`${name}: the writes of a frame allocate nothing`, () => {
      const bytes = bytesPerCall(write(handedValues(definition)));

      console.log(`${name} write: ${bytes} B`);
      expect(bytes).toBeLessThanOrEqual(BUDGET.transitionBodyWrite + NOISE);
    });

    // Bug it guards: the upload's read of a uniform by name hands back a new box: 16 B a frame and uniform.
    it(`${name}: the upload's read by name allocates nothing`, () => {
      const values = handedValues(definition);
      const step = write(values);
      const read = uploadAsPixiDoes(values, names);
      const bytes = bytesPerCall(() => {
        step();
        read();
      });
      const writeOnly = bytesPerCall(step);

      console.log(`${name} write+read: ${bytes} B (write alone ${writeOnly} B)`);
      expect(bytes).toBeLessThanOrEqual(BUDGET.transitionBodyRead + NOISE);
    });
  }
});
