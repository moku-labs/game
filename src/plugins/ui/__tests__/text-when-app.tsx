/**
 * @file ui plugin — the app of the text key by the frame tests (F182): texts whose style object
 * names their text style key, the key of the base on a short phone and another in `when.tall`.
 * Next to them a text whose key changes only on a wide frame, a message in a fixed box that fits
 * its short key and not its tall one, a text in a style object without a key, a text with a key
 * string, a key beside `width: "100%"`, and a bound text whose format names its own style. Real world, text and Yoga; plain Bun, inert renderer, no font loaded, so a
 * text measures by the size of its style.
 */
import { vi } from "vitest";
import { createApp, defineGame, defineTextStyles, projection } from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import { i18nPlugin } from "../../i18n";
import type { CompiledMessages } from "../../i18n/types";
import { inputPlugin } from "../../input";
import { rendererPlugin } from "../../renderer";
import type { ViewportSize } from "../../renderer/viewport/types";
import { scenesPlugin } from "../../scenes";
import { textPlugin } from "../../text";
import { worldPlugin } from "../../world";
import { component } from "../../world/ecs/define";
import { uiPlugin } from "../index";

/** The counter of the bound text. */
export const Coins = component("Coins", { value: 0 });

/** The text style keys of the fixture. */
type StyleKey = "tw.short" | "tw.tall" | "tw.other" | "tw.format";

const { bind, defineFeature, defineFlow, defineNode, defineTextFormats, tr } = defineGame<{
  player: { level: number };
  session: Record<string, never>;
  assets: string;
  strings: { "tw.title": Record<string, never> };
  textStyles: StyleKey;
  textFormats: "tw.coins";
}>();

/** The one locale: a title as long as a shop's. */
const english: CompiledMessages = {
  "tw.title": () => [{ kind: "text", text: "Vitrine of the week" }]
};

/** A phone of 16:9, not tall: the base key holds. */
export const SHORT: ViewportSize = {
  width: 1080,
  height: 1920,
  scale: 0.36,
  orientation: "portrait",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 }
};

/** A phone of 20:9: `when.tall` holds. */
export const TALL: ViewportSize = { ...SHORT, height: 2400 };

/** The node the fixture rests on. */
const home = defineNode({ rest: true, outcomes: {} });

const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: {},
  edges: { home: {} }
});

/** Two sizes of a title, a size a game's system writes, and the size the format answers. */
const textStyles = defineTextStyles({
  "tw.short": { font: "ui.font-body", size: 19, fill: 0 },
  "tw.tall": { font: "ui.font-body", size: 41, fill: 0 },
  "tw.other": { font: "ui.font-body", size: 30, fill: 0 },
  "tw.format": { font: "ui.font-body", size: 14, fill: 0 }
});

/** A format that answers its own style. */
const textFormats = defineTextFormats({
  "tw.coins": value => ({ content: `${String(value)} c`, style: "tw.format" })
});

/** The style of a title: the short key, the tall one on a tall phone. */
const titleStyle = { text: "tw.short", when: { tall: { text: "tw.tall" } } } as const;

/** A screen of texts that name their key in the style object. */
export const textWhenScreen = projection({
  name: "textWhen",
  layer: "ui",
  from: (): Array<{ id: string }> => [{ id: "textWhen" }],
  key: (item: { id: string }) => item.id,
  view: () => (
    <column key="twRoot" style={{ width: 600, height: 1600, align: "start" }}>
      <text key="title" content="Vitrine" style={titleStyle} />
      <text key="message" content={tr("tw.title")} style={titleStyle} />
      <text
        key="rule"
        content="Rule"
        style={{ text: "tw.short", width: "100%", when: { tall: { text: "tw.tall" } } }}
      />
      <text
        key="steady"
        content="9"
        style={{ text: "tw.short", when: { wide: { text: "tw.tall" } } }}
      />
      <text
        key="boxed"
        content={tr("tw.title")}
        style={{ width: 300, height: 60, text: "tw.short", when: { tall: { text: "tw.tall" } } }}
      />
      <text key="plain" content="Plain" style={{ alignSelf: "start" }} />
      <text key="keyed" content="Keyed" style="tw.short" />
      <text
        key="coins"
        style={titleStyle}
        bind={bind(Coins, "value", { format: "tw.coins" })}
        components={[Coins({ value: 5 })]}
      />
    </column>
  )
});

/** The feature of the fixture. */
const textWhenFeature = defineFeature("textWhen", {
  flows: [main],
  projections: [textWhenScreen],
  textStyles,
  textFormats,
  strings: { en: english }
});

/**
 * Yields the microtask queue to the loop, the way a test waits without a timer.
 *
 * @param times - How many turns to yield.
 */
async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the screen set plus `ui` headless on a viewport, with the flow resting on `home`, and
 * mounts the screen: its reconcile, its first solve and the first resolve of `text` have run.
 *
 * @param viewport - The viewport the app starts on; a test mocks another one later.
 * @returns The started app.
 */
export async function startTextWhenApp(viewport: ViewportSize = SHORT) {
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
      textWhenFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { level: 1 }, initialSession: {}, seed: 1 }
    }
  });

  vi.spyOn(app.renderer.viewport, "size").mockReturnValue(viewport);

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.world.projection.mount(["textWhen"], { kind: "plugin", name: "test" });
  app.time.step(16);
  app.time.step(16);

  return app;
}

/** The app `startTextWhenApp` builds. */
export type TextWhenApp = Awaited<ReturnType<typeof startTextWhenApp>>;
