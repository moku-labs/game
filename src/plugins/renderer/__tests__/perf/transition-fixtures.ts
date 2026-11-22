/**
 * @file renderer plugin — the fixture of the perf tests and benches of a scene switch's transition (spec 36). Not a
 * test file. A started renderer on the fake GPU of the shots tests, its picture taken and its transition playing for a
 * day, so every window steps it on without reaching its end. What a transition draws with is real Pixi: the sprite, the
 * mesh and its geometry, the shader, the uniform groups and the picture's render texture. A fake's field form is not
 * Pixi's (V8 keeps a number field as a small integer, a double or a box by the history of its shape), so a fake cannot
 * tell what a frame allocates. The bodies are the ones `effects` hands over.
 */
import * as pixi from "pixi.js";
import { createTransitionBody } from "../../../effects/filters/transition";
import { Dissolve } from "../../../effects/set/dissolve";
import { RevealLine } from "../../../effects/set/reveal-line";
import { RevealRound } from "../../../effects/set/reveal-round";
import type { FilterSlotQuad, LeaveTransition, PixiGpuProgram, PixiModule } from "../../types";
import type { MockRenderer } from "../mock-renderer";
import { quadProgram } from "../quad-harness";
import { startShots } from "../shots-gpu";

/** A started renderer whose transition plays, and one frame's step of it. */
export type PlayingTransition = {
  mock: MockRenderer;
  /** One frame: the clock 1 ms on, then the step of the look. */
  step: () => void;
};

/** A day of clock milliseconds: a transition no window of calls reaches the end of. */
const DAY = 86_400_000;

/** Pixi itself, as the renderer's module type. */
const REAL = pixi as unknown as PixiModule;

// Pixi asks a canvas for the GLSL precision when it builds a GL program, which a warm filter does; Node has no DOM, so
// the adapter, Pixi's own seam for other runtimes, hands out a canvas with no WebGL.
pixi.DOMAdapter.set({
  ...pixi.DOMAdapter.get(),
  // eslint-disable-next-line unicorn/no-null -- a canvas answers null for a context it cannot make.
  createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement
});

/** The transition of each kind, as `scenes` resolves it with the defaults, over a day. */
const TRANSITIONS: Readonly<Record<LeaveTransition["kind"], LeaveTransition>> = {
  fade: { kind: "fade", ms: DAY, ease: "inOut", reduced: "cut" },
  slide: { kind: "slide", ms: DAY, ease: "inOut", reduced: "cut", to: "left" },
  wipe: { kind: "wipe", ms: DAY, ease: "inOut", reduced: "cut", angle: 0.7, soft: 0.04 },
  iris: { kind: "iris", ms: DAY, ease: "inOut", reduced: "cut", x: 0.4, y: 0.6, soft: 0.05 },
  dissolve: {
    kind: "dissolve",
    ms: DAY,
    ease: "inOut",
    reduced: "cut",
    scale: 8,
    edge: 0.08,
    edgeColor: 0xff_80_00
  }
};

/** The member each body kind is drawn on, as a feature lists it in its `filters`. */
const MEMBERS = { wipe: RevealLine, iris: RevealRound, dissolve: Dissolve } as const;

/**
 * A set body of a kind as `effects` hands it over: its own `createTransitionBody`, the real `UniformGroup` of the
 * member's warm filter with its numbers in V8's double form, over a real quad program.
 *
 * @param kind - The body kind.
 * @returns The quad.
 */
function bodyOf(kind: "wipe" | "iris" | "dissolve"): FilterSlotQuad {
  const program = quadProgram() as unknown as PixiGpuProgram;

  return createTransitionBody(REAL, MEMBERS[kind].filter, program).quad;
}

/**
 * Puts what a transition draws with on real Pixi: the sprite, the mesh and its geometry, the shader, the uniform
 * groups and the render texture of the picture (a texture source with no GPU behind it in Node). The fake module keeps
 * the application, the stage and the GPU.
 *
 * @param mock - The started renderer.
 */
function drawWithRealObjects(mock: MockRenderer): void {
  const create = pixi.RenderTexture.create.bind(pixi.RenderTexture);

  Object.assign(mock.pixi.module, {
    Sprite: pixi.Sprite,
    Mesh: pixi.Mesh,
    MeshGeometry: pixi.MeshGeometry,
    Shader: pixi.Shader,
    UniformGroup: pixi.UniformGroup,
    Texture: pixi.Texture,
    RenderTexture: { create }
  });
}

/**
 * Starts the mock renderer on the fake GPU with a 2160 x 3840 canvas, hands the body of a kind that needs one, shows a
 * look with the transition, takes its picture in one drawn frame and plays it; the first step makes what draws it. The
 * clock moves in whole milliseconds, which a call hands back unboxed.
 *
 * @param kind - The transition kind.
 * @returns The renderer and its step.
 */
export async function playingTransition(kind: LeaveTransition["kind"]): Promise<PlayingTransition> {
  const { mock } = await startShots({ shots: undefined, canvas: { width: 2160, height: 3840 } });

  drawWithRealObjects(mock);
  mock.world.projection.setLayers([{ name: "scene", sort: "none" }]);
  mock.modules.sync.pass();

  if (kind === "wipe" || kind === "iris" || kind === "dissolve") {
    mock.api.sync.leave.body(kind, bodyOf(kind), "member");
  }

  mock.api.sync.leave.show({
    cover: { color: 0, alpha: 0.45, inMs: 0, outMs: 150 },
    transition: TRANSITIONS[kind]
  });
  mock.api.sync.leave.capture();
  mock.runPhase("render");
  mock.api.sync.leave.play();

  let now = 0;
  const step = (): void => {
    now += 1;
    mock.setNow(now);
    mock.modules.sync.stepLeave();
  };

  step();

  const playing = mock.ctx.state.sync.leave.playing;

  if (playing?.capture !== "playing" || playing.drawn !== kind) {
    throw new Error(`perf fixture: no ${kind} transition plays`);
  }

  return { mock, step };
}
