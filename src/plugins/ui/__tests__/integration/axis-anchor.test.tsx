import { afterEach, describe, expect, it, vi } from "vitest";
import { Transform } from "../../../renderer/components";
import { Box } from "../../components";
import { type AnchorApp, entityOf, frames, mount, PIECE, startAnchorApp } from "../anchor-app";

// ---------------------------------------------------------------------------
// Integration: an `<anchor>` inside a container stretched on one axis (F179). The anchor maps the shown targets
// into the units of the space it is drawn in, each axis by its own factor, so the window still lands on the target.
// Real world, real Yoga, plain Bun, inert renderer.
// ---------------------------------------------------------------------------

/** The window inside the container drawn at half its size by `fit: "contain"`. */
const HALF_WINDOW = { projection: "tutorial", key: "halfWindow" };

/** The window that is the root element of its screen, on the world piece. */
const ROOT_WINDOW = { projection: "rootAnchor", key: "rootWindow" };

/** The app of the running test, stopped after it. */
let running: AnchorApp | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  await running?.stop();
  running = undefined;
});

/**
 * Starts the fixture with the board, the piece and the tutorial mounted.
 *
 * @returns The app.
 */
async function mounted(): Promise<AnchorApp> {
  running = await startAnchorApp();
  mount(running, ["board.strip", "board.pieces", "tutorial"]);
  frames(running, 2);

  return running;
}

describe("an anchor under a container stretched on one axis", () => {
  // Bug: the anchor divides both axes by the uniform scale, so under a container of scaleX 0.5 its window is twice too
  // wide and covers its target and the neighbours.
  it("maps the width by the width factor and the height by the height factor", async () => {
    const app = await mounted();
    const half = app.ui.find("half") ?? 0;

    // Before: the container is drawn at 0.5, the window is 116 wide and 120 tall on the screen, padded by 4 a side.
    expect(app.world.ecs.get(entityOf(app, HALF_WINDOW), Box)).toMatchObject({ w: 240, h: 248 });

    app.world.ecs.set(half, Transform, { scaleX: 0.5 });
    frames(app, 2);

    // The same 116 on the screen is 116 / 0.25 = 464 units wide; the height still divides by 0.5 alone.
    expect(app.world.ecs.get(entityOf(app, HALF_WINDOW), Box)).toMatchObject({ w: 472, h: 248 });
  });

  // Bug: a space collapsed on one axis is divided by zero and the window gets an infinite size.
  it("keeps the window it had under a container collapsed on one axis", async () => {
    const app = await mounted();
    const half = app.ui.find("half") ?? 0;
    const before = app.world.ecs.get(entityOf(app, HALF_WINDOW), Box);

    app.world.ecs.set(half, Transform, { scaleX: 0 });
    frames(app, 2);

    const after = app.world.ecs.get(entityOf(app, HALF_WINDOW), Box);

    expect(after?.w).toBe(before?.w);
    expect(Number.isFinite(after?.w)).toBe(true);
  });
});

describe("an anchor on the screen's own root, on a stretched target", () => {
  // Bug: the pose scratch the resolver filled for the target keeps its `scaleX` into the mapping of a root anchor, so the
  // window is divided by a factor that is not its own space's and comes out twice too wide.
  it("takes the stretched width of the target as it is", async () => {
    running = await startAnchorApp();
    mount(running, ["board.pieces", "rootAnchor"]);
    frames(running, 2);

    const piece = entityOf(running, PIECE);
    const full = running.ui.rectOf(PIECE);

    running.world.ecs.set(piece, Transform, { scaleX: 0.5 });
    frames(running, 2);

    const window = running.world.ecs.get(entityOf(running, ROOT_WINDOW), Box);
    const squeezed = running.ui.rectOf(PIECE);

    expect(squeezed?.w).toBeCloseTo((full?.w ?? 0) / 2);
    expect(window?.w).toBeCloseTo(squeezed?.w ?? 0);
  });
});

describe("the pose of a followed anchor", () => {
  // Bug: the follow writes x, y, rotation and scale from the rest and leaves a stretch a motion left on the stored pose,
  // so a window that was squeezed stays squeezed while it follows its target.
  it("takes the rest's factor back, 1 where the rest has none", async () => {
    running = await startAnchorApp();
    mount(running, ["board.pieces", "rootAnchor"]);
    frames(running, 2);

    const window = entityOf(running, ROOT_WINDOW);

    running.world.ecs.set(window, Transform, { scaleX: 0.5 });
    running.world.ecs.set(entityOf(running, PIECE), Transform, { x: 600 });
    frames(running, 2);

    expect(running.world.ecs.get(window, Transform)?.scaleX).toBe(1);
  });
});
