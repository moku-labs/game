import { afterEach, describe, expect, it } from "vitest";
import { Parent, Transform } from "../../../renderer/components";
import { Exiting } from "../../../world/ecs/define";
import { Box, type BoxValue, Scroll, UiCounters } from "../../components";
import { windowOf } from "../../layout/window";
import type { UiNode } from "../../types";
import {
  counts,
  find,
  LIST,
  logged,
  moveTo,
  nodeOf,
  press,
  ROW,
  ROWS,
  release,
  rowMotions,
  startWindowApp,
  type WindowApp
} from "../window-app";

// ---------------------------------------------------------------------------
// Integration: the windowed scroll on P18's list (14-ui Delta 10 Part B) —
// 1000 rows of five elements, 120 u each, in a 1600 u list. Real world, real
// Yoga, plain Bun, inert renderer.
// ---------------------------------------------------------------------------

/** The app of the running test, stopped after it. */
let running: WindowApp | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

/**
 * Starts the fixture on one screen and keeps it for the teardown.
 *
 * @param screen - The projection to mount.
 * @returns The app.
 */
async function start(screen = "window"): Promise<WindowApp> {
  running = await startWindowApp(screen);

  return running;
}

/**
 * The entity of the content a scroll moves: its one child.
 *
 * @param app - The running app.
 * @param scroll - The scroll entity.
 * @returns The content entity.
 */
function contentOf(app: WindowApp, scroll: number): number {
  const [content] = [...app.world.ecs.query(Parent)]
    .filter(([, parent]) => parent.entity === scroll)
    .map(([entity]) => entity);

  return content ?? 0;
}

/**
 * The children of the content of a scroll, top to bottom: the spacers and the rows.
 *
 * @param app - The running app.
 * @param scroll - The scroll entity.
 * @returns Their `Box` values, in layout order.
 */
function slotsOf(app: WindowApp, scroll: number): { entity: number; box: BoxValue }[] {
  const content = contentOf(app, scroll);

  return [...app.world.ecs.query(Parent)]
    .filter(([, parent]) => parent.entity === content)
    .map(([entity]) => ({
      entity,
      box: app.world.ecs.get(entity, Box) ?? { x: 0, y: 0, w: 0, h: 0 }
    }))
    .toSorted((first, second) => first.box.y - second.box.y || first.box.h - second.box.h);
}

/**
 * The message of the error the first `ui:root-failed` entry carries.
 *
 * @param app - The running app.
 * @returns The message, or `undefined`.
 */
function rootFailure(app: WindowApp): string | undefined {
  const [data] = logged(app, "ui:root-failed") as { error?: { message?: string } }[];

  return data?.error?.message;
}

/**
 * The window the snapshot reports for a scroll.
 *
 * @param app - The running app.
 * @param key - The key of the scroll.
 * @returns The window of its node.
 */
function windowIn(app: WindowApp, key: string): UiNode["window"] {
  return nodeOf(app.ui.tree(), key)?.window;
}

/**
 * Tells whether any node of the snapshot holds the keyboard focus.
 *
 * @param node - Where the walk starts.
 * @returns True when one does.
 */
function anyFocus(node: UiNode): boolean {
  return node.state.focus || node.children.some(child => anyFocus(child));
}

describe("the windowed scroll at mount", () => {
  it("holds the rows of the window and two spacers, and the content keeps the full height", async () => {
    const app = await start();
    const scroll = find(app, "shop");
    const window = windowOf(0, LIST, ROWS, ROW, 5);
    const slots = slotsOf(app, scroll);
    const rows = window.last - window.first + 1;

    expect(window).toEqual({ first: 0, last: 18 });
    expect(slots).toHaveLength(rows + 2);
    expect(slots[0]?.box.h).toBe(0);
    expect(slots.at(-1)?.box.h).toBe((ROWS - window.last - 1) * ROW);
    expect(app.world.ecs.get(contentOf(app, scroll), Box)?.h).toBe(ROWS * ROW);
    expect(app.world.ecs.get(scroll, Scroll)).toEqual({
      axis: "y",
      offset: 0,
      min: LIST - 120_000
    });
  });

  it("reports the window on the scroll node of tree() and lists the rows, never a spacer", async () => {
    const app = await start();
    const node = nodeOf(app.ui.tree(), "shop");
    const content = node?.children[0];

    expect(node?.window).toEqual({ first: 0, last: 18, rows: ROWS });
    expect(node?.children).toHaveLength(1);
    expect(content?.children.map(child => child.key)).toEqual(
      Array.from({ length: 19 }, (_unused, index) => `r${index}`)
    );
  });

  it("lays every row out at the row height, five elements each", async () => {
    const app = await start();
    const row = find(app, "r3");

    expect(app.world.ecs.get(row, Box)).toMatchObject({ y: 3 * ROW, h: ROW });
    expect(nodeOf(app.ui.tree(), "r3")?.children).toHaveLength(4);
  });

  it("cuts its first range at the viewport height when its height is no number, and corrects it after the solve", async () => {
    const app = await start("halfList");
    const scroll = find(app, "halfList");

    // At enter the list has no rect: 1920 u of viewport cut rows 0 to 20. The solve gave it 960 u,
    // and the range step of the next frame cut rows 0 to 12.
    expect(windowOf(0, 1920, ROWS, ROW, 5)).toEqual({ first: 0, last: 20 });
    expect(app.world.ecs.get(scroll, Box)?.h).toBe(960);
    expect(app.world.ecs.resource(UiCounters).windowRenders).toBe(1);
    expect(windowIn(app, "halfList")).toEqual({ first: 0, last: 12, rows: ROWS });
  });

  it("keys a row without a key by its index", async () => {
    const app = await start("plain");

    expect(app.ui.find("0")).toBeDefined();
    expect(app.ui.find("18")).toBeDefined();
    expect(app.ui.find("19")).toBeUndefined();
  });

  it("answers find for a row inside the window and undefined for one outside it", async () => {
    const app = await start();

    expect(app.ui.find("r18")).toBeDefined();
    expect(app.ui.find("r19")).toBeUndefined();
    expect(app.ui.find("r500")).toBeUndefined();
  });
});

describe("the windowed scroll under a finger", () => {
  it("re-renders the list only when the range changes: no view above it runs, one solve each", async () => {
    const app = await start();
    const counters = app.world.ecs.resource(UiCounters);

    press(app, "shop", 4000);

    const before = {
      renders: counters.windowRenders,
      solves: counters.solves,
      screen: counts.screen
    };
    let window = windowOf(0, LIST, ROWS, ROW, 5);
    let changes = 0;

    for (let frame = 1; frame <= 240; frame += 1) {
      moveTo(app, 4000 - 16 * frame);

      const next = windowOf(-16 * frame, LIST, ROWS, ROW, 5);

      if (next.first !== window.first || next.last !== window.last) changes += 1;

      window = next;
    }

    expect(app.world.ecs.get(find(app, "shop"), Scroll)?.offset).toBe(-3840);
    expect(windowIn(app, "shop")).toEqual({ first: 27, last: 50, rows: ROWS });
    // 32 rows crossed at the bottom edge and 27 at the top one: the two edges move on different
    // frames in a 1600 u list of 120 u rows.
    expect(changes).toBe(59);
    expect(counters.windowRenders - before.renders).toBe(changes);
    expect(counts.screen - before.screen).toBe(0);
    expect(counters.solves - before.solves).toBe(changes);
  });

  it("matches the window on the frame the offset moved: no lag", async () => {
    const app = await start();

    press(app, "shop", 1000);
    moveTo(app, 400);

    const { first, last } = windowOf(-600, LIST, ROWS, ROW, 5);

    expect(windowIn(app, "shop")).toEqual({ first, last, rows: ROWS });
    expect(app.ui.find(`r${last}`)).toBeDefined();
    expect(app.world.ecs.get(find(app, `r${last}`), Box)).toMatchObject({ y: last * ROW, h: ROW });
  });

  it("keeps the entity of a row that stays in the window", async () => {
    const app = await start();
    const kept = find(app, "r12");

    press(app, "shop", 1000);
    moveTo(app, 400);

    expect(app.ui.find("r12")).toBe(kept);
  });

  it("frees the rows that left in the same frame: no Exiting, the nodes are the window's", async () => {
    const app = await start();
    const counters = app.world.ecs.resource(UiCounters);
    const left = find(app, "r2");
    const rowsBefore = 19;
    const base = counters.nodes - rowsBefore * 5;

    press(app, "shop", 3000);
    moveTo(app, 3000 - 14 * ROW);

    const { first, last } = windowOf(-14 * ROW, LIST, ROWS, ROW, 5);

    expect(app.ui.find("r2")).toBeUndefined();
    expect(app.world.ecs.has(left, Exiting)).toBe(false);
    expect(app.world.ecs.has(left, Box)).toBe(false);
    expect(counters.nodes).toBe(base + (last - first + 1) * 5);
  });

  it("plays no enter and no exit hook on a shift", async () => {
    const app = await start();

    rowMotions.length = 0;
    press(app, "shop", 3000);
    moveTo(app, 3000 - 14 * ROW);
    moveTo(app, 3000);

    expect(rowMotions).toEqual([]);
  });

  it('loses the local of a row component across leave and return: "Row state belongs in the model: a row that leaves the window loses its local state"', async () => {
    const app = await start();
    const first = find(app, "r2");

    app.input.tap(find(app, "r2-open"));
    app.time.step(16);

    expect(nodeOf(app.ui.tree(), "r2")?.local).toEqual({ open: true });

    press(app, "shop", 3000);
    moveTo(app, 3000 - 14 * ROW);
    moveTo(app, 3000);

    expect(find(app, "r2")).not.toBe(first);
    expect(nodeOf(app.ui.tree(), "r2")?.local).toEqual({ open: false });
  });

  it("clears the keyboard focus of a row scrolled out", async () => {
    const app = await start();

    expect(app.input.pressKey("Tab")).toBe(true);
    app.time.step(16);

    expect(nodeOf(app.ui.tree(), "r0-open")?.state.focus).toBe(true);

    press(app, "shop", 3000);
    moveTo(app, 3000 - 14 * ROW);

    expect(app.ui.find("r0-open")).toBeUndefined();
    expect(anyFocus(app.ui.tree())).toBe(false);
  });

  it("ends the editing of a text field in a row scrolled out", async () => {
    const app = await start("form");
    const field = find(app, "f0-name");

    expect(app.ui.fill("f0-name", "Alex")).toBe(true);
    app.time.step(16);

    press(app, "formList", 3000);
    moveTo(app, 3000 - 14 * ROW);

    expect(app.ui.find("f0-name")).toBeUndefined();
    expect(app.world.ecs.has(field, Box)).toBe(false);
    expect(app.input.pressKey("Escape")).toBe(false);
  });
});

describe("the windowed scroll when the list changes", () => {
  it("plays exit and enter when an item drops from inside the window", async () => {
    const app = await start();

    rowMotions.length = 0;
    app.input.tap(find(app, "dropFour"));
    app.time.step(16);

    expect(rowMotions).toEqual([
      { hook: "exit", key: "r4" },
      { hook: "enter", key: "r19" }
    ]);
    expect(windowIn(app, "shop")).toEqual({ first: 0, last: 18, rows: ROWS - 1 });
  });

  it("clamps the window and the offset in the same frame when the list shrinks below it", async () => {
    const app = await start();
    const scroll = find(app, "shop");

    press(app, "shop", 4000);
    moveTo(app, 4000 - 3840);
    release(app, "shop");
    app.input.tap(find(app, "shrink"));
    app.time.step(16);

    expect(app.world.ecs.get(scroll, Scroll)).toEqual({ axis: "y", offset: 0, min: 0 });
    expect(app.world.ecs.get(contentOf(app, scroll), Transform)?.y).toBe(0);
    expect(windowIn(app, "shop")).toEqual({ first: 0, last: 9, rows: 10 });
    expect(app.ui.find("r9")).toBeDefined();
    expect(app.ui.find("r27")).toBeUndefined();
  });
});

describe("the props of a windowed scroll at run time", () => {
  it("throws for a row height that is not above 0, and the root fails alone", async () => {
    const app = await start("zeroHeight");

    expect(app.ui.find("zeroHeight")).toBeUndefined();
    expect(rootFailure(app)).toBe(
      "[game] Scroll rowHeight must be above 0.\n  Give the row height in reference units."
    );
  });

  it("throws for some but not all of rows, rowHeight and row", async () => {
    const app = await start("partial");

    expect(app.ui.find("partial")).toBeUndefined();
    expect(rootFailure(app)).toBe(
      "[game] A windowed scroll needs rows, rowHeight and row.\n  Write <scroll rows={n} rowHeight={80} row={index => <Row key={ids[index]} />} />."
    );
  });

  it("rounds rows down with one warning", async () => {
    const app = await start("rounded");

    expect(windowIn(app, "rounded")).toEqual({ first: 0, last: 9, rows: 10 });
    expect(logged(app, "ui:scroll-rows-rounded")).toEqual([{ key: "rounded" }]);
  });

  it("takes a negative overscan as 0", async () => {
    const app = await start("tightOverscan");

    expect(windowIn(app, "tightOverscan")).toEqual({ first: 0, last: 13, rows: ROWS });
  });

  it("ignores children next to row with one warning", async () => {
    const app = await start("childrenIgnored");

    expect(app.ui.find("ignored")).toBeUndefined();
    expect(windowIn(app, "childrenIgnored")).toEqual({ first: 0, last: 2, rows: 3 });
    expect(logged(app, "ui:scroll-children-ignored")).toEqual([{ key: "childrenIgnored" }]);
  });

  it("puts an empty spacer of the row height where a row is not one node, with one error", async () => {
    const app = await start("brokenRow");

    expect(logged(app, "ui:row-not-one-node")).toEqual([{ key: "brokenRow", index: 1 }]);
    expect(app.world.ecs.get(find(app, "b3"), Box)).toMatchObject({ y: 3 * ROW, h: ROW });
  });

  it("writes the row height over a row style with another one, with one warning", async () => {
    const app = await start("tallRow");

    expect(app.world.ecs.get(find(app, "t1"), Box)).toMatchObject({ y: ROW, h: ROW });
    expect(logged(app, "ui:row-height-overridden")).toEqual([{ key: "tallRow" }]);
  });
});
