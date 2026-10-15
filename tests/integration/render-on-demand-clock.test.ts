/**
 * @file Root integration — what lives on the clock under render on demand (spec 15, the clock
 * cases of the game's `still-screens.test.ts`). A line typed by `res(Now)` and a glint cycle with a
 * pause, on a renderer drawing on demand over Pixi's own objects. Cross-plugin: world (`Now`),
 * clock, lifecycle, text, anim, effects, renderer. The tree oracle checks every frame
 * (`drawn-helpers.ts`), so a frame skipped over a changed picture fails the test.
 */
import { readFile } from "node:fs/promises";
import type { Assets, World } from "@moku-labs/game";
import {
  component,
  defineFilter,
  defineGame,
  Layer,
  mut,
  Now,
  Shape,
  system,
  Text,
  Transform,
  type
} from "@moku-labs/game";
import { defineGameApp } from "@moku-labs/game/app";
import { fakeClock } from "@moku-labs/game/testing";
import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diskIo, openPage, type Watched, watch } from "./drawn-helpers";

/** The folder of the mini game: its body font draws the line. */
const MINI = new URL("../fixtures/mini-game/", import.meta.url);

/** How long one character of the line takes to appear, in milliseconds of the clock. */
const CHAR_MS = 31;

/** The line the fixture types. */
const LINE = "The ward is waking";

/** The owner of every view the tests spawn. */
const OWNER = { kind: "plugin", name: "clock-typing" } as const;

const { defineNode, defineFlow, defineFeature, defineScene, defineTextStyles, projection } =
  defineGame<{
    player: { n: number };
    session: Record<string, never>;
    assets: "ui.font-body";
    scenes: "main";
    strings: Record<string, never>;
    textStyles: "line";
  }>();

/** A line typed from a moment of the clock on. */
const Typed = component("clockTyping.typed", { line: "", since: 0 });

/**
 * Types every line by the frame's moment, and writes the shown part in every frame, also when it
 * did not grow: the label answers for the frame, not the system.
 */
const typer = system({
  name: "clockTyping.typer",
  phase: "animate",
  query: [Typed, mut(Text)],
  run: (rows, { res }) => {
    const { now } = res(Now);

    for (const [, typed, text] of rows) {
      const shown = Math.max(0, Math.floor((now - typed.since) / CHAR_MS));

      text.content = typed.line.slice(0, shown);
    }
  }
});

/** The strength of a glint: a filter the renderer writes as a uniform. */
const Glint = defineFilter("clockTyping.glint", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv) * fu.amount; }",
  glsl: "void main() { finalColor = texture(uTexture, vTextureCoord) * amount; }",
  uniforms: { amount: 0.2 }
});

/** The glints' cycle: up in 500 ms, a hold of 3 s, down in 500 ms, forever. */
const GLINT_CYCLE = [
  { at: 0.125, ease: "linear", to: { amount: 0.6 } },
  { at: 0.875, ease: "linear", to: { amount: 0.6 } },
  { at: 1, ease: "linear", to: { amount: 0.2 } }
] as const;

/** A card under the glint cycle. */
const glintCard = projection({
  name: "clockTyping.glint",
  layer: "main",
  from: () => ({ shine: 0.2 }),
  view: card => [
    Transform({ x: 195, y: 300 }),
    Shape({ kind: "rect", w: 80, h: 80, fill: 0x9f_b7_b4 }),
    Glint({ amount: card.shine })
  ],
  motion: {
    loop: view =>
      view.tween(Glint, { amount: 0.2 }, { ms: 4000, repeat: "forever", segments: GLINT_CYCLE })
  }
});

const rest = defineNode({ scene: "main", outcomes: { go: type() }, rest: true, checkpoint: true });

const mainFlow = defineFlow("main", {
  nodes: { rest },
  start: "rest",
  edges: { rest: { go: "rest" } }
});

/**
 * Makes the fixture feature: one scene, with the glint card on it or not.
 *
 * @param glint - True to mount the glint card with the scene.
 * @returns The feature.
 */
function fixtureFeature(glint: boolean) {
  const main = defineScene("main", {
    bundle: "ui",
    layers: { main: { sort: "order" } },
    projections: glint ? [glintCard] : []
  });

  return defineFeature("clockTyping", {
    scenes: [main],
    systems: [typer],
    filters: [Glint],
    projections: [glintCard],
    textStyles: defineTextStyles({ line: { font: "ui.font-body", size: 40, fill: 0xff_ff_ff } })
  });
}

/** A running fixture. */
type Running = Watched & {
  app: ReturnType<ReturnType<typeof defineGameApp>["screen"]>["app"];
  clock: ReturnType<typeof fakeClock>;
  page: ReturnType<typeof openPage>;
};

const running: Running[] = [];

afterEach(async () => {
  for (const fixture of running.splice(0)) {
    fixture.oracle.expectNoMissedFrame();
    fixture.oracle.expectPicturesCurrent();
    await fixture.app.stop();
  }

  vi.unstubAllGlobals();
});

/**
 * Starts the fixture on a page, drawing on demand, and lets it settle on its rest node.
 *
 * @param glint - True to show the glint card.
 * @returns The running fixture.
 */
async function open(glint = false): Promise<Running> {
  const page = openPage();
  const clock = fakeClock(1_790_000_000_000);
  const mini = JSON.parse(
    await readFile(new URL("generated/manifest.json", MINI), "utf8")
  ) as Assets.Manifest;
  const manifest: Assets.Manifest = {
    ...mini,
    bundles: { ui: mini.bundles.ui ?? { feature: "ui", tier: "boot", mb: 0, files: [] } }
  };
  const { app } = defineGameApp({
    flow: mainFlow,
    safeNode: "rest",
    player: { n: 0 },
    session: {},
    referenceSide: 390,
    features: [fixtureFeature(glint)],
    pluginConfigs: { log: { mode: "test" }, renderer: { onDemand: true } }
  }).screen({ manifest, io: diskIo(MINI, manifest), renderer: page.renderer, clock });

  await app.start();
  app.flow.run().catch(() => undefined);

  const fixture: Running = { ...watch(app, page, clock), app, clock, page };

  running.push(fixture);

  for (let frame = 0; frame < 200 && app.flow.state().path !== "rest"; frame += 1) {
    await fixture.frames(1);
  }

  await fixture.frames(30);

  return fixture;
}

/**
 * Spawns the typed line, its first character due `delayMs` after the clock's moment now.
 *
 * @param fixture - The running fixture.
 * @param delayMs - How long the line stays empty.
 * @returns The entity of the line.
 */
function typeLine(fixture: Running, delayMs: number): World.Entity {
  return fixture.app.world.ecs.spawn(OWNER, [
    Layer({ name: "main" }),
    Transform({ x: 195, y: 400 }),
    Text({ style: "line" }),
    Typed({ line: LINE, since: fixture.clock.now() + delayMs })
  ]);
}

/**
 * The part of the line the world holds now.
 *
 * @param fixture - The running fixture.
 * @param line - The entity of the line.
 * @returns The resolved string of its `Text`.
 */
function shownOf(fixture: Running, line: World.Entity): string {
  return fixture.app.world.ecs.get(line, Text)?.resolved ?? "";
}

/**
 * What the BitmapText objects on the stage show, in tree order: the line as the player reads it.
 *
 * @param fixture - The running fixture.
 * @returns The texts joined.
 */
function onStage(fixture: Running): string {
  const texts: string[] = [];
  const walk = (node: pixi.Container): void => {
    if (node instanceof pixi.BitmapText) texts.push(node.text);
    for (const child of node.children) walk(child);
  };

  walk(fixture.page.stage.last().stage);

  return texts.join("");
}

describe("render on demand: a line typed by the clock", () => {
  // The bug: a typed line that writes its Text in every frame draws every frame, or the frame a
  // character appears in is skipped and the line shows late.
  it("types a line by the clock and draws every frame a character appears in, and no other", async () => {
    const fixture = await open();
    const line = typeLine(fixture, 200);

    // The spawn and the empty line settle before the first character is due.
    await fixture.frames(6);

    const grew: boolean[] = [];
    const drawn: boolean[] = [];
    let before = shownOf(fixture, line);

    while (shownOf(fixture, line) !== LINE && drawn.length < 120) {
      const [frame = false] = await fixture.each(1);
      const now = shownOf(fixture, line);

      drawn.push(frame);
      grew.push(now.length > before.length);
      before = now;
    }

    expect(shownOf(fixture, line)).toBe(LINE);
    expect(grew.filter(Boolean)).toHaveLength(LINE.length);
    // 16 ms frames against 31 ms characters: some frames add nothing, and those are not drawn.
    expect(grew.some(added => !added)).toBe(true);
    expect(drawn).toEqual(grew);
    expect(onStage(fixture)).toBe(LINE);
  });

  // The bug: the resume after a long background draws no frame, or the first frame shows the line
  // as it stood when the game went away.
  it("shows the line whole in the first frame after half a minute in the background", async () => {
    const fixture = await open();
    const line = typeLine(fixture, 50);

    await fixture.frames(10);

    expect(shownOf(fixture, line).length).toBeGreaterThan(0);
    expect(shownOf(fixture, line).length).toBeLessThan(LINE.length);

    fixture.app.lifecycle.push("background");
    fixture.clock.advance(30_000);
    fixture.app.lifecycle.pop("background");

    expect(await fixture.each(1)).toEqual([true]);
    expect(shownOf(fixture, line)).toBe(LINE);
    expect(onStage(fixture)).toBe(LINE);
  });
});

describe("render on demand: a glint cycle with a pause", () => {
  // The bug: a loop holding between two keys writes its equal value in every frame and the
  // renderer draws all 187 frames of the pause; or a moving frame is not drawn.
  it("draws the pause of a glint cycle as no frame at all, and every frame it moves", async () => {
    const fixture = await open(true);
    const card = fixture.app.world.projection.entityOf("clockTyping.glint", "clockTyping.glint");

    if (card === undefined) throw new Error("The fixture has no glint card.");

    const amountOf = (): number | undefined => fixture.app.world.ecs.get(card, Glint)?.amount;
    const moved: boolean[] = [];
    const drawn: boolean[] = [];
    let before = amountOf();

    // 300 frames of 16 ms: 4.8 s, the whole 4 s cycle and the rise of the next one.
    for (let frame = 0; frame < 300; frame += 1) {
      const [shown = false] = await fixture.each(1);
      const now = amountOf();

      drawn.push(shown);
      moved.push(now !== before);
      before = now;
    }

    let held = 0;
    let longestHold = 0;

    for (const move of moved) {
      held = move ? 0 : held + 1;
      longestHold = Math.max(longestHold, held);
    }

    // The 3 s hold stands as some 187 frames of 16 ms in a row with no move.
    expect(longestHold).toBeGreaterThan(180);
    expect(drawn).toEqual(moved);
  });
});
