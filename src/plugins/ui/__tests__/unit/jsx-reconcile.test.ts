import { describe, expect, it, vi } from "vitest";
import { Tappable } from "../../../input/components";
import { Shape, Sprite } from "../../../renderer/components";
import type { ViewportSize } from "../../../renderer/viewport/types";
import { bind, Text } from "../../../text/components";
import { component, Tree } from "../../../world/ecs/define";
import type { AnyComponentType, AnyComponentValue, Entity } from "../../../world/types";
import { LocalWrite, type UiCountersValue } from "../../components";
import { createJsxApi } from "../../jsx/api";
import { createReconciler } from "../../jsx/reconcile";
import { createJsxState } from "../../jsx/state";
import type { DescriptionNode, Element, ElementMotion, Root } from "../../jsx/types";
import { layoutChanged } from "../../layout/apply";
import { createLayoutState } from "../../layout/state";
import type { ElementLookup, LayoutModule } from "../../layout/types";
import { windowOf } from "../../layout/window";
import { createStylesApi } from "../../styles/api";
import { createStylesState } from "../../styles/state";
import type { UiCtx } from "../../types";

// ---------------------------------------------------------------------------
// Unit: the patch of one live element (14-ui, a description that says the same
// costs no style pass and no layout). The reconciler runs over the real styles
// module, a layout module of spies and a world of maps, so every call it makes
// is counted: `styles.resolveElement`, `layout.applyStyle`, every write of the
// ecs and every rest the world is handed.
// ---------------------------------------------------------------------------

/** A game's own component, as `Glow` would be. */
const Mark = component("Mark", { level: 0 });

/** A game's own counter: the number the bound text shows. */
const Tally = component("Tally", { value: 0 });

/** The entity of the one root the harness mounts. */
const ROOT = 1000;

/** The entity of a popup root that lies over it, in the covered test. */
const COVERER = 2000;

/** A phone in reference units. */
const PHONE: ViewportSize = {
  width: 1080,
  height: 1920,
  scale: 1,
  orientation: "portrait",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 }
};

/** A `change.Box` hook built once, as a game keeps its hook tables. */
const boxHook = (): undefined => undefined;

/** The motion of the `go` button, built once. */
const goMotion: ElementMotion = { change: { Box: boxHook } };

/** What a test changes: for the element of a key, the props laid over the ones of `screen`. */
type Overrides = Readonly<Record<string, Record<string, unknown>>>;

/**
 * Builds the description of the test screen. Every call builds new nodes, new props and new style
 * objects, the way a `view` does.
 *
 * @param overrides - The props a test changes, by element key.
 * @returns The root node.
 */
function screen(overrides: Overrides = {}): DescriptionNode {
  const tag = (
    type: string,
    key: string,
    props: Record<string, unknown>,
    children: DescriptionNode[] = []
  ): DescriptionNode => ({ type, key, props: { ...props, ...overrides[key] }, children });

  return tag("column", "page", { style: { width: 1080, height: 1920 } }, [
    tag("row", "bar", { style: { width: 400, height: 80, fill: 0x11_11_11 } }),
    tag("text", "title", {
      style: { width: 200, height: 40 },
      content: { key: "hud.title", params: { n: 1 } }
    }),
    tag("text", "count", {
      style: "digits",
      bind: bind(Tally, "value"),
      components: [Tally({ value: 3 })]
    }),
    tag("image", "art", { texture: "ui.coin", fit: "contain", style: { width: 64, height: 64 } }),
    tag("icon", "gear", { name: "ui.gear", style: { width: 32, height: 32 } }),
    tag("button", "go", {
      intent: "go",
      payload: { id: 1 },
      style: { width: 100, height: 60, is: { hover: { fill: 0x33_33_33 } } },
      motion: goMotion
    }),
    tag("button", "tab", { local: { tab: "audio" }, style: { width: 100, height: 60 } }),
    tag("row", "other", { style: { width: 10, height: 10 }, components: [Mark({ level: 1 })] })
  ]);
}

/** How many elements `screen` describes. */
const ELEMENTS = 9;

/** What a remover, a popup close and an fx handler of the fakes do: nothing. */
function nothing(): undefined {
  return undefined;
}

/** A `loop` hook built once: it starts no motion. */
const sway = (): undefined => undefined;

/**
 * The props of a `go` button whose hook is built again on every call, as an inline arrow in a
 * view is.
 *
 * @returns The override of `screen`.
 */
function inlineHook(): Overrides {
  return { go: { motion: { change: { Box: (): undefined => undefined } } } };
}

/**
 * The props of a `bar` 10 units taller than `screen` draws it.
 *
 * @returns The override of `screen`.
 */
function tallerBar(): Overrides {
  return { bar: { style: { width: 400, height: 90, fill: 0x11_11_11 } } };
}

/**
 * A screen with one text field.
 *
 * @param maxLength - The longest value the field takes.
 * @returns The root node.
 */
function form(maxLength: number): DescriptionNode {
  return {
    type: "column",
    key: "form",
    props: { style: { width: 600, height: 200 } },
    children: [
      {
        type: "input",
        key: "nick",
        props: { local: "name", maxLength, style: { width: 400, height: 80 } },
        children: []
      }
    ]
  };
}

/**
 * One row of the windowed list: a new node per call, its style without a height.
 *
 * @param index - The index of the row.
 * @returns The row.
 */
function listRow(index: number): DescriptionNode {
  return { type: "row", key: `r${index}`, props: { style: { width: 400 } }, children: [] };
}

/**
 * A screen that is one windowed list, 200 units high.
 *
 * @param rows - How many rows the list has.
 * @param rowHeight - The height of every row.
 * @returns The root node.
 */
function list(rows: number, rowHeight: number): DescriptionNode {
  return {
    type: "scroll",
    key: "list",
    props: { style: { width: 400, height: 200 }, rows, rowHeight, overscan: 0, row: listRow },
    children: []
  };
}

/**
 * A screen padded by the notch of the viewport.
 *
 * @returns The root node.
 */
function notched(): DescriptionNode {
  return {
    type: "column",
    key: "page",
    props: { style: { width: 1080, height: 1920, padding: { top: "safeArea.top" } } },
    children: []
  };
}

/**
 * Builds the reconciler over a world of maps, the real styles module and a layout module of
 * spies, and the handles a test drives it with.
 *
 * @returns The reconciler, its state, the spies and the drivers.
 */
function harness() {
  const store = new Map<Entity, Map<string, object | true>>();
  const types = new Map<string, AnyComponentType>();
  const counters: UiCountersValue = {
    solves: 0,
    nodes: 0,
    measured: 0,
    reconciles: 0,
    windowRenders: 0,
    styled: 0,
    written: 0
  };
  const world = {
    viewport: PHONE,
    locale: "en",
    spawned: 0,
    /** The entities whose `Text` the fake `text` wrote this frame. */
    textsWritten: [] as Entity[],
    /** What the fake `layout.remeasure` answers: whether the text takes another size. */
    resized: false,
    /** What the fake `layout.iconLineMoved` answers: whether the line of the icons moved. */
    lineMoved: false
  };

  const ecs = {
    spawn: vi.fn((): Entity => {
      world.spawned += 1;
      store.set(world.spawned, new Map());

      return world.spawned;
    }),
    despawn: vi.fn((entity: Entity): void => {
      store.delete(entity);
    }),
    add: vi.fn((entity: Entity, value: AnyComponentValue): void => {
      types.set(value.type.componentName, value.type);
      store
        .get(entity)
        ?.set(value.type.componentName, value.value === true ? true : { ...value.value });
    }),
    set: vi.fn((entity: Entity, type: AnyComponentType, patch: object): void => {
      const current = store.get(entity)?.get(type.componentName);

      if (current !== undefined && current !== true) Object.assign(current, patch);
    }),
    remove: vi.fn((entity: Entity, type: AnyComponentType): void => {
      store.get(entity)?.delete(type.componentName);
    }),
    get: (entity: Entity, type: AnyComponentType): object | undefined => {
      const stored = store.get(entity)?.get(type.componentName);

      return stored === true ? undefined : stored;
    },
    has: (entity: Entity, type: AnyComponentType): boolean =>
      store.get(entity)?.has(type.componentName) === true,
    typeOf: (name: string): AnyComponentType | undefined => types.get(name),
    changed: (type: AnyComponentType): Entity[] =>
      type.componentName === Text.componentName ? world.textsWritten : [],
    resource: (): UiCountersValue => counters
  };
  const setRest = vi.fn();
  const state = {
    jsx: createJsxState(),
    styles: createStylesState(),
    layout: createLayoutState()
  };
  const ctx = {
    config: { breakpoints: { tall: 2, wide: 1.5 } },
    state,
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    deps: {
      world: {
        ecs,
        projection: {
          registerKey: () => nothing,
          keyOf: () => undefined,
          entitiesOf: () => [],
          layers: () => [],
          setRest
        }
      },
      renderer: { viewport: { size: () => world.viewport } },
      time: { wake: vi.fn() },
      i18n: { locale: () => world.locale },
      flow: { state: () => ({ running: false, stack: [], pending: {}, mode: "live" }) }
    }
  } as unknown as UiCtx;

  const styles = createStylesApi(ctx);
  const resolveElement = vi.spyOn(styles, "resolveElement");
  const applyStyle = vi.fn<(element: Element) => void>();
  const repose = vi.fn<LayoutModule["repose"]>();
  const remeasure = vi.fn<(element: Element) => boolean>(() => world.resized);
  const loop = vi.fn<(element: Element) => void>();

  /**
   * Gives an element the rect its style names, and every element under it. Only an element that
   * is not live yet moves, so a second solve changes nothing.
   *
   * @param element - The element to place.
   * @param lookup - How a child entity becomes its element.
   */
  const place = (element: Element, lookup: ElementLookup): void => {
    const { width, height } = element.style;

    element.moved = !element.live;
    element.rect = {
      x: 0,
      y: 0,
      w: typeof width === "number" ? width : 100,
      h: typeof height === "number" ? height : 40
    };

    for (const child of element.children) {
      const childElement = lookup(child);

      if (childElement !== undefined) place(childElement, lookup);
    }
  };
  const solve = vi.fn<LayoutModule["solve"]>((rootElement, _size, lookup) => {
    place(rootElement, lookup);

    return true;
  });
  const layout: LayoutModule = {
    load: () => Promise.resolve(),
    loaded: () => true,
    attach: vi.fn(),
    applyStyle,
    remeasure,
    iconLineMoved: () => world.lineMoved,
    markMeasured: vi.fn(),
    affectsRect: layoutChanged,
    place: vi.fn(),
    free: vi.fn(),
    solve,
    commit: vi.fn(),
    enter: vi.fn(),
    loop,
    change: () => false,
    changeExtra: () => false,
    repose,
    lift: vi.fn(),
    exit: vi.fn(),
    playTrack: vi.fn(),
    settled: () => true,
    scroll: vi.fn(),
    clampScroll: () => 0,
    windowOf,
    popupHandler: () => nothing,
    guideHandler: () => nothing,
    counters: () => ({ nodes: 0, measured: 0, solves: 0 })
  };
  const fields = { enter: vi.fn(), patch: vi.fn(), exit: vi.fn(), drop: vi.fn(), pull: vi.fn() };
  const frame = createReconciler(ctx, { styles, layout }, fields);

  /**
   * The root record of the mounted screen.
   *
   * @returns The root.
   */
  const root = (): Root => state.jsx.roots.get(ROOT) as Root;

  /**
   * The entity of a keyed element.
   *
   * @param key - The key of the element.
   * @returns Its entity, -1 when the key is not mounted.
   */
  const entity = (key: string): Entity => state.jsx.byKey.get(ROOT)?.get(key) ?? -1;

  return {
    ctx,
    state,
    frame,
    world,
    layout,
    styles,
    fields,
    counters,
    resolveElement,
    applyStyle,
    repose,
    remeasure,
    loop,
    solve,
    setRest,
    ecs,
    root,
    entity,

    /**
     * The element record of a key.
     *
     * @param key - The key of the element.
     * @returns The live element.
     */
    element: (key: string): Element => state.jsx.elements.get(entity(key)) as Element,

    /**
     * What an entity carries of one component.
     *
     * @param key - The key of the element.
     * @param type - The component type.
     * @returns The stored value, `true` for a tag, `undefined` when the entity lacks it.
     */
    stored: (key: string, type: AnyComponentType): object | true | undefined =>
      store.get(entity(key))?.get(type.componentName),

    /**
     * Mounts the screen: the first reconcile, the first solve and the enter of every element.
     * The spies are cleared, so a test counts only what follows.
     *
     * @param node - The description of the first render.
     */
    mount: (node: DescriptionNode): void => {
      store.set(ROOT, new Map([["Tree", { node }]]));
      types.set("Tree", Tree);
      frame.mountRoot(ROOT, "screen", "ui");
      frame.reconcile();
      frame.solve();

      for (const live of state.jsx.elements.keys()) frame.playEnter(live);

      vi.clearAllMocks();
    },

    /**
     * Hands the root a new description and runs the reconcile, as a commit does. The solve is
     * left to the test, so it can read `needsSolve` first.
     *
     * @param node - The description of this render.
     */
    render: (node: DescriptionNode): void => {
      store.get(ROOT)?.set("Tree", { node });
      root().dirty = true;
      frame.reconcile();
    },

    /**
     * The entities the reconcile wrote since the spies were cleared: every `set`, `add` and
     * `remove` of the ecs, once per entity, in call order.
     *
     * @returns The entities.
     */
    touched: (): Entity[] => [
      ...new Set(
        [...ecs.set.mock.calls, ...ecs.add.mock.calls, ...ecs.remove.mock.calls].map(
          call => call[0]
        )
      )
    ],

    /**
     * The elements `layout.applyStyle` was called with since the spies were cleared.
     *
     * @returns Their entities, in call order.
     */
    applied: (): Entity[] => applyStyle.mock.calls.map(call => call[0].entity)
  };
}

// ─── the equal description ─────────────────────────────────────

describe("an equal description", () => {
  it("resolves no style, writes no layout node, asks for no solve and writes nothing", () => {
    const h = harness();

    h.mount(screen());

    const styles = [...h.state.jsx.elements.values()].map(element => element.style);

    h.render(screen());

    expect(h.resolveElement).not.toHaveBeenCalled();
    expect(h.applyStyle).not.toHaveBeenCalled();
    expect(h.root().needsSolve).toBe(false);
    expect(h.touched()).toEqual([]);
    expect(h.setRest).not.toHaveBeenCalled();
    expect(h.repose).not.toHaveBeenCalled();
    expect([...h.state.jsx.elements.values()].map(element => element.style)).toEqual(styles);

    h.frame.solve();

    expect(h.solve).not.toHaveBeenCalled();
  });

  it("keeps the resolved style object of every element", () => {
    const h = harness();

    h.mount(screen());

    const before = h.element("bar").style;

    h.render(screen());

    expect(h.element("bar").style).toBe(before);
  });

  it("still takes the node of this render, so what reads it later reads the new one", () => {
    const h = harness();

    h.mount(screen());

    const next = screen();

    h.render(next);

    expect(h.element("page").node).toBe(next);
    expect(h.element("bar").node).toBe(next.children[0]);
  });

  it("counts no style pass and no write pass", () => {
    const h = harness();

    h.mount(screen());

    const before = { styled: h.counters.styled, written: h.counters.written };

    h.render(screen());
    h.frame.solve();

    expect(before).toEqual({ styled: ELEMENTS, written: 0 });
    expect({ styled: h.counters.styled, written: h.counters.written }).toEqual(before);
  });
});

// ─── one prop changed alone ────────────────────────────────────

/** One case of the table: the element, the props laid over it, and what the patch has to do. */
type Case = {
  name: string;
  key: string;
  props: Record<string, unknown>;
  /** How often `styles.resolveElement` runs: once for the element, or never. */
  resolved: 0 | 1;
  /** Whether the style is written onto the layout node, and a solve asked for. */
  applied: boolean;
};

const CASES: readonly Case[] = [
  {
    name: "a style field that moves the rect",
    key: "bar",
    props: { style: { width: 400, height: 90, fill: 0x11_11_11 } },
    resolved: 1,
    applied: true
  },
  {
    name: "a style field that changes the look only",
    key: "bar",
    props: { style: { width: 400, height: 80, fill: 0x22_22_22 } },
    resolved: 1,
    applied: true
  },
  {
    name: "the text style key",
    key: "count",
    props: { style: "body" },
    resolved: 1,
    applied: true
  },
  { name: "state", key: "go", props: { state: { disabled: true } }, resolved: 1, applied: false },
  {
    name: "content",
    key: "title",
    props: { content: { key: "hud.title", params: { n: 2 } } },
    resolved: 0,
    applied: true
  },
  {
    name: "bind",
    key: "count",
    props: { bind: bind(Tally, "value", { format: "mm:ss" }) },
    resolved: 0,
    applied: false
  },
  { name: "texture", key: "art", props: { texture: "ui.gem" }, resolved: 0, applied: false },
  { name: "name", key: "gear", props: { name: "ui.cog" }, resolved: 0, applied: false },
  { name: "fit", key: "art", props: { fit: "cover" }, resolved: 0, applied: false },
  {
    name: "components",
    key: "other",
    props: { components: [Mark({ level: 2 })] },
    resolved: 0,
    applied: false
  },
  {
    name: "motion",
    key: "go",
    props: { motion: { change: { Box: (): undefined => undefined } } },
    resolved: 0,
    applied: false
  },
  { name: "intent", key: "go", props: { intent: "stop" }, resolved: 0, applied: false },
  { name: "payload", key: "go", props: { payload: { id: 2 } }, resolved: 0, applied: false },
  { name: "local", key: "tab", props: { local: { tab: "video" } }, resolved: 0, applied: false },
  { name: "escape", key: "go", props: { escape: true }, resolved: 0, applied: false }
];

describe("one prop changed alone", () => {
  it.each(CASES)("patches exactly that element: $name", ({ key, props, resolved, applied }) => {
    const h = harness();

    h.mount(screen());
    h.render(screen({ [key]: props }));

    const changed = h.entity(key);

    // The look, the input and the extras of that element are written, and of no other.
    expect(h.touched()).toEqual([changed]);
    expect(h.counters.written).toBe(1);

    // Its style is resolved again only when its `style` or its flags changed.
    expect(h.resolveElement).toHaveBeenCalledTimes(resolved);

    // The layout node is written, and the root solves, only when a rect or a measure may move.
    expect(h.applied()).toEqual(applied ? [changed] : []);
    expect(h.root().needsSolve).toBe(applied);
    expect(h.counters.styled - ELEMENTS).toBe(resolved === 1 || applied ? 1 : 0);
  });

  it("writes what the changed prop says", () => {
    const h = harness();

    h.mount(screen());
    h.render(
      screen({
        bar: { style: { width: 400, height: 80, fill: 0x22_22_22 } },
        title: { content: "plain" },
        art: { texture: "ui.gem", fit: "cover" },
        gear: { name: "ui.cog" },
        go: { intent: "stop", payload: { id: 2 } },
        tab: { local: { tab: "video" } },
        other: { components: [Mark({ level: 2 })] }
      })
    );

    expect(h.stored("bar", Shape)).toMatchObject({ fill: 0x22_22_22 });
    expect(h.stored("title", Text)).toMatchObject({ content: "plain" });
    expect(h.stored("art", Sprite)).toMatchObject({ texture: "ui.gem", fit: "cover" });
    expect(h.stored("gear", Sprite)).toMatchObject({ texture: "ui.cog" });
    expect(h.stored("go", Tappable)).toEqual({ intent: "stop", payload: { id: 2 } });
    expect(h.stored("tab", LocalWrite)).toEqual({ patch: { tab: "video" } });
    expect(h.stored("other", Mark)).toEqual({ level: 2 });
  });

  it("drops the answer of a button that became disabled", () => {
    const h = harness();

    h.mount(screen());

    expect(h.stored("go", Tappable)).toBeDefined();

    h.render(screen({ go: { state: { disabled: true } } }));

    expect(h.stored("go", Tappable)).toBeUndefined();
    expect(h.element("go").is.disabled).toBe(true);
  });

  it("restarts the loop of an element whose motion names another loop", () => {
    const h = harness();

    h.mount(screen());
    h.render(screen({ go: { motion: { loop: sway } } }));

    expect(h.loop).toHaveBeenCalledExactlyOnceWith(h.element("go"));
    expect(h.element("go").motion?.loop).toBe(sway);
  });
});

// ─── functions compare by identity ─────────────────────────────

describe("a function inside a prop", () => {
  it("is the same in a new object when the function is the same", () => {
    const h = harness();

    h.mount(screen());
    h.render(screen({ go: { motion: { change: { Box: boxHook } } } }));

    expect(h.touched()).toEqual([]);
    expect(h.counters.written).toBe(0);
  });

  it("is another one when it is built again per render, so the element is written every time", () => {
    const h = harness();

    h.mount(screen(inlineHook()));
    h.render(screen(inlineHook()));
    h.render(screen(inlineHook()));

    expect(h.touched()).toEqual([h.entity("go")]);
    expect(h.counters.written).toBe(2);
    expect(h.resolveElement).not.toHaveBeenCalled();
    expect(h.applyStyle).not.toHaveBeenCalled();
  });

  it("is the same component type in a new `components` list", () => {
    const h = harness();

    h.mount(screen());
    h.render(screen({ other: { components: [Mark({ level: 1 })] } }));

    expect(h.touched()).toEqual([]);
  });
});

// ─── a style object changed in place ───────────────────────────

describe("a style object changed in place between two renders", () => {
  it("is not seen: the same object says the same, until the element is resolved again", () => {
    const h = harness();
    const shared = { width: 400, height: 80, fill: 0x11_11_11 };

    h.mount(screen({ bar: { style: shared } }));

    shared.fill = 0x44_44_44;
    shared.height = 120;
    h.render(screen({ bar: { style: shared } }));

    // A style is a value. The object of the last render is the one compared, and it is this one.
    expect(h.resolveElement).not.toHaveBeenCalled();
    expect(h.touched()).toEqual([]);
    expect(h.element("bar").style).toMatchObject({ height: 80, fill: 0x11_11_11 });
    expect(h.stored("bar", Shape)).toMatchObject({ fill: 0x11_11_11 });

    // The next resolve of that element reads the object as it is now: here a state flag asks.
    h.render(screen({ bar: { style: shared, state: { active: true } } }));

    expect(h.element("bar").style).toMatchObject({ height: 120, fill: 0x44_44_44 });
    expect(h.stored("bar", Shape)).toMatchObject({ fill: 0x44_44_44 });
    expect(h.applied()).toEqual([h.entity("bar")]);
  });
});

// ─── what an unchanged element still does ──────────────────────

describe("a prop outside the comparison", () => {
  it("still tracks the `hosts` of an element that is written no more", () => {
    const h = harness();

    h.mount(screen());

    expect(h.state.jsx.hosts.has(h.entity("bar"))).toBe(false);

    h.render(screen({ bar: { hosts: ["board.items"] } }));

    expect(h.state.jsx.hosts.has(h.entity("bar"))).toBe(true);
    expect(h.touched()).toEqual([]);

    h.render(screen());

    expect(h.state.jsx.hosts.has(h.entity("bar"))).toBe(false);
  });

  it("still hands a text field its new props", () => {
    const h = harness();

    h.mount(form(8));
    h.render(form(16));

    expect(h.fields.patch).toHaveBeenCalledExactlyOnceWith(h.element("nick"));
    expect(h.element("nick").node.props.maxLength).toBe(16);
    expect(h.touched()).toEqual([]);
  });

  it("still cuts the rows of a windowed scroll again", () => {
    const h = harness();

    h.mount(list(2, 50));

    expect(h.entity("r2")).toBe(-1);

    h.render(list(3, 50));

    expect(h.entity("r2")).not.toBe(-1);
    expect(h.touched()).not.toContain(h.entity("list"));
    expect(h.touched()).not.toContain(h.entity("r0"));
  });

  it("still places the children again when only their order changed", () => {
    const h = harness();
    const turned = screen();

    h.mount(screen());
    turned.children.reverse();
    h.render(turned);

    expect(h.layout.place).toHaveBeenCalledExactlyOnceWith(
      h.element("page"),
      turned.children.map(child => h.element(child.key ?? ""))
    );
    expect(h.root().needsSolve).toBe(true);
    expect(h.touched()).toEqual([]);
    expect(h.resolveElement).not.toHaveBeenCalled();
  });

  it("takes another key for another element: the old one exits, the new one enters", () => {
    const h = harness();
    const renamed = screen();
    const bar = renamed.children[0];

    h.mount(screen());

    const old = h.entity("bar");

    if (bar !== undefined) bar.key = "strip";

    h.render(renamed);

    expect(h.entity("bar")).toBe(-1);
    expect(h.entity("strip")).not.toBe(old);
    expect(h.layout.exit).toHaveBeenCalledExactlyOnceWith(h.state.jsx.elements.get(old));
    expect(h.resolveElement).toHaveBeenCalledTimes(1);
  });

  it("still diffs the children: a child that left exits under an unchanged parent", () => {
    const h = harness();
    const full = screen();
    const short = screen();

    h.mount(full);
    short.children.pop();
    h.render(short);

    expect(h.entity("other")).toBe(-1);
    expect(h.touched()).toEqual([]);
    expect(h.root().needsSolve).toBe(true);
  });
});

// ─── what is not in the description ────────────────────────────

describe("what an equal description is resolved against", () => {
  it("resolves every element again on a new viewport", () => {
    const h = harness();

    h.mount(screen());
    h.world.viewport = { ...PHONE, height: 2400 };
    h.frame.reconcile();

    expect(h.resolveElement).toHaveBeenCalledTimes(ELEMENTS);
    expect(h.counters.styled - ELEMENTS).toBe(ELEMENTS);
    expect(h.counters.written).toBe(ELEMENTS);
    expect(h.root().needsSolve).toBe(true);

    // The same viewport again, and an equal description: nothing.
    vi.clearAllMocks();
    h.render(screen());

    expect(h.resolveElement).not.toHaveBeenCalled();
    expect(h.touched()).toEqual([]);
  });

  it("resolves a safe-area token again when only the notch changed", () => {
    const h = harness();

    h.mount(notched());

    expect(h.element("page").style.padding).toEqual({ top: 0 });

    h.world.viewport = { ...PHONE, safeArea: { top: 44, right: 0, bottom: 0, left: 0 } };
    h.frame.reconcile();

    expect(h.element("page").style.padding).toEqual({ top: 44 });
    expect(h.applied()).toEqual([h.entity("page")]);
  });

  it("starts no epoch on a new locale: a render after it still says the same", () => {
    const h = harness();

    h.mount(screen());
    h.world.locale = "de";
    h.frame.reconcile();
    h.render(screen());

    expect(h.resolveElement).not.toHaveBeenCalled();
    expect(h.applyStyle).not.toHaveBeenCalled();
    expect(h.touched()).toEqual([]);
    expect(h.root().needsSolve).toBe(false);
  });

  it("measures the texts `text` wrote this frame again, and solves when one takes another size", () => {
    const h = harness();

    h.mount(screen());

    // A new locale or a font that arrived: `text` resolved the title again, and it is wider now.
    h.world.textsWritten = [h.entity("title")];
    h.world.resized = true;
    h.frame.reconcile();

    expect(h.remeasure).toHaveBeenCalledExactlyOnceWith(h.element("title"));
    expect(h.root().needsSolve).toBe(true);
    // No root was reconciled for it: no style pass and no write.
    expect(h.resolveElement).not.toHaveBeenCalled();
    expect(h.touched()).toEqual([]);

    // The same string in the same size asks for nothing.
    h.frame.solve();
    h.world.resized = false;
    h.frame.reconcile();

    expect(h.root().needsSolve).toBe(false);
  });

  it("measures every icon again when the line they are squared on moved, and no other element", () => {
    const h = harness();

    h.mount(screen());

    // The body font arrived on a screen where `text` wrote nothing this frame.
    h.world.lineMoved = true;
    h.world.resized = true;
    h.frame.reconcile();

    expect(h.remeasure).toHaveBeenCalledExactlyOnceWith(h.element("gear"));
    expect(h.root().needsSolve).toBe(true);
    expect(h.resolveElement).not.toHaveBeenCalled();
    expect(h.touched()).toEqual([]);

    // The line stands still: no icon is looked at.
    vi.clearAllMocks();
    h.frame.solve();
    h.world.lineMoved = false;
    h.frame.reconcile();

    expect(h.remeasure).not.toHaveBeenCalled();
    expect(h.root().needsSolve).toBe(false);
  });

  it("resolves every element of a root that became covered, and again when it is uncovered", () => {
    const h = harness();

    h.mount(screen());

    // A popup lies over the root: the settle step keeps it covered while that popup lives.
    h.state.jsx.roots.set(COVERER, {
      ...h.root(),
      entity: COVERER,
      element: undefined,
      dirty: false,
      needsSolve: false,
      popup: { close: nothing, over: ROOT }
    });
    h.root().covered = true;
    h.render(screen());

    expect(h.resolveElement).toHaveBeenCalledTimes(ELEMENTS);
    expect(h.element("go").is.covered).toBe(true);
    // A button of a covered root answers nothing.
    expect(h.stored("go", Tappable)).toBeUndefined();
    expect(h.counters.written).toBe(ELEMENTS);

    vi.clearAllMocks();
    h.render(screen());

    expect(h.resolveElement).not.toHaveBeenCalled();
    expect(h.touched()).toEqual([]);

    h.state.jsx.roots.delete(COVERER);
    h.root().covered = false;
    h.render(screen());

    expect(h.resolveElement).toHaveBeenCalledTimes(ELEMENTS);
    expect(h.stored("go", Tappable)).toEqual({ intent: "go", payload: { id: 1 } });
  });

  it("resolves the element under the pointer, and nothing at the reconcile that follows", () => {
    const h = harness();

    h.mount(screen());
    h.frame.markPointer(h.entity("go"), "hover", true);

    expect(h.resolveElement).toHaveBeenCalledTimes(1);
    expect(h.touched()).toEqual([h.entity("go")]);
    expect(h.stored("go", Shape)).toMatchObject({ fill: 0x33_33_33 });
    expect(h.root().dirty).toBe(true);

    vi.clearAllMocks();
    h.frame.reconcile();

    expect(h.resolveElement).not.toHaveBeenCalled();
    expect(h.touched()).toEqual([]);
    expect(h.element("go").is.hover).toBe(true);

    h.render(screen());

    expect(h.resolveElement).not.toHaveBeenCalled();
    expect(h.stored("go", Shape)).toMatchObject({ fill: 0x33_33_33 });
  });

  it("lays the rows of a windowed scroll out again when only the row height changed", () => {
    const h = harness();

    h.mount(list(2, 50));

    expect(h.element("r0").style.height).toBe(50);

    h.render(list(2, 50));

    expect(h.resolveElement).not.toHaveBeenCalled();
    expect(h.applied()).not.toContain(h.entity("r0"));

    vi.clearAllMocks();
    h.render(list(2, 80));

    expect(h.element("r0").style.height).toBe(80);
    expect(h.element("r1").style.height).toBe(80);
    expect(h.applied()).toEqual(expect.arrayContaining([h.entity("r0"), h.entity("r1")]));
  });
});

// ─── a patch that throws on the way ────────────────────────────

describe("a patch that throws before its write went through", () => {
  it("is done in full at the next render, though the description then says the same", () => {
    const h = harness();

    h.mount(screen());
    h.applyStyle.mockImplementationOnce(() => {
      throw new Error("bad style");
    });
    h.render(screen(tallerBar()));

    expect(h.ctx.log.error).toHaveBeenCalledWith(
      "ui:root-failed",
      { root: "screen" },
      expect.any(Error)
    );
    expect(h.touched()).toEqual([]);

    vi.clearAllMocks();
    h.render(screen(tallerBar()));

    expect(h.applied()).toEqual([h.entity("bar")]);
    expect(h.touched()).toEqual([h.entity("bar")]);
    expect(h.stored("bar", Shape)).toMatchObject({ h: 80 });

    // Written through: the same description is now left alone.
    vi.clearAllMocks();
    h.render(screen(tallerBar()));

    expect(h.applyStyle).not.toHaveBeenCalled();
    expect(h.touched()).toEqual([]);
  });
});

// ─── the dev hot swap ──────────────────────────────────────────

describe("refreshAll", () => {
  it("starts a new epoch, so every element is patched in full on the next frame", () => {
    const h = harness();
    const jsx = createJsxApi(h.ctx, { styles: h.styles, layout: h.layout });

    h.mount(screen());

    const epoch = h.state.jsx.epoch;

    jsx.refreshAll();

    expect(h.state.jsx.epoch).toBe(epoch + 1);
    expect(h.root()).toMatchObject({ dirty: true, needsSolve: true });

    h.frame.reconcile();

    expect(h.resolveElement).toHaveBeenCalledTimes(ELEMENTS);
    expect(h.applyStyle).toHaveBeenCalledTimes(ELEMENTS);
    expect(h.counters.written).toBe(ELEMENTS);
  });
});
