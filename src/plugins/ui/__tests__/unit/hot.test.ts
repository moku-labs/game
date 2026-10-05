import { afterEach, describe, expect, it, vi } from "vitest";
import {
  component,
  defineAnimation,
  defineFeature,
  defineGame,
  defineMotion,
  defineTextStyles,
  Glow,
  mark,
  projection,
  system
} from "../../../../index";
import type { AnyAnimationDefinition } from "../../../anim/types";
import type { CompiledMessages } from "../../../i18n/types";
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
// Unit test: the dev hot swap handler over a stub world, anim, i18n, text,
// time, log, emit and jsx module. Each row of the export table, the order of
// the writes, the refusals, and the install under the dev flag on a real app.
// ---------------------------------------------------------------------------

/** The global the footer of `@moku-labs/game/hot` calls. */
const HOT = "__moku_hot";

/** The path of the saved module every swap is reported with. */
const FILE = "/game/features/hud/view.tsx";

/** The path of the strings module `assets:keys` writes for Russian. */
const STRINGS_RU = "/game/generated/strings.ru.ts";

/** The handler the footer calls. */
type Swap = (next: unknown, file: string) => void;

/** What the `ui:hot-swap` log line reports. */
type Summary = {
  file: string;
  components: string[];
  projections: string[];
  animations: string[];
  emitters: string[];
  strings: string[];
  textStyles: string[];
};

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
 * Builds the stubs the handler talks to. The world knows the projection `hud`, anim the
 * animation `hud.coinsFly`, and i18n one module of `ru` with the key `hud.orders`: anything else
 * throws the way the real plugins refuse it.
 *
 * @returns The domain context, the jsx module and the spies on both.
 */
function stubs() {
  const info = vi.fn();
  const emit = vi.fn();
  const replace = vi.fn((spec: AnyProjectionSpec): void => {
    if (spec.name === "hud") return;

    throw new Error(
      `[game] Projection "${spec.name}" is not registered.\n  Register it before replacing it.`
    );
  });
  const replaceAnimation = vi.fn((definition: AnyAnimationDefinition): void => {
    if (definition.id === "hud.coinsFly") return;

    throw new Error(
      `[game] Animation "${definition.id}" is not registered.\n  Register it before replacing it.`
    );
  });
  const replaceStrings = vi.fn((locale: string, messages: CompiledMessages): void => {
    if (Object.hasOwn(messages, "hud.orders")) return;

    throw new Error(
      `[game] Strings for "${locale}" match no single registered module.\n` +
        "  Replace them with the module of one feature, or reload the page."
    );
  });
  const replaceStyles = vi.fn();
  const rerunAll = vi.fn();
  const wake = vi.fn();
  const replaceComponent = vi.fn();
  const refreshAll = vi.fn();
  const ctx = {
    log: { info },
    emit,
    deps: {
      world: { projection: { replace, rerunAll } },
      anim: { replace: replaceAnimation },
      i18n: { replace: replaceStrings },
      text: { replaceStyles },
      time: { wake }
    }
  } as unknown as UiCtx;
  const jsx = { replace: replaceComponent, refreshAll } as unknown as JsxModule;

  return {
    ctx,
    jsx,
    info,
    emit,
    replace,
    replaceAnimation,
    replaceStrings,
    replaceStyles,
    rerunAll,
    wake,
    replaceComponent,
    refreshAll
  };
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

/**
 * The `ui:hot-swap` log line of one file: every list empty unless the patch fills it.
 *
 * @param file - The path of the saved module.
 * @param patch - The lists that are not empty.
 * @returns The log data.
 */
function summary(file: string, patch: Partial<Summary> = {}): Summary {
  return {
    file,
    components: [],
    projections: [],
    animations: [],
    emitters: [],
    strings: [],
    textStyles: [],
    ...patch
  };
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

/** A new build of a registered animation, as a saved `animations.ts` exports it. */
const coinsFly = defineAnimation("hud.coinsFly", { slots: {}, build: () => mark("landed") });

/** An animation no feature registered. */
const sparkle = defineAnimation("hud.sparkle", { slots: {}, build: () => mark("shone") });

/** An emitter, as a saved `effects.ts` exports it. */
const steam = { id: "fx.steam", config: { textures: ["fx.puff"], rate: 12 } };

/** A text style table, as a saved `styles.ts` exports it. */
const digits = defineTextStyles({ "hud.digits": { font: "ui.font", size: 40, fill: 0xff_e0_82 } });

/** The Russian strings of the orders feature, as `assets:keys` writes them again. */
const ordersRu: CompiledMessages = {
  "hud.orders": () => [{ kind: "text", text: "3 заказа!" }]
};

/**
 * The refusal message of a module, with its reason.
 *
 * @param reason - Why the module is refused.
 * @param file - The path of the saved module.
 * @returns The message of the throw.
 */
function refusal(reason: string, file = FILE): string {
  return `[game] Hot swap refused for ${file}: ${reason}.\n  The page reloads and restores its state.`;
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
    const { swap, info, emit, replace, rerunAll, wake, replaceComponent, refreshAll } = installed();

    swap({ Settings }, FILE);

    expect(replaceComponent).toHaveBeenCalledExactlyOnceWith(Settings);
    expect(replace).not.toHaveBeenCalled();
    expect(refreshAll).toHaveBeenCalledOnce();
    expect(rerunAll).toHaveBeenCalledOnce();
    expect(wake).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledExactlyOnceWith("ui:hot-swap", {
      file: FILE,
      module: { Settings }
    });
    expect(info).toHaveBeenCalledExactlyOnceWith(
      "ui:hot-swap",
      summary(FILE, { components: ["Settings"] })
    );
  });

  it("replaces a registered projection through world", () => {
    const { swap, info, replace, replaceComponent } = installed();

    swap({ hud }, FILE);

    expect(replace).toHaveBeenCalledExactlyOnceWith(hud);
    expect(replaceComponent).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledExactlyOnceWith(
      "ui:hot-swap",
      summary(FILE, { projections: ["hud"] })
    );
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

  it("replaces a registered animation through anim", () => {
    const { swap, info, replaceAnimation } = installed();

    swap({ coinsFly }, "/game/features/hud/animations.ts");

    expect(replaceAnimation).toHaveBeenCalledExactlyOnceWith(coinsFly);
    expect(info).toHaveBeenCalledExactlyOnceWith(
      "ui:hot-swap",
      summary("/game/features/hud/animations.ts", { animations: ["hud.coinsFly"] })
    );
  });

  it("leaves an emitter to effects, which takes it from the event", () => {
    const { swap, info, emit, replaceComponent, refreshAll } = installed();

    swap({ steam }, "/game/features/board/effects.ts");

    expect(replaceComponent).not.toHaveBeenCalled();
    expect(refreshAll).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledExactlyOnceWith("ui:hot-swap", {
      file: "/game/features/board/effects.ts",
      module: { steam }
    });
    expect(info).toHaveBeenCalledExactlyOnceWith(
      "ui:hot-swap",
      summary("/game/features/board/effects.ts", { emitters: ["fx.steam"] })
    );
  });

  it("replaces the strings of a generated strings file through i18n, the locale from the path", () => {
    const { swap, info, replaceStrings } = installed();

    swap({ default: ordersRu }, STRINGS_RU);

    expect(replaceStrings).toHaveBeenCalledExactlyOnceWith("ru", ordersRu);
    expect(info).toHaveBeenCalledExactlyOnceWith(
      "ui:hot-swap",
      summary(STRINGS_RU, { strings: ["ru"] })
    );
  });

  it("reads the locale of a strings file from a Windows path too", () => {
    const { swap, replaceStrings } = installed();

    swap({ default: ordersRu }, String.raw`C:\game\generated\strings.pt-BR.ts`);

    expect(replaceStrings).toHaveBeenCalledExactlyOnceWith("pt-BR", ordersRu);
  });

  it("takes a record of functions for strings only in a generated strings file", () => {
    const { swap, replaceStrings } = installed();

    swap({ default: ordersRu }, "/game/features/hud/messages.ts");

    expect(replaceStrings).not.toHaveBeenCalled();
  });

  it("replaces text styles through text", () => {
    const { swap, info, replaceStyles } = installed();

    swap({ digits }, "/game/features/hud/styles.ts");

    expect(replaceStyles).toHaveBeenCalledExactlyOnceWith(digits);
    expect(info).toHaveBeenCalledExactlyOnceWith(
      "ui:hot-swap",
      summary("/game/features/hud/styles.ts", { textStyles: ["hud.digits"] })
    );
  });

  it("swaps nothing for styles, tokens, motions, values and plain functions, and still repaints", () => {
    const { swap, info, emit, replace, rerunAll, wake, replaceComponent, refreshAll } = installed();
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
    expect(emit).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledExactlyOnceWith("ui:hot-swap", summary(FILE));
  });

  it("runs the replaces that may throw first, then the writes, the repaint, the event and the log", () => {
    const parts = installed();

    parts.swap({ Settings, digits, coinsFly, hud }, FILE);

    const order = [
      parts.replace,
      parts.replaceAnimation,
      parts.replaceComponent,
      parts.replaceStyles,
      parts.refreshAll,
      parts.rerunAll,
      parts.wake,
      parts.emit,
      parts.info
    ].map(spy => spy.mock.invocationCallOrder[0] ?? 0);

    expect(order).toEqual(order.toSorted((left, right) => left - right));
    expect(order).not.toContain(0);
  });
});

/** Every value a game registers at start, under the export name a module would give it. */
const registeredAtStart: ReadonlyArray<readonly [string, unknown]> = [
  ["homeScene", defineScene("home", { bundle: "home", layers: { board: {} }, projections: [] })],
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
  ["hudFeature", defineFeature("hud", {})],
  ["uiPlugin", uiPlugin]
];

describe("the swap: what it refuses", () => {
  it.each(
    registeredAtStart
  )("refuses a module exporting %s, registered at start", (name, value) => {
    const { swap, info, emit, replace, replaceAnimation, replaceComponent, refreshAll } =
      installed();

    expect(() => swap({ Settings, hud, coinsFly, [name]: value }, FILE)).toThrow(
      refusal(`exports "${name}", registered at start`)
    );
    expect(info).toHaveBeenCalledExactlyOnceWith("ui:hot-refused", {
      file: FILE,
      reason: `exports "${name}", registered at start`
    });
    expect(replace).not.toHaveBeenCalled();
    expect(replaceAnimation).not.toHaveBeenCalled();
    expect(replaceComponent).not.toHaveBeenCalled();
    expect(refreshAll).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("refuses a projection no feature registered, before any component is written", () => {
    const { swap, info, replaceComponent, refreshAll, wake } = installed();
    const reason = 'Projection "shop.items" is not registered';

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

  it("refuses a replace that throws a value that is not an Error, with its first line", () => {
    const { swap, info, replace, replaceComponent } = installed();
    const reason = 'Projection "hud" is busy';

    replace.mockImplementation(() => {
      throw '[game] Projection "hud" is busy.\n  Save again.';
    });

    expect(() => swap({ Settings, hud }, FILE)).toThrow(refusal(reason));
    expect(info).toHaveBeenCalledExactlyOnceWith("ui:hot-refused", { file: FILE, reason });
    expect(replaceComponent).not.toHaveBeenCalled();
  });

  it("refuses a replace whose message has one line, without the prefix and the period", () => {
    const { swap, replaceAnimation } = installed();

    replaceAnimation.mockImplementation(() => {
      throw new Error("[game] Animation registry is frozen.");
    });

    expect(() => swap({ coinsFly }, FILE)).toThrow(refusal("Animation registry is frozen"));
  });

  it("refuses an animation no feature registered, before any component or style is written", () => {
    const { swap, info, replaceComponent, replaceStyles, emit } = installed();
    const reason = 'Animation "hud.sparkle" is not registered';

    expect(() => swap({ Settings, digits, sparkle }, FILE)).toThrow(refusal(reason));
    expect(info).toHaveBeenCalledExactlyOnceWith("ui:hot-refused", { file: FILE, reason });
    expect(replaceComponent).not.toHaveBeenCalled();
    expect(replaceStyles).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("refuses strings i18n cannot place, before any component or style is written", () => {
    const { swap, replaceComponent, replaceStyles } = installed();
    const stray: CompiledMessages = { "shop.title": () => [{ kind: "text", text: "Лавка" }] };

    expect(() => swap({ default: stray, Settings, digits }, STRINGS_RU)).toThrow(
      refusal('Strings for "ru" match no single registered module', STRINGS_RU)
    );
    expect(replaceComponent).not.toHaveBeenCalled();
    expect(replaceStyles).not.toHaveBeenCalled();
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
