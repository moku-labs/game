import { describe, expect, it } from "vitest";
import { createApp, defineGame, projection } from "../../../../index";
import { animPlugin } from "../../../anim";
import { assetsPlugin } from "../../../assets";
import { i18nPlugin } from "../../../i18n";
import { inputPlugin } from "../../../input";
import { rendererPlugin } from "../../../renderer";
import { FakeGraphics } from "../../../renderer/__tests__/fake-pixi";
import { Shape } from "../../../renderer/components";
import { paintShape } from "../../../renderer/sync/shape-path";
import type { PixiGraphics } from "../../../renderer/types";
import { scenesPlugin } from "../../../scenes";
import { textPlugin } from "../../../text";
import { worldPlugin } from "../../../world";
import { uiPlugin } from "../../index";
import { defineComponent } from "../../jsx/component";
import { defineStyle } from "../../styles/define";

// ---------------------------------------------------------------------------
// Integration: the style vocabulary's arc (F30) on a headless app. A slot timer's ring is a `stack` styled
// `shape: "arc"`; the share of time left is its `sweep`, and a render with another share patches its `Shape`.
// ---------------------------------------------------------------------------

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { n: number };
  session: Record<string, never>;
  assets: string;
  strings: Record<string, never>;
}>();

/** The ring of the slot timer, as the game writes it. */
const ring = defineStyle({
  shape: "arc",
  stroke: 0xc8_a1_5a,
  strokeWidth: 2.2,
  cap: "round",
  width: 28,
  height: 28
});

/**
 * The timer: 42 of 100 seconds left, a button that lets the clock run on to 50 left, one that turns the ring into a
 * rectangle, and one that turns it back into a ring that names no share (`left` below 0).
 */
const Timer = defineComponent("Timer", {
  local: { left: 42, rect: false },
  view: (_props: object, local) => (
    <column key="timerRoot" style={{ width: 400, height: 400 }}>
      <stack
        key="slotTimer"
        style={{
          ...ring,
          shape: local.rect ? "rect" : "arc",
          ...(local.left < 0 ? {} : { sweep: local.left / 100 })
        }}
      />
      <button key="rewind" local={{ left: 50 }} style={{ width: 60, height: 60 }} />
      <button key="toRect" local={{ rect: true }} style={{ width: 60, height: 60 }} />
      <button key="toRing" local={{ rect: false, left: -1 }} style={{ width: 60, height: 60 }} />
    </column>
  )
});

const timerScreen = projection({
  name: "test.timer",
  layer: "ui",
  from: () => ({ id: "timer" }),
  view: () => <Timer />
});

const home = defineNode({ rest: true, outcomes: {} });
const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: {},
  edges: { home: {} }
});
const timerFeature = defineFeature("timer", {
  flows: [main],
  projections: [timerScreen],
  ui: [Timer]
});

/** Yields the microtask queue to the loop. */
async function tick(): Promise<void> {
  for (let index = 0; index < 60; index += 1) await Promise.resolve();
}

/**
 * Starts the fixture headless with the timer mounted.
 *
 * @returns The started app.
 */
async function start() {
  const app = createApp({
    plugins: [
      worldPlugin,
      rendererPlugin,
      inputPlugin,
      assetsPlugin,
      scenesPlugin,
      animPlugin,
      i18nPlugin,
      textPlugin,
      uiPlugin,
      timerFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { n: 0 }, initialSession: {}, seed: 1 }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();
  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.world.projection.mount(["test.timer"], { kind: "plugin", name: "test" });
  app.time.step(10);
  app.time.step(10);

  return app;
}

describe("an arc in the style vocabulary", () => {
  // Bug: the style's arc reaches the Shape as a rectangle, without its share or its ends, or a render with a new share
  // leaves the ring at its first one.
  it("writes the arc, its sweep and its cap into the Shape, and patches the sweep of a new render", async () => {
    const app = await start();
    const timer = app.ui.find("slotTimer") ?? 0;

    expect(app.world.ecs.get(timer, Shape)).toMatchObject({
      kind: "arc",
      w: 28,
      h: 28,
      stroke: 0xc8_a1_5a,
      strokeWidth: 2.2,
      sweep: 0.42,
      cap: "round"
    });

    app.input.tap(app.ui.find("rewind") ?? 0);
    app.time.step(10);
    app.time.step(10);

    expect(app.ui.find("slotTimer")).toBe(timer);
    expect(app.world.ecs.get(timer, Shape)).toMatchObject({
      kind: "arc",
      sweep: 0.5,
      cap: "round"
    });

    await app.stop();
  });

  // Bug: a ring that follows a rectangle keeps the share an earlier arc left on the merged `Shape` instead of a whole
  // ring, or a rectangle that follows an arc draws the arc's stroke from the share left on it.
  it("writes sweep 1 again for a ring after a rectangle, and the rectangle between draws as a rectangle", async () => {
    const app = await start();
    const timer = app.ui.find("slotTimer") ?? 0;

    app.input.tap(app.ui.find("toRect") ?? 0);
    app.time.step(10);
    app.time.step(10);

    const rect = app.world.ecs.get(timer, Shape);

    expect(rect).toMatchObject({ kind: "rect", w: 28, h: 28, sweep: 0.42 });

    const graphics = new FakeGraphics();

    if (rect !== undefined) paintShape(graphics as unknown as PixiGraphics, rect, 0xff_ff_ff);

    expect(graphics.ops).toEqual([{ op: "rect", x: 0, y: 0, width: 28, height: 28, radius: 0 }]);
    expect(graphics.strokes).toMatchObject([{ color: 0xc8_a1_5a, width: 2.2 }]);

    app.input.tap(app.ui.find("toRing") ?? 0);
    app.time.step(10);
    app.time.step(10);

    expect(app.ui.find("slotTimer")).toBe(timer);
    expect(app.world.ecs.get(timer, Shape)).toMatchObject({ kind: "arc", sweep: 1, cap: "round" });

    await app.stop();
  });
});
