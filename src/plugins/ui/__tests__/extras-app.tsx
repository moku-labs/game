/**
 * @file ui plugin — the app of the `components` prop tests (Delta 8a): a test component and a
 * test tag that stand in for any game component, a screen that adds, changes and drops them, a
 * button that names components the element owns, an element that leaves with an exit motion,
 * every tag once, and a popup the flow shows again with a new level. Real flow runner, plain Bun,
 * inert renderer, real Yoga. Nothing here imports `effects`.
 */
import { createApp, defineGame, projection, type } from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import type { Answer } from "../../flow/gate/types";
import { i18nPlugin } from "../../i18n";
import type { CompiledMessages } from "../../i18n/types";
import { inputPlugin } from "../../input";
import { rendererPlugin } from "../../renderer";
import { Shape, Transform } from "../../renderer/components";
import { scenesPlugin } from "../../scenes";
import { textPlugin } from "../../text";
import { worldPlugin } from "../../world";
import { component, Order, tag } from "../../world/ecs/define";
import { popup } from "../components";
import { uiPlugin } from "../index";
import { defineComponent } from "../jsx/component";
import type { ElementComponents } from "../jsx/intrinsics";
import type { ElementMotion } from "../jsx/types";

/** A game's own component, as `Glow` would be: one field a re-render may change. */
export const Mark = component("Mark", { level: 0 });

/** A game's own tag, as `Held` is: no data. */
export const Flag = tag("Flag");

/** The player of the extras fixture: the level the popup button carries. */
export type ExtrasPlayer = { level: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: ExtrasPlayer;
  session: { visits: number };
  assets: string;
  strings: { "extras.title": Record<string, never> };
}>();

/** The one compiled locale of the fixture. */
const english: CompiledMessages = {
  "extras.title": () => [{ kind: "text", text: "extras" }]
};

/** The size of every control button of the fixture. */
const control = { width: 100, height: 60 } as const;

/** What the marked button's extras follow: the level, whether `Mark` is listed, whether any is. */
type MarkedLocal = { level: number; mark: boolean; listed: boolean };

/**
 * The `components` prop of the marked button: `Mark` and `Flag`, `Flag` alone, or no prop at all.
 *
 * @param local - The local state of the marked component.
 * @returns The prop to spread on the button.
 */
function markedExtras(local: MarkedLocal): { components?: ElementComponents } {
  if (!local.listed) return {};

  return { components: local.mark ? [Mark({ level: local.level }), Flag()] : [Flag()] };
}

/** A screen whose button carries a test component and a test tag its local state changes. */
export const Marked = defineComponent("Marked", {
  local: { level: 2, mark: true, listed: true, shown: true, renders: 0 },
  view: (_props: object, local) => (
    <column key="markedRoot" style={{ width: 800, height: 800 }}>
      {local.shown ? (
        <button
          key="b"
          intent="go"
          style={{ width: 100, height: 100, fill: 0x22_22_22 }}
          {...markedExtras(local)}
        />
      ) : undefined}
      <button key="toFive" local={{ level: 5 }} style={control} />
      <button key="again" local={{ renders: local.renders + 1 }} style={control} />
      <button key="dropMark" local={{ mark: false }} style={control} />
      <button key="addMark" local={{ mark: true }} style={control} />
      <button key="dropAll" local={{ listed: false }} style={control} />
      <button key="hide" local={{ shown: false }} style={control} />
      <button key="show" local={{ shown: true }} style={control} />
    </column>
  )
});

/** A button that names two components its element owns next to one of its own, and a row that names one without a key. */
export const Clash = defineComponent("Clash", {
  local: { renders: 0 },
  view: (_props: object, local) => (
    <column key="clashRoot" style={{ width: 600, height: 600 }}>
      <button
        key="owner"
        intent="go"
        style={{ width: 100, height: 100, fill: 0x11_11_11 }}
        components={[Transform({ x: 10 }), Shape({ fill: 0xff_00_00 }), Mark({ level: 3 })]}
      />
      <row style={{ width: 50, height: 50 }} components={[Order({ value: 4 })]} />
      <button key="clashAgain" local={{ renders: local.renders + 1 }} style={control} />
    </column>
  )
});

/** How long the leaving row takes to slide out, in ms. */
export const leaveMs = 300;

/** The exit motion of the leaving row. */
const leaveMotion: ElementMotion = {
  exit: view => view.tween(Transform, { y: 500 }, { ms: leaveMs })
};

/** A row that slides out when its local switch turns it off, carrying `Mark` all the way. */
export const Leaving = defineComponent("Leaving", {
  local: { shown: true },
  view: (_props: object, local) => (
    <column key="leavingRoot" style={{ width: 600, height: 600 }}>
      {local.shown ? (
        <row
          key="leaver"
          style={{ width: 100, height: 100 }}
          motion={leaveMotion}
          components={[Mark({ level: 7 })]}
        />
      ) : undefined}
      <button key="leave" local={{ shown: false }} style={control} />
    </column>
  )
});

/** The tags of `UiIntrinsicElements` the every-tag screen writes; `input` arrives in wave B. */
export const TAGS = [
  "screen",
  "layer",
  "row",
  "column",
  "stack",
  "spacer",
  "panel",
  "image",
  "icon",
  "text",
  "button",
  "scroll"
] as const;

/** The extras every tag of the every-tag screen carries. */
const tagExtras: ElementComponents = [Mark({ level: 1 })];

/** The box of every element of the every-tag screen. */
const tagBox = { width: 100, height: 100 } as const;

/** One row of a single-root screen. */
type ScreenItem = { id: string };

/** Every tag once, each with `Mark`; the scroll holds one column of content. */
export const everyTagScreen = projection({
  name: "everyTag",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "everyTag" }],
  key: (item: ScreenItem) => item.id,
  view: () => (
    <column key="tagRoot" style={{ width: 1080, height: 1800 }}>
      <screen key="tag-screen" style={tagBox} components={tagExtras} />
      <layer key="tag-layer" style={tagBox} components={tagExtras} />
      <row key="tag-row" style={tagBox} components={tagExtras} />
      <column key="tag-column" style={tagBox} components={tagExtras} />
      <stack key="tag-stack" style={tagBox} components={tagExtras} />
      <spacer key="tag-spacer" style={tagBox} components={tagExtras} />
      <panel key="tag-panel" style={tagBox} components={tagExtras} />
      <image key="tag-image" texture="ui.coin" style={tagBox} components={tagExtras} />
      <icon key="tag-icon" name="ui.gear" style={tagBox} components={tagExtras} />
      <text
        key="tag-text"
        content="marked"
        style={{ width: 100, height: 40 }}
        components={tagExtras}
      />
      <button key="tag-button" intent="go" style={tagBox} components={tagExtras} />
      <scroll key="tag-scroll" axis="y" style={tagBox} components={tagExtras}>
        <column key="tagRows" style={{ width: 100, height: 400 }} />
      </scroll>
    </column>
  )
});

/** A screen with the marked component. */
export const markedScreen = projection({
  name: "markedScreen",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "markedScreen" }],
  key: (item: ScreenItem) => item.id,
  view: () => <Marked key="marked" />
});

/** A screen with the clashing button. */
export const clashScreen = projection({
  name: "clashScreen",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "clashScreen" }],
  key: (item: ScreenItem) => item.id,
  view: () => <Clash key="clash" />
});

/** A screen with the leaving row. */
export const leavingScreen = projection({
  name: "leavingScreen",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "leavingScreen" }],
  key: (item: ScreenItem) => item.id,
  view: () => <Leaving key="leaving" />
});

/** A popup whose button carries `Mark` at the level of the props, and `Flag`. */
export const MarkedPopup = defineComponent("MarkedPopup", {
  outcomes: { louder: type(), close: type() },
  view: (props: { level: number }) => (
    <panel key="popupPanel" style={{ width: 600, height: 400 }}>
      <button
        key="popupButton"
        intent="louder"
        style={control}
        components={[Mark({ level: props.level }), Flag()]}
      />
    </panel>
  )
});

const home = defineNode({ rest: true, outcomes: { openPopup: type() } });

const shown = defineNode({
  rest: true,
  outcomes: { louder: type(), close: type() },
  run: async ({ player, fx, out }) => {
    const answer = (await fx(popup(MarkedPopup, { level: player.level }))) as Answer | undefined;

    return answer?.intent === "louder" ? out.louder() : out.close();
  }
});

const louder = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.level += 1;

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, shown, louder },
  start: "home",
  outcomes: {},
  edges: {
    home: { openPopup: "shown" },
    shown: { louder: "louder", close: "home" },
    louder: { done: "shown" }
  }
});

/** The feature of the extras fixture. */
export const extrasFeature = defineFeature("extras", {
  flows: [main],
  projections: [markedScreen, clashScreen, leavingScreen, everyTagScreen],
  ui: [Marked, Clash, Leaving, MarkedPopup],
  strings: { en: english }
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the screen set plus `ui` headless, with the flow resting on `home`.
 *
 * @returns The started app, one frame in.
 */
export async function startExtrasApp() {
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
      extrasFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { level: 1 }, initialSession: { visits: 0 }, seed: 1 }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.time.step(16);

  return app;
}

/** The app `startExtrasApp` builds. */
export type ExtrasApp = Awaited<ReturnType<typeof startExtrasApp>>;

/**
 * Lets the runner move, then runs frames, so the next node is entered and the screen follows.
 *
 * @param app - The running app.
 * @param frames - How many frames to step after the runner moved.
 */
export async function settle(app: ExtrasApp, frames = 2): Promise<void> {
  await tick();

  for (let frame = 0; frame < frames; frame += 1) app.time.step(16);
}

/**
 * Mounts one screen of the fixture and gives it the two frames of a reconcile and a solve.
 *
 * @param app - The running app.
 * @param name - The projection name.
 */
export function mountScreen(app: ExtrasApp, name: string): void {
  app.world.projection.mount([name], { kind: "plugin", name: "test" });
  app.time.step(16);
  app.time.step(16);
}
