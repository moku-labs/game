import { afterEach, describe, expect, it, vi } from "vitest";
import { read } from "../../../flow/doors/read";
import { sources } from "../../../flow/doors/sources";
import type { UiNode } from "../../jsx/types";
import {
  frames,
  glideNode,
  mount,
  moveTo,
  press,
  release,
  renderRoot,
  type ScrollApp,
  startScrollApp,
  stateOf
} from "../scroll-app";

// ---------------------------------------------------------------------------
// Integration: `ui.tree()` shows the `scroll` record of a scroll and the `motion`
// id of an element (F192, F193), the way `game.ui` reads it. Real world, real
// Yoga, plain Bun, inert renderer.
// ---------------------------------------------------------------------------

/** The app of the running test, stopped after it. */
let running: ScrollApp | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await running?.stop();
  running = undefined;
});

/**
 * Starts the fixture and mounts one screen.
 *
 * @param screen - The projection to mount.
 * @returns The app.
 */
async function start(screen: string): Promise<ScrollApp> {
  running = await startScrollApp();
  mount(running, screen);

  return running;
}

/**
 * The node with a key in a snapshot, depth first.
 *
 * @param node - The snapshot root.
 * @param key - The key of the element.
 * @returns The node, or `undefined`.
 */
function nodeOf(node: UiNode, key: string): UiNode | undefined {
  if (node.key === key) return node;

  for (const child of node.children) {
    const found = nodeOf(child, key);

    if (found !== undefined) return found;
  }

  return undefined;
}

describe("ui.tree() scroll", () => {
  it("shows the board's strip with its axis, offset, max, stops and no motion", async () => {
    // Bug caught: the strip's record is missing, built from the wrong source, or its stops unclamped.
    const app = await start("strip");
    const strip = nodeOf(app.ui.tree(), "strip");

    expect(strip?.scroll).toEqual({
      axis: "x",
      offset: 318,
      max: 390,
      moving: false,
      snap: [0, 318, 390]
    });
    expect(nodeOf(app.ui.tree(), "stripRoot")?.scroll).toBeUndefined();
    expect(Object.hasOwn(nodeOf(app.ui.tree(), "track") ?? {}, "scroll")).toBe(false);
  });

  it("follows ScrollState through a release glide, frame by frame", async () => {
    // Bug caught: the tree keeps the offset or moving of the first frame while the strip glides.
    const app = await start("strip");

    press(app, "strip", 500, 900);
    // The finger drags the strip to 218, rests, and lets go: it glides back to the stop at 318.
    moveTo(app, 600, 900);
    frames(app, 3);
    release(app, "strip");

    let sawMoving = false;

    for (let frame = 0; frame < 40; frame += 1) {
      const shown = nodeOf(app.ui.tree(), "strip")?.scroll;
      const state = stateOf(app, "strip");

      expect(shown?.offset).toBe(state?.offset);
      expect(shown?.moving).toBe(state?.moving);
      sawMoving ||= state?.moving === true;
      frames(app, 1);
    }

    expect(sawMoving).toBe(true);
    expect(nodeOf(app.ui.tree(), "strip")?.scroll).toMatchObject({ offset: 318, moving: false });
  });

  it("follows app.ui.scroll and clamps a request past the end", async () => {
    // Bug caught: a programmatic scroll leaves the tree at its old offset.
    const app = await start("strip");

    app.ui.scroll("strip", 999);

    expect(nodeOf(app.ui.tree(), "strip")?.scroll).toMatchObject({ offset: 390, moving: false });
    expect(stateOf(app, "strip")?.offset).toBe(390);
  });

  it("has no snap key on a free strip and shows the same record through game.ui", async () => {
    // Bug caught: a strip with no stops shows `snap: []`; the door source is not `tree()`.
    const app = await start("free");
    const free = nodeOf(read(app, sources.ui), "free");

    expect(free?.scroll).toEqual({ axis: "x", offset: 0, max: 2694, moving: false });
    expect(Object.hasOwn(free?.scroll ?? {}, "snap")).toBe(false);
  });

  it("clamps the stops a render names to the range the solve gave", async () => {
    // Bug caught: stops past the content reach the reader unclamped, NaN as null in the JSON.
    const app = await start("glide");

    renderRoot(app, "glide", glideNode({ at: 0, snap: [-10, 500, Number.NaN] }));
    frames(app, 2);

    const shown = nodeOf(app.ui.tree(), "glider")?.scroll;

    expect(shown?.snap).toEqual([0, 390]);
    expect(JSON.stringify(shown)).not.toContain("null");
  });
});

describe("ui.tree() motion", () => {
  it("shows the id of the motion prop and leaves the key off an element without one", async () => {
    // Bug caught: the id is read off the wrong prop, or a motion without id leaves `motion: undefined`.
    const app = await start("glide");

    renderRoot(app, "glide", {
      type: "column",
      key: "glideRoot",
      props: { style: { width: 1080, height: 1920 }, motion: { id: "hud.card" } },
      children: [
        { type: "row", key: "plain", props: { style: { width: 100, height: 50 } }, children: [] },
        {
          type: "row",
          key: "unnamed",
          props: { style: { width: 100, height: 50 }, motion: {} },
          children: []
        }
      ]
    });
    frames(app, 2);

    const tree = app.ui.tree();

    expect(tree.motion).toBe("hud.card");
    expect(Object.hasOwn(nodeOf(tree, "plain") ?? {}, "motion")).toBe(false);
    expect(Object.hasOwn(nodeOf(tree, "unnamed") ?? {}, "motion")).toBe(false);
  });
});
