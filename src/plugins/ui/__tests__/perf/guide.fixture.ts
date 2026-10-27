/**
 * @file ui plugin — the perf fixture of the guide pass (F98): the guide of the rest node stands on
 * the world piece, a 64 u sprite, with its veil of four rectangles and the lock window `input`
 * keeps. Started and brought to rest outside any measured window; the system `ui.guide` is read off
 * the world while it registers, so a window calls exactly the pass.
 */
import { vi } from "vitest";
import { Transform, type TransformValue } from "../../../renderer/components";
import type { AnySystem, SystemContext } from "../../../world/types";
import {
  createGuideApp,
  entityOf,
  frames,
  type GuideApp,
  PIECE,
  settleGuideApp
} from "../guide-app";
import type { Step } from "./fixtures";

/** The rows a system of `ui` gets: it declares no query. */
const NO_ROWS: readonly [] = Object.freeze([]);

/** What the pass gets beside its rows: it reads nothing of it. */
const NO_FRAME = Object.freeze({}) as unknown as SystemContext;

/** The two fractional places the piece moves between, one a call. */
const PLACES = [512.25, 513.75] as const;

/** The started app, its pass, and the kinds of frame a window measures. */
export type GuidePerf = {
  app: GuideApp;
  /** A frame of the pass with the target standing still. */
  still: Step;
  /** A frame of the pass after the piece moved to the other fractional place. */
  moving: Step;
};

/**
 * Starts the fixture with the guide of step `piece` standing, reads the system `ui.guide` off the
 * world while it registers, and builds the two frames: one with the piece still, one that first
 * moves it to the other of two fractional places, as a game's system writes a field of its stored
 * pose.
 *
 * @returns The app and its two steps.
 */
export async function startGuidePerf(): Promise<GuidePerf> {
  const { app } = createGuideApp({ step: "piece" });
  const register = app.world.ecs.system;
  const steps: { pass: Step | undefined } = { pass: undefined };

  vi.spyOn(app.world.ecs, "system").mockImplementation((definition: AnySystem) => {
    if (definition.name === "ui.guide") steps.pass = () => definition.run(NO_ROWS, NO_FRAME);

    return register(definition);
  });

  await app.start();
  vi.restoreAllMocks();
  await settleGuideApp(app);
  frames(app, 3);

  const pass = steps.pass;
  const piece: TransformValue | undefined = app.world.ecs.get(entityOf(app, PIECE), Transform);

  if (pass === undefined) throw new Error("perf: ui registered no ui.guide system");
  if (piece === undefined) throw new Error("perf: the piece has no Transform");

  const at = { turn: 0 };

  return {
    app,
    still: pass,
    moving: (): void => {
      at.turn = 1 - at.turn;
      piece.x = PLACES[at.turn] ?? 0;
      pass();
    }
  };
}
