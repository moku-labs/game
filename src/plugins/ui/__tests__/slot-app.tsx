/**
 * @file ui plugin — the app of the JSX slot tests (spec 16 U3). Not a test file. On the fake DOM and the fake Pixi
 * of the renderer's tests, so `sync` builds a real display tree and the hit test walks it. The screen `slot.host`
 * holds a padded slot that hosts the JSX projection `slot.row` while a local flag says so, a twin slot that may name
 * it too, and the buttons that flip the flags; `slot.row` is one row with a button. `cycle.a` and `cycle.b` host each
 * other. The node `teachRow` points a guide at the button of the row. Every screen is mounted by hand.
 */
import { createApp, defineGame, guide, projection, screen, type } from "../../../index";
import { defineMotion } from "../../anim/motion";
import type { Manifest } from "../../assets/types";
import type { CompiledMessages } from "../../i18n/types";
import { type FakeDom, installFakeDom } from "../../renderer/__tests__/fake-dom";
import { createFakePixi, type FakePixi, FakeTexture } from "../../renderer/__tests__/fake-pixi";
import { defineComponent } from "../jsx/component";
import type { ElementMotion } from "../jsx/types";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { n: number };
  session: Record<string, never>;
  assets: string;
  strings: { "slot.title": Record<string, never> };
}>();

/** The one compiled locale of the fixture. */
const english: CompiledMessages = {
  "slot.title": () => [{ kind: "text", text: "slot" }]
};

/** The manifest of the fixture: no bundle at all. */
const manifest: Manifest = { version: 2, bundles: {} };

/** How often the root of the row played a `change.Box` motion. */
export const rowChanges = { box: 0 };

/** The motion of the row's root: it counts every `change.Box` and moves nothing. */
const rowMotion: ElementMotion = {
  change: {
    Box: () => {
      rowChanges.box += 1;

      return undefined;
    }
  }
};

/** The exit of the slot: it shrinks for 160 ms before it goes. */
const slotMotion = defineMotion({
  states: { gone: { Transform: { scale: 0.5 } } },
  transition: { ms: 160 },
  on: { exit: "gone" }
});

/** A small button of the host screen, at a place of its own on the bottom row. */
function flagButton(key: string, left: number, local: Record<string, boolean>) {
  return (
    <button
      key={key}
      local={local}
      style={{ position: "absolute", top: 1700, left, width: 100, height: 100, reason: "flag" }}
    />
  );
}

/**
 * The host screen: the padded slot `rowSlot` that hosts `slot.row` while `named` holds, 600 wide
 * or 800 once `wide`, gone once `gone`; the twin slot that names `slot.row` too once `twin`; and
 * the four buttons that set those flags.
 */
export const SlotHost = defineComponent("SlotHost", {
  local: { named: true, wide: false, gone: false, twin: false },
  view: (_props: object, local) => (
    <stack key="hostRoot" style={{ width: 1080, height: 1920 }}>
      {local.gone ? undefined : (
        <stack
          key="rowSlot"
          hosts={local.named ? ["slot.row"] : []}
          motion={slotMotion}
          style={{
            position: "absolute",
            top: 400,
            left: 100,
            width: local.wide ? 800 : 600,
            height: 300,
            padding: { top: 20, left: 30, right: 30, bottom: 20 },
            reason: "slot"
          }}
        />
      )}
      <stack
        key="twinSlot"
        hosts={local.twin ? ["slot.row"] : []}
        style={{
          position: "absolute",
          top: 1000,
          left: 100,
          width: 400,
          height: 200,
          reason: "twin"
        }}
      />
      {flagButton("unname", 0, { named: false })}
      {flagButton("widen", 120, { wide: true })}
      {flagButton("remove", 240, { gone: true })}
      {flagButton("twin", 360, { twin: true })}
    </stack>
  )
});

/** The screen of the host, mounted by hand. */
export const slotHost = projection({
  name: "slot.host",
  layer: "ui",
  from: () => ({ id: "host" }),
  view: () => <SlotHost key="host" />
});

/** The row a slot hosts: it fills the content box it is laid out in, a button at its start. */
export const slotRow = projection({
  name: "slot.row",
  layer: "ui",
  from: () => ({ id: "row" }),
  view: () => (
    <row key="slotRowRoot" style={{ width: "100%", height: "100%" }} motion={rowMotion}>
      <button key="slotButton" intent="row" style={{ width: 100, height: 100 }} />
    </row>
  )
});

/** A screen whose slot hosts `cycle.b`. */
export const cycleA = projection({
  name: "cycle.a",
  layer: "ui",
  from: () => ({ id: "a" }),
  view: () => (
    <stack key="cycleARoot" style={{ width: 300, height: 300 }}>
      <stack key="holdsB" hosts={["cycle.b"]} style={{ width: 200, height: 200 }} />
    </stack>
  )
});

/** A screen whose slot hosts `cycle.a`: each of the two is laid out in the other. */
export const cycleB = projection({
  name: "cycle.b",
  layer: "ui",
  from: () => ({ id: "b" }),
  view: () => (
    <stack key="cycleBRoot" style={{ width: 300, height: 300 }}>
      <stack key="holdsA" hosts={["cycle.a"]} style={{ width: 200, height: 200 }} />
    </stack>
  )
});

const home = defineNode({ rest: true, outcomes: { teach: type(), row: type() } });

const teachRow = defineNode({
  outcomes: { ok: type() },
  run: async ({ fx, out }) => {
    await fx(
      guide({ allow: { intent: "ok" }, target: { projection: "slot.row", key: "slotButton" } })
    );
    await fx({ kind: "pause", answers: ["ok"] });

    return out.ok();
  }
});

const main = defineFlow("main", {
  nodes: { home, teachRow },
  start: "home",
  outcomes: {},
  edges: { home: { teach: "teachRow", row: "home" }, teachRow: { ok: "home" } }
});

/** The feature of the slot fixture. */
export const slotFeature = defineFeature("slots", {
  flows: [main],
  projections: [slotHost, slotRow, cycleA, cycleB],
  ui: [SlotHost],
  strings: { en: english }
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
export async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the screen set plus the slot feature on the fake page, resting at `home`, with no screen
 * mounted. The fake page stubs globals: the test takes them down with `vi.unstubAllGlobals()`.
 *
 * @returns The started app, its page and its Pixi.
 */
export async function startSlotApp() {
  const dom: FakeDom = installFakeDom({ width: 1080, height: 1920 });
  const pixi: FakePixi = createFakePixi();
  const app = createApp({
    plugins: [...screen, slotFeature],
    pluginConfigs: {
      assets: { manifest },
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      log: { mode: "test" },
      model: { initialPlayer: { n: 0 }, initialSession: {}, seed: 1 },
      renderer: { mount: "#game", loadPixi: () => Promise.resolve(pixi.module) }
    }
  });

  rowChanges.box = 0;
  await app.start();
  app.renderer.sync.textures.provide(() => new FakeTexture({}) as never);
  app.flow.run().catch(() => undefined);
  await tick();
  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.time.step(16);

  return { app, dom, pixi };
}

/** The app `startSlotApp` builds. */
export type SlotApp = Awaited<ReturnType<typeof startSlotApp>>["app"];

/**
 * Mounts screens by hand, the way a scene mounts its projections, and runs their first frame.
 *
 * @param app - The running app.
 * @param names - The projections, in draw order.
 */
export function mountScreens(app: SlotApp, names: readonly string[]): void {
  app.world.projection.mount(names, { kind: "plugin", name: "test" });
  app.time.step(16);
}
