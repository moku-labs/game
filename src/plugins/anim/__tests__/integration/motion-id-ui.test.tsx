import { describe, expect, it } from "vitest";
import { createApp, defineGame, exit, projection, type } from "../../../../index";
import { assetsPlugin } from "../../../assets";
import { i18nPlugin } from "../../../i18n";
import type { CompiledMessages } from "../../../i18n/types";
import { inputPlugin } from "../../../input";
import { rendererPlugin } from "../../../renderer";
import { scenesPlugin } from "../../../scenes";
import { textPlugin } from "../../../text";
import { uiPlugin } from "../../../ui";
import { defineComponent } from "../../../ui/jsx/component";
import { worldPlugin } from "../../../world";
import { animPlugin } from "../../index";
import { defineMotion } from "../../motion";

// ---------------------------------------------------------------------------
// The motion id on a ui element (F192): the loop of `motion={defineMotion({ id, ... })}` is
// labelled `<id>.loop`, and an equal loop built again under another id keeps the running track,
// so it keeps its old label too: `ui` compares loops by what they play, never by their name.
// ---------------------------------------------------------------------------

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { n: number };
  session: Record<string, never>;
  assets: string;
  strings: { "label.title": Record<string, never> };
}>();

const english: CompiledMessages = {
  "label.title": () => [{ kind: "text", text: "label" }]
};

/** A sway from rest to 0.2 rad and back: one cycle of the loop. */
const SWAY = [
  { at: 0, Transform: { rotation: 0 } },
  { at: 0.5, ease: "linear" as const, Transform: { rotation: 0.2 } },
  { at: 1, ease: "linear" as const, Transform: { rotation: 0 } }
];

/**
 * A card whose motion is built in the view body at every render, under an id the local state holds.
 * The buttons render it again under another id: with the same loop, or with a longer one.
 */
const Card = defineComponent("Card", {
  local: { id: "hud.one", ms: 400 },
  view: (_props: object, local) => (
    <column key="cardRoot" style={{ width: 1080, height: 1080 }}>
      <row
        key="labelCard"
        style={{ width: 200, height: 100 }}
        motion={defineMotion({
          id: local.id,
          keyframes: { sway: SWAY },
          transition: { ms: 200 },
          loop: { track: "sway", ms: local.ms },
          on: {}
        })}
      />
      <button key="sameLoop" local={{ id: "hud.two" }} style={{ width: 100, height: 100 }} />
      <button
        key="longerLoop"
        local={{ id: "hud.two", ms: 800 }}
        style={{ width: 100, height: 100 }}
      />
    </column>
  )
});

const cardScreen = projection({
  name: "label.screen",
  layer: "ui",
  from: () => ({ id: "label" }),
  view: () => <Card key="card" />
});

const home = defineNode({ rest: true, outcomes: { quit: type() } });
const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: { over: type() },
  edges: { home: { quit: exit("over") } }
});
const labelFeature = defineFeature("label", {
  flows: [main],
  projections: [cardScreen],
  ui: [Card],
  strings: { en: english }
});

/**
 * Starts the app headless and mounts the card with its loop running.
 *
 * @returns The started app.
 */
async function startCard() {
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
      labelFeature
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

  for (let index = 0; index < 60; index += 1) await Promise.resolve();

  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.time.step(16);
  app.world.projection.mount(["label.screen"], { kind: "plugin", name: "test" });

  for (let frame = 0; frame < 11; frame += 1) app.time.step(16);

  return app;
}

type CardApp = Awaited<ReturnType<typeof startCard>>;

/**
 * Taps a button of the card and renders one frame.
 *
 * @param app - The running app.
 * @param key - The key of the button.
 */
function tapButton(app: CardApp, key: string): void {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  app.input.tap(app.ui.find(key) ?? 0);
  app.time.step(16);
}

/**
 * The labels of the running tracks of the card.
 *
 * @param app - The running app.
 * @returns Its `motionIdsOf`.
 */
function labelsOfCard(app: CardApp): readonly string[] {
  return app.world.projection.motionIdsOf(app.ui.find("labelCard") ?? 0);
}

describe("anim — the id of a motion on a ui element", () => {
  it("labels the running loop of the element after the id", async () => {
    const app = await startCard();

    expect(labelsOfCard(app)).toEqual(["hud.one.loop"]);

    await app.stop();
  });

  it("keeps the running loop, and its old label, when an equal loop is built under another id", async () => {
    const app = await startCard();

    expect(app.anim.active()).toBe(1);

    tapButton(app, "sameLoop");

    // The loop did not restart: `ui` compares the loops by their fingerprint, which has no id.
    expect(app.anim.active()).toBe(1);
    expect(labelsOfCard(app)).toEqual(["hud.one.loop"]);

    await app.stop();
  });

  it("starts a new loop under the new label when the loop itself changes", async () => {
    const app = await startCard();

    tapButton(app, "longerLoop");

    expect(app.anim.active()).toBe(1);
    expect(labelsOfCard(app)).toEqual(["hud.two.loop"]);

    await app.stop();
  });
});
