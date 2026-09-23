import { describe, expect, it, vi } from "vitest";
import { Pointer, PointerOver, Pressed } from "../../../input/components";
import { Parent, Shape, Transform } from "../../../renderer/components";
import type { ViewportSize } from "../../../renderer/viewport/types";
import { Box, Scroll } from "../../components";
import { type StackApp, startStackApp, tick } from "../stack-app";

// ---------------------------------------------------------------------------
// Three findings of the ui code review, on the real screen set: a scroll keeps
// its offset through hover, press and a new rect; the guide hole of a hosted
// view sits where the view is drawn; lint names a nine-slice a clip drops.
// ---------------------------------------------------------------------------

/** A phone in reference units. */
const PHONE: ViewportSize = {
  width: 1080,
  height: 1920,
  scale: 0.36,
  orientation: "portrait",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 }
};

/** The same phone, taller: a centred element moves down. */
const TALL: ViewportSize = { ...PHONE, height: 2400 };

/**
 * Puts the app on a viewport and mounts projections, then gives them their frames.
 *
 * @param app - The running app.
 * @param names - The projections to mount.
 */
function mount(app: StackApp, names: readonly string[]): void {
  vi.spyOn(app.renderer.viewport, "size").mockReturnValue(PHONE);
  app.world.projection.mount(names, { kind: "plugin", name: "test" });
  app.time.step(16);
  app.time.step(16);
  app.time.step(16);
}

/**
 * Drags a scroll container from one pointer height to another.
 *
 * @param app - The running app.
 * @param container - The scroll container.
 * @param from - Where the finger lands.
 * @param to - Where it lifts.
 */
function drag(app: StackApp, container: number, from: number, to: number): void {
  const pointer = app.world.ecs.resource(Pointer);

  pointer.y = from;
  app.world.ecs.tag(container, Pressed);
  app.time.step(16);
  pointer.y = to;
  app.time.step(16);
  app.world.ecs.untag(container, Pressed);
  app.time.step(16);
}

describe("a scroll offset", () => {
  it("survives the mouse coming over it, a second press and a new rect", async () => {
    const app = await startStackApp();

    mount(app, ["listScreen"]);

    const list = app.ui.find("list") ?? 0;
    const rows = app.ui.find("rows") ?? 0;
    const offset = (): number | undefined => app.world.ecs.get(list, Scroll)?.offset;

    drag(app, list, 500, 300);

    expect(offset()).toBe(-200);

    app.world.ecs.tag(list, PointerOver);
    app.time.step(16);

    expect(offset()).toBe(-200);

    app.world.ecs.untag(list, PointerOver);
    app.time.step(16);

    expect(offset()).toBe(-200);

    // A second drag goes on from where the first one left the content.
    drag(app, list, 300, 250);

    expect(offset()).toBe(-250);

    const before = app.world.ecs.get(list, Box)?.y ?? 0;

    vi.spyOn(app.renderer.viewport, "size").mockReturnValue(TALL);
    app.time.step(16);
    app.time.step(16);

    expect(app.world.ecs.get(list, Box)?.y).toBeGreaterThan(before);
    expect(offset()).toBe(-250);
    // The content the offset moves is the parent of the rows.
    const content = app.world.ecs.get(rows, Parent)?.entity ?? 0;

    expect(app.world.ecs.get(content, Transform)?.y).toBe(-250);

    await app.stop();
  });
});

describe("the guide hole over a hosted view", () => {
  it("sits where the view is drawn inside a slot fitted to 0.8", async () => {
    const app = await startStackApp();

    mount(app, ["sized", "fitSlotScreen"]);

    const board = app.ui.find("fitBoard") ?? 0;

    expect(app.world.ecs.get(board, Transform)?.scale).toBeCloseTo(0.8, 5);

    expect(app.flow.gate.answer({ intent: "teachSized" })).toBe(true);
    await tick();
    app.time.step(16);

    const dims = [...app.world.ecs.query(Shape, Transform)]
      .filter(([, shape]) => shape.alpha === 0.6)
      .map(([, shape, transform]) => ({ x: transform.x, y: transform.y, w: shape.w, h: shape.h }));
    const top = dims.find(dim => dim.x === 0 && dim.y === 0);
    const left = dims.find(dim => dim.x === 0 && dim.y > 0 && dim.w < PHONE.width);

    expect(dims).toHaveLength(4);
    expect(top?.h).toBeCloseTo(40, 5);
    expect(left?.y).toBeCloseTo(40, 5);
    expect(left?.w).toBeCloseTo(40, 5);
    expect(left?.h).toBeCloseTo(80, 5);

    expect(app.flow.gate.answer({ intent: "ok" })).toBe(true);
    await tick();
    await app.stop();
  });
});

describe("lint of a nine-slice a clip drops", () => {
  it("reports a clipping element that names a nine-slice, and no other", async () => {
    const app = await startStackApp();

    mount(app, ["clippedScreen"]);

    expect(app.ui.lint().filter(finding => finding.rule === "nine-slice-clipped")).toEqual([
      { rule: "nine-slice-clipped", key: "clipped", detail: "column" },
      { rule: "nine-slice-clipped", key: "slicedList", detail: "scroll" }
    ]);

    await app.stop();
  });
});
