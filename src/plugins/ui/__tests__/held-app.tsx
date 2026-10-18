/**
 * @file ui plugin — the app of the hold tests (spec 28 U1–U3): popup components and a JSX
 * projection, each in a feature of its own, shown by the nodes of a flow that a fifth feature
 * owns. So a component's feature is active only through the hold `ui` takes for its root. Real
 * flow runner, plain Bun, inert renderer, real Yoga.
 */
import { createApp, defineGame, projection, Transform, type } from "../../../index";
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

/** The player of the hold fixture: a volume the prefs popup shows, and whether the shop is open. */
export type HeldPlayer = { volume: number; shopOpen: boolean };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: HeldPlayer;
  session: Record<string, never>;
  assets: string;
  strings: { "held.title": Record<string, never> };
}>();

/** The one compiled locale of the fixture. */
const english: CompiledMessages = { "held.title": () => [{ kind: "text", text: "held" }] };

/** Every panel leaves with a motion of 100 ms, so a root outlives its answer for a few frames. */
const leaving: ElementMotion = {
  exit: view => view.tween(Transform, { y: 500 }, { ms: 100 })
};

/** The reward popup: one answer. */
export const RewardPopup = defineComponent("Reward", {
  outcomes: { ok: type() },
  view: () => (
    <panel key="rewardPanel" style={{ width: 400, height: 300 }} motion={leaving}>
      <button key="ok" intent="ok" style={{ width: 100, height: 60 }} />
    </panel>
  )
});

/** The prefs popup: shown again after every volume step, and the one a confirm covers. */
export const PrefsPopup = defineComponent("Prefs", {
  outcomes: { louder: type(), confirm: type(), close: type() },
  view: (props: { volume: number }) => (
    <panel key="prefsPanel" style={{ width: 600, height: 600 }} motion={leaving}>
      <text key="volume" style={{ width: 200, height: 40 }} content={`${props.volume}`} />
      <button key="louder" intent="louder" style={{ width: 100, height: 60 }} />
      <button key="confirm" intent="confirm" style={{ width: 100, height: 60 }} />
      <button key="close" intent="close" style={{ width: 100, height: 60 }} />
    </panel>
  )
});

/** The confirm popup, opened over the prefs. */
export const ConfirmPopup = defineComponent("Confirm", {
  outcomes: { yes: type(), no: type() },
  view: () => (
    <panel key="confirmPanel" style={{ width: 400, height: 300 }} motion={leaving}>
      <button key="yes" intent="yes" style={{ width: 100, height: 60 }} />
      <button key="no" intent="no" style={{ width: 100, height: 60 }} />
    </panel>
  )
});

/** One row of the shop sheet. */
type Sheet = { id: string };

/** The shop sheet: a JSX root while the shop is open, whose panel leaves with its motion. */
export const shopSheet = projection({
  name: "shop.sheet",
  layer: "ui",
  from: (player: HeldPlayer): Sheet[] => (player.shopOpen ? [{ id: "sheet" }] : []),
  key: (item: Sheet) => item.id,
  view: () => (
    <panel key="sheetPanel" style={{ width: 1080, height: 600 }} motion={leaving}>
      <text key="sheetTitle" style={{ width: 200, height: 40 }} content="shop" />
    </panel>
  )
});

const home = defineNode({
  rest: true,
  outcomes: { reward: type(), prefs: type(), shop: type() }
});

const showReward = defineNode({
  outcomes: { done: type() },
  run: async ({ fx, out }) => {
    await fx(popup(RewardPopup, {}));

    return out.done();
  }
});

const prefs = defineNode({
  rest: true,
  outcomes: { louder: type(), confirm: type(), close: type() },
  run: async ({ player, fx, out }) => {
    const answer = (await fx(popup(PrefsPopup, { volume: player.volume }))) as Answer | undefined;

    if (answer?.intent === "louder") return out.louder();
    if (answer?.intent === "confirm") return out.confirm();

    return out.close();
  }
});

const louder = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.volume += 1;

    return out.done();
  }
});

const confirm = defineNode({
  outcomes: { yes: type(), no: type() },
  run: async ({ fx, out }) => {
    const answer = (await fx(popup(ConfirmPopup, {}, { over: "Prefs" }))) as Answer | undefined;

    return answer?.intent === "yes" ? out.yes() : out.no();
  }
});

const toggleShop = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.shopOpen = !player.shopOpen;

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, showReward, prefs, louder, confirm, toggleShop },
  start: "home",
  outcomes: {},
  edges: {
    home: { reward: "showReward", prefs: "prefs", shop: "toggleShop" },
    showReward: { done: "home" },
    prefs: { louder: "louder", confirm: "confirm", close: "home" },
    louder: { done: "prefs" },
    confirm: { yes: "home", no: "prefs" },
    toggleShop: { done: "home" }
  }
});

/** The feature that owns the flow: its nodes show the popups of the others. */
const homeFeature = defineFeature("home", { flows: [main], strings: { en: english } });

/** The reward popup's feature. */
const rewardFeature = defineFeature("reward", { ui: [RewardPopup] });

/** The prefs popup's feature. */
const prefsFeature = defineFeature("prefs", { ui: [PrefsPopup] });

/** The confirm popup's feature. */
const confirmFeature = defineFeature("confirmKit", { ui: [ConfirmPopup] });

/** The shop sheet's feature. */
const shopFeature = defineFeature("shop", { projections: [shopSheet] });

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
export async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the screen set plus `ui` headless, the shop sheet mounted, with the flow resting on
 * `home`.
 *
 * @returns The started app, one frame in.
 */
export async function startHeldApp() {
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
      homeFeature,
      rewardFeature,
      prefsFeature,
      confirmFeature,
      shopFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { volume: 3, shopOpen: false }, initialSession: {}, seed: 1 }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.world.projection.mount(["shop.sheet"], { kind: "plugin", name: "test" });
  app.time.step(16);

  return app;
}

/** The app `startHeldApp` builds. */
export type HeldApp = Awaited<ReturnType<typeof startHeldApp>>;

/**
 * Answers the gate, lets the runner move, then runs frames, so the next node is entered and the
 * screen follows.
 *
 * @param app - The running app.
 * @param intent - The answer.
 * @param frames - How many frames to step after the runner moved.
 */
export async function answer(app: HeldApp, intent: string, frames = 2): Promise<void> {
  app.flow.gate.answer({ intent });
  await tick();

  for (let frame = 0; frame < frames; frame += 1) app.time.step(16);
}

/**
 * Steps frames until every exit motion of the fixture ended and the sweep dropped what left.
 *
 * @param app - The running app.
 */
export function settleExits(app: HeldApp): void {
  for (let frame = 0; frame < 20; frame += 1) app.time.step(16);
}
