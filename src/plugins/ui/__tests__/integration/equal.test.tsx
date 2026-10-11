import { describe, expect, it, vi } from "vitest";
import { PointerOver, Pressed, Tappable } from "../../../input/components";
import { Shape, Sprite } from "../../../renderer/components";
import { Text } from "../../../text/components";
import { Box, UiCounters } from "../../components";
import {
  commit,
  createGridApp,
  ELEMENTS,
  type GridApp,
  LATE_BUNDLE,
  LATE_FONT,
  Purse,
  renders,
  startGridApp,
  TALL
} from "../equal-app";
import { type StackApp, settle, startStackApp } from "../stack-app";

// ---------------------------------------------------------------------------
// Integration: a description that says the same costs no style pass and no
// layout (14-ui). Real flow, world, text and Yoga; plain Bun, inert renderer.
// The screen is 200 elements with every style written inline, so each render
// hands ui new objects that say what the last ones said.
// ---------------------------------------------------------------------------

/**
 * What one step cost: the style passes and the write passes of ui, the solves and the measures of
 * Yoga, and every write the world took through `ecs` and `projection.setRest`.
 */
type Cost = {
  styled: number;
  written: number;
  solves: number;
  measured: number;
  sets: number;
  adds: number;
  removes: number;
  rests: number;
};

/** The cost of a step in which ui had nothing to do. */
const NOTHING: Cost = {
  styled: 0,
  written: 0,
  solves: 0,
  measured: 0,
  sets: 0,
  adds: 0,
  removes: 0,
  rests: 0
};

/**
 * Watches the counters of ui and the writes of the world on a running app.
 *
 * @param app - The running app.
 * @returns The counters, a meter for one step, and the entities that step wrote.
 */
function watch(app: GridApp | StackApp) {
  const counters = app.world.ecs.resource(UiCounters);
  const set = vi.spyOn(app.world.ecs, "set");
  const add = vi.spyOn(app.world.ecs, "add");
  const remove = vi.spyOn(app.world.ecs, "remove");
  const rest = vi.spyOn(app.world.projection, "setRest");

  return {
    counters,

    /**
     * Runs one step and reads what it cost.
     *
     * @param run - The step: a commit, a frame, a pointer.
     * @returns The cost of that step alone.
     */
    cost: async (run: () => Promise<void> | void): Promise<Cost> => {
      const before = { ...counters };

      for (const spy of [set, add, remove, rest]) spy.mockClear();

      await run();

      return {
        styled: counters.styled - before.styled,
        written: counters.written - before.written,
        solves: counters.solves - before.solves,
        measured: counters.measured - before.measured,
        sets: set.mock.calls.length,
        adds: add.mock.calls.length,
        removes: remove.mock.calls.length,
        rests: rest.mock.calls.length
      };
    },

    /**
     * The entities whose components the last step set, once each.
     *
     * @returns The entities, in call order.
     */
    touched: (): number[] => [...new Set(set.mock.calls.map(call => call[0]))]
  };
}

/**
 * The entity of a keyed element of the running app.
 *
 * @param app - The running app.
 * @param key - The element key.
 * @returns The entity.
 */
function find(app: GridApp | StackApp, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key);

  expect(entity).toBeDefined();

  return entity ?? -1;
}

/**
 * Runs frames until the 0 ms rest tracks of a moved rect have landed and left.
 *
 * @param app - The running app.
 */
function rest(app: GridApp): void {
  for (let frame = 0; frame < 3; frame += 1) app.time.step(16);
}

describe("a description that says the same", () => {
  it("costs no style pass, no solve and no write on a screen of 200 elements", async () => {
    const app = await startGridApp();
    const watched = watch(app);

    expect(ELEMENTS).toBe(200);
    expect(watched.counters.nodes).toBe(ELEMENTS);
    expect(watched.counters.styled).toBe(ELEMENTS);

    for (let round = 1; round <= 3; round += 1) {
      const rendered = renders.grid;
      const cost = await watched.cost(() => commit(app, "tick"));

      // The commit reached the screen: the model moved and the view built a new description.
      expect(app.model.store.snapshot().player).toMatchObject({ ticks: round });
      expect(renders.grid).toBe(rendered + 1);

      expect(cost).toEqual(NOTHING);
    }

    await app.stop();
  });

  it("keeps every rect and every look where the first solve put them", async () => {
    const app = await startGridApp();
    const before = JSON.stringify(app.ui.tree());

    await commit(app, "tick");
    await commit(app, "tick");

    expect(JSON.stringify(app.ui.tree())).toBe(before);

    await app.stop();
  });
});

describe("one changed prop on a screen of 200 elements", () => {
  it("writes exactly the element whose `components` value changed, and solves nothing", async () => {
    const app = await startGridApp();
    const watched = watch(app);
    const purse = find(app, "purse");
    const cost = await watched.cost(() => commit(app, "earn"));

    expect(cost).toMatchObject({ styled: 0, written: 1, solves: 0, measured: 0 });
    expect(watched.touched()).toEqual([purse]);
    expect(app.world.ecs.get(purse, Purse)).toEqual({ value: 8 });

    await app.stop();
  });

  it("writes exactly the element whose `texture` changed, and solves nothing", async () => {
    const app = await startGridApp();
    const watched = watch(app);
    const art = find(app, "art");
    const cost = await watched.cost(() => commit(app, "dress"));

    expect(cost).toMatchObject({ styled: 0, written: 1, solves: 0, measured: 0 });
    expect(watched.touched()).toEqual([art]);
    expect(app.world.ecs.get(art, Sprite)?.texture).toBe("ui.gem");

    await app.stop();
  });

  it("styles exactly the text whose `content` changed, and solves once for its new rect", async () => {
    const app = await startGridApp();
    const watched = watch(app);
    const label = find(app, "label");
    const width = app.world.ecs.get(label, Box)?.w ?? 0;
    const cost = await watched.cost(() => commit(app, "rename"));

    // One style pass and one measure: the label. It is written at the patch, and once more with
    // the rect the solve gave it.
    expect(cost).toMatchObject({ styled: 1, written: 2, solves: 1, measured: 1 });
    expect(watched.touched()).toEqual([label]);
    expect(app.world.ecs.get(label, Text)?.content).toBe("for a much longer name");
    expect(app.world.ecs.get(label, Box)?.w).toBeGreaterThan(width);

    rest(app);

    expect(await watched.cost(() => commit(app, "tick"))).toEqual(NOTHING);

    await app.stop();
  });
});

describe("a pointer flag on a screen of 200 elements", () => {
  it("restyles only the element under the pointer, and the reconcile after it does nothing", async () => {
    const app = await startGridApp();
    const watched = watch(app);
    const hot = find(app, "hot");
    const over = await watched.cost(() => {
      app.world.ecs.tag(hot, PointerOver);
      app.time.step(16);
    });

    // The hover variant changes the look and the scale: no rect moves, so nothing solves.
    expect(over).toMatchObject({ styled: 1, written: 1, solves: 0 });
    expect(watched.touched()).toEqual([hot]);
    expect(app.world.ecs.get(hot, Shape)?.fill).toBe(0x55_66_77);
    expect(app.ui.tree().children[0]?.children[2]?.style.scale).toBe(1.1);

    // The root stays marked for one more reconcile: every element says what it said.
    expect(await watched.cost(() => app.time.step(16))).toMatchObject({
      styled: 0,
      written: 0,
      solves: 0
    });

    // A commit while the pointer is over it keeps the hover look.
    rest(app);

    expect(await watched.cost(() => commit(app, "tick"))).toEqual(NOTHING);
    expect(app.world.ecs.get(hot, Shape)?.fill).toBe(0x55_66_77);

    await app.stop();
  });

  it("solves once when the pressed variant moves a rect, and goes back on release", async () => {
    const app = await startGridApp();
    const watched = watch(app);
    const hot = find(app, "hot");
    const label = find(app, "label");
    const before = { hot: app.world.ecs.get(hot, Box)?.w, label: app.world.ecs.get(label, Box)?.x };
    const down = await watched.cost(() => {
      app.world.ecs.tag(hot, Pressed);
      app.time.step(16);
    });

    // The button is written at the press and again with its new rect; the label behind it moved.
    expect(down).toMatchObject({ styled: 1, written: 3, solves: 1 });
    expect(new Set(watched.touched())).toEqual(new Set([hot, label]));
    expect(app.world.ecs.get(hot, Box)?.w).toBe(150);
    expect(app.world.ecs.get(hot, Shape)?.fill).toBe(0x11_22_33);
    expect(app.world.ecs.get(label, Box)?.x).toBe((before.label ?? 0) - 10);

    const up = await watched.cost(() => {
      app.world.ecs.untag(hot, Pressed);
      app.time.step(16);
    });

    expect(up).toMatchObject({ styled: 1, solves: 1 });
    expect(app.world.ecs.get(hot, Box)?.w).toBe(before.hot);
    expect(app.world.ecs.get(hot, Shape)?.fill).toBe(0x33_44_55);
    expect(app.world.ecs.get(label, Box)?.x).toBe(before.label);

    await app.stop();
  });
});

describe("a new viewport on a screen of 200 elements", () => {
  it("resolves every element again, with the `when` variant and the safe area of the new one", async () => {
    const app = await startGridApp();
    const watched = watch(app);
    const head = find(app, "head");

    expect(app.world.ecs.get(head, Box)).toMatchObject({ y: 0, h: 120 });

    vi.spyOn(app.renderer.viewport, "size").mockReturnValue(TALL);

    const turned = await watched.cost(() => app.time.step(16));

    expect(turned).toMatchObject({ styled: ELEMENTS, solves: 1 });
    expect(turned.written).toBeGreaterThanOrEqual(ELEMENTS);
    // `when.tall` makes the header 160 high, and `safeArea.top` moves it 44 down.
    expect(app.world.ecs.get(head, Box)).toMatchObject({ y: 44, h: 160 });
    expect(app.world.ecs.get(find(app, "gridRoot"), Box)?.h).toBe(TALL.height);

    // The commit after it says the same on the same viewport: nothing.
    rest(app);

    expect(await watched.cost(() => commit(app, "tick"))).toEqual(NOTHING);
    expect(app.world.ecs.get(head, Box)).toMatchObject({ y: 44, h: 160 });

    await app.stop();
  });
});

describe("what a text is measured in changes, with no commit", () => {
  it("gives a `tr()` text without a bind its new width in the frame after a locale switch", async () => {
    const app = await startGridApp();
    const watched = watch(app);
    const title = find(app, "title");
    const label = find(app, "label");
    const rendered = renders.grid;
    const before = app.world.ecs.get(label, Box)?.x ?? 0;

    // "Shop" in the 32 px body style with no font: 4 characters of 0.6 em, rounded up.
    expect(app.world.ecs.get(title, Box)?.w).toBe(77);

    const cost = await watched.cost(async () => {
      await app.i18n.setLocale("de");
      app.time.step(16);
    });

    // "Kaufladen": 9 characters. One frame, one measure, one solve; no view ran, no style pass.
    expect(app.world.ecs.get(title, Text)?.resolved).toBe("Kaufladen");
    expect(app.world.ecs.get(title, Box)?.w).toBe(173);
    expect(app.world.ecs.get(label, Box)?.x).toBe(before + 96);
    expect(cost).toMatchObject({ styled: 0, solves: 1, measured: 1 });
    expect(renders.grid).toBe(rendered);

    // The first commit in the new locale says the same: nothing is styled, solved or written.
    rest(app);

    expect(await watched.cost(() => commit(app, "tick"))).toEqual(NOTHING);
    expect(app.world.ecs.get(title, Box)?.w).toBe(173);

    await app.stop();
  });

  it("measures an auto-sized text with an inline style again when its font arrives late", async () => {
    const app = await startGridApp(createGridApp({ lateFont: true }));
    const watched = watch(app);
    const title = find(app, "title");
    const label = find(app, "label");
    const rendered = renders.grid;

    // Mounted before its font: the 0.6 em fallback and a line of 1.2 em.
    expect(app.assets.isLoaded(LATE_BUNDLE)).toBe(false);
    expect(app.world.ecs.get(title, Box)).toMatchObject({ w: 77, h: 39 });

    const cost = await watched.cost(async () => {
      await app.assets.load(LATE_BUNDLE);
      app.time.step(16);
    });

    // The font is there: "Shop" is 4 glyphs and "for Al" 6, each 30 wide, on a line of 48.
    expect(app.assets.isLoaded(LATE_BUNDLE)).toBe(true);
    expect(app.world.ecs.get(title, Box)).toMatchObject({
      w: 4 * LATE_FONT.advance,
      h: LATE_FONT.lineHeight
    });
    expect(app.world.ecs.get(label, Box)?.w).toBe(6 * LATE_FONT.advance);
    // One frame and one solve; the description was never built again and no element was styled.
    expect(cost).toMatchObject({ styled: 0, solves: 1 });
    expect(renders.grid).toBe(rendered);

    // The next commit says the same and keeps the new rects.
    rest(app);

    expect(await watched.cost(() => commit(app, "tick"))).toMatchObject({
      styled: 0,
      written: 0,
      solves: 0
    });
    expect(app.world.ecs.get(title, Box)?.w).toBe(4 * LATE_FONT.advance);

    await app.stop();
  });
});

describe("a prop that is no plain data", () => {
  it("writes a `local` patch that holds another Set: tap A, then tap B, picks both", async () => {
    const app = await startGridApp(createGridApp(), ["picker"]);
    const picked = find(app, "picked");

    expect(app.world.ecs.get(picked, Text)?.content).toBe("");

    app.input.tap(find(app, "pickA"));
    app.time.step(16);

    expect(app.world.ecs.get(picked, Text)?.content).toBe("a");

    // The patch of B was `{ picked: Set {"b"} }` and is `{ picked: Set {"a", "b"} }` now.
    app.input.tap(find(app, "pickB"));
    app.time.step(16);

    expect(app.world.ecs.get(picked, Text)?.content).toBe("a,b");
    expect(app.ui.tree().local).toEqual({ picked: new Set(["a", "b"]) });

    await app.stop();
  });
});

describe("an icon without a size when the body font arrives late", () => {
  it("is squared on the new line beside a text that grew, with no commit", async () => {
    const app = await startGridApp(createGridApp({ lateFont: true }), ["grid", "icons"]);
    const watched = watch(app);
    const title = find(app, "title");
    const icon = find(app, "autoIcon");
    const rendered = renders.grid;

    // Mounted before the font: one line of the 32 px body style is 1.2 em, rounded up.
    expect(app.world.ecs.get(title, Box)).toMatchObject({ w: 77, h: 39 });
    expect(app.world.ecs.get(icon, Box)).toMatchObject({ w: 39, h: 39 });

    const cost = await watched.cost(async () => {
      await app.assets.load(LATE_BUNDLE);
      app.time.step(16);
    });

    // One frame: the title and the icon follow the line of the font. One solve per root.
    expect(app.world.ecs.get(title, Box)).toMatchObject({
      w: 4 * LATE_FONT.advance,
      h: LATE_FONT.lineHeight
    });
    expect(app.world.ecs.get(icon, Box)).toMatchObject({
      w: LATE_FONT.lineHeight,
      h: LATE_FONT.lineHeight
    });
    expect(app.world.ecs.get(icon, Sprite)).toMatchObject({
      width: LATE_FONT.lineHeight,
      height: LATE_FONT.lineHeight
    });
    expect(cost).toMatchObject({ styled: 0, solves: 2 });
    expect(renders.grid).toBe(rendered);
    // The icon with a fixed size is not measured: it keeps its 32.
    expect(app.world.ecs.get(find(app, "fixedIcon"), Box)).toMatchObject({ w: 32, h: 32 });

    await app.stop();
  });

  it("is squared on the new line on a screen with icons and no text", async () => {
    const app = await startGridApp(createGridApp({ lateFont: true }), ["icons"]);
    const watched = watch(app);
    const icon = find(app, "autoIcon");

    expect(app.world.ecs.get(icon, Box)).toMatchObject({ w: 39, h: 39 });

    const cost = await watched.cost(async () => {
      await app.assets.load(LATE_BUNDLE);
      app.time.step(16);
    });

    expect(app.world.ecs.get(icon, Box)).toMatchObject({
      w: LATE_FONT.lineHeight,
      h: LATE_FONT.lineHeight
    });
    expect(cost).toMatchObject({ styled: 0, solves: 1 });

    // The line stands still from here: an idle frame measures and solves nothing.
    rest(app);

    expect(await watched.cost(() => app.time.step(16))).toMatchObject({ solves: 0, measured: 0 });

    await app.stop();
  });
});

describe("a popup root that becomes covered", () => {
  it("resolves its elements again from the same description, and again when it is uncovered", async () => {
    const app = await startStackApp();

    app.flow.gate.answer({ intent: "openSettings" });
    await settle(app);

    const watched = watch(app);
    const close = find(app, "close");
    const louder = find(app, "louder");

    expect(app.world.ecs.get(close, Shape)?.alpha).toBe(1);
    expect(app.world.ecs.has(louder, Tappable)).toBe(true);

    const covered = await watched.cost(async () => {
      app.input.tap(find(app, "reset"));
      await settle(app);
    });

    // The six elements of the settings resolve `is.covered`; the four of the confirm enter.
    expect(covered.styled).toBe(6 + 4);
    expect(app.world.ecs.get(close, Shape)?.alpha).toBe(0);
    expect(app.world.ecs.has(louder, Tappable)).toBe(false);

    const uncovered = await watched.cost(async () => {
      app.input.tap(find(app, "no"));
      await settle(app);
    });

    expect(uncovered.styled).toBe(6);
    expect(app.world.ecs.get(close, Shape)?.alpha).toBe(1);
    expect(app.world.ecs.has(louder, Tappable)).toBe(true);

    await app.stop();
  });
});
