import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, projection } from "../../../../index";
import { animPlugin } from "../../../anim";
import { assetsPlugin } from "../../../assets";
import { i18nPlugin } from "../../../i18n";
import { inputPlugin } from "../../../input";
import { rendererPlugin } from "../../../renderer";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import { stagePixi } from "../../../renderer/__tests__/stage-pixi";
import { Overlay, type OverlayValue } from "../../../renderer/components";
import { scenesPlugin } from "../../../scenes";
import { textPlugin } from "../../../text";
import { worldPlugin } from "../../../world";
import { uiPlugin } from "../../index";
import { defineComponent } from "../../jsx/component";

// ---------------------------------------------------------------------------
// Integration: an `Overlay` whose `hudReturn` a render drops (F240). ui patches a live extra with `ecs.set`, a shallow
// merge, so without care the entity keeps the field the render no longer declares and the renderer starts its return
// at the leave. The app draws on the real Pixi with a stand-in GPU, so the overlay step runs and `debug.overlays()` reports a run.
// ---------------------------------------------------------------------------

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { n: number };
  session: Record<string, never>;
  assets: string;
  strings: Record<string, never>;
}>();

/** The splash's own value; `returns` adds a return of the HUD 1100 ms after its leave, over 700 ms. */
const SPLASH: Partial<OverlayValue> = { hud: "none", fade: 120 };
const SPLASH_RETURNING: Partial<OverlayValue> = {
  ...SPLASH,
  hudReturn: { delayMs: 1100, fadeMs: 700 }
};

/** A button's box. */
const control = { width: 60, height: 60 } as const;

/** The splash, its return switched by a button, and the buttons that open and close it. */
const Splash = defineComponent("Splash", {
  local: { open: false, returns: true },
  view: (_props: object, local) => (
    <column key="splashRoot" style={{ width: 800, height: 800 }}>
      {local.open ? (
        <panel
          key="splash"
          style={{ width: 100, height: 100 }}
          components={[Overlay(local.returns ? SPLASH_RETURNING : SPLASH)]}
        />
      ) : undefined}
      <button key="open" local={{ open: true }} style={control} />
      <button key="dropReturn" local={{ returns: false }} style={control} />
      <button key="close" local={{ open: false }} style={control} />
    </column>
  )
});

const splashScreen = projection({
  name: "test.splash",
  layer: "ui",
  from: () => ({ id: "splash" }),
  view: () => <Splash />
});

const home = defineNode({ rest: true, outcomes: {} });
const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: {},
  edges: { home: {} }
});
const splashFeature = defineFeature("splash", {
  flows: [main],
  projections: [splashScreen],
  ui: [Splash]
});

afterEach(() => {
  vi.unstubAllGlobals();
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
 * Starts the fixture on the fake page, over the real Pixi, with the splash screen mounted in the `ui` layer.
 *
 * @returns The started app.
 */
async function start() {
  installFakeDom({ width: 1080, height: 1920 });

  const pixi = stagePixi();
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
      splashFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { n: 0 }, initialSession: {}, seed: 1 },
      renderer: {
        mount: "#game",
        loadPixi: () => Promise.resolve(pixi.module),
        onDemand: true,
        warm: 0
      }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();
  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.world.projection.mount(["test.splash"], { kind: "plugin", name: "test" });
  run(app, 20);

  return app;
}

type App = Awaited<ReturnType<typeof start>>;

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
 * Taps a button of the fixture and runs the frames its local write and the reconcile after it land in.
 *
 * @param app - The running app.
 * @param key - The button's key.
 */
function tap(app: App, key: string): void {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key);

  if (entity === undefined) throw new Error(`no ${key}`);

  app.input.tap(entity);
  run(app, 20);
}

/**
 * Opens the splash, lands it, optionally renders it again without its return, then starts its leave.
 *
 * @param app - The running app.
 * @param drop - Render it again without `hudReturn` before the leave.
 * @returns The splash's entity, and its line of `debug.overlays()` in its leave.
 */
function leaveOf(app: App, drop: boolean) {
  tap(app, "open");
  run(app, 200);
  if (drop) tap(app, "dropReturn");

  const splash = app.ui.find("splash");

  tap(app, "close");

  return {
    splash,
    line: app.renderer.sync.debug.overlays().find(line => line.phase === "exiting")
  };
}

describe("ui — an overlay's hudReturn a render drops", () => {
  // Control: the fixture reaches the overlay step, so a kept `hudReturn` starts a run the report shows.
  it("starts the return at the leave while the render keeps hudReturn", async () => {
    const app = await start();

    expect(leaveOf(app, false).line?.hudReturn).toMatchObject({ delayMs: 1100, fadeMs: 700 });
    await app.stop();
  });

  // Bug: ui patches the live extra with `ecs.set` (a shallow merge): the dropped `hudReturn` stays on the entity and the
  // HUD waits 1100 ms after a leave whose render no longer asks for it.
  it("starts no return once a render drops hudReturn, and the entity no longer carries it", async () => {
    const app = await start();
    const { splash, line } = leaveOf(app, true);

    expect(line?.phase).toBe("exiting");
    expect(line?.hudReturn).toBeUndefined();
    expect(
      splash === undefined ? "no splash" : app.world.ecs.get(splash, Overlay)?.hudReturn
    ).toBeUndefined();
    await app.stop();
  });
});
