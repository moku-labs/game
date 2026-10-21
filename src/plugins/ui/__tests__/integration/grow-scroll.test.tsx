/**
 * @file ui plugin — an enter hook sees what the game's systems wrote in the frame its element came (F48, A Memory
 * Missing's case file). A picture grows out of a thumbnail in a scrolled list: a game system of phase `sync` adds the
 * list's scroll to where the picture starts, and the hook starts the picture there, in the first frame it is drawn.
 * A small game on the fake page, every frame read after it is stepped.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  component,
  createApp,
  defineComponent,
  defineGame,
  defineScene,
  projection,
  ScrollState,
  screen,
  system,
  Transform,
  type
} from "../../../../index";
import type { Manifest } from "../../../assets/types";
import type { CompiledMessages } from "../../../i18n/types";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import { createFakePixi, FakeTexture } from "../../../renderer/__tests__/fake-pixi";
import type { ViewHandle } from "../../../world/projection/types";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: { "grow.title": Record<string, never> };
}>();

/** The one scene bundle, with no files to fetch. */
const manifest: Manifest = {
  version: 2,
  bundles: { sheet: { feature: "grow", tier: "lazy", mb: 0, files: [] } }
};

/** The one compiled locale. */
const english: CompiledMessages = { "grow.title": () => [{ kind: "text", text: "grow" }] };

/** How far above its rest the picture starts while the list lies unscrolled: on the thumbnail's row. */
const ROW_DY = -300;

/** Where the picture starts, relative to its rest: `dy`, and whether the game's system added the scroll yet. */
const GrowFrom = component("GrowFrom", { dy: 0, scrolled: false });

/** The game's system: adds the list's scroll to the start of a picture that came, once. */
const growScroll = system({
  name: "grow.scroll",
  phase: "sync",
  query: [GrowFrom],
  run: (rows, { world }) => {
    const [list] = world.query(ScrollState);
    const offset = list?.[1].offset ?? 0;

    for (const [entity, from] of rows) {
      if (!from.scrolled) world.set(entity, GrowFrom, { dy: from.dy - offset, scrolled: true });
    }
  }
});

/**
 * The picture's enter hook: it starts at its rest moved by `GrowFrom.dy`, and travels to its rest.
 *
 * @param view - The picture.
 * @returns The track to the rest.
 */
function growEnter(view: ViewHandle<unknown>) {
  const rest = view.rest(Transform)?.y ?? 0;

  view.set(Transform, { y: rest + (view.get(GrowFrom)?.dy ?? 0) });

  return view.toRest(Transform, { ms: 300 });
}

/** The sheet: a list of six rows that scrolls in a 200 u window, the button that opens the picture, the picture. */
const Sheet = defineComponent("Sheet", {
  local: { open: false },
  view: (_props: object, local) => (
    <column key="sheetRoot" style={{ width: 1080, height: 1920 }}>
      <scroll key="list" style={{ width: 400, height: 200 }}>
        <column key="rows" style={{ width: 400 }}>
          {[1, 2, 3, 4, 5, 6].map(row => (
            <stack key={`row${row}`} style={{ width: 400, height: 100, fill: 0x22_44_88 }} />
          ))}
        </column>
      </scroll>
      <button key="open" local={{ open: true }} style={{ width: 100, height: 100 }} />
      {local.open ? (
        <stack
          key="picture"
          motion={{ enter: growEnter }}
          components={[GrowFrom({ dy: ROW_DY })]}
          style={{ width: 200, height: 200, fill: 0x88_44_22 }}
        />
      ) : undefined}
    </column>
  )
});

/** The sheet's root, a JSX root in layer `scene`. */
const sheetRoot = projection({
  name: "grow.sheet",
  layer: "scene",
  from: () => ({ id: "sheet" }),
  view: () => <Sheet />
});

const sheetScene = defineScene("sheet", {
  bundle: "sheet",
  layers: { scene: {} },
  projections: [sheetRoot]
});
const rest = defineNode({ rest: true, scene: "sheet", outcomes: { again: type() } });
const main = defineFlow("main", {
  nodes: { rest },
  start: "rest",
  outcomes: {},
  edges: { rest: { again: "rest" } }
});
const feature = defineFeature("grow", {
  flows: [main],
  scenes: [sheetScene],
  projections: [sheetRoot],
  components: [GrowFrom],
  systems: [growScroll],
  ui: [Sheet],
  strings: { en: english }
});

const running: Array<{ stop(): Promise<void> }> = [];

/**
 * Starts the game on the sheet.
 *
 * @returns The running app and the frame driver.
 */
async function startSheet() {
  installFakeDom({ width: 1080, height: 1920 });

  const pixi = createFakePixi();
  const app = createApp({
    plugins: [...screen, feature],
    pluginConfigs: {
      assets: { manifest },
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { visits: 0 }, initialSession: { visits: 0 }, seed: 1 },
      renderer: { mount: "#game", loadPixi: () => Promise.resolve(pixi.module), warm: 0 }
    }
  });

  await app.start();
  running.push(app);
  app.renderer.sync.textures.provide(() => new FakeTexture({}) as never);
  app.flow.run().catch(() => undefined);

  /**
   * Steps frames of 16 ms, the runner given its turn before each, and reads each.
   *
   * @param count - How many.
   * @param each - What runs after each frame.
   */
  const frames = async (count: number, each?: () => void): Promise<void> => {
    for (let frame = 1; frame <= count; frame += 1) {
      for (let turn = 0; turn < 80; turn += 1) await Promise.resolve();
      app.time.step(16);
      each?.();
    }
  };

  await frames(8);

  return { app, frames };
}

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("an enter hook under a scrolled list (F48)", () => {
  // Bug (A Memory Missing, case file): the hook played at the Box flush of phase `layout`, before the game's system
  // saw the picture, so the picture grew from the row as if the list lay unscrolled, 150 u off the thumbnail.
  it("starts the picture where the game's system put it, in the first frame it is drawn", async () => {
    const game = await startSheet();
    const { app } = game;

    expect(app.ui.scroll("list", 150)).toBe(true);
    await game.frames(2);
    app.input.tap(app.ui.find("open") ?? 0);

    const firsts: Array<{ y: number; drawn: number }> = [];

    await game.frames(4, () => {
      const picture = app.ui.find("picture");
      const display = picture === undefined ? undefined : app.renderer.sync.displayOf(picture);

      if (picture === undefined || display === undefined || firsts.length > 0) return;

      firsts.push({
        y: app.world.ecs.get(picture, Transform)?.y ?? Number.NaN,
        drawn: (display as { position: { y: number } }).position.y
      });
    });

    // The track is over: the picture stands at its rest.
    await game.frames(30);

    const picture = app.ui.find("picture") ?? 0;
    const restY = app.world.ecs.get(picture, Transform)?.y ?? Number.NaN;
    const start = firsts[0];

    expect(start).toBeDefined();
    // The track has not travelled yet in the frame that draws it first: the start pose, scroll included.
    expect(start?.y).toBeCloseTo(restY + ROW_DY - 150, 0);
    expect(start?.drawn).toBeCloseTo(restY + ROW_DY - 150, 0);
  });
});
