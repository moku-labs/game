import { afterEach, describe, expect, it, vi } from "vitest";
import { defineAnimation, projection, Transform, tween } from "../../../../index";
import { defineScene } from "../../../scenes/define";
import { Text } from "../../../text/components";
import type { TextValue } from "../../../text/types";
import { defineComponent } from "../../jsx/component";
import { type Player, startUiApp } from "../app";

// ---------------------------------------------------------------------------
// Integration: the dev hot swap on the real screen set. The footer of
// `@moku-labs/game/hot` calls `globalThis.__moku_hot` with the new exports of
// a saved view module; here the test calls it the same way. The HUD of the
// fixture holds the Settings component, whose tab is local state.
// ---------------------------------------------------------------------------

/** The handler the footer calls. */
type Swap = (next: unknown, file: string) => void;

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
async function startDevApp() {
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
 * Reads the string a label of the screen shows.
 *
 * @param app - The started app.
 * @param key - The key of the label.
 * @returns The content of its `Text`, or `undefined`.
 */
function labelOf(
  app: Awaited<ReturnType<typeof startUiApp>>,
  key: string
): TextValue["content"] | undefined {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key) ?? 0;

  return app.world.ecs.get(entity, Text)?.content;
}

describe("dev hot swap", () => {
  it("re-renders a mounted component with the new view and keeps its local state", async () => {
    const app = await startDevApp();

    app.input.tap(app.ui.find("video") ?? 0);
    app.time.step(16);

    expect(labelOf(app, "which")).toBe("video:3");

    hotSwap()({ Settings: NewSettings }, FILE);
    app.time.step(16);

    expect(app.ui.find("heading")).toBeDefined();
    expect(labelOf(app, "which")).toBe("tab video, volume 3");
    expect(app.ui.tree().children[2]?.local).toEqual({ tab: "video" });
    expect(app.log.trace().find(entry => entry.event === "ui:hot-swap")?.data).toEqual({
      file: FILE,
      components: ["Settings"],
      projections: []
    });

    await app.stop();
  });

  it("re-renders a mounted projection with the new view", async () => {
    const app = await startDevApp();

    expect(labelOf(app, "coins")).toBe("7");

    hotSwap()({ hud: newHud }, FILE);
    app.time.step(16);

    expect(labelOf(app, "coins")).toBe("coins 7");
    expect(app.log.trace().find(entry => entry.event === "ui:hot-swap")?.data).toEqual({
      file: FILE,
      components: [],
      projections: ["hud"]
    });

    await app.stop();
  });

  it.each([
    ["homeScene", defineScene("home", { bundle: "home", layers: { board: {} }, projections: [] })],
    [
      "coinsFly",
      defineAnimation("hud.coinsFly", {
        slots: {},
        build: () =>
          tween({ projection: "hud", key: "coins" }, Transform, { scale: 0.4 }, { ms: 600 })
      })
    ]
  ])("refuses a module exporting %s and changes nothing", async (name, value) => {
    const app = await startDevApp();

    expect(() => hotSwap()({ Settings: NewSettings, hud: newHud, [name]: value }, FILE)).toThrow(
      `[game] Hot swap refused for ${FILE}: exports "${name}", registered at start.\n` +
        "  The page reloads and restores its state."
    );

    // The local write re-renders the panel: with the old view, through the old projection.
    app.input.tap(app.ui.find("video") ?? 0);
    app.time.step(16);
    app.time.step(16);

    expect(labelOf(app, "which")).toBe("video:3");
    expect(labelOf(app, "coins")).toBe("7");
    expect(app.ui.find("heading")).toBeUndefined();
    expect(app.log.trace().find(entry => entry.event === "ui:hot-refused")?.data).toEqual({
      file: FILE,
      reason: `exports "${name}", registered at start`
    });

    await app.stop();
  });
});
