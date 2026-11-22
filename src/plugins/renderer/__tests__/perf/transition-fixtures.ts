/**
 * @file renderer plugin — the fixture of the perf tests and benches of a scene switch's transition (spec 36). Not a
 * test file. A started renderer on the fake GPU of the shots tests, its picture taken and its transition playing for a
 * day, so every window steps it on without reaching its end.
 */
import type { FilterSlotQuad, LeaveTransition } from "../../types";
import { FakeGpuProgram, FakeUniformGroup } from "../fake-pixi";
import type { MockRenderer } from "../mock-renderer";
import { startShots } from "../shots-gpu";

/** A started renderer whose transition plays, and one frame's step of it. */
export type PlayingTransition = {
  mock: MockRenderer;
  /** One frame: the clock 1 ms on, then the step of the look. */
  step: () => void;
};

/** A day of clock milliseconds: a transition no window of calls reaches the end of. */
const DAY = 86_400_000;

/** The transition of each kind, as `scenes` resolves it with the defaults, over a day. */
const TRANSITIONS: Readonly<Record<LeaveTransition["kind"], LeaveTransition>> = {
  fade: { kind: "fade", ms: DAY, ease: "inOut", reduced: "cut" },
  slide: { kind: "slide", ms: DAY, ease: "inOut", reduced: "cut", to: "left" },
  wipe: { kind: "wipe", ms: DAY, ease: "inOut", reduced: "cut", angle: 0, soft: 0.04 },
  iris: { kind: "iris", ms: DAY, ease: "inOut", reduced: "cut", x: 0.5, y: 0.5, soft: 0.05 },
  dissolve: {
    kind: "dissolve",
    ms: DAY,
    ease: "inOut",
    reduced: "cut",
    scale: 8,
    edge: 0.08,
    edgeColor: 0xff_ff_ff
  }
};

/**
 * A set body of a kind as `effects` builds it: a program and a uniform group over the member's defaults.
 *
 * @param kind - The body kind.
 * @returns The quad.
 */
function bodyOf(kind: "wipe" | "iris" | "dissolve"): FilterSlotQuad {
  return {
    program: new FakeGpuProgram({}),
    fu: new FakeUniformGroup(uniformsOf(kind))
  } as unknown as FilterSlotQuad;
}

/**
 * The uniforms of a set body at the member's defaults, as Pixi's uniform group takes them.
 *
 * @param kind - The body kind.
 * @returns The uniforms, new.
 */
function uniformsOf(kind: "wipe" | "iris" | "dissolve"): Record<string, { value: unknown }> {
  switch (kind) {
    case "wipe": {
      return { progress: { value: 0 }, angle: { value: 0 }, soft: { value: 0.05 } };
    }
    case "iris": {
      return {
        x: { value: 0.5 },
        y: { value: 0.5 },
        radius: { value: 0 },
        soft: { value: 0.05 },
        wobble: { value: 0 }
      };
    }
    case "dissolve": {
      return {
        progress: { value: 0 },
        scale: { value: 8 },
        edge: { value: 0.08 },
        edgeColor: { value: Float32Array.of(1, 1, 1) }
      };
    }
  }
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
