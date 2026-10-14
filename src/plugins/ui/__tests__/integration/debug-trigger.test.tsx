import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, projection, type } from "../../../../index";
import { animPlugin } from "../../../anim";
import { assetsPlugin } from "../../../assets";
import { i18nPlugin } from "../../../i18n";
import { inputPlugin } from "../../../input";
import { rendererPlugin } from "../../../renderer";
import { scenesPlugin } from "../../../scenes";
import { textPlugin } from "../../../text";
import { worldPlugin } from "../../../world";
import { DebugTrigger } from "../../components";
import { uiPlugin } from "../../index";

// ---------------------------------------------------------------------------
// Integration: DebugTrigger on a real app with ui, headless renderer. Five
// taps within three seconds of wall time open the editor's overlay through
// app.debug.overlay; game time plays no part.
// ---------------------------------------------------------------------------

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { coins: number };
  session: { visits: number };
  assets: string;
  strings: Record<string, never>;
}>();

/** The settings sheet: the version line, a play button, a trigger with an intent, a text trigger, two tiny buttons. */
const sheet = projection({
  name: "sheet",
  layer: "ui",
  from: (): { id: string }[] => [{ id: "sheet" }],
  key: (item: { id: string }) => item.id,
  view: () => (
    <column key="sheetRoot" style={{ gap: 10, width: 1080, height: 1920 }}>
      <button key="versionLine" style={{ width: 600, height: 200 }} components={[DebugTrigger()]}>
        <text key="version" style={{ width: 300, height: 60 }} content="1.4.0" />
      </button>
      <button key="play" intent="play" style={{ width: 600, height: 200 }} />
      <button
        key="answering"
        intent="play"
        style={{ width: 600, height: 200 }}
        components={[DebugTrigger()]}
      />
      <text
        key="label"
        style={{ width: 300, height: 60 }}
        content="v"
        components={[DebugTrigger()]}
      />
      <button key="tiny" style={{ width: 4, height: 4 }} components={[DebugTrigger()]} />
      <button key="tinyPlain" style={{ width: 4, height: 4 }} />
    </column>
  )
});

const home = defineNode({ rest: true, outcomes: { play: type() } });
const board = defineNode({ rest: true, outcomes: { back: type() } });
const main = defineFlow("main", {
  nodes: { home, board },
  start: "home",
  outcomes: {},
  edges: { home: { play: "board" }, board: { back: "home" } }
});
const settingsFeature = defineFeature("settings", { flows: [main], projections: [sheet] });

/** The page clock the test moves: what `performance.now()` answers. */
const clock = { now: 1000 };

/** A channel as the editor's page agent sets it. */
const channel = {
  open: vi.fn(),
  close: vi.fn(),
  toggle: vi.fn(),
  isOpen: vi.fn(() => false)
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  channel.open.mockClear();
});

/** Yields the microtask queue to the loop. */
async function tick(): Promise<void> {
  for (let index = 0; index < 60; index += 1) await Promise.resolve();
}

/**
 * Starts the app with the sheet mounted, after the flags a test stubbed.
 *
 * @returns The started app, two frames in.
 */
async function startSheet() {
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
      settingsFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialPlayer: { coins: 0 }, initialSession: { visits: 0 }, seed: 1 }
    }
  });

  vi.spyOn(globalThis.performance, "now").mockImplementation(() => clock.now);
  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();
  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.world.projection.mount(["sheet"], { kind: "plugin", name: "test" });
  app.time.step(16);
  app.time.step(16);

  return app;
}

/** The started app of a test. */
type SheetApp = Awaited<ReturnType<typeof startSheet>>;

/**
 * Taps a view by key after moving the page clock, one frame per tap.
 *
 * @param app - The started app.
 * @param viewKey - The view's key.
 * @param afterMs - Wall time since the last tap.
 */
async function tapAfter(app: SheetApp, viewKey: string, afterMs = 500): Promise<void> {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(viewKey) ?? 0;

  clock.now += afterMs;
  app.input.tap(entity);
  app.time.step(16);
  await tick();
}

/**
 * Reads the log events of the app.
 *
 * @param app - The started app.
 * @param event - The event name.
 * @returns The entries of that event.
 */
function events(app: SheetApp, event: string) {
  return app.log.trace().filter(entry => entry.event === event);
}

describe("DebugTrigger", () => {
  it("with the agent flag, five taps call __MOKU_GAME_OVERLAY__.open once and log ui:debug-trigger", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    vi.stubGlobal("__MOKU_GAME_OVERLAY__", channel);

    const app = await startSheet();

    for (let tap = 0; tap < 4; tap += 1) await tapAfter(app, "versionLine");

    expect(channel.open).not.toHaveBeenCalled();

    await tapAfter(app, "versionLine");

    expect(channel.open.mock.calls).toEqual([[{ mode: "card" }]]);
    expect(events(app, "ui:debug-trigger").map(entry => entry.data)).toEqual([
      { key: "versionLine" }
    ]);

    // After an open, five new taps are needed.
    for (let tap = 0; tap < 4; tap += 1) await tapAfter(app, "versionLine");

    expect(channel.open).toHaveBeenCalledTimes(1);

    await app.stop();
  });

  it("the window is wall time: with time.setScale(0) five taps spread over 6 s of page clock do not open, and five within 3 s do", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    vi.stubGlobal("__MOKU_GAME_OVERLAY__", channel);

    const app = await startSheet();

    app.time.setScale(0);

    for (let tap = 0; tap < 5; tap += 1) await tapAfter(app, "versionLine", 1500);

    expect(channel.open).not.toHaveBeenCalled();

    for (let tap = 0; tap < 4; tap += 1) await tapAfter(app, "versionLine", 700);

    expect(channel.open).toHaveBeenCalledTimes(1);

    await app.stop();
  });

  it("taps on another view neither count nor reset the count", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    vi.stubGlobal("__MOKU_GAME_OVERLAY__", channel);

    const app = await startSheet();

    for (let tap = 0; tap < 4; tap += 1) {
      await tapAfter(app, "versionLine", 300);
      await tapAfter(app, "play", 100);
    }

    expect(channel.open).not.toHaveBeenCalled();

    await tapAfter(app, "versionLine", 300);

    expect(channel.open).toHaveBeenCalledTimes(1);

    await app.stop();
  });

  it("with no overlay at all, one warning ui:debug-trigger-no-agent for any number of opens", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const app = await startSheet();

    for (let tap = 0; tap < 10; tap += 1) await tapAfter(app, "versionLine");

    expect(events(app, "ui:debug-trigger-no-agent").map(entry => entry.data)).toEqual([
      { key: "versionLine" }
    ]);
    expect(events(app, "ui:debug-trigger")).toEqual([]);

    await app.stop();
  });

  it("without the agent flag five taps call nothing and register no listener", async () => {
    vi.stubGlobal("__MOKU_GAME_OVERLAY__", channel);

    const app = await startSheet();

    for (let tap = 0; tap < 5; tap += 1) await tapAfter(app, "versionLine");

    expect(channel.open).not.toHaveBeenCalled();
    // The onAdded hook is not registered either: the text trigger is never checked.
    expect(events(app, "ui:debug-trigger-untouchable")).toEqual([]);
    expect(events(app, "ui:debug-trigger-no-agent")).toEqual([]);

    await app.stop();
  });

  it("a trigger on a button with an intent still answers that intent", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    vi.stubGlobal("__MOKU_GAME_OVERLAY__", channel);

    const app = await startSheet();

    expect(app.flow.state().path).toBe("home");

    await tapAfter(app, "answering");

    expect(app.flow.state().path).toBe("board");

    await app.stop();
  });

  it("a trigger on a text element warns ui:debug-trigger-untouchable once", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const app = await startSheet();

    for (let frame = 0; frame < 3; frame += 1) app.time.step(16);

    expect(events(app, "ui:debug-trigger-untouchable").map(entry => entry.data)).toEqual([
      { key: "label" }
    ]);

    await app.stop();
  });

  it("lint reports a trigger button smaller than tapTargetPt as tap-target", async () => {
    const app = await startSheet();
    const flagged = app.ui
      .lint()
      .filter(finding => finding.rule === "tap-target")
      .map(finding => finding.key);

    expect(flagged).toContain("tiny");
    // A button naming nothing without the tag is no tap target: the same findings as before.
    expect(flagged).not.toContain("tinyPlain");
    expect(flagged).not.toContain("versionLine");

    await app.stop();
  });
});
