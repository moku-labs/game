import { describe, expect, it, vi } from "vitest";
import {
  component,
  createApp,
  defineGame,
  projection,
  system,
  Transform,
  type
} from "../../../../index";
import { animPlugin } from "../../../anim";
import { assetsPlugin } from "../../../assets";
import { i18nPlugin } from "../../../i18n";
import type { CompiledMessages } from "../../../i18n/types";
import { inputPlugin } from "../../../input";
import { rendererPlugin } from "../../../renderer";
import { scenesPlugin } from "../../../scenes";
import { textPlugin } from "../../../text";
import { worldPlugin } from "../../../world";
import type { LayerSpec } from "../../../world/types";
import { uiPlugin } from "../../index";
import { defineComponent } from "../../jsx/component";
import type { ElementMotion } from "../../jsx/types";

// ---------------------------------------------------------------------------
// Integration: the next scene built aside (spec 31, ui). The real world builds the board while the
// ward stays mounted; ui reconciles and solves the board's root, marks everything it spawns as the
// build's, holds its enters, keeps it out of `find` and `tree`, and tells the world through
// `onBuild` when its part is done. The commit plays the held enters in the next frame; a discard
// leaves the world as it was. Real flow, world and Yoga; plain Bun, inert renderer.
// ---------------------------------------------------------------------------

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Record<string, never>;
  session: Record<string, never>;
  assets: string;
  strings: { "aside.title": Record<string, never> };
}>();

/** The one compiled locale of the fixture. */
const english: CompiledMessages = {
  "aside.title": () => [{ kind: "text", text: "Board" }]
};

/** How often the board's button started its enter and its exit. */
const starts = { enter: 0, exit: 0 };

/** The motion of the board's button: it counts its enter and its exit and moves nothing. */
const counted: ElementMotion = {
  enter: () => {
    starts.enter += 1;

    return undefined;
  },
  exit: () => {
    starts.exit += 1;

    return undefined;
  }
};

/** Marks the board's button for the game's system of `sync` that reads its scale. */
const Watched = component("AsideWatched", { frames: 0 });

/** The scales the game's system of `sync` saw on the board's button, one per frame. */
const seen: number[] = [];

/** A game's system of `sync`, as F49's gate: it reads the button's scale before `ui.enter`. */
const gate = system({
  name: "aside.gate",
  phase: "sync",
  query: [Watched, Transform],
  run: rows => {
    for (const row of rows) seen.push(row[2].scale);
  }
});

/** The motion of the board's button: it counts its enter, starts at scale 0 and grows to its rest. */
const grown: ElementMotion = {
  enter: view => {
    starts.enter += 1;
    view.set(Transform, { scale: 0 });

    return view.toRest(Transform, { ms: 200 });
  },
  exit: () => {
    starts.exit += 1;

    return undefined;
  }
};

/**
 * The board: a button with the grown motion, a text field, whose parts `ui` spawns, and a button
 * too small to tap, which `lint` reports once it is on the screen.
 */
const Board = defineComponent("AsideBoard", {
  local: { nick: "" },
  view: () => (
    <column key="boardRoot" style={{ width: 1080, height: 1920 }} motion={counted}>
      <button
        key="boardPlay"
        intent="play"
        style={{ width: 200, height: 80 }}
        motion={grown}
        components={[Watched()]}
      />
      <input key="boardNick" local="nick" style={{ width: 400, height: 80 }} />
      <button key="boardTiny" intent="play" style={{ width: 10, height: 10 }} />
    </column>
  )
});

/** One item of a single-root screen. */
type Item = { id: string };

/** The scene on the screen while the board builds. */
const wardScreen = projection({
  name: "ward",
  layer: "ui",
  from: (): Item => ({ id: "ward" }),
  view: () => (
    <column key="wardRoot" style={{ width: 1080, height: 1920 }}>
      <button key="wardPlay" intent="play" style={{ width: 200, height: 80 }} />
    </column>
  )
});

/** The scene built aside. */
const boardScreen = projection({
  name: "board",
  layer: "ui",
  from: (): Item => ({ id: "board" }),
  view: () => <Board key="board" />
});

const home = defineNode({ rest: true, outcomes: { play: type() } });

const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: {},
  edges: { home: { play: "home" } }
});

const asideFeature = defineFeature("aside", {
  flows: [main],
  projections: [wardScreen, boardScreen],
  components: [Watched],
  systems: [gate],
  ui: [Board],
  strings: { en: english }
});

/** The layer list both scenes declare alike: the ward is kept, the board is built. */
const LAYERS: ReadonlyArray<LayerSpec> = [{ name: "ui", sort: "order" }];

/** Who owns the entities of the projections the test mounts. */
const OWNER = { kind: "plugin", name: "test" } as const;

/**
 * Starts the app with the ward mounted and at rest, and catches the check `ui` registers with
 * `onBuild`, so a test asks `ui`'s part alone.
 *
 * @returns The app and `ui`'s part of a build.
 */
async function startWard() {
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
      asideFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: {}, initialSession: {}, seed: 1 }
    }
  });
  const checks: Array<() => boolean> = [];
  const onBuild = app.world.projection.onBuild;

  vi.spyOn(app.world.projection, "onBuild").mockImplementation(check => {
    checks.push(check);

    return onBuild(check);
  });
  // The renderer is inert here. ui registers its part of a build only with a renderer that draws:
  // it is asked as one would answer, the views themselves stay undrawn.
  vi.spyOn(app.renderer.host, "kind").mockReturnValue("webgpu");
  await app.start();
  vi.restoreAllMocks();
  app.flow.run().catch(() => undefined);

  for (let index = 0; index < 60; index += 1) await Promise.resolve();

  app.world.projection.setLayers(LAYERS);
  app.world.projection.mount(["ward"], OWNER);

  for (let frame = 0; frame < 3; frame += 1) app.time.step(16);

  // The renderer registers a part of its own: ui's is the reconciler's `asideBuilt`.
  const uiBuilt = checks.find(check => check.name === "asideBuilt");

  if (uiBuilt === undefined) throw new Error("ui registered no part of a scene build");

  starts.enter = 0;
  starts.exit = 0;

  return { app, uiBuilt };
}

/**
 * The ids of every entity of the world.
 *
 * @param app - The running app.
 * @returns The ids, sorted.
 */
function idsOf(app: Awaited<ReturnType<typeof startWard>>["app"]): number[] {
  return app.world.ecs
    .snapshot()
    .entities.map(entity => entity.id)
    .toSorted((first, second) => first - second);
}

describe("a scene built aside", () => {
  it("is built in one frame, unseen, and its enters start in the frame after the commit", async () => {
    const { app, uiBuilt } = await startWard();
    const before = idsOf(app);

    expect(app.world.projection.build(["ward", "board"], OWNER, LAYERS, 4)).toBe(true);
    // Its root is mounted and dirty: ui's part is not done.
    expect(uiBuilt()).toBe(false);

    app.time.step(16);

    const spawned = idsOf(app).filter(id => !before.includes(id));

    expect(uiBuilt()).toBe(true);
    // The root, its elements and the parts of its field all belong to the build.
    expect(spawned.length).toBeGreaterThan(4);
    expect(spawned.filter(id => !app.world.projection.isBuilding(id))).toEqual([]);
    expect(app.ui.find("boardPlay")).toBeUndefined();
    expect(app.ui.tree().key).toBe("wardRoot");
    expect(app.ui.lint().filter(finding => finding.key === "boardTiny")).toEqual([]);

    app.time.step(16);

    expect(starts.enter).toBe(0);

    // The swap, as `scenes` makes it: the layer list of the board, then the commit.
    app.world.projection.setLayers(LAYERS);
    app.world.projection.commit();

    expect(app.ui.find("boardPlay")).toBeDefined();
    expect(app.ui.lint().filter(finding => finding.key === "boardTiny")).toHaveLength(1);
    expect(starts.enter).toBe(0);

    seen.length = 0;
    app.time.step(16);

    // The column and the button, once each; the game's system of `sync` saw the button's start
    // pose in the swap frame, as after a mount (F49).
    expect(starts.enter).toBe(2);
    expect(seen).toEqual([0]);

    await app.stop();
  });

  it("leaves the world as it was after a discard: no exit plays, nothing of it stays", async () => {
    const { app } = await startWard();
    const before = idsOf(app);

    app.world.projection.build(["ward", "board"], OWNER, LAYERS, 4);
    app.time.step(16);
    app.world.projection.discard();
    app.time.step(16);

    expect(starts).toEqual({ enter: 0, exit: 0 });
    expect(idsOf(app)).toEqual(before);
    expect(app.ui.tree().key).toBe("wardRoot");

    await app.stop();
  });
});
