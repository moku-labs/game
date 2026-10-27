/**
 * @file ui plugin — the perf fixture of the anchor pass (F99): the tutorial's window on the board's
 * world piece, a 64 u sprite, with a rim and a button inside it, and a second window on the strip's
 * first seat inside a container drawn at half its size. Started and brought to rest outside any
 * measured window; the system `ui.anchor` is read off the world while it registers, so a window
 * calls exactly the pass.
 */
import { vi } from "vitest";
import { Transform, type TransformValue } from "../../../renderer/components";
import type { AnySystem, SystemContext } from "../../../world/types";
import {
  createAnchorApp,
  entityOf,
  frames,
  mount,
  PIECE,
  press,
  settleAnchorApp
} from "../anchor-app";
import type { Step } from "./fixtures";

/** The rows a system of `ui` gets: it declares no query. */
const NO_ROWS: readonly [] = Object.freeze([]);

/** What the pass gets beside its rows: it reads nothing of it. */
const NO_FRAME = Object.freeze({}) as unknown as SystemContext;

/** The two fractional places the piece moves between, one a call. */
const PLACES = [512.25, 513.75] as const;

/** The started app, its pass, and the two kinds of frame a window measures. */
export type AnchorPerf = {
  app: ReturnType<typeof createAnchorApp>;
  /** A frame of the pass with every target standing still. */
  still: Step;
  /** A frame of the pass after the piece moved to the other fractional place. */
  moving: Step;
};

/**
 * Starts the fixture, mounts the board, the piece and the tutorial, puts the window on the piece
 * and runs frames until its glide is over.
 *
 * @returns The app and its two steps.
 */
export async function startAnchorPerf(): Promise<AnchorPerf> {
  const app = createAnchorApp();
  const register = app.world.ecs.system;
  const steps: { pass: Step | undefined } = { pass: undefined };

  vi.spyOn(app.world.ecs, "system").mockImplementation((definition: AnySystem) => {
    if (definition.name === "ui.anchor") steps.pass = () => definition.run(NO_ROWS, NO_FRAME);

    return register(definition);
  });

  await app.start();
  vi.restoreAllMocks();
  await settleAnchorApp(app);
  mount(app, ["board.strip", "board.pieces", "tutorial"]);
  frames(app, 2);
  press(app, "go-piece");
  frames(app, 30);

  const pass = steps.pass;
  const piece: TransformValue | undefined = app.world.ecs.get(entityOf(app, PIECE), Transform);

  if (pass === undefined || piece === undefined) {
    throw new Error("perf: ui registered no ui.anchor system, or the piece has no Transform");
  }

  // The window stands: the world's copy of its rest catches up in the first still frame.
  pass();

  const at = { turn: 0 };

  return {
    app,
    still: pass,
    moving: (): void => {
      at.turn = 1 - at.turn;
      // The game's system moving a view: a field of its stored pose, written in place.
      piece.x = PLACES[at.turn] ?? 0;
      pass();
    }
  };
}
