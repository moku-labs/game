/**
 * @file ui plugin — the app of the named format tests (F135): the pill of a game, a bound number in
 * a centred row whose format answers the string and the style, next to the same number under the
 * built-in `"int"`. Real world, text and Yoga; plain Bun, inert renderer, no font loaded: a glyph is
 * 0.6 em wide, so "950" in `digits.17` is 30.6 and "1.5K" in `digits.14` is 33.6.
 */
import { createApp, defineGame, defineTextStyles, projection } from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import { i18nPlugin } from "../../i18n";
import { inputPlugin } from "../../input";
import { rendererPlugin } from "../../renderer";
import { scenesPlugin } from "../../scenes";
import { textPlugin } from "../../text";
import { worldPlugin } from "../../world";
import { component } from "../../world/ecs/define";
import { uiPlugin } from "../index";
import { defineComponent } from "../jsx/component";

/** The counter of the pill. */
export const Counter = component("Counter", { value: 0 });

/** A component a commit rewrites beside the counter. */
const Mark = component("Mark", { level: 0 });

/** The style keys of the fixture. */
type StyleKey = "digits.17" | "digits.14";

const { bind, defineFeature, defineFlow, defineNode, defineTextFormats } = defineGame<{
  player: { level: number };
  session: Record<string, never>;
  assets: string;
  strings: Record<string, never>;
  textStyles: StyleKey;
  textFormats: "pill.number";
}>();

/** The node the fixture rests on. */
const home = defineNode({ rest: true, outcomes: {} });

const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: {},
  edges: { home: {} }
});

/** The two sizes of the pill. */
const textStyles = defineTextStyles({
  "digits.17": { font: "ui.font-digits", size: 17, fill: 0, digits: true },
  "digits.14": { font: "ui.font-digits", size: 14, fill: 0, digits: true }
});

/** How many times the format was asked: a write of the style `text` has to mend is one more. */
export const asked = { count: 0 };

/** Thousands take a K and the smaller size: what the engine knows nothing about. */
const textFormats = defineTextFormats({
  "pill.number": value => {
    asked.count += 1;

    return value < 1000
      ? { content: String(value), style: "digits.17" }
      : { content: `${Math.round(value / 100) / 10}K`, style: "digits.14" };
  }
});

/** The row that centres the pill, 300 wide. */
const centredRow = {
  width: 300,
  height: 60,
  direction: "row",
  align: "center",
  justify: "center"
} as const;

/** The size of every control button of the fixture. */
const control = { width: 100, height: 60 } as const;

/** What the pill's local state starts at, and what the controls move. */
type PillLocal = { value: number; level: number; named: boolean };

/** A pill whose controls commit a new `components` prop, and take the name off its bind. */
export const Pill = defineComponent("Pill", {
  local: { value: 1500, level: 0, named: true } as PillLocal,
  view: (_props: object, local) => (
    <column key="pillRoot" style={{ width: 800, height: 400 }}>
      <row key="pillRow" style={centredRow}>
        <text
          key="pill"
          style="digits.17"
          bind={bind(Counter, "value", { format: local.named ? "pill.number" : "int" })}
          components={[Counter({ value: local.value }), Mark({ level: local.level })]}
        />
      </row>
      <button key="touch" local={{ level: local.level + 1 }} style={control} />
      <button key="builtIn" local={{ named: false }} style={control} />
    </column>
  )
});

/** A screen with the pill. */
export const pillScreen = projection({
  name: "pillScreen",
  layer: "ui",
  from: (): Array<{ id: string }> => [{ id: "pillScreen" }],
  key: (item: { id: string }) => item.id,
  view: () => <Pill key="pillBox" />
});

/** The feature of the fixture. */
const formatFeature = defineFeature("format", {
  flows: [main],
  projections: [pillScreen],
  ui: [Pill],
  textStyles,
  textFormats
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
 * Starts the screen set plus `ui` headless, with the flow resting on `home`, and no screen mounted.
 *
 * @returns The started app, one frame in.
 */
export async function startFormatApp() {
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
      formatFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { level: 1 }, initialSession: {}, seed: 1 }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.time.step(16);

  return app;
}

/** The app `startFormatApp` builds. */
export type FormatApp = Awaited<ReturnType<typeof startFormatApp>>;
