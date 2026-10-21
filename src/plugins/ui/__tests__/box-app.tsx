/**
 * @file ui plugin — the app of the wrap "box" tests (F50): a card row of a fixed 300 wide, a side
 * of a fixed width, and a cell that shrinks to the room the side leaves. The cell holds a name in
 * a text style with `wrap: "box"`. Two buttons widen the side and shorten the name. Real flow,
 * world, text and Yoga; plain Bun, inert renderer, no font loaded: a glyph of the 32 px style is
 * 19.2 wide and a line 38.4 high.
 */
import { createApp, defineGame, defineTextStyles, projection, type } from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import { i18nPlugin } from "../../i18n";
import type { CompiledMessages } from "../../i18n/types";
import { inputPlugin } from "../../input";
import { rendererPlugin } from "../../renderer";
import { scenesPlugin } from "../../scenes";
import { textPlugin } from "../../text";
import { worldPlugin } from "../../world";
import { uiPlugin } from "../index";
import { defineComponent } from "../jsx/component";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Record<string, never>;
  session: Record<string, never>;
  assets: string;
  strings: { "box.title": Record<string, never> };
}>();

/** The one compiled locale of the fixture. */
const english: CompiledMessages = {
  "box.title": () => [{ kind: "text", text: "box" }]
};

/**
 * The long name: 23 glyphs. At 300 its widest line is "Lopez Garcia", 230.4; at the 200 the side
 * leaves it is three lines, "Anna Maria", "Lopez", "Garcia".
 */
export const LONG_NAME = "Anna Maria Lopez Garcia";

/** The short name: 4 glyphs, 76.8 wide, one line at any room. */
export const SHORT_NAME = "Anna";

/** The width of the card row. */
export const CARD_WIDTH = 300;

/** The size of every control button of the fixture. */
const control = { width: 100, height: 60 } as const;

/** The card: a fixed side, then a cell that shrinks to the room left, holding the name. */
export const Card = defineComponent("Card", {
  local: { side: 100, long: true },
  view: (_props: object, local) => (
    <column key="cardRoot" style={{ width: 800, height: 600 }}>
      <row key="card" style={{ width: CARD_WIDTH }}>
        <stack key="cardSide" style={{ width: local.side, height: 40 }} />
        <column key="cardCell" style={{ shrink: 1 }}>
          <text key="cardName" style="card.name" content={local.long ? LONG_NAME : SHORT_NAME} />
        </column>
      </row>
      <button key="widen" local={{ side: 150 }} style={control} />
      <button key="shorten" local={{ long: false }} style={control} />
    </column>
  )
});

/** One root of a single-root screen. */
type ScreenItem = { id: string };

/** A screen with the card. */
const cardScreen = projection({
  name: "cardScreen",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "cardScreen" }],
  key: (item: ScreenItem) => item.id,
  view: () => <Card key="card" />
});

const home = defineNode({ rest: true, outcomes: { go: type() } });

const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: {},
  edges: { home: { go: "home" } }
});

/** The feature of the fixture: the card screen and the style that wraps at its box. */
const boxFeature = defineFeature("box", {
  flows: [main],
  projections: [cardScreen],
  ui: [Card],
  textStyles: defineTextStyles({
    "card.name": { font: "ui.font-body", size: 32, fill: 0xff_ff_ff, wrap: "box" }
  }),
  strings: { en: english }
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the screen set plus `ui` headless, with the flow resting on `home`.
 *
 * @returns The started app, one frame in, the card not mounted yet.
 */
export async function startBoxApp() {
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
      boxFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: {}, initialSession: {}, seed: 1 }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.time.step(16);

  return app;
}

/** The app `startBoxApp` builds. */
export type BoxApp = Awaited<ReturnType<typeof startBoxApp>>;
