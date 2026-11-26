/**
 * @file Root integration — the first drawn frame of a window that comes in with additive `Alpha` walks (F241, not
 * finished in 0.15.170). A Memory Missing's ladder opens over the board: the ladder's screen, held warm, and a veil
 * laid over the board come in with an additive walk of their `Alpha` from −1 to 0 (`walkView Alpha toRest({ alpha:
 * -1 })`). The game measured, on the device, one frame where both stood whole before their fades began, warm and
 * cold. The oracle is the frame Pixi is handed: real Pixi with a stand-in `Application`, the real world, ui, anim and
 * effects. A view is drawn at the product of its own and its parents' alpha and of their switched-on `AlphaFilter`s.
 */

import type * as pixi from "pixi.js";
import { AlphaFilter, Texture } from "pixi.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  Alpha,
  createApp,
  defineGame,
  defineScene,
  effectsPlugin,
  projection,
  screen,
  system,
  type
} from "../../src";
import type { Manifest } from "../../src/plugins/assets/types";
import type { CompiledMessages } from "../../src/plugins/i18n/types";
import { installFakeDom } from "../../src/plugins/renderer/__tests__/fake-dom";
import { stagePixi } from "../../src/plugins/renderer/__tests__/stage-pixi";
import type { ElementMotion } from "../../src/plugins/ui/jsx/types";
import { Tree } from "../../src/plugins/world/ecs/define";

type Session = { open: boolean };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: Session;
  assets: string;
  strings: { "fade.title": Record<string, never> };
}>();

/** The scene's bundle, with no files to fetch. */
const manifest: Manifest = {
  version: 2,
  bundles: { home: { feature: "fade", tier: "lazy", mb: 0, files: [] } }
};

/** The one compiled locale. */
const english: CompiledMessages = { "fade.title": () => [{ kind: "text", text: "fade" }] };

/** How long the screen fades in, as the ladder's `ladderIn.screen`. */
const SCREEN_MS = 600;

/** How long the veil fades in, as the ladder's `board.inMs`. */
const VEIL_MS = 450;

/**
 * The enter of the game's `walkView(view, Alpha, toRest({ alpha: -1 }), { ms })`: an additive walk of `Alpha` whose
 * first segment jumps to the offset −1 and whose second comes home to 0.
 *
 * @param ms - How long it walks.
 * @returns The motion.
 */
function fadeIn(ms: number): ElementMotion {
  return {
    enter: view =>
      view.tween(
        Alpha,
        { alpha: 0 },
        {
          ms,
          additive: true,
          segments: [
            { at: 0.0005, ease: () => 1, to: { alpha: -1 } },
            { at: 1, ease: t => t, to: { alpha: 0 } }
          ]
        }
      )
  };
}

/**
 * The game's system of phase `sync` that switches the `Alpha` filter of an element by its alpha, as A Memory Missing's
 * `shared.alphaGate` does: off while the element is whole, so a whole element costs no pass, on while it fades. It
 * reads the alpha of the frame it runs in, so it must see an enter's start pose.
 */
const alphaGate = system({
  name: "fade.alphaGate",
  phase: "sync",
  query: [Alpha],
  run: (rows, { world }) => {
    for (const [entity, alpha] of rows) {
      const on = alpha.alpha < 0.999;

      if (alpha.enabled !== on) world.set(entity, Alpha, { enabled: on });
    }
  }
});

/** The board under the ladder. */
const board = projection({
  name: "fade.board",
  layer: "ui",
  from: () => [{ id: "boardItem" }],
  key: (item: { id: string }) => item.id,
  view: () => <stack key="board" style={{ width: 1080, height: 1920, fill: 0x88_88_88 }} />
});

/** The veil laid over the board while the ladder shows: never held, it is made at the open. */
const veil = projection({
  name: "fade.veil",
  layer: "ui",
  from: (_player: unknown, session: Session) => (session.open ? [{ id: "veilItem" }] : []),
  key: (item: { id: string }) => item.id,
  view: () => (
    <stack
      key="veil"
      style={{ width: 1080, height: 1920, fill: 0x10_10_20 }}
      motion={fadeIn(VEIL_MS)}
      components={[Alpha()]}
    />
  )
});

/**
 * The ladder's screen: one root that fades in, with a child.
 *
 * @returns The screen's root.
 */
function ladderView() {
  return (
    <stack
      key="ladder"
      style={{ width: 1080, height: 1920, fill: 0x20_20_40 }}
      motion={fadeIn(SCREEN_MS)}
      components={[Alpha()]}
    >
      <stack key="ladderRow" style={{ width: 400, height: 80, fill: 0xff_dd_9e }} />
    </stack>
  );
}

/** The ladder's screen held warm: built aside at rest, shown by the open. */
const warmLadder = projection({
  name: "fade.ladder",
  layer: "ui",
  from: (_player: unknown, session: Session) => (session.open ? [{ id: "ladderItem" }] : []),
  key: (item: { id: string }) => item.id,
  view: () => ladderView(),
  warm: () => ({ id: "ladderItem" })
});

/** The same screen opened cold: made at the open. */
const coldLadder = projection({
  name: "fade.ladder",
  layer: "ui",
  from: (_player: unknown, session: Session) => (session.open ? [{ id: "ladderItem" }] : []),
  key: (item: { id: string }) => item.id,
  view: () => ladderView()
});

/**
 * The game of one scene: the board, the veil and the ladder's screen, opened by the intent `open`.
 *
 * @param warm - True: the ladder's screen is held warm.
 * @returns The feature.
 */
function gameOf(warm: boolean) {
  const ladder = warm ? warmLadder : coldLadder;
  const home = defineScene("home", {
    bundle: "home",
    layers: { ui: {} },
    projections: [board, veil, ladder]
  });
  const rest = defineNode({ rest: true, scene: "home", outcomes: { open: type() } });
  const open = defineNode({
    outcomes: { done: type() },
    run: ({ session, out }) => {
      session.open = true;

      return out.done();
    }
  });
  const main = defineFlow("main", {
    nodes: { rest, open },
    start: "rest",
    outcomes: {},
    edges: { rest: { open: "open" }, open: { done: "rest" } }
  });

  return {
    main,
    feature: defineFeature("fade", {
      flows: [main],
      systems: [alphaGate],
      scenes: [home],
      projections: [board, veil, ladder],
      strings: { en: english }
    })
  };
}

/** What one frame drawn onto the canvas showed: the alpha each view was drawn at and the one the world stored. */
type Drawn = { ladder: number; veil: number; ladderStored: number; veilStored: number };

const running: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
});

/**
 * The kept picture (spec 23) drawn in place of a container that is not rendered live: its sibling labelled
 * `kept:<label>`.
 *
 * @param node - The container that is not rendered live.
 * @returns The picture's sprite, or `undefined` when none stands in for it.
 */
function keptOf(node: pixi.Container): pixi.Container | undefined {
  return node.parent?.children.find(child => child.label === `kept:${node.label}`);
}

/**
 * The alpha one container adds to what it draws: its own alpha times its switched-on `AlphaFilter`s, or the alpha of
 * its kept picture when it is not rendered live; 0 when it draws nothing.
 *
 * @param node - The container.
 * @returns The factor.
 */
function factorOf(node: pixi.Container): number {
  if (!node.visible) return 0;

  let alpha = node.alpha;

  if (!node.renderable) {
    const kept = keptOf(node);

    if (kept === undefined || !kept.visible || !kept.renderable) return 0;
    alpha *= kept.alpha;
  }

  for (const filter of (node.filters as pixi.Filter[] | null | undefined) ?? []) {
    if (filter.enabled && filter instanceof AlphaFilter) alpha *= filter.alpha;
  }

  return alpha;
}

/**
 * The alpha a display object is drawn at on the stage: the product of the factors of it and its parents; 0 when it
 * is not on the stage.
 *
 * @param object - The display object.
 * @param stage - The stage.
 * @returns The alpha.
 */
function drawnAlpha(object: pixi.Container | undefined, stage: pixi.Container): number {
  let alpha = 1;

  for (let node: pixi.Container | null | undefined = object; node; node = node.parent) {
    alpha *= factorOf(node);

    if (node === stage) return alpha;
  }

  return 0;
}

/**
 * Starts the game on the board, lets the ladder be held warm when it is, and records the alpha the screen and the
 * veil are drawn at in every frame drawn onto the canvas from the open on.
 *
 * @param warm - True: the ladder's screen is held warm.
 * @returns How many roots the world held aside before the open, and the alphas of every drawn frame after it.
 */
async function openLadder(warm: boolean): Promise<{ held: number; drawn: Drawn[] }> {
  installFakeDom({ width: 1080, height: 1920 });

  const stage = stagePixi();
  const { main, feature } = gameOf(warm);
  const app = createApp({
    plugins: [...screen, effectsPlugin, feature],
    pluginConfigs: {
      assets: { manifest },
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { visits: 0 }, initialSession: { open: false }, seed: 1 },
      renderer: { mount: "#game", loadPixi: () => Promise.resolve(stage.module), warm: 0 }
    }
  });

  await app.start();
  running.push(app);
  app.renderer.sync.textures.provide(() => Texture.WHITE as never);
  app.flow.run().catch(() => undefined);

  const frames = async (count: number): Promise<void> => {
    for (let frame = 1; frame <= count; frame += 1) {
      for (let turn = 0; turn < 80; turn += 1) await Promise.resolve();
      app.time.step(16);
    }
  };

  await frames(60);

  const drawn: Drawn[] = [];
  const application = stage.last();
  let opened = false;
  let held = 0;

  for (const [entity] of app.world.ecs.query(Tree)) {
    if (app.world.projection.isBuilding(entity)) held += 1;
  }

  application.renderer.watchers.push(call => {
    if (!opened || call.target !== undefined || call.container !== application.stage) return;

    const ladder = app.ui.find("ladder") ?? -1;
    const veilEntity = app.ui.find("veil") ?? -1;
    const display = (entity: number) =>
      app.renderer.sync.displayOf(entity) as pixi.Container | undefined;

    drawn.push({
      ladder: drawnAlpha(display(ladder), application.stage),
      veil: drawnAlpha(display(veilEntity), application.stage),
      ladderStored: app.world.ecs.get(ladder, Alpha)?.alpha ?? Number.NaN,
      veilStored: app.world.ecs.get(veilEntity, Alpha)?.alpha ?? Number.NaN
    });
  });

  opened = true;
  if (!app.flow.gate.answer({ intent: "open" })) throw new Error("the gate refused the open");

  await frames(6);

  return { held, drawn };
}

describe("the first drawn frame of additive Alpha walks from −1 (F241)", () => {
  // Bug (A Memory Missing, the ladder over the board, 0.15.170): the frame the window first shows draws the screen and
  // the veil whole, and their fades begin a frame later: a flash of the whole ladder before it fades in.
  it.each([
    ["warm", true],
    ["cold", false]
  ])("a %s open draws the screen and the veil at their walks' start from the first frame", async (_name, warm) => {
    const { held, drawn } = await openLadder(warm);

    expect(held).toBe(warm ? 1 : 0);
    expect(drawn.length).toBeGreaterThan(3);
    // The first frame carries the walks' t=0 sample: the offset -1 over the rest 1.
    expect(drawn[0]).toEqual({ ladder: 0, veil: 0, ladderStored: 0, veilStored: 0 });
    // Every frame is drawn at the alpha the world stores in it, and the fades run.
    for (const frame of drawn) {
      expect(frame.ladder).toBeCloseTo(frame.ladderStored, 6);
      expect(frame.veil).toBeCloseTo(frame.veilStored, 6);
    }
    expect(drawn.at(-1)?.ladder ?? 0).toBeGreaterThan(0.05);
    expect(drawn.at(-1)?.veil ?? 0).toBeGreaterThan(0.05);
  });
});
