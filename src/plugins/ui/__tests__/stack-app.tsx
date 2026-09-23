/**
 * @file ui plugin — the app of the delta-4 popup and host tests: a settings popup the flow shows
 * again after every volume step, a confirm popup opened over it, a world projection hosted in a
 * ui slot, and a toggle whose second button is disabled by the first. Real flow runner, plain Bun,
 * inert renderer, real Yoga.
 */
import { createApp, defineGame, guide, projection, Sprite, Transform, type } from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import type { Answer } from "../../flow/gate/types";
import { i18nPlugin } from "../../i18n";
import type { CompiledMessages } from "../../i18n/types";
import { inputPlugin } from "../../input";
import { rendererPlugin } from "../../renderer";
import { scenesPlugin } from "../../scenes";
import { textPlugin } from "../../text";
import { worldPlugin } from "../../world";
import { popup } from "../components";
import { uiPlugin } from "../index";
import { defineComponent } from "../jsx/component";
import type { ElementMotion } from "../jsx/types";

/** The player of the stack fixture: one volume the settings popup shows. */
export type StackPlayer = { volume: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: StackPlayer;
  session: { visits: number };
  assets: string;
  strings: { "stack.title": Record<string, never> };
}>();

/** The one compiled locale of the fixture. */
const english: CompiledMessages = {
  "stack.title": () => [{ kind: "text", text: "stack" }]
};

/** How often the panel of each popup played its enter and its exit motion. */
export const played = { enter: 0, exit: 0 };

/** The motion of both popup panels: it counts, then moves the way a real popup would. */
const countedMotion: ElementMotion = {
  enter: view => {
    played.enter += 1;

    return view.toRest(Transform, { ms: 100 });
  },
  exit: view => {
    played.exit += 1;

    return view.tween(Transform, { y: 500 }, { ms: 100 });
  }
};

/** The settings popup: a local tab, a volume from the props, and three answers. */
export const SettingsPopup = defineComponent("Settings", {
  local: { tab: "audio" },
  outcomes: { volume: type<{ delta: number }>(), reset: type(), close: type() },
  view: (props: { volume: number }, local) => (
    <panel key="settingsPanel" style={{ width: 600, height: 600, gap: 10 }} motion={countedMotion}>
      <button key="tabVideo" local={{ tab: "video" }} style={{ width: 100, height: 60 }} />
      <text
        key="level"
        style={{ width: 200, height: 40 }}
        content={`${local.tab}:${props.volume}`}
      />
      <button
        key="louder"
        intent="volume"
        payload={{ delta: 1 }}
        style={{ width: 100, height: 60 }}
      />
      <button key="reset" intent="reset" style={{ width: 100, height: 60 }} />
      <button
        key="close"
        intent="close"
        style={{ width: 100, height: 60, alpha: 1, is: { covered: { alpha: 0 } } }}
      />
    </panel>
  )
});

/** The confirm popup, opened over the settings. */
export const ConfirmPopup = defineComponent("Confirm", {
  outcomes: { confirm: type(), cancel: type() },
  view: () => (
    <panel key="confirmPanel" style={{ width: 400, height: 300 }} motion={countedMotion}>
      <button key="yes" intent="confirm" style={{ width: 100, height: 60 }} />
      <button key="no" intent="cancel" style={{ width: 100, height: 60 }} />
    </panel>
  )
});

/** A local switch that disables the button next to it. */
export const Toggle = defineComponent("Toggle", {
  local: { off: false },
  view: (_props: object, local) => (
    <column key="toggleRoot" style={{ width: 400, height: 300 }}>
      <button key="lock" local={{ off: !local.off }} style={{ width: 100, height: 100 }} />
      <button
        key="go"
        intent="go"
        state={{ disabled: local.off }}
        style={{ width: 100, height: 100 }}
      />
    </column>
  )
});

/** One token of the hosted world projection. */
type Token = { id: string; x: number };

/** A world projection of two sprites, drawn in the `board` layer unless a ui slot hosts it. */
export const tokens = projection({
  name: "tokens",
  layer: "board",
  from: (): Token[] => [
    { id: "t1", x: 10 },
    { id: "t2", x: 20 }
  ],
  key: (item: Token) => item.id,
  view: (item: Token) => [Sprite({ texture: "ui.coin" }), Transform({ x: item.x, y: 0 })]
});

/** One row of a single-root screen. */
type ScreenItem = { id: string };

/** A screen whose slot hosts the tokens. */
export const slotScreen = projection({
  name: "slotScreen",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "slotScreen" }],
  key: (item: ScreenItem) => item.id,
  view: () => (
    <column key="slotRoot" style={{ width: 1080, height: 1080 }}>
      <stack key="slot" hosts={["tokens"]} style={{ width: 500, height: 500 }} />
    </column>
  )
});

/** A screen with two slots that both name the tokens: the first slot hosts them. */
export const twinSlotScreen = projection({
  name: "twinSlotScreen",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "twinSlotScreen" }],
  key: (item: ScreenItem) => item.id,
  view: () => (
    <column key="twinRoot" style={{ width: 1080, height: 1080 }}>
      <stack key="slotA" hosts={["tokens", "tokens"]} style={{ width: 500, height: 500 }} />
      <stack key="slotB" hosts={["tokens"]} style={{ width: 500, height: 500 }} />
    </column>
  )
});

/** A screen with the toggle. */
export const toggleScreen = projection({
  name: "toggleScreen",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "toggleScreen" }],
  key: (item: ScreenItem) => item.id,
  view: () => <Toggle key="toggle" />
});

/** A sized token: a 100 u sprite anchored on its top-left corner, 50 u into its parent. */
export const sizedTokens = projection({
  name: "sized",
  layer: "board",
  from: (): Token[] => [{ id: "s1", x: 50 }],
  key: (item: Token) => item.id,
  view: (item: Token) => [
    Sprite({ texture: "ui.coin", width: 100, height: 100, anchor: { x: 0, y: 0 } }),
    Transform({ x: item.x, y: item.x })
  ]
});

/** A 500 u board in a 400 u slot, so it is drawn at 0.8; it hosts the sized tokens. */
export const fitSlotScreen = projection({
  name: "fitSlotScreen",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "fitSlotScreen" }],
  key: (item: ScreenItem) => item.id,
  view: () => (
    <column key="fitRoot" style={{ width: 1080, height: 1080 }}>
      <column key="fitSlot" style={{ width: 400, height: 400 }}>
        <stack
          key="fitBoard"
          hosts={["sized"]}
          style={{ width: 500, height: 500, fit: "contain" }}
        />
      </column>
    </column>
  )
});

/** A list centred on the screen, so a new viewport height moves its rect. */
export const listScreen = projection({
  name: "listScreen",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "listScreen" }],
  key: (item: ScreenItem) => item.id,
  view: () => (
    <column key="listRoot" style={{ width: 1080, height: "100%", justify: "center" }}>
      <scroll
        key="list"
        axis="y"
        style={{ width: 400, height: 200, is: { hover: { alpha: 0.9 } } }}
      >
        <column key="rows" style={{ width: 400, height: 800 }} />
      </scroll>
    </column>
  )
});

/** Two clipping elements that name a nine-slice, and one that draws its nine-slice. */
export const clippedScreen = projection({
  name: "clippedScreen",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "clippedScreen" }],
  key: (item: ScreenItem) => item.id,
  view: () => (
    <column key="clipRoot" style={{ width: 1080, height: 1080 }}>
      <column
        key="clipped"
        style={{ width: 200, height: 200, overflow: "hidden", nineSlice: "ui.panel" }}
      />
      <scroll
        key="slicedList"
        axis="y"
        style={{ width: 200, height: 200, nineSlice: "ui.strip" }}
      />
      <row key="sliced" style={{ width: 200, height: 200, nineSlice: "ui.strip" }} />
    </column>
  )
});

/** What the `hold` effect of the closing node waits for. */
export const hold = { release: (): void => undefined };

const home = defineNode({
  rest: true,
  outcomes: { openSettings: type(), go: type(), teachSized: type() }
});

const teachSized = defineNode({
  outcomes: { ok: type() },
  run: async ({ fx, out }) => {
    await fx(guide({ allow: { intent: "ok" }, target: { projection: "sized", key: "s1" } }));
    await fx({ kind: "pause", answers: ["ok"] });

    return out.ok();
  }
});

const settings = defineNode({
  rest: true,
  outcomes: { volume: type<{ delta: number }>(), reset: type(), close: type() },
  run: async ({ player, fx, out }) => {
    const answer = (await fx(popup(SettingsPopup, { volume: player.volume }))) as
      | Answer
      | undefined;

    if (answer?.intent === "volume") return out.volume({ delta: 1 });
    if (answer?.intent === "reset") return out.reset();

    return out.close();
  }
});

const louder = defineNode({
  input: type<{ delta: number }>(),
  outcomes: { done: type() },
  run: ({ input, player, out }) => {
    player.volume += input.delta;

    return out.done();
  }
});

const confirmReset = defineNode({
  outcomes: { confirm: type(), cancel: type() },
  run: async ({ fx, out }) => {
    const answer = (await fx(popup(ConfirmPopup, {}, { over: "Settings" }))) as Answer | undefined;

    return answer?.intent === "confirm" ? out.confirm() : out.cancel();
  }
});

const doReset = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.volume = 0;

    return out.done();
  }
});

const closing = defineNode({
  outcomes: { done: type() },
  run: async ({ fx, out }) => {
    await fx({ kind: "hold" });

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, settings, louder, confirmReset, doReset, closing, teachSized },
  start: "home",
  outcomes: {},
  edges: {
    home: { openSettings: "settings", go: "home", teachSized: "teachSized" },
    settings: { volume: "louder", reset: "confirmReset", close: "closing" },
    louder: { done: "settings" },
    confirmReset: { confirm: "doReset", cancel: "settings" },
    doReset: { done: "home" },
    closing: { done: "home" },
    teachSized: { ok: "home" }
  }
});

/** The feature of the stack fixture. */
export const stackFeature = defineFeature("stack", {
  flows: [main],
  projections: [
    tokens,
    slotScreen,
    twinSlotScreen,
    toggleScreen,
    sizedTokens,
    fitSlotScreen,
    listScreen,
    clippedScreen
  ],
  ui: [SettingsPopup, ConfirmPopup, Toggle],
  strings: { en: english }
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
export async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the screen set plus `ui` headless, with the flow resting on `home`.
 *
 * @returns The started app, one frame in.
 */
export async function startStackApp() {
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
      stackFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { volume: 3 }, initialSession: { visits: 0 }, seed: 1 }
    }
  });

  played.enter = 0;
  played.exit = 0;
  hold.release = () => undefined;

  await app.start();
  app.flow.fx.handle("hold", () => new Promise<void>(resolve => (hold.release = resolve)));
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([
    { name: "board", sort: "order" },
    { name: "ui", sort: "order" }
  ]);
  app.time.step(16);

  return app;
}

/** The app `startStackApp` builds. */
export type StackApp = Awaited<ReturnType<typeof startStackApp>>;

/**
 * Lets the runner move, then runs frames, so the next node is entered and the screen follows.
 *
 * @param app - The running app.
 * @param frames - How many frames to step after the runner moved.
 */
export async function settle(app: StackApp, frames = 2): Promise<void> {
  await tick();

  for (let frame = 0; frame < frames; frame += 1) app.time.step(16);
}
