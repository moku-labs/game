import { afterEach, describe, expect, it, vi } from "vitest";
import {
  component,
  defineAnimation,
  defineGame,
  defineMotion,
  defineTextStyles,
  Glow,
  projection,
  system,
  Transform,
  tween
} from "../../../../index";
import { defineScene } from "../../../scenes/define";
import type { AnyProjectionSpec } from "../../../world/projection/types";
import { installHot } from "../../hot";
import { uiPlugin } from "../../index";
import { defineComponent } from "../../jsx/component";
import type { JsxModule } from "../../jsx/types";
import { defineStyle } from "../../styles/define";
import { defineTokens } from "../../styles/tokens";
import type { UiCtx } from "../../types";
import { createUiApp } from "../app";

// ---------------------------------------------------------------------------
// Unit test: the dev hot swap handler over a stub world, time, log and jsx
// module. Each row of the export table, the two refusals of a module that
// brings nothing, and the install under the dev flag on a real app.
// ---------------------------------------------------------------------------

/** The global the footer of `@moku-labs/game/hot` calls. */
const HOT = "__moku_hot";

/** The path of the saved module every swap is reported with. */
const FILE = "/game/features/hud/view.tsx";

/** The handler the footer calls. */
type Swap = (next: unknown, file: string) => void;

const { defineNode, defineFlow } = defineGame<{
  player: { coins: number };
  session: { visits: number };
  assets: string;
  strings: Record<string, never>;
}>();

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, HOT);
});

/**
 * Builds the stubs the handler talks to. `replace` of the world throws for any name but `hud`,
 * the way the world refuses a projection no feature registered.
 *
 * @returns The domain context, the jsx module and the spies on both.
 */
function stubs() {
  const info = vi.fn();
  const replace = vi.fn((spec: AnyProjectionSpec): void => {
    if (spec.name === "hud") return;

    throw new Error(
      `[game] Projection "${spec.name}" is not registered.\n  Register it before replacing it.`
    );
  });
  const rerunAll = vi.fn();
  const wake = vi.fn();
  const replaceComponent = vi.fn();
  const refreshAll = vi.fn();
  const ctx = {
    log: { info },
    deps: { world: { projection: { replace, rerunAll } }, time: { wake } }
  } as unknown as UiCtx;
  const jsx = { replace: replaceComponent, refreshAll } as unknown as JsxModule;

  return { ctx, jsx, info, replace, rerunAll, wake, replaceComponent, refreshAll };
}

/**
 * Installs the handler over fresh stubs and reads it back from the global.
 *
 * @returns The handler, the remover and the spies.
 */
function installed() {
  const parts = stubs();
  const remove = installHot(parts.ctx, parts.jsx);
  const swap = Reflect.get(globalThis, HOT) as Swap;

  return { ...parts, remove, swap };
}

/** A new view of the settings panel, as a saved `settings.tsx` exports it. */
const Settings = defineComponent("Settings", {
  local: { tab: "audio" },
  view: () => ({ type: "column", props: {}, children: [] })
});

/** A new view of the HUD, keyed per item. */
const hud = projection({
  name: "hud",
  layer: "ui",
  from: (player: { coins: number }) => [{ id: "hud", coins: player.coins }],
  key: (item: { id: string }) => item.id,
  view: () => ({ type: "row", props: {}, children: [] })
});

/** A projection no feature registered: a scene would have to mount it. */
const shop = projection({
  name: "shop.items",
  layer: "ui",
  from: () => [{ id: "s1" }],
  key: (item: { id: string }) => item.id,
  view: () => ({ type: "row", props: {}, children: [] })
});

/** The refusal message of a module, with its reason. */
function refusal(reason: string): string {
  return `[game] Hot swap refused for ${FILE}: ${reason}.\n  The page reloads and restores its state.`;
}

describe("installHot", () => {
  it("sets globalThis.__moku_hot, and the remover deletes it", () => {
    const { remove, swap } = installed();

    expect(typeof swap).toBe("function");

    remove();

    expect(Reflect.has(globalThis, HOT)).toBe(false);
  });

  it("leaves the handler of a newer app alone", () => {
    const first = installed();
    const second = installed();

    first.remove();

    expect(Reflect.get(globalThis, HOT)).toBe(second.swap);

    second.remove();

    expect(Reflect.has(globalThis, HOT)).toBe(false);
  });
});

describe("the swap: what it replaces", () => {
  it("replaces a component definition by name and repaints every root", () => {
    const { swap, info, replace, rerunAll, wake, replaceComponent, refreshAll } = installed();

    swap({ Settings }, FILE);

    expect(replaceComponent).toHaveBeenCalledExactlyOnceWith(Settings);
    expect(replace).not.toHaveBeenCalled();
    expect(refreshAll).toHaveBeenCalledOnce();
    expect(rerunAll).toHaveBeenCalledOnce();
    expect(wake).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledExactlyOnceWith("ui:hot-swap", {
      file: FILE,
      components: ["Settings"],
      projections: []
    });
  });

  it("replaces a registered projection through world", () => {
    const { swap, info, replace, replaceComponent } = installed();

    swap({ hud }, FILE);

    expect(replace).toHaveBeenCalledExactlyOnceWith(hud);
    expect(replaceComponent).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledExactlyOnceWith("ui:hot-swap", {
      file: FILE,
      components: [],
      projections: ["hud"]
    });
  });

  it("takes a projection of one plain object, which has no key", () => {
    const { swap, replace } = installed();
    const single = projection({
      name: "hud",
      layer: "ui",
      from: (player: { coins: number }) => ({ coins: player.coins }),
      view: () => ({ type: "row", props: {}, children: [] })
    });

    swap({ single }, FILE);

    expect(replace).toHaveBeenCalledExactlyOnceWith(single);
  });

  it("swaps nothing for styles, tokens, motions, values and plain functions, and still repaints", () => {
    const { swap, info, replace, rerunAll, wake, replaceComponent, refreshAll } = installed();
    const next = {
      panel: defineStyle({ gap: 8 }),
      palette: defineTokens({ color: { ink: 0x3a_22_12 } }),
      pop: defineMotion({
        states: { small: { Transform: { scale: 0.8 } } },
        on: { enter: "small" }
      }),
      GAP: 8,
      title: "Settings",
      nothing: undefined,
      // eslint-disable-next-line unicorn/no-null -- a module may export null; it swaps nothing.
      empty: null,
      formatCoins: (coins: number): string => `${coins} coins`,
      Badge: (): { type: string; props: object; children: [] } => ({
        type: "row",
        props: {},
        children: []
      })
    };

    swap(next, FILE);

    expect(replaceComponent).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(refreshAll).toHaveBeenCalledOnce();
    expect(rerunAll).toHaveBeenCalledOnce();
    expect(wake).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledExactlyOnceWith("ui:hot-swap", {
      file: FILE,
      components: [],
      projections: []
    });
  });
});

/** Every value a game registers at start, under the export name a module would give it. */
const registeredAtStart: ReadonlyArray<readonly [string, unknown]> = [
  ["homeScene", defineScene("home", { bundle: "home", layers: { board: {} }, projections: [] })],
  [
    "coinsFly",
    defineAnimation("hud.coinsFly", {
      slots: {},
      build: () =>
        tween({ projection: "hud", key: "coins" }, Transform, { scale: 0.4 }, { ms: 600 })
    })
  ],
  ["steam", { id: "fx.steam", config: { rate: 12 } }],
  [
    "mainFlow",
    defineFlow("main", {
      nodes: { home: defineNode({ rest: true, outcomes: {} }) },
      start: "home",
      outcomes: {},
      edges: { home: {} }
    })
  ],
  ["homeNode", defineNode({ rest: true, outcomes: {} })],
  ["spin", system({ name: "spin", phase: "animate", query: [], run: () => undefined })],
  ["Health", component("Health", { hp: 0 })],
  ["Glow", Glow],
  ["styles", defineTextStyles({ "hud.digits": { font: "ui.font", size: 40, fill: 0xff_e0_82 } })],
  ["uiPlugin", uiPlugin]
];

describe("the swap: what it refuses", () => {
  it.each(
    registeredAtStart
  )("refuses a module exporting %s, registered at start", (name, value) => {
    const { swap, info, replace, replaceComponent, refreshAll } = installed();

    expect(() => swap({ Settings, hud, [name]: value }, FILE)).toThrow(
      refusal(`exports "${name}", registered at start`)
    );
    expect(info).toHaveBeenCalledExactlyOnceWith("ui:hot-refused", {
      file: FILE,
      reason: `exports "${name}", registered at start`
    });
    expect(replace).not.toHaveBeenCalled();
    expect(replaceComponent).not.toHaveBeenCalled();
    expect(refreshAll).not.toHaveBeenCalled();
  });

  it("refuses a projection no feature registered, before any component is written", () => {
    const { swap, info, replaceComponent, refreshAll, wake } = installed();
    const reason = '"shop.items" is a new projection, a scene mounts it';

    expect(() => swap({ Settings, shop }, FILE)).toThrow(refusal(reason));
    expect(info).toHaveBeenCalledExactlyOnceWith("ui:hot-refused", { file: FILE, reason });
    expect(replaceComponent).not.toHaveBeenCalled();
    expect(refreshAll).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
  });

  it("refuses a projection world turns down for another reason, with that reason", () => {
    const { swap, replace, replaceComponent } = installed();

    replace.mockImplementation(() => {
      throw new Error(
        '[game] Projection "hud" names layer "fx", which the scene does not declare.\n' +
          "  Add it to the layers of the scene."
      );
    });

    expect(() => swap({ Settings, hud }, FILE)).toThrow(
      refusal('Projection "hud" names layer "fx", which the scene does not declare')
    );
    expect(replaceComponent).not.toHaveBeenCalled();
  });

  it("refuses a module that did not evaluate", () => {
    const { swap, info, refreshAll } = installed();

    expect(() => swap(undefined, FILE)).toThrow(refusal("the module did not evaluate"));
    expect(info).toHaveBeenCalledExactlyOnceWith("ui:hot-refused", {
      file: FILE,
      reason: "the module did not evaluate"
    });
    expect(refreshAll).not.toHaveBeenCalled();
  });

  it("refuses a module with no exports", () => {
    const { swap, info, refreshAll } = installed();

    expect(() => swap({}, FILE)).toThrow(refusal("no exports"));
    expect(info).toHaveBeenCalledExactlyOnceWith("ui:hot-refused", {
      file: FILE,
      reason: "no exports"
    });
    expect(refreshAll).not.toHaveBeenCalled();
  });
});

describe("the install under the dev flag", () => {
  it("installs nothing without the dev flag", async () => {
    const app = createUiApp();

    await app.start();

    expect(Reflect.has(globalThis, HOT)).toBe(false);

    await app.stop();
  });

  it("installs the handler in a dev build and removes it on stop", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = createUiApp();

    await app.start();

    expect(typeof Reflect.get(globalThis, HOT)).toBe("function");

    await app.stop();

    expect(Reflect.has(globalThis, HOT)).toBe(false);
  });

  it("installs nothing when the dev flag is false", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", false);
    const app = createUiApp();

    await app.start();

    expect(Reflect.has(globalThis, HOT)).toBe(false);

    await app.stop();
  });
});
