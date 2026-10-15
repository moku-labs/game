import { describe, expect, it } from "vitest";
import { createApp, defineGame, projection } from "../../../../index";
import { animPlugin } from "../../../anim";
import { defineMotion } from "../../../anim/motion";
import { assetsPlugin } from "../../../assets";
import { i18nPlugin } from "../../../i18n";
import { inputPlugin } from "../../../input";
import { rendererPlugin } from "../../../renderer";
import { Overlay, OverlayLevel } from "../../../renderer/components";
import { scenesPlugin } from "../../../scenes";
import { textPlugin } from "../../../text";
import { worldPlugin } from "../../../world";
import type { Entity } from "../../../world/types";
import { uiPlugin } from "../../index";
import { defineComponent } from "../../jsx/component";

// ---------------------------------------------------------------------------
// Unit test: ui writes the level and the landing of overlays (spec 22 O4, LEAD-FIXES-4 item 5a). The level follows
// the root's own enter and exit motion; `fade` times it when the root has none; the exit waits for it. Headless app,
// real anim driver, frames of 10 ms.
// ---------------------------------------------------------------------------

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { n: number };
  session: Record<string, never>;
  assets: string;
  strings: Record<string, never>;
}>();

/** The enter and exit of the moving sheet: a 300 ms fade of its shape. */
const sheetMotion = defineMotion({
  states: { hidden: { Shape: { alpha: 0 } } },
  transition: { ms: 300, ease: "linear" },
  on: { enter: "hidden", exit: "hidden" }
});

/** A button's box. */
const control = { width: 60, height: 60 } as const;

/** The sheets of the fixture: one with its own motion, one with none, one with fade 0, each switched by a button. */
const Sheets = defineComponent("Sheets", {
  local: { moving: false, still: false, instant: false, tone: 0 },
  view: (_props: object, local) => (
    <column key="sheetsRoot" style={{ width: 800, height: 800 }}>
      {local.moving ? (
        <panel
          key="moving"
          motion={sheetMotion}
          style={{ width: 100, height: 100, fill: 0x22_22_22 }}
          components={[Overlay({ dim: 0.5, fade: 120 })]}
        />
      ) : undefined}
      {local.still ? (
        <panel
          key="still"
          style={{ width: 100, height: 100, fill: local.tone === 0 ? 0x11_11_11 : 0x33_33_33 }}
          components={[Overlay({ dim: 0.5, fade: 120 })]}
        />
      ) : undefined}
      {local.instant ? (
        <panel
          key="instant"
          style={{ width: 100, height: 100 }}
          components={[Overlay({ fade: 0 })]}
        />
      ) : undefined}
      <button key="showMoving" local={{ moving: true }} style={control} />
      <button key="hideMoving" local={{ moving: false }} style={control} />
      <button key="showStill" local={{ still: true }} style={control} />
      <button key="hideStill" local={{ still: false }} style={control} />
      <button key="showInstant" local={{ instant: true }} style={control} />
      <button key="retone" local={{ tone: 1 }} style={control} />
    </column>
  )
});

const sheetsScreen = projection({
  name: "test.sheets",
  layer: "ui",
  from: () => ({ id: "sheets" }),
  view: () => <Sheets />
});

const home = defineNode({ rest: true, outcomes: {} });
const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: {},
  edges: { home: {} }
});
const sheetsFeature = defineFeature("sheets", {
  flows: [main],
  projections: [sheetsScreen],
  ui: [Sheets]
});

/**
 * Yields the microtask queue to the loop.
 *
 * @param times - How many turns.
 */
async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the fixture headless with the sheets mounted.
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
      sheetsFeature
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
  app.world.projection.mount(["test.sheets"], { kind: "plugin", name: "test" });
  app.time.step(10);
  app.time.step(10);

  return app;
}

type App = Awaited<ReturnType<typeof start>>;

/**
 * The entity of a keyed element.
 *
 * @param app - The running app.
 * @param key - The element's key.
 * @returns The entity, or `undefined`.
 */
function keyed(app: App, key: string): Entity | undefined {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  return app.ui.find(key);
}

/**
 * Taps a button of the fixture and runs the frame its local write lands in, and the reconcile after it.
 *
 * @param app - The running app.
 * @param key - The button's key.
 */
function tap(app: App, key: string): void {
  const entity = keyed(app, key);

  if (entity === undefined) throw new Error(`no ${key}`);

  app.input.tap(entity);
  app.time.step(10);
  app.time.step(10);
}

/**
 * Runs frames of 10 ms.
 *
 * @param app - The running app.
 * @param ms - How long.
 */
function run(app: App, ms: number): void {
  for (let elapsed = 0; elapsed < ms; elapsed += 10) app.time.step(10);
}

/**
 * The engine's level and landing of a keyed overlay.
 *
 * @param app - The running app.
 * @param key - The overlay's key.
 * @returns Its entity and its `OverlayLevel`.
 */
function levelOf(
  app: App,
  key: string
): { entity: Entity | undefined; level?: number; landed?: boolean } {
  const entity = keyed(app, key);
  const value = entity === undefined ? undefined : app.world.ecs.get(entity, OverlayLevel);

  return { entity, ...(value === undefined ? {} : { level: value.level, landed: value.landed }) };
}

describe("ui — the level and the landing of overlays", () => {
  it("the level follows the root's own enter motion for its length and lands at 1 when it is over", async () => {
    const app = await start();

    tap(app, "showMoving");
    run(app, 140);

    // The root's motion is 300 ms long: past fade's 120 ms, the level is still on its way.
    const midway = levelOf(app, "moving");

    expect(midway.level).toBeGreaterThan(0.2);
    expect(midway.level).toBeLessThan(0.8);
    expect(midway.landed).toBe(false);

    run(app, 200);

    expect(levelOf(app, "moving")).toMatchObject({ level: 1, landed: true });
  });

  it("a root with no motion is followed over fade", async () => {
    const app = await start();

    tap(app, "showStill");
    run(app, 40);

    const midway = levelOf(app, "still");

    expect(midway.level).toBeGreaterThan(0);
    expect(midway.level).toBeLessThan(1);
    expect(midway.landed).toBe(false);

    run(app, 120);

    expect(levelOf(app, "still")).toMatchObject({ level: 1, landed: true });
  });

  it("fade 0 sets the level at once and lands at the next solve", async () => {
    const app = await start();

    tap(app, "showInstant");

    expect(levelOf(app, "instant")).toMatchObject({ level: 1, landed: true });
  });

  it("the exit takes the level back to 0 with the exit motion, and the element despawns only after it", async () => {
    const app = await start();

    tap(app, "showMoving");
    run(app, 400);

    const { entity } = levelOf(app, "moving");

    if (entity === undefined) throw new Error("no sheet");

    tap(app, "hideMoving");
    run(app, 140);

    const level = app.world.ecs.get(entity, OverlayLevel)?.level ?? -1;

    expect(app.world.ecs.has(entity, OverlayLevel)).toBe(true);
    expect(level).toBeGreaterThan(0.2);
    expect(level).toBeLessThan(0.8);

    run(app, 300);

    expect(app.world.ecs.has(entity, OverlayLevel)).toBe(false);
  });

  it("a re-render of a landed overlay keeps its level and its landing", async () => {
    const app = await start();

    tap(app, "showStill");
    run(app, 200);
    tap(app, "retone");
    run(app, 20);

    expect(levelOf(app, "still")).toMatchObject({ level: 1, landed: true });
  });

  it("the marker is read in the frame the element spawns: the level starts moving in the next frame", async () => {
    const app = await start();
    const entity = app.ui.find("showStill");

    if (entity === undefined) throw new Error("no button");

    app.input.tap(entity);
    app.time.step(10);
    app.time.step(10);

    const first = levelOf(app, "still");

    app.time.step(10);

    expect(first.level).toBeDefined();
    expect(levelOf(app, "still").level).toBeGreaterThan(first.level ?? 1);
  });
});
