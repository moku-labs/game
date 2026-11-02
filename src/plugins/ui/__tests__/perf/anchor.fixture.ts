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

/** The started app, its pass, and the kinds of frame a window measures. */
export type AnchorPerf = {
  app: ReturnType<typeof createAnchorApp>;
  /** A frame of the pass with every target standing still. */
  still: Step;
  /** A frame of the pass after the piece moved to the other fractional place. */
  moving: Step;
};

/**
 * Starts the fixture app and reads the system `ui.anchor` off the world while it registers.
 *
 * @returns The started app, at rest with nothing mounted, and one run of the pass.
 */
async function startPass(): Promise<{ app: ReturnType<typeof createAnchorApp>; pass: Step }> {
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

  const pass = steps.pass;

  if (pass === undefined) throw new Error("perf: ui registered no ui.anchor system");

  return { app, pass };
}

/**
 * The two frames of a fixture whose piece the windows sit on: one with every target still, one
 * that first moves the piece to the other of two fractional places, as a game's system writes a
 * field of its stored pose.
 *
 * @param app - The started app, its windows at rest.
 * @param pass - One run of the pass.
 * @returns The app and its two steps.
 */
function stepsOf(app: ReturnType<typeof createAnchorApp>, pass: Step): AnchorPerf {
  const piece: TransformValue | undefined = app.world.ecs.get(entityOf(app, PIECE), Transform);

  if (piece === undefined) throw new Error("perf: the piece has no Transform");

  // The windows stand: the world's copy of their rest catches up in the first still frame.
  pass();

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

/**
 * Starts the fixture, mounts the board, the piece and the tutorial, puts the window on the piece
 * and runs frames until its glide is over.
 *
 * @returns The app and its two steps.
 */
export async function startAnchorPerf(): Promise<AnchorPerf> {
  const { app, pass } = await startPass();

  mount(app, ["board.strip", "board.pieces", "tutorial"]);
  frames(app, 2);
  press(app, "go-piece");
  frames(app, 30);

  return stepsOf(app, pass);
}

/**
 * Starts the fixture with the piece and the screen whose root is an anchor on it, under a loop that
 * sways it forever, and runs frames until it is placed and its loop runs.
 *
 * @returns The app and its two steps: `moving` follows the piece while the loop runs.
 */
export async function startLoopPerf(): Promise<AnchorPerf> {
  const { app, pass } = await startPass();

  mount(app, ["board.pieces", "rootAnchor"]);
  frames(app, 5);

  return stepsOf(app, pass);
}
