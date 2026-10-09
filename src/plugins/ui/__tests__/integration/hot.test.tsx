import { afterEach, describe, expect, it, vi } from "vitest";
import { defineAnimation, mark, play, projection } from "../../../../index";
import type { CompiledMessages } from "../../../i18n/types";
import { defineScene } from "../../../scenes/define";
import { defineTextStyles, Text } from "../../../text/components";
import type { TextValue } from "../../../text/types";
import { Box } from "../../components";
import { defineComponent } from "../../jsx/component";
import { coinsPop, type Player, startUiApp } from "../app";

// ---------------------------------------------------------------------------
// Integration: the dev hot swap on the real screen set. The footer of
// `@moku-labs/game/hot` calls `globalThis.__moku_hot` with the new exports of
// a saved module; here the test calls it the same way. The HUD of the fixture
// holds the Settings component, whose tab is local state; the fixture also
// registers the animation `hud.coinsPop` and the English `hud.coins`.
// ---------------------------------------------------------------------------

/** The handler the footer calls. */
type Swap = (next: unknown, file: string) => void;

/** The started fixture. */
type App = Awaited<ReturnType<typeof startUiApp>>;

/** The path of the saved module every swap is reported with. */
const FILE = "/game/features/hud/view.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Reads the handler the running app installed.
 *
 * @returns The handler.
 */
function hotSwap(): Swap {
  return Reflect.get(globalThis, "__moku_hot") as Swap;
}

/**
 * Starts the fixture in a dev build, so `ui` installs the handler.
 *
 * @returns The started app with the HUD mounted.
 */
async function startDevApp(): Promise<App> {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);

  return startUiApp();
}

/** The settings panel after a save: a heading over the tabs, another label, the same local. */
const NewSettings = defineComponent("Settings", {
  local: { tab: "audio" },
  view: (props: { volume: number }, local) => (
    <column key="settings" style={{ gap: 8, width: 400, height: 260 }}>
      <text key="heading" style={{ width: 200, height: 40 }} content="Settings" />
      <button key="audio" local={{ tab: "audio" }} style={{ width: 120, height: 60 }} />
      <button key="video" local={{ tab: "video" }} style={{ width: 120, height: 60 }} />
      <text
        key="which"
        style={{ width: 300, height: 40 }}
        content={`tab ${local.tab}, volume ${props.volume}`}
      />
    </column>
  )
});

/** One item of the HUD projection: the screen is one row of the model. */
type HudItem = { id: string; coins: number };

/** The HUD after a save: the coin label reads "coins 7" instead of "7". */
const newHud = projection({
  name: "hud",
  layer: "ui",
  from: (player: Player): HudItem[] => [{ id: "hud", coins: player.coins }],
  key: (item: HudItem) => item.id,
  view: (item: HudItem) => (
    <row key="bar" style={{ direction: "row", gap: 10, width: 1080, height: 120 }}>
      <text key="coins" style={{ width: 200, height: 60 }} content={`coins ${item.coins}`} />
      <button key="settings" intent="openSettings" style={{ width: 100, height: 100 }} />
      <NewSettings key="panel" volume={3} />
    </row>
  )
});

/**
 * Reads the text a label of the screen holds.
 *
 * @param app - The started app.
 * @param key - The key of the label.
 * @returns Its `Text`, or `undefined`.
 */
function textOf(app: App, key: string): TextValue | undefined {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key) ?? 0;

  return app.world.ecs.get(entity, Text);
}

/**
 * Reads the data of the last log entry with that event.
 *
 * @param app - The started app.
 * @param event - The event of the entry.
 * @returns Its data, or `undefined`.
 */
function loggedData(app: App, event: string): unknown {
  return app.log.trace().findLast(entry => entry.event === event)?.data;
}

describe("dev hot swap", () => {
  it("re-renders a mounted component with the new view and keeps its local state", async () => {
    const app = await startDevApp();

    app.input.tap(app.ui.find("video") ?? 0);
    app.time.step(16);

    expect(textOf(app, "which")?.content).toBe("video:3");

    hotSwap()({ Settings: NewSettings }, FILE);
    app.time.step(16);

    expect(app.ui.find("heading")).toBeDefined();
    expect(textOf(app, "which")?.content).toBe("tab video, volume 3");
    expect(app.ui.tree().children[2]?.local).toEqual({ tab: "video" });
    expect(loggedData(app, "ui:hot-swap")).toEqual({
      file: FILE,
      components: ["Settings"],
      projections: [],
      animations: [],
      emitters: [],
      strings: [],
      textStyles: []
    });

    await app.stop();
  });

  it("forwards the assets stamp without rendering a view again", async () => {
    const app = await startDevApp();
    const stamp = "/game/.moku/assets-stamp.ts";
    let renders = 0;
    const Counted = defineComponent("Settings", {
      local: { tab: "audio" },
      view: (props: { volume: number }, local) => {
        renders += 1;

        return (
          <column key="settings" style={{ gap: 8, width: 400, height: 260 }}>
            <button key="audio" local={{ tab: "audio" }} style={{ width: 120, height: 60 }} />
            <button key="video" local={{ tab: "video" }} style={{ width: 120, height: 60 }} />
            <text
              key="which"
              style={{ width: 300, height: 40 }}
              content={`${local.tab}:${props.volume}`}
            />
          </column>
        );
      }
    });

    hotSwap()({ Settings: Counted }, FILE);
    app.time.step(16);

    const rendered = renders;

    expect(rendered).toBeGreaterThan(0);

    // The stamp of the keys watch names asset files: `assets` hooks the event, no view runs.
    hotSwap()(
      { default: { files: { "features/ui/assets/fx-spark.webp": "2554:1" }, changed: [] } },
      stamp
    );
    app.time.step(16);
    app.time.step(16);

    expect(renders).toBe(rendered);
    expect(loggedData(app, "ui:hot-swap")).toEqual({
      file: stamp,
      components: [],
      projections: [],
      animations: [],
      emitters: [],
      strings: [],
      textStyles: []
    });

    // Any other module that is not refused repaints, a module of plain values too.
    hotSwap()({ GAP: 8 }, FILE);
    app.time.step(16);

    expect(renders).toBeGreaterThan(rendered);

    await app.stop();
  });

  it("re-renders a mounted projection with the new view", async () => {
    const app = await startDevApp();

    expect(textOf(app, "coins")?.content).toBe("7");

    hotSwap()({ hud: newHud }, FILE);
    app.time.step(16);

    expect(textOf(app, "coins")?.content).toBe("coins 7");
    expect(loggedData(app, "ui:hot-swap")).toMatchObject({ projections: ["hud"] });

    await app.stop();
  });

  it("re-renders a label with the strings of a regenerated strings file", async () => {
    const app = await startDevApp();

    app.world.projection.mount(["hud", "rich"], { kind: "plugin", name: "test" });
    app.time.step(16);
    app.time.step(16);

    expect(textOf(app, "auto")?.resolved).toBe("coins 3");

    const english: CompiledMessages = {
      "hud.coins": params => [{ kind: "text", text: `${String(params.n)} gold` }]
    };

    hotSwap()({ default: english }, "/game/generated/strings.en.ts");
    app.time.step(16);

    expect(textOf(app, "auto")?.resolved).toBe("3 gold");
    expect(loggedData(app, "ui:hot-swap")).toMatchObject({ strings: ["en"] });

    await app.stop();
  });

  it("lays a label out again at the size of a swapped text style", async () => {
    const app = await startDevApp();

    app.world.projection.mount(["hud", "rich"], { kind: "plugin", name: "test" });
    app.time.step(16);
    app.time.step(16);

    const styled = app.ui.find("styled") ?? 0;
    const swapped = (size: number): void => {
      hotSwap()(
        { styles: defineTextStyles({ body: { font: "ui.font-body", size, fill: 0xff_ff_ff } }) },
        "/game/features/ui/styles.ts"
      );
      app.time.step(16);
      app.time.step(16);
    };

    // The row is narrower than the label, so the height shows the new size.
    swapped(100);
    expect(app.world.ecs.get(styled, Box)?.h).toBe(120);

    swapped(50);
    expect(app.world.ecs.get(styled, Box)?.h).toBe(60);
    expect(loggedData(app, "ui:hot-swap")).toMatchObject({ textStyles: ["body"] });

    await app.stop();
  });

  it("plays the new build of a swapped animation the next time it plays", async () => {
    const app = await startDevApp();
    const reached: string[] = [];

    app.anim.onMark((_animation, name) => reached.push(name));
    app.flow.fx.dispatch(play(coinsPop, {}));
    app.time.step(16);

    hotSwap()(
      { coinsPop: defineAnimation("hud.coinsPop", { slots: {}, build: () => mark("v2") }) },
      "/game/features/hud/animations.ts"
    );
    app.flow.fx.dispatch(play(coinsPop, {}));
    app.time.step(16);

    expect(reached).toEqual(["v1", "v2"]);

    await app.stop();
  });

  it.each([
    [
      "homeScene",
      defineScene("home", { bundle: "home", layers: { board: {} }, projections: [] }),
      'exports "homeScene", registered at start'
    ],
    [
      "sparkle",
      defineAnimation("hud.sparkle", { slots: {}, build: () => mark("shone") }),
      'Animation "hud.sparkle" is not registered'
    ]
  ])("refuses a module exporting %s and writes no component", async (name, value, reason) => {
    const app = await startDevApp();

    expect(() => hotSwap()({ Settings: NewSettings, hud: newHud, [name]: value }, FILE)).toThrow(
      `[game] Hot swap refused for ${FILE}: ${reason}.\n` +
        "  The page reloads and restores its state."
    );

    // The local write re-renders the panel: the registry still holds the old Settings.
    app.input.tap(app.ui.find("video") ?? 0);
    app.time.step(16);
    app.time.step(16);

    expect(textOf(app, "which")?.content).toBe("video:3");
    expect(app.ui.find("heading")).toBeUndefined();
    expect(loggedData(app, "ui:hot-refused")).toEqual({ file: FILE, reason });

    await app.stop();
  });
});
