/**
 * @file ui plugin — the app of the tests of a subtree built in parts behind its clip (spec 33, slice G): the screen
 * set plus `ui`, one JSX root shaped like the album's page area (a 390-wide `overflow: "hidden"` area, the strip of
 * the pages in it at 21), whose tree a test writes as a commit of the game would. The renderer is inert; a test asks
 * it to answer as one that draws, so the mode gate of the build in parts is on, or leaves it headless. A game system
 * of phase `sync` writes the strip's `Transform` when a test asks it to: a late write, after the layout.
 */
import { vi } from "vitest";
import { createApp, defineGame, projection, system, Transform } from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import { i18nPlugin } from "../../i18n";
import { inputPlugin } from "../../input";
import { rendererPlugin } from "../../renderer";
import { textPlugin } from "../../text";
import { worldPlugin } from "../../world";
import { Tree } from "../../world/ecs/define";
import type { ViewHandle } from "../../world/projection/types";
import type { AnySystem, Entity } from "../../world/types";
import { UiCounters } from "../components";
import { uiPlugin } from "../index";
import { defineComponent } from "../jsx/component";
import type { DescriptionNode } from "../jsx/types";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Record<string, never>;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, never>;
}>();

/** The width of the clipped area: the screen's. */
export const CLIP_WIDTH = 390;

/** Where the strip stands in the area. */
export const STRIP_LEFT = 21;

/** The width of a page. */
export const PAGE_WIDTH = 348;

/** The distance between two pages of the strip: 1.25 widths, as the game's pager places them. */
export const PITCH = PAGE_WIDTH * 1.25;

/** The rows of a page, each a row and 17 leaves: with the page and its head (or its component's column), 128 elements. */
const ROWS = 7;

/** The leaves of a row. */
const LEAVES = 17;

/** The elements of a page: the page, its head, its rows and their leaves. */
export const PAGE_ELEMENTS = 2 + ROWS * (1 + LEAVES);

/** How far below its rest a leaf starts its enter. */
export const ENTER_DY = 50;

/** How long a leaf comes in. */
const ENTER_MS = 300;

/** What the late system of phase `sync` writes: the strip's `Transform.x`, while a test sets it. */
export const late: { entity: Entity | undefined; x: number | undefined } = {
  entity: undefined,
  x: undefined
};

/**
 * The enter of a leaf: it starts `ENTER_DY` below its rest and comes up to it.
 *
 * @param view - The leaf.
 * @returns The track to its rest.
 */
function leafEnter(view: ViewHandle<unknown>) {
  view.set(Transform, { y: (view.rest(Transform)?.y ?? 0) + ENTER_DY });

  return view.toRest(Transform, { ms: ENTER_MS });
}

/**
 * The rows of a page: each a row of 17 leaves, every leaf with an enter.
 *
 * @param name - The page's name, the prefix of its keys.
 * @returns The rows.
 */
function rows(name: string) {
  return Array.from({ length: ROWS }, (_unused, row) => (
    <row key={`${name}Row${row}`} style={{ gap: 2 }}>
      {Array.from({ length: LEAVES }, (_leaf, leaf) => (
        <stack
          key={`${name}Leaf${row}x${leaf}`}
          motion={{ enter: leafEnter }}
          style={{ width: 18, height: 18, fill: 0x22_44_66 }}
        />
      ))}
    </row>
  ));
}

/** The body of a wrapped page: its rows, drawn by one component. */
export const ClipBody = defineComponent("ClipBody", {
  view: (props: { name: string }) => <column style={{ gap: 2 }}>{rows(props.name)}</column>
});

/**
 * The one component node of a wrapped page. It carries 40 child nodes its view does not draw: a walk that went down a
 * component node would count them and find the page big.
 *
 * @param name - The page's name.
 * @returns The component node.
 */
function bodyOf(name: string): DescriptionNode {
  return {
    type: ClipBody.name,
    props: { name },
    children: Array.from({ length: 40 }, () => ({ type: "stack", props: {}, children: [] }))
  };
}

/** How a page is written: its own width, its width from its children, or its rows inside one component. */
export type PageShape = "plain" | "fluid" | "wrapped";

/**
 * One page of the strip at `x`: 128 elements, its height from its children: a head and the rows, or the rows drawn
 * by one component.
 *
 * @param name - The page's name, its key and the prefix of its keys.
 * @param x - Its place on the strip.
 * @param shape - How it is written.
 * @returns The page.
 */
export function page(name: string, x: number, shape: PageShape = "plain") {
  const style =
    shape === "fluid"
      ? ({ position: "absolute", left: x, top: 0, gap: 2 } as const)
      : ({ position: "absolute", left: x, top: 0, width: PAGE_WIDTH, gap: 2 } as const);

  return (
    <column key={name} style={style}>
      {shape === "wrapped"
        ? bodyOf(name)
        : [
            <stack
              key={`${name}Head`}
              style={{ width: PAGE_WIDTH, height: 30, fill: 0x66_44_22 }}
            />,
            ...rows(name)
          ]}
    </column>
  );
}

/**
 * The root: the clipped area and the strip of the pages in it, under a scroll when asked.
 *
 * @param pages - The pages of the strip.
 * @param scrolled - Whether the strip hangs in a scroll inside the area.
 * @returns The root's tree.
 */
export function clipTree(pages: readonly DescriptionNode[], scrolled = false): DescriptionNode {
  const strip = (
    <stack
      key="clipStrip"
      style={{ position: "absolute", left: STRIP_LEFT, top: 0, width: PAGE_WIDTH }}
    >
      {pages}
    </stack>
  );

  return (
    <stack key="clipRoot" style={{ width: CLIP_WIDTH, height: 844 }}>
      <stack
        key="clipArea"
        style={{
          position: "absolute",
          left: 0,
          top: 100,
          width: CLIP_WIDTH,
          height: 600,
          overflow: "hidden"
        }}
      >
        {scrolled ? (
          <scroll key="clipScroll" style={{ width: CLIP_WIDTH, height: 600 }}>
            <stack key="clipLane" style={{ width: CLIP_WIDTH, height: 900 }}>
              {strip}
            </stack>
          </scroll>
        ) : (
          strip
        )}
      </stack>
    </stack>
  ) as DescriptionNode;
}

/** The tree the root mounts with: page `p0` on show, nothing beside it. */
const FIRST = clipTree([page("p0", 0)]);

/** The tree the root under a scroll mounts with. */
const FIRST_SCROLLED = clipTree([page("p0", 0)], true);

/** The game's late write: the strip's `Transform.x`, in phase `sync`, after the layout. */
const lateWrite = system({
  name: "clip.late",
  phase: "sync",
  query: [],
  run: (_rows, { world }) => {
    if (late.entity !== undefined && late.x !== undefined) {
      world.set(late.entity, Transform, { x: late.x });
    }
  }
});

const home = defineNode({ rest: true, outcomes: {} });
const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: {},
  edges: { home: {} }
});

/** The root of the fixture. */
const clipScreen = projection({
  name: "clip",
  layer: "ui",
  from: () => ({ id: "clip" }),
  view: () => FIRST
});

/** The root of the fixture whose strip hangs in a scroll. */
const scrolledScreen = projection({
  name: "clipScrolled",
  layer: "ui",
  from: () => ({ id: "clipScrolled" }),
  view: () => FIRST_SCROLLED
});

const clipFeature = defineFeature("clip", {
  flows: [main],
  projections: [clipScreen, scrolledScreen],
  systems: [lateWrite],
  ui: [ClipBody]
});

/** How the fixture starts: with a renderer that draws (the default), and its root under a scroll or not. */
export type ClipOptions = { drawing?: boolean; scrolled?: boolean };

/**
 * Starts the app with the root mounted and at rest, page `p0` on show.
 *
 * @param options - Whether the renderer answers as one that draws, and whether the strip hangs in a scroll.
 * @returns The app and its drivers.
 */
export async function startClip(options: ClipOptions = {}) {
  late.entity = undefined;
  late.x = undefined;

  const app = createApp({
    plugins: [
      worldPlugin,
      rendererPlugin,
      inputPlugin,
      assetsPlugin,
      animPlugin,
      i18nPlugin,
      textPlugin,
      uiPlugin,
      clipFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: {}, initialSession: {}, seed: 1 }
    }
  });

  const watch = { reconciling: false };
  const register = app.world.ecs.system;

  // The system `ui.reconcile` is wrapped as it registers, so a test tells what it does from what the rest of the frame does.
  vi.spyOn(app.world.ecs, "system").mockImplementation((definition: AnySystem) => {
    if (definition.name !== "ui.reconcile") return register(definition);

    const run = definition.run;

    return register({
      ...definition,
      run: (rows, context) => {
        watch.reconciling = true;

        try {
          run(rows, context);
        } finally {
          watch.reconciling = false;
        }
      }
    });
  });

  // The renderer is inert here: asked as one that draws would answer, the views themselves stay undrawn.
  if (options.drawing !== false) vi.spyOn(app.renderer.host, "kind").mockReturnValue("webgpu");

  await app.start();
  vi.restoreAllMocks();
  app.flow.run().catch(() => undefined);

  for (let index = 0; index < 60; index += 1) await Promise.resolve();

  const name = options.scrolled === true ? "clipScrolled" : "clip";
  const first = options.scrolled === true ? FIRST_SCROLLED : FIRST;

  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.world.projection.mount([name], { kind: "plugin", name: "test" });

  const frame = (): void => app.time.step(16);

  for (let index = 0; index < 3; index += 1) frame();

  const ecs = app.world.ecs;
  let root: Entity | undefined;

  for (const [entity] of ecs.query(Tree)) {
    if (ecs.get(entity, Tree)?.node === first) root = entity;
  }

  // The value the world keeps, written in place below: `get` hands it read-only.
  const tree = root === undefined ? undefined : (ecs.get(root, Tree) as { node: DescriptionNode });

  if (root === undefined || tree === undefined) throw new Error("clip: the root was not mounted");

  const rootEntity = root;

  return {
    app,
    frame,
    /** The root's tree written and marked changed: the commit the next frame reconciles. */
    render: (node: DescriptionNode): void => {
      tree.node = node;
      ecs.set(rootEntity, Tree, {});
    },
    /** Whether the system `ui.reconcile` is running now. */
    reconciling: (): boolean => watch.reconciling,
    /** How many elements `ui` holds now: its Yoga nodes. */
    nodes: (): number => ecs.resource(UiCounters).nodes,
    /** The entity of a key, while an element of it is on the screen. */
    // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
    keyed: (key: string): Entity | undefined => app.ui.find(key)
  };
}

/** A started fixture. */
export type Clip = Awaited<ReturnType<typeof startClip>>;
