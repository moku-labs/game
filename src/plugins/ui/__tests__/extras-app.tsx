/**
 * @file ui plugin — the app of the `components` prop tests (Delta 8a): a test component and a
 * test tag that stand in for any game component, a screen that adds, changes and drops them, a
 * button that names components the element owns, an element that leaves with an exit motion,
 * every tag once, a popup the flow shows again with a new level, a bound counter next to the
 * same number as content, and a plaque padded around a text of fractional width. Real flow
 * runner, plain Bun, inert renderer, real Yoga. Nothing here imports `effects`.
 */
import { bind, createApp, defineGame, hint, projection, type } from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import type { Answer } from "../../flow/gate/types";
import type { Hint } from "../../flow/types";
import { i18nPlugin } from "../../i18n";
import type { CompiledMessages } from "../../i18n/types";
import { inputPlugin } from "../../input";
import { rendererPlugin } from "../../renderer";
import { Shape, Transform } from "../../renderer/components";
import { scenesPlugin } from "../../scenes";
import { textPlugin } from "../../text";
import { worldPlugin } from "../../world";
import { component, Order, tag } from "../../world/ecs/define";
import type { Motion, MotionHandle, ViewHandle } from "../../world/types";
import { popup } from "../components";
import { uiPlugin } from "../index";
import { defineComponent } from "../jsx/component";
import type { ElementComponents } from "../jsx/intrinsics";
import type { ElementMotion } from "../jsx/types";

/** A game's own component, as `Glow` would be: one field a re-render may change. */
export const Mark = component("Mark", { level: 0 });

/** A game's own tag, as `Held` is: no data. */
export const Flag = tag("Flag");

/** A game's own component with a field a plugin derives, as `Countdown.left` is. */
export const Timer = component("Timer", { until: 0, left: 0 }, { owned: ["left"] });

/** A game's own counter, as the fixture's `Counter` is: the number a bound text shows. */
export const Tally = component("Tally", { value: 0 });

/** What `Mark` holds. */
type MarkValue = { level: number };

/** What one call of the `change.Mark` hook of the rolled row got. */
export type MarkCall = { previous: MarkValue; next: MarkValue; hint: Hint | undefined };

/**
 * What the `change.Mark` hook of the rolled row does, set by a test: roll home over `ms`, return
 * nothing, or throw. Every call and every motion it returned are recorded.
 */
export const markHook = {
  mode: "roll" as "roll" | "none" | "throw",
  ms: 200,
  calls: [] as MarkCall[],
  motions: [] as MotionHandle[]
};

/**
 * The `change.Mark` hook of the rolled row: it records the call and does what `markHook` says.
 *
 * @param view - The handle of the row.
 * @param previous - The value of the last render.
 * @param next - The value of this render.
 * @param given - The hint routed to the row.
 * @returns The roll, or nothing.
 */
function rollMark(
  view: ViewHandle<unknown>,
  previous: MarkValue,
  next: MarkValue,
  given?: Hint
): Motion {
  markHook.calls.push({ previous, next, hint: given });

  if (markHook.mode === "throw") throw new Error("bad roll");
  if (markHook.mode === "none") return undefined;

  const motion = view.toRest(Mark, { ms: markHook.ms });

  markHook.motions.push(motion);

  return motion;
}

/** The motion of the rolled row: a `change` hook for its extra `Mark`. */
const rolledMotion: ElementMotion = { change: { Mark: rollMark } };

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

/** A row whose extra `Mark` rolls through a `change` hook, next to a tag and an owned field. */
export const Rolled = defineComponent("Rolled", {
  local: { level: 2, shown: true },
  view: (_props: object, local) => (
    <column key="rolledRoot" style={{ width: 800, height: 800 }}>
      {local.shown ? (
        <row
          key="roller"
          style={{ width: 100, height: 100 }}
          components={[Mark({ level: local.level }), Flag(), Timer({ until: local.level * 1000 })]}
          motion={rolledMotion}
        />
      ) : undefined}
      <button key="rollFive" local={{ level: 5 }} style={control} />
      <button key="rollNine" local={{ level: 9 }} style={control} />
      <button key="hideRoller" local={{ shown: false }} style={control} />
    </column>
  )
});

/** What one call of a hook of the hinted text got: the hook and the hint. */
export type HintCall = { hook: string; hint: Hint | undefined };

/** Every hook call of the hinted text and of the hinted world view, in order. */
export const hintCalls: HintCall[] = [];

/**
 * Builds a `change` hook that records the hint it got under a name and plays nothing.
 *
 * @param hook - The name the call is recorded under.
 * @returns The hook.
 */
function recordHint(hook: string) {
  return (_view: ViewHandle<unknown>, _previous: unknown, _next: unknown, given?: Hint): Motion => {
    hintCalls.push({ hook, hint: given });

    return undefined;
  };
}

/** The motion of the hinted text: its extra `Mark` and its rect both record the hint. */
const hintedMotion: ElementMotion = {
  change: { Mark: recordHint("Mark"), Box: recordHint("Box") }
};

/** One item of the hint screen: the level the text carries and grows with. */
type HintItem = { id: string; level: number };

/** A screen whose keyed text carries the level as `Mark` and grows with it, so both hooks run. */
export const hintScreen = projection({
  name: "hintScreen",
  layer: "ui",
  from: (player: ExtrasPlayer): HintItem[] => [{ id: "hintScreen", level: player.level }],
  key: (item: HintItem) => item.id,
  view: (item: HintItem) => (
    <column key="hintRoot" style={{ width: 800, height: 400 }}>
      <text
        key="coinPillText"
        content="coins"
        style={{ width: 100 + item.level * 10, height: 40 }}
        components={[Mark({ level: item.level })]}
        motion={hintedMotion}
      />
    </column>
  )
});

/** A world projection of one view that carries the level, so the world's own routing is seen. */
export const hintViews = projection({
  name: "hintViews",
  layer: "ui",
  from: (player: ExtrasPlayer): HintItem[] => [{ id: "v1", level: player.level }],
  key: (item: HintItem) => item.id,
  view: (item: HintItem) => [Mark({ level: item.level })],
  motion: { change: { Mark: recordHint("view.Mark") } }
});

/** A row that centres what it holds, as a HUD pill centres its number. */
const centredRow = {
  width: 300,
  height: 60,
  direction: "row",
  align: "center",
  justify: "center"
} as const;

/**
 * A bound counter and the same number as content, each centred in a row of its own. Hidden, the
 * counter slides out with the exit motion of the leaving row.
 */
export const Bound = defineComponent("Bound", {
  local: { shown: true },
  view: (_props: object, local) => (
    <column key="boundRoot" style={{ width: 800, height: 400 }}>
      <row key="boundRow" style={centredRow}>
        {local.shown ? (
          <text
            key="bound"
            style="digits"
            bind={bind(Tally, "value")}
            components={[Tally({ value: 9 })]}
            motion={leaveMotion}
          />
        ) : undefined}
      </row>
      <row key="plainRow" style={centredRow}>
        <text key="plain" style="digits" content="9" />
      </row>
      <button key="hideBound" local={{ shown: false }} style={control} />
    </column>
  )
});

/** A screen with the bound counter. */
export const boundScreen = projection({
  name: "boundScreen",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "boundScreen" }],
  key: (item: ScreenItem) => item.id,
  view: () => <Bound key="boundCounter" />
});

/** The padding of the plaque: wide on the sides, as a title plaque pads its title. */
export const plaquePadding = { top: 20, right: 80, bottom: 20, left: 80 } as const;

/**
 * A plaque sized by its title, centred on the screen. With no font loaded "10" in `digits`
 * measures 38.4 wide, a fraction of a unit.
 */
export const Plaque = defineComponent("Plaque", {
  view: () => (
    <column
      key="plaqueRoot"
      style={{ width: 800, height: 400, align: "center", justify: "center" }}
    >
      <row key="plaque" style={{ padding: plaquePadding }}>
        <text key="plaqueTitle" style="digits" content="10" />
      </row>
    </column>
  )
});

/** A screen with the plaque. */
export const plaqueScreen = projection({
  name: "plaqueScreen",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "plaqueScreen" }],
  key: (item: ScreenItem) => item.id,
  view: () => <Plaque key="plaqueBox" />
});

/** The tags of `UiIntrinsicElements` the every-tag screen writes, each once. */
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
  "scroll",
  "input"
] as const;

/** The extras every tag of the every-tag screen carries. */
const tagExtras: ElementComponents = [Mark({ level: 1 })];

/** The box of every element of the every-tag screen. */
const tagBox = { width: 100, height: 100 } as const;

/** One row of a single-root screen. */
type ScreenItem = { id: string };

/** Every tag once, each with `Mark`; the scroll holds one column of content; the input sits outside every component. */
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
      <input key="tag-input" local="name" style={tagBox} components={tagExtras} />
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

/** A screen with the rolled row. */
export const rolledScreen = projection({
  name: "rolledScreen",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "rolledScreen" }],
  key: (item: ScreenItem) => item.id,
  view: () => <Rolled key="rolled" />
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

const home = defineNode({
  rest: true,
  outcomes: { openPopup: type(), grant: type(), bump: type() }
});

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

/** One commit that raises the level and releases two hints: one for the text, one for the view. */
const grant = defineNode({
  outcomes: { done: type() },
  run: ({ player, fx, out }) => {
    player.level += 1;
    fx.emit(hint("coins.fly", { projection: "hintScreen", key: "coinPillText", ms: 400 }));
    fx.emit(hint("view.bump", { projection: "hintViews", key: "v1" }));

    return out.done();
  }
});

/** One commit that raises the level and releases nothing. */
const bump = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.level += 1;

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, shown, louder, grant, bump },
  start: "home",
  outcomes: {},
  edges: {
    home: { openPopup: "shown", grant: "grant", bump: "bump" },
    shown: { louder: "louder", close: "home" },
    louder: { done: "shown" },
    grant: { done: "home" },
    bump: { done: "home" }
  }
});

/** The feature of the extras fixture. */
export const extrasFeature = defineFeature("extras", {
  flows: [main],
  projections: [
    markedScreen,
    clashScreen,
    leavingScreen,
    everyTagScreen,
    rolledScreen,
    hintScreen,
    hintViews,
    boundScreen,
    plaqueScreen
  ],
  ui: [Marked, Clash, Leaving, MarkedPopup, Rolled, Bound, Plaque],
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
