/**
 * @file ui plugin — the app every ui test starts: the real screen set plus `ui`, a HUD written
 * in JSX, a settings component with local state and a reward popup with one outcome. Plain Bun,
 * inert renderer, real Yoga.
 */
import { createApp, defineGame, exit, guide, projection, Transform, type } from "../../../index";
import { animPlugin } from "../../anim";
import { defineMotion } from "../../anim/motion";
import { assetsPlugin } from "../../assets";
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

/** The player the fixture starts with. */
export type Player = { coins: number; tab: string };

/** The session the fixture starts with. */
export type Session = { visits: number };

const { defineNode, defineFlow, defineFeature, tr } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: { "hud.coins": { n: number } };
}>();

/** The one compiled locale of the fixture, as `compileStrings` writes it. */
const english: CompiledMessages = {
  "hud.coins": (params, intl) => [
    { kind: "text", text: `coins ${intl.number().format(Number(params.n))}` }
  ]
};

/** A settings panel: the tab is local state, so a tab press is never an intent. */
export const Settings = defineComponent("Settings", {
  local: { tab: "audio" },
  view: (props: { volume: number }, local) => (
    <column key="settings" style={{ gap: 8, width: 400, height: 200 }}>
      <button key="audio" local={{ tab: "audio" }} style={{ width: 120, height: 60 }} />
      <button key="video" local={{ tab: "video" }} style={{ width: 120, height: 60 }} />
      <text
        key="which"
        style={{ width: 200, height: 40 }}
        content={`${local.tab}:${props.volume}`}
      />
      <row key="badge" style={{ position: "absolute", width: 20, height: 20 }} />
    </column>
  )
});

/** How many rows the scrolling list holds. */
const ROWS = 8;

/** Where the enter hook puts an element before it returns to its rest pose. */
export const enterOffset = 40;

/**
 * An enter hook that throws, so the logged path of `play` is exercised.
 *
 * @throws {Error} Always.
 */
function throwingHook(): never {
  throw new Error("bad hook");
}

/** A list screen: a scroll container over rows taller than the container. */
export const listProjection = projection({
  name: "list",
  layer: "ui",
  from: (player: Player): { id: string; coins: number }[] => [{ id: "list", coins: player.coins }],
  key: (item: { id: string }) => item.id,
  view: () => (
    <scroll key="listBox" axis="y" style={{ width: 400, height: 200, fill: 0x00_00_00 }}>
      <column key="content" style={{ width: 400, height: ROWS * 80 }}>
        {Array.from({ length: ROWS }, (_unused, index) => (
          <row key={`row${index}`} style={{ width: 400, height: 80, fill: 0x22_22_22 }} />
        ))}
      </column>
    </scroll>
  )
});

/** The motion a game writes with `defineMotion`, on a button of the screen. */
export const buttonMotion = defineMotion({
  states: { small: { Transform: { scale: 0.8 } } },
  transition: { ms: 200, ease: "out" },
  on: { enter: "small", change: ["Transform"] }
});

/** A screen whose one element carries the three motion hooks, so they are all exercised. */
export const movedProjection = projection({
  name: "moved",
  layer: "ui",
  from: (player: Player): { id: string; coins: number }[] => [{ id: "moved", coins: player.coins }],
  key: (item: { id: string }) => item.id,
  view: () => (
    <column key="movedRoot" style={{ width: 300, height: 300 }}>
      <row key="thrower" style={{ width: 10, height: 10 }} motion={{ enter: throwingHook }} />
      <button
        key="animated"
        intent="openSettings"
        style={{ width: 80, height: 80 }}
        motion={buttonMotion}
      />
      <row
        key="mover"
        style={{ width: 100, height: 100, fill: 0x33_33_33 }}
        motion={{
          enter: view => {
            view.set(Transform, { y: enterOffset });

            return view.toRest(Transform);
          },
          exit: view => view.tween(Transform, { y: 500 }, { ms: 300 }),
          change: { Box: view => view.toRest(Transform) }
        }}
      />
    </column>
  )
});

/** A screen whose root element names a tag that is not in V3. */
export const inputProjection = projection({
  name: "inputScreen",
  layer: "ui",
  from: (player: Player): { id: string; coins: number }[] => [
    { id: "inputScreen", coins: player.coins }
  ],
  key: (item: { id: string }) => item.id,
  view: () => <input key="field" style={{ width: 100, height: 40 }} />
});

/** A screen with a horizontal scroll, which arrives after V3. */
export const sidewaysProjection = projection({
  name: "sideways",
  layer: "ui",
  from: (player: Player): { id: string; coins: number }[] => [
    { id: "sideways", coins: player.coins }
  ],
  key: (item: { id: string }) => item.id,
  view: () => <scroll key="sidewaysBox" axis="x" style={{ width: 100, height: 40 }} />
});

/** A component whose view throws, so the old subtree has to stay. */
export const Broken = defineComponent("Broken", {
  local: { mode: "button" },
  view: (_props: object, local) => {
    if (local.mode === "throw") throw new Error("broken view");

    return (
      <column key="brokenRoot" style={{ width: 300, height: 200 }}>
        {local.mode === "text" ? (
          <text key="swap" style={{ width: 100, height: 40 }} content="now text" />
        ) : (
          <button key="swap" local={{ mode: "text" }} style={{ width: 100, height: 40 }} />
        )}
        <button key="boom" local={{ mode: "throw" }} style={{ width: 100, height: 40 }} />
      </column>
    );
  }
});

/** A screen with two elements under the same key and a component that can throw. */
export const oddProjection = projection({
  name: "odd",
  layer: "ui",
  from: (player: Player): { id: string; coins: number }[] => [{ id: "odd", coins: player.coins }],
  key: (item: { id: string }) => item.id,
  view: () => (
    <column key="oddRoot" style={{ width: 400, height: 400 }}>
      <row key="twin" style={{ width: 100, height: 40 }} />
      <text key="twin" style={{ width: 100, height: 40 }} content="second" />
      <Broken key="broken" />
    </column>
  )
});

/** A screen that uses every group of the style vocabulary and both text sizings. */
export const richProjection = projection({
  name: "rich",
  layer: "ui",
  from: (player: Player): { id: string; coins: number }[] => [{ id: "rich", coins: player.coins }],
  key: (item: { id: string }) => item.id,
  view: () => (
    <column
      key="richRoot"
      style={{
        direction: "column",
        wrap: true,
        justify: "between",
        align: "center",
        alignSelf: "stretch",
        gap: 4,
        grow: 0,
        shrink: 1,
        padding: { top: 2, right: 3, bottom: 4, left: 5 },
        margin: 6,
        width: "50%",
        height: 400,
        minWidth: 10,
        minHeight: 10,
        maxWidth: 900,
        maxHeight: 900,
        overflow: "hidden",
        position: "relative",
        fill: 0x11_11_11,
        radius: 8,
        stroke: 0x22_22_22,
        strokeWidth: 2,
        alpha: 0.9
      }}
    >
      <text key="auto" content={tr("hud.coins", { n: 3 })} style={{ height: 40 }} />
      <text key="tiny" content={tr("hud.coins", { n: 3 })} style={{ width: 4, height: 4 }} />
      <button key="small" intent="openSettings" style={{ width: 10, height: 10 }} />
      <row
        key="pinned"
        style={{
          position: "absolute",
          top: 1,
          left: 1,
          right: 1,
          bottom: 1,
          width: 10,
          height: 10,
          aspect: 1,
          reason: "a badge sits on the corner"
        }}
      />
      <image key="pic" texture="ui.coin" style={{ width: 20, height: 20 }} />
      <icon key="ic" name="ui.gear" style={{ width: 20, height: 20 }} />
      <panel key="pan" style={{ width: 40, height: 40, nineSlice: "ui.panel" }} />
      <button key="off" state={{ disabled: true }} style={{ width: 60, height: 60 }} />
      <button
        key="held"
        intent="openSettings"
        style={{ width: 60, height: 60, fill: 0x01_01_01, is: { pressed: { fill: 0x99_00_00 } } }}
      />
      <row key="strokeOnly" style={{ width: 30, height: 30, stroke: 0x44_44_44 }} />
      <icon key="autoIcon" name="ui.gear" />
      <text key="styled" style="body" content="a style key carries the size" />
      <button key="plain" style={{ width: 50, height: 50 }} />
    </column>
  )
});

/** The look every sliced button of the showcase shares: a texture per state, a lift on hover. */
const slicedButton = {
  width: 300,
  height: 120,
  nineSlice: "ui.button",
  alpha: 0.9,
  tint: 0xff_ee_dd,
  is: {
    hover: { nineSlice: "ui.button-hover", offsetY: -6, scale: 1.05 },
    pressed: { nineSlice: "ui.button-pressed", offsetY: 4, scale: 0.95 },
    disabled: { nineSlice: "ui.button-off" }
  }
} as const;

/** A screen of the delta-4 looks: nine-slices in the style, image fits, clip, transforms. */
export const showcaseProjection = projection({
  name: "showcase",
  layer: "ui",
  from: (player: Player): { id: string; coins: number }[] => [
    { id: "showcase", coins: player.coins }
  ],
  key: (item: { id: string }) => item.id,
  view: () => (
    <column key="showRoot" style={{ width: 1080, height: 1800, gap: 10 }}>
      <button key="sliced" intent="openSettings" style={slicedButton} />
      <button
        key="offButton"
        intent="openSettings"
        state={{ disabled: true }}
        style={slicedButton}
      />
      <row key="slicedRow" style={{ width: 400, height: 80, nineSlice: "ui.strip" }} />
      <stack key="slicedStack" style={{ width: 200, height: 200, nineSlice: "ui.card" }} />
      <image
        key="cover"
        texture="ui.bg"
        fit="cover"
        style={{ width: 300, height: 200, tint: 0xaa_aa_aa }}
      />
      <image key="contained" texture="ui.coin" style={{ width: 64, height: 64 }} />
      <icon key="filled" name="ui.gear" fit="fill" style={{ width: 48, height: 48 }} />
      <panel key="card" style={{ width: 300, height: 200, fill: 0x22_22_22 }} />
      <column key="clipper" style={{ width: 200, height: 200, overflow: "hidden" }} />
      <row
        key="lifted"
        style={{ width: 100, height: 100, offsetX: 10, offsetY: -20, scale: 1.5, origin: "top" }}
      />
      <row key="corner" style={{ width: 100, height: 100, origin: "topLeft" }} />
      <row
        key="swapper"
        style={{
          width: 100,
          height: 60,
          fill: 0x11_11_11,
          is: { hover: { nineSlice: "ui.strip" } }
        }}
      />
      <button
        key="bouncy"
        intent="openSettings"
        style={{ width: 100, height: 100, is: { hover: { scale: 1.2 } } }}
        motion={buttonMotion}
      />
    </column>
  )
});

/** The top bar and the bottom bar around the fitted slot, in reference units. */
export const fitBars = { top: 300, bottom: 800, padding: 20 } as const;

/** A board-like slot: a 970 u stack with `fit: "contain"` in whatever height the bars leave. */
export const fittedProjection = projection({
  name: "fitted",
  layer: "ui",
  from: (player: Player): { id: string; coins: number }[] => [
    { id: "fitted", coins: player.coins }
  ],
  key: (item: { id: string }) => item.id,
  view: () => (
    <column key="fitScreen" style={{ width: 1080, height: "100%" }}>
      <row key="fitTop" style={{ height: fitBars.top }} />
      <column key="slot" style={{ grow: 1, padding: fitBars.padding }}>
        <stack key="board" style={{ width: 970, height: 970, fit: "contain" }}>
          <button
            key="cell"
            intent="openSettings"
            style={{ left: 100, top: 100, width: 140, height: 140 }}
          />
        </stack>
      </column>
      <row key="fitBottom" style={{ height: fitBars.bottom }} />
    </column>
  )
});

/** How far above its rest the swinging board starts, in reference units. */
export const swingDrop = 780;

/** A popup swing written as keyframes: it drops in from above, overshoots and settles. */
export const swingMotion = defineMotion({
  keyframes: {
    dropIn: [
      { at: 0, Transform: { dy: -swingDrop, rotation: -0.035, scale: 0.8 } },
      { at: 0.42, ease: "out", Transform: { dy: 14, rotation: 0.087, scale: 1.04 } },
      { at: 0.86, Transform: { dy: 0, rotation: -0.012, scale: 1 } }
    ]
  },
  transition: { ms: 1000 },
  on: { enter: "dropIn" }
});

/** A board that swings in on its ropes around a pivot above it, and a panel with its slices outlined. */
export const keyframedProjection = projection({
  name: "keyframed",
  layer: "ui",
  from: (player: Player): { id: string; coins: number }[] => [
    { id: "keyframed", coins: player.coins }
  ],
  key: (item: { id: string }) => item.id,
  view: () => (
    <column key="keyRoot" style={{ width: 1080, height: 1200, gap: 10 }}>
      <panel
        key="swinging"
        style={{ width: 600, height: 400, fill: 0x10_10_18, origin: { x: 0.5, y: -0.5 } }}
        motion={swingMotion}
      />
      <panel
        key="outlined"
        style={{ width: 300, height: 200, nineSlice: "ui.card", debug: true }}
      />
    </column>
  )
});

/** The reward popup: its one outcome is the intent the node resolves with. */
export const RewardPopup = defineComponent("RewardPopup", {
  outcomes: { claim: type<{ orderId: string }>() },
  view: (props: { gold: number }) => (
    <panel key="reward" style={{ width: 600, height: 400, fill: 0x10_10_18 }}>
      <text key="amount" style={{ width: 200, height: 40 }} content={String(props.gold)} />
      <text key="coins" style={{ width: 80, height: 30 }} content="popup coins" />
      <button
        key="claim"
        intent="claim"
        payload={{ orderId: "o1" }}
        style={{ width: 200, height: 80 }}
      />
    </panel>
  )
});

/** The HUD: a row with a coin text, a settings button and the settings component. */
/** One item of the HUD projection: the screen is one row of the model. */
type HudItem = { id: string; coins: number };

export const hud = projection({
  name: "hud",
  layer: "ui",
  from: (player: Player): HudItem[] => [{ id: "hud", coins: player.coins }],
  key: (item: HudItem) => item.id,
  view: (item: HudItem) => (
    <row key="bar" style={{ direction: "row", gap: 10, width: 1080, height: 120 }}>
      <text key="coins" style={{ width: 200, height: 60 }} content={String(item.coins)} />
      <button key="settings" intent="openSettings" style={{ width: 100, height: 100 }} />
      <Settings key="panel" volume={3} />
    </row>
  )
});

const home = defineNode({
  rest: true,
  outcomes: {
    openSettings: type(),
    reward: type(),
    teach: type(),
    teachBlind: type(),
    teachFit: type()
  }
});

const teach = defineNode({
  outcomes: { ok: type() },
  async run({ fx, out }) {
    await fx(guide({ allow: { intent: "ok" }, target: { projection: "hud", key: "settings" } }));
    await fx({ kind: "pause", answers: ["ok"] });

    return out.ok();
  }
});

const teachFit = defineNode({
  outcomes: { ok: type() },
  async run({ fx, out }) {
    await fx(guide({ allow: { intent: "ok" }, target: { projection: "fitted", key: "cell" } }));
    await fx({ kind: "pause", answers: ["ok"] });

    return out.ok();
  }
});

const teachBlind = defineNode({
  outcomes: { ok: type() },
  async run({ fx, out }) {
    await fx(guide({ allow: { intent: "ok" } }));
    await fx({ kind: "pause", answers: ["ok"] });

    return out.ok();
  }
});

const deliver = defineNode({
  outcomes: { done: type() },
  async run({ fx, out }) {
    await fx(popup(RewardPopup, { gold: 5 }));

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, deliver, teach, teachBlind, teachFit },
  start: "home",
  outcomes: { over: type() },
  edges: {
    home: {
      openSettings: "home",
      reward: "deliver",
      teach: "teach",
      teachBlind: "teachBlind",
      teachFit: "teachFit"
    },
    deliver: { done: exit("over") },
    teach: { ok: "home" },
    teachBlind: { ok: "home" },
    teachFit: { ok: "home" }
  }
});

/** The one feature of the fixture: the HUD, the flow and the two ui components. */
export const hudFeature = defineFeature("hud", {
  flows: [main],
  projections: [
    hud,
    listProjection,
    movedProjection,
    inputProjection,
    sidewaysProjection,
    oddProjection,
    richProjection,
    showcaseProjection,
    fittedProjection,
    keyframedProjection
  ],
  // The fourth entry is not a `defineComponent` result: `ui` skips what it cannot register.
  ui: [Settings, RewardPopup, Broken, { name: "NotAComponent" } as never],
  strings: { en: english }
});

/** A second feature, with nothing under its `ui` key. */
export const plainFeature = defineFeature("plain", {});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
export async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the screen set plus `ui` headless and mounts the HUD.
 *
 * @returns The started app, one frame in.
 */
export async function startUiApp() {
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
      hudFeature,
      plainFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      // `de` is registered and never loaded: a lazy locale a game ships and the player never picks.
      i18n: { locale: "en", fallback: "en", locales: { de: () => Promise.resolve(english) } },
      model: { initialPlayer: { coins: 7, tab: "audio" }, initialSession: { visits: 0 }, seed: 1 }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.world.projection.mount(["hud"], { kind: "plugin", name: "test" });
  app.time.step(16);
  app.time.step(16);

  return app;
}
