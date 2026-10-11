/**
 * @file ui plugin — the app of the equal-description tests: one screen of 200 elements, every
 * style written inline, with a title from `tr()`, a bound counter and a label, drawn from three
 * fields of the model while a fourth one changes without being shown. Two eager locales whose
 * title measures to different widths, and on request a lazy bundle that brings the body font
 * after the screen is mounted. Real flow runner, plain Bun, inert renderer, real Yoga.
 */
import { vi } from "vitest";
import { bind, createApp, defineGame, projection, type } from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import type { AssetsIo, DecodedImage, Manifest, Texture } from "../../assets/types";
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
import { defineComponent } from "../jsx/component";

/** A game's own counter: the number the bound text of the header shows. */
export const Purse = component("Purse", { value: 0 });

/**
 * The player of the fixture: `coins`, `name` and `skin` are drawn, `ticks` is not.
 */
export type GridPlayer = { coins: number; name: string; skin: string; ticks: number };

const { defineNode, defineFlow, defineFeature, tr } = defineGame<{
  player: GridPlayer;
  session: { visits: number };
  assets: string;
  strings: { "grid.title": Record<string, never>; "grid.cell": { n: number } };
}>();

/** The start locale: a short title. */
const english: CompiledMessages = {
  "grid.title": () => [{ kind: "text", text: "Shop" }],
  "grid.cell": params => [{ kind: "text", text: `cell ${String(params.n)}` }]
};

/** The second locale: the same keys, the title three times as long. */
const german: CompiledMessages = {
  "grid.title": () => [{ kind: "text", text: "Kaufladen" }],
  "grid.cell": params => [{ kind: "text", text: `Zelle ${String(params.n)}` }]
};

/** How many list rows the screen holds: five elements each. */
export const ROWS = 38;

/** How many elements the screen holds: the root, the header of five, the rows, the footer of four. */
export const ELEMENTS = 1 + 5 + ROWS * 5 + 4;

/** A phone in reference units, with no notch. */
export const PHONE: ViewportSize = {
  width: 1080,
  height: 1920,
  scale: 0.36,
  orientation: "portrait",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 }
};

/** A taller phone with a notch: `when.tall` holds and `safeArea.top` is 44. */
export const TALL: ViewportSize = {
  ...PHONE,
  height: 2400,
  safeArea: { top: 44, right: 0, bottom: 0, left: 0 }
};

/** How many times the view of the grid ran: a commit that reaches the screen adds one. */
export const renders = { grid: 0 };

/** One item of the grid projection: the three drawn fields of the model. */
type GridItem = { id: string; coins: number; name: string; skin: string };

/**
 * One list row: an icon, two fixed texts and a button. Every style is a new object per call.
 *
 * @param index - The index of the row.
 * @returns The row.
 */
function listRow(index: number) {
  return (
    <row key={`r${index}`} style={{ height: 40, gap: 8 }}>
      <icon key={`i${index}`} name="ui.gear" style={{ width: 32, height: 32, tint: 0xff_ee_dd }} />
      <text key={`n${index}`} style={{ width: 200, height: 32 }} content={`item ${index}`} />
      <text
        key={`c${index}`}
        style={{ width: 200, height: 32 }}
        content={tr("grid.cell", { n: index })}
      />
      <button
        key={`b${index}`}
        intent="tick"
        payload={{ index }}
        style={{ width: 120, height: 32, fill: 0x22_22_22 }}
      />
    </row>
  );
}

/**
 * The screen of 200 elements. `ticks` is not part of the item, so a commit that only raises it
 * re-renders an equal description.
 */
export const gridScreen = projection({
  name: "grid",
  layer: "ui",
  from: (player: GridPlayer): GridItem[] => [
    { id: "grid", coins: player.coins, name: player.name, skin: player.skin }
  ],
  key: (item: GridItem) => item.id,
  view: (item: GridItem) => {
    renders.grid += 1;

    return (
      <column
        key="gridRoot"
        style={{ width: 1080, height: "100%", gap: 4, padding: { top: "safeArea.top" } }}
      >
        <row
          key="head"
          style={{ height: 120, gap: 16, align: "center", when: { tall: { height: 160 } } }}
        >
          <text key="title" style={{ alignSelf: "center" }} content={tr("grid.title")} />
          <text
            key="purse"
            style="digits"
            bind={bind(Purse, "value")}
            components={[Purse({ value: item.coins })]}
          />
          <button
            key="hot"
            intent="tick"
            style={{
              width: 160,
              height: 100,
              fill: 0x33_44_55,
              is: {
                hover: { fill: 0x55_66_77, scale: 1.1 },
                pressed: { fill: 0x11_22_33, width: 150 }
              }
            }}
          />
          <text key="label" style={{ alignSelf: "center" }} content={`for ${item.name}`} />
        </row>
        {Array.from({ length: ROWS }, (_unused, index) => listRow(index))}
        <row key="foot" style={{ height: 80, gap: 8 }}>
          <image key="art" texture={item.skin} fit="cover" style={{ width: 80, height: 80 }} />
          <panel key="plate" style={{ width: 80, height: 80, nineSlice: "ui.panel" }} />
          <stack key="slot" style={{ width: 80, height: 80, fill: 0x10_10_18 }} />
        </row>
      </column>
    );
  }
});

/**
 * A picker whose local state is a `Set`: each button writes the picked names plus its own, so
 * its `local` prop holds a new `Set` at every render.
 */
export const Picker = defineComponent("Picker", {
  local: { picked: new Set<string>() },
  view: (_props: object, local) => (
    <column key="pickerRoot" style={{ width: 600, height: 400 }}>
      <button
        key="pickA"
        local={{ picked: new Set([...local.picked, "a"]) }}
        style={{ width: 100, height: 60 }}
      />
      <button
        key="pickB"
        local={{ picked: new Set([...local.picked, "b"]) }}
        style={{ width: 100, height: 60 }}
      />
      <text
        key="picked"
        style={{ width: 200, height: 40 }}
        content={[...local.picked].toSorted().join(",")}
      />
    </column>
  )
});

/** One row of a single-root screen. */
type ScreenItem = { id: string };

/** A screen with the picker. */
export const pickerScreen = projection({
  name: "picker",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "picker" }],
  key: (item: ScreenItem) => item.id,
  view: () => <Picker key="pickerBox" />
});

/**
 * A screen with icons and no text: one icon without a size, its style written inline, so it is
 * square on one line of the `body` text style, and one with a fixed size.
 */
export const iconScreen = projection({
  name: "icons",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "icons" }],
  key: (item: ScreenItem) => item.id,
  view: () => (
    <column key="iconRoot" style={{ width: 600, height: 400, align: "start" }}>
      <icon key="autoIcon" name="ui.gear" style={{ tint: 0xff_ee_dd }} />
      <icon key="fixedIcon" name="ui.gear" style={{ width: 32, height: 32 }} />
    </column>
  )
});

const home = defineNode({
  rest: true,
  outcomes: { tick: type(), earn: type(), rename: type(), dress: type() }
});

/** A commit that changes nothing the screen draws. */
const tick = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.ticks += 1;

    return out.done();
  }
});

/** A commit that raises the bound counter: one `components` value changes. */
const earn = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.coins += 1;

    return out.done();
  }
});

/** A commit that makes the label longer: one `content` changes, and with it a rect. */
const rename = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.name = "a much longer name";

    return out.done();
  }
});

/** A commit that swaps the texture of the footer image: one `texture` changes. */
const dress = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.skin = "ui.gem";

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, tick, earn, rename, dress },
  start: "home",
  outcomes: {},
  edges: {
    home: { tick: "tick", earn: "earn", rename: "rename", dress: "dress" },
    tick: { done: "home" },
    earn: { done: "home" },
    rename: { done: "home" },
    dress: { done: "home" }
  }
});

/** The feature of the fixture: the grid screen and its two locales. */
export const gridFeature = defineFeature("grid", {
  flows: [main],
  projections: [gridScreen, pickerScreen, iconScreen],
  ui: [Picker],
  strings: { en: english, de: german }
});

/** The lazy bundle that brings the body font: only `app.assets.load(LATE_BUNDLE)` loads it. */
export const LATE_BUNDLE = "late";

/** What every glyph of the late font advances, and its line height, at the 32 px of `body`. */
export const LATE_FONT = { advance: 30, lineHeight: 48 } as const;

/** The manifest of the late font: one lazy bundle with the font the built-in `body` style names. */
const lateManifest: Manifest = {
  version: 1,
  bundles: {
    [LATE_BUNDLE]: {
      feature: "ui",
      tier: "lazy",
      mb: 0.063,
      files: [
        {
          key: "ui.font-body",
          path: "fonts/body.fnt",
          kind: "font",
          width: 0,
          height: 0,
          mb: 0.063,
          pages: [{ path: "fonts/body_0.png", width: 128, height: 128, mb: 0.063 }]
        }
      ]
    }
  }
};

/**
 * The late font as BMFont JSON: every printable ASCII character, each `LATE_FONT.advance` wide.
 *
 * @returns The text of the `.fnt` file.
 */
function lateFontFile(): string {
  const chars = Array.from({ length: 95 }, (_unused, index) => ({
    id: 32 + index,
    xadvance: LATE_FONT.advance
  }));

  return JSON.stringify({
    info: { face: "late", size: 32 },
    common: { lineHeight: LATE_FONT.lineHeight, base: 32 },
    chars
  });
}

/**
 * The file seam of `assets` for the late font: every fetch answers the `.fnt` text, and the page
 * decodes to a stand-in. The renderer is inert, so nothing reaches a GPU.
 *
 * @returns The seam.
 */
function lateFontIo(): AssetsIo {
  const page = { width: 128, height: 128 };

  return {
    fetch: url =>
      Promise.resolve({
        ok: true,
        status: 200,
        // eslint-disable-next-line unicorn/no-null -- a `Response` answers a missing header with null.
        headers: { get: () => null },
        json: () => Promise.resolve({}),
        blob: () => Promise.resolve(new Blob([url])),
        text: () => Promise.resolve(lateFontFile()),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
      }),
    decode: () => Promise.resolve(page as unknown as DecodedImage),
    createTexture: image => image as unknown as Texture,
    sliceTexture: texture => texture,
    destroyTexture: () => undefined
  };
}

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
async function tick60(): Promise<void> {
  for (let index = 0; index < 60; index += 1) await Promise.resolve();
}

/**
 * Builds the screen set plus `ui` with the fixture's configs, not started yet.
 *
 * @param options - What the app adds to the fixture.
 * @param options.lateFont - Whether `assets` carries the lazy bundle of the body font.
 * @returns The app, before `start()`.
 */
export function createGridApp(options: { lateFont?: boolean } = {}) {
  renders.grid = 0;

  return createApp({
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
      gridFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: {
        initialPlayer: { coins: 7, name: "Al", skin: "ui.coin", ticks: 0 },
        initialSession: { visits: 0 },
        seed: 1
      },
      ...(options.lateFont === true ? { assets: { manifest: lateManifest, io: lateFontIo() } } : {})
    }
  });
}

/**
 * Starts the app headless on a phone, with the flow resting on `home`, and mounts its screens:
 * the reconcile, the first solve and the first resolve of `text` have run.
 *
 * @param app - The app to start; a new one when left out.
 * @param screens - The projections to mount; the grid of 200 elements when left out.
 * @returns The started app, the elements of the mounted screens live.
 */
export async function startGridApp(app = createGridApp(), screens: readonly string[] = ["grid"]) {
  vi.spyOn(app.renderer.viewport, "size").mockReturnValue(PHONE);

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick60();

  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.world.projection.mount(screens, { kind: "plugin", name: "test" });
  app.time.step(16);
  app.time.step(16);
  app.time.step(16);

  return app;
}

/** The app `startGridApp` builds. */
export type GridApp = Awaited<ReturnType<typeof startGridApp>>;

/**
 * Answers the gate on Home, lets the runner commit and come back to Home, and steps the one
 * frame the commit lands in.
 *
 * @param app - The running app.
 * @param intent - Which node runs.
 */
export async function commit(
  app: GridApp,
  intent: "tick" | "earn" | "rename" | "dress"
): Promise<void> {
  app.flow.gate.answer({ intent });
  await tick60();
  app.time.step(16);
}
