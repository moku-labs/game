/**
 * @file ui plugin — the app of the motion cause and loop tests (spec 16 U4, U5). Not a test file. A screen of cards
 * mounted by hand, whose first card plays its `enter` and `exit` only for a commit (`when: "change"`) and sways in a
 * loop, next to a card with a default motion; local buttons add and remove cards. A popup carries the same motion. A
 * second screen builds its `defineMotion` in the view body, as a game writes it inline, with buttons that render it
 * again with the same loop, with a longer one, or with a hand-written loop. Real flow runner, plain Bun, inert
 * renderer, real Yoga, real `anim`.
 */
import { createApp, defineGame, projection, type } from "../../../index";
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
import type { Motion, ViewHandle } from "../../world/projection/types";
import { popup } from "../components";
import { uiPlugin } from "../index";
import { defineComponent } from "../jsx/component";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { n: number };
  session: Record<string, never>;
  assets: string;
  strings: { "cause.title": Record<string, never> };
}>();

/** The one compiled locale of the fixture. */
const english: CompiledMessages = {
  "cause.title": () => [{ kind: "text", text: "cause" }]
};

/** How small a card starts its enter and ends its exit. */
export const SMALL = 0.5;

/** The widest turn of the sway of a card. */
export const PEAK = 0.2;

/** One cycle of the sway, in milliseconds. */
export const CYCLE_MS = 400;

/** A sway from rest to `peak` and back, one cycle of the loop. */
function swayKeys(peak: number) {
  return [
    { at: 0, Transform: { rotation: 0 } },
    { at: 0.5, ease: "linear" as const, Transform: { rotation: peak } },
    { at: 1, ease: "linear" as const, Transform: { rotation: 0 } }
  ];
}

/** The motion of a card that plays only for a commit, and sways whatever came. */
export const changeMotion = defineMotion({
  states: { small: { Transform: { scale: SMALL } } },
  keyframes: { sway: swayKeys(PEAK) },
  transition: { ms: 200 },
  loop: { track: "sway", ms: CYCLE_MS },
  on: { enter: "small", exit: "small" },
  when: "change"
});

/** The motion of a card that plays always, as before `when` existed. */
export const plainMotion = defineMotion({
  states: { small: { Transform: { scale: SMALL } } },
  transition: { ms: 200 },
  on: { enter: "small", exit: "small" }
});

/** A screen of cards: `count` cards with the commit-only motion, then a card with the default one. */
export const Cards = defineComponent("Cards", {
  local: { count: 1 },
  view: (_props: object, local) => (
    <column key="cardsRoot" style={{ width: 1080, height: 1080 }}>
      {Array.from({ length: local.count }, (_unused, index) => (
        <row key={`card${index}`} style={{ width: 200, height: 100 }} motion={changeMotion} />
      ))}
      <row key="plainCard" style={{ width: 200, height: 100 }} motion={plainMotion} />
      <button key="addCard" local={{ count: 2 }} style={{ width: 100, height: 100 }} />
      <button key="dropCards" local={{ count: 0 }} style={{ width: 100, height: 100 }} />
    </column>
  )
});

/** The screen of the cards, mounted by hand. */
export const cardsScreen = projection({
  name: "cards.screen",
  layer: "ui",
  from: () => ({ id: "cards" }),
  view: () => <Cards key="cards" />
});

/** A popup whose panel carries the commit-only motion. */
export const CardPopup = defineComponent("CardPopup", {
  outcomes: { close: type() },
  view: () => (
    <panel key="popupCard" style={{ width: 400, height: 400 }} motion={changeMotion}>
      <button key="popupClose" intent="close" style={{ width: 100, height: 100 }} />
    </panel>
  )
});

/** A hand-written loop: a new function at every call, with no fingerprint, over the sway of a card. */
function handLoop() {
  const sway = changeMotion.loop;

  return { loop: (view: ViewHandle<unknown>): Motion => sway?.(view) };
}

/**
 * A card whose motion is built in the view body at every render: the same loop while `ms` holds,
 * a longer one once it changes, a hand-written one while `hand` is set. The `again` buttons render
 * it again with nothing else changed.
 */
export const Rebuilt = defineComponent("Rebuilt", {
  local: { ms: CYCLE_MS, hand: false, renders: 0 },
  view: (_props: object, local) => (
    <column key="rebuiltRoot" style={{ width: 1080, height: 1080 }}>
      <row
        key="rebuiltCard"
        style={{ width: 200, height: 100 }}
        motion={
          local.hand
            ? handLoop()
            : defineMotion({
                keyframes: { sway: swayKeys(PEAK) },
                transition: { ms: 200 },
                loop: { track: "sway", ms: local.ms },
                on: {}
              })
        }
      />
      <button key="again1" local={{ renders: 1 }} style={{ width: 100, height: 100 }} />
      <button key="again2" local={{ renders: 2 }} style={{ width: 100, height: 100 }} />
      <button key="again3" local={{ renders: 3 }} style={{ width: 100, height: 100 }} />
      <button key="slower" local={{ ms: CYCLE_MS * 2 }} style={{ width: 100, height: 100 }} />
      <button key="byHand" local={{ hand: true }} style={{ width: 100, height: 100 }} />
    </column>
  )
});

/** The screen of the rebuilt card, mounted by hand. */
export const rebuiltScreen = projection({
  name: "rebuilt.screen",
  layer: "ui",
  from: () => ({ id: "rebuilt" }),
  view: () => <Rebuilt key="rebuilt" />
});

const home = defineNode({ rest: true, outcomes: { open: type() } });

const cardPopup = defineNode({
  outcomes: { close: type() },
  run: async ({ fx, out }) => {
    await fx(popup(CardPopup, {}));

    return out.close();
  }
});

const main = defineFlow("main", {
  nodes: { home, cardPopup },
  start: "home",
  outcomes: {},
  edges: { home: { open: "cardPopup" }, cardPopup: { close: "home" } }
});

/** The feature of the cause fixture. */
export const causeFeature = defineFeature("cause", {
  flows: [main],
  projections: [cardsScreen, rebuiltScreen],
  ui: [Cards, CardPopup, Rebuilt],
  strings: { en: english }
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
export async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the cause app headless, with the flow resting on `home` and the layers set.
 *
 * @returns The started app, one frame in.
 */
export async function startCauseApp() {
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
      causeFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      log: { mode: "test" },
      model: { initialPlayer: { n: 0 }, initialSession: {}, seed: 1 }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();
  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.time.step(16);

  return app;
}

/** The app `startCauseApp` builds. */
export type CauseApp = Awaited<ReturnType<typeof startCauseApp>>;

/**
 * Steps frames of 16 ms.
 *
 * @param app - The running app.
 * @param count - How many.
 */
export function frames(app: CauseApp, count: number): void {
  for (let frame = 0; frame < count; frame += 1) app.time.step(16);
}
