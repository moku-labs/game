/**
 * @file Root integration — render on demand (`renderer.onDemand`, spec 14 B1, E1), ported from
 * the game that first drew on demand: a frame in which nothing changed is not drawn, and the change
 * of a frame is drawn in that frame. Cross-plugin: renderer, effects, world, anim, flow. The
 * renderer runs for real over Pixi's own display objects (`drawn-helpers.ts`); the tree oracle
 * checks every frame, so a frame skipped over a changed picture fails the test.
 */
import type { Assets, World } from "@moku-labs/game";
import { defineFilter, defineGame, mut, Shape, system, Transform, type } from "@moku-labs/game";
import { defineGameApp } from "@moku-labs/game/app";
import { commands, run } from "@moku-labs/game/control";
import { fakeClock } from "@moku-labs/game/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DrawnPage, FRAME_MS, openPage, type Watched, watch } from "./drawn-helpers";

/** The fixture keeps nothing in the save. */
type FixturePlayer = { n: number };

/** Where the box rests, and how bright the lamp is. */
type FixtureSession = { x: number; glow: number };

/** How long the box takes to its new place, in milliseconds: ten frames. */
const SLIDE_MS = 160;

/** The bundle of the fixture's scene holds no file: a renderer that draws asks for it. */
const MANIFEST: Assets.Manifest = {
  version: 2,
  bundles: { fixture: { feature: "fixture", tier: "core", mb: 0, files: [] } }
};

const { defineNode, defineFlow, defineFeature, defineScene, projection } = defineGame<{
  player: FixturePlayer;
  session: FixtureSession;
  assets: string;
  scenes: "main";
  strings: Record<string, never>;
}>();

/**
 * A filter with a number, a vector and a colour, and a padding that follows one of its numbers:
 * what a glow or a veil is to the renderer.
 */
const Glow = defineFilter("fixture.glow", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv + fu.shift) * vec4<f32>(fu.tint, 1.0) * fu.amount * fu.spread; }",
  glsl: "void main() { finalColor = texture(uTexture, vTextureCoord + shift) * vec4(tint, 1.0) * amount * spread; }",
  uniforms: { amount: 1, spread: 4, shift: [0, 0], tint: { color: 0xff_d7_00 } },
  padding: "spread"
});

/** A box that slides to where the session puts it. */
const fixtureBox = projection({
  name: "fixture.box",
  layer: "main",
  from: (_player, session) => ({ x: session.x }),
  view: box => [
    Transform({ x: box.x, y: 100 }),
    Shape({ kind: "rect", w: 50, h: 50, fill: 0xff_9b_83 })
  ],
  motion: { change: { Transform: view => view.toRest(Transform, { ms: SLIDE_MS }) } }
});

/** A lamp under a filter, as bright as the session says. */
const fixtureLamp = projection({
  name: "fixture.lamp",
  layer: "main",
  from: (_player, session) => ({ glow: session.glow }),
  view: lamp => [
    Transform({ x: 200, y: 300 }),
    Shape({ kind: "rect", w: 80, h: 80, fill: 0x9f_b7_b4 }),
    Glow({ amount: lamp.glow })
  ]
});

/**
 * Writes the filter of the lamp again in every frame, with the value it holds. The query marks
 * the component changed in every frame.
 */
const rewriteGlow = system({
  name: "fixture.rewriteGlow",
  phase: "sync",
  query: [mut(Glow)],
  run: entities => {
    for (const row of entities) {
      const glow = row[1];

      glow.amount = Number(glow.amount);
      glow.spread = Number(glow.spread);
      glow.shift = [...glow.shift];
      glow.tint = Number(glow.tint);
    }
  }
});

const rest = defineNode({
  scene: "main",
  outcomes: { move: type<{ x: number }>() },
  rest: true,
  checkpoint: true
});

const shift = defineNode({
  input: type<{ x: number }>(),
  outcomes: { done: type() },
  run: ({ input, session, out }) => {
    session.x = input.x;

    return out.done();
  }
});

const mainFlow = defineFlow("main", {
  nodes: { rest, shift },
  start: "rest",
  edges: { rest: { move: "shift" }, shift: { done: "rest" } }
});

const main = defineScene("main", {
  bundle: "fixture",
  layers: { main: { sort: "order" } },
  projections: [fixtureBox, fixtureLamp]
});

const fixtureFeature = defineFeature("fixture", {
  scenes: [main],
  projections: [fixtureBox, fixtureLamp],
  filters: [Glow],
  systems: [rewriteGlow]
});

/**
 * Makes the fixture game on a page. Each call is a fresh game.
 *
 * @param page - The page it draws on.
 * @param onDemand - The switch of the renderer; left out, the engine's default stands.
 * @returns The game.
 */
function fixtureGame(page: DrawnPage, onDemand?: boolean) {
  return defineGameApp({
    flow: mainFlow,
    safeNode: "rest",
    player: { n: 0 },
    session: { x: 20, glow: 1 },
    referenceSide: 390,
    features: [fixtureFeature],
    pluginConfigs: {
      log: { mode: "test" },
      flow: { holdMs: 0 },
      renderer: { ...page.renderer, ...(onDemand === undefined ? {} : { onDemand }) }
    }
  });
}

/** The screen app of the fixture. */
type App = ReturnType<ReturnType<typeof fixtureGame>["screen"]>["app"];

/** A running fixture. */
type Running = Watched & {
  app: App;
  page: DrawnPage;
  /** The entity of one view of the fixture. */
  view: (name: "fixture.box" | "fixture.lamp") => World.Entity;
};

const running: Running[] = [];

/**
 * Starts the fixture on its rest node and draws until it stands still.
 *
 * @param options - What differs from the game as it ships.
 * @param options.onDemand - The switch of the renderer; `true` when left out.
 * @param options.clock - The clock the game runs on; the device clock when left out.
 * @returns The running fixture.
 */
async function open(
  options: { onDemand?: boolean | "default"; clock?: ReturnType<typeof fakeClock> } = {}
): Promise<Running> {
  const page = openPage();
  const onDemand = options.onDemand === "default" ? undefined : (options.onDemand ?? true);
  const { app } = fixtureGame(page, onDemand).screen({
    manifest: MANIFEST,
    ...(options.clock === undefined ? {} : { clock: options.clock })
  });

  await app.start();
  app.flow.run().catch(() => undefined);

  const fixture: Running = {
    ...watch(app, page, options.clock),
    app,
    page,
    view: name => {
      const entity = app.world.projection.entityOf(name, name);

      if (entity === undefined) throw new Error(`The fixture has no view "${name}".`);

      return entity;
    }
  };

  running.push(fixture);
  // The first frames mount the scene, build the filter and draw both.
  await fixture.frames(12);

  return fixture;
}

afterEach(async () => {
  for (const fixture of running.splice(0)) {
    fixture.oracle.expectNoMissedFrame();
    await fixture.app.stop();
  }

  vi.unstubAllGlobals();
});

describe("renderer.onDemand: a frame in which nothing changed is not drawn", () => {
  it("draws no frame of a screen that stands still, though a system writes its filter again in every frame", async () => {
    const fixture = await open();

    expect(await fixture.frames(30)).toBe(0);
  });

  it("draws every frame while the switch is off, the engine's default", async () => {
    const fixture = await open({ onDemand: "default" });

    expect(await fixture.frames(30)).toBe(30);
  });

  it("tells the frames really drawn apart from the frames of the loop", async () => {
    const resting = await open({ clock: fakeClock(1000) });
    const drawing = await open({ clock: fakeClock(1000), onDemand: false });

    // Two full seconds of the clock at rest: the loop runs 62.5 frames a second in both games.
    await resting.frames(130);
    await drawing.frames(130);

    expect(resting.app.renderer.stats().fps).toBeGreaterThan(60);
    expect(resting.app.renderer.stats().drawn).toBe(0);
    expect(drawing.app.renderer.stats().drawn).toBe(drawing.app.renderer.stats().fps);
  });
});

describe("renderer.onDemand: the change of a frame is drawn in that frame", () => {
  it("draws the frame a wake falls in, and only that one", async () => {
    const fixture = await open();

    fixture.app.time.wake();

    expect(await fixture.frames(1)).toBe(1);
    expect(await fixture.frames(10)).toBe(0);
  });

  it("draws a view in the frame it was written in, with no wake", async () => {
    const fixture = await open();

    fixture.app.world.ecs.set(fixture.view("fixture.box"), Transform, { y: 140 });

    expect(await fixture.frames(1)).toBe(1);
    expect(await fixture.frames(10)).toBe(0);
  });

  it("draws a view whose picture was drawn again, with no wake", async () => {
    const fixture = await open();

    fixture.app.world.ecs.set(fixture.view("fixture.box"), Shape, { fill: 0x33_44_55 });

    expect(await fixture.frames(1)).toBe(1);
    expect(await fixture.frames(10)).toBe(0);
  });

  it("draws every frame of a running track and stops when it ends", async () => {
    const fixture = await open();
    const box = fixture.view("fixture.box");
    const placeOf = () => fixture.app.world.ecs.get(box, Transform)?.x;
    const undrawn: number[] = [];
    let moved = 0;

    fixture.app.flow.gate.answer({ intent: "move", payload: { x: 220 } });

    // The commit and the ten frames of the slide: a frame that moved the box was drawn.
    for (let frame = 0; frame < SLIDE_MS / FRAME_MS + 4; frame += 1) {
      const before = placeOf();
      const drawn = await fixture.frames(1);

      if (placeOf() === before) continue;

      moved += 1;
      if (drawn !== 1) undrawn.push(frame);
    }

    expect(placeOf()).toBe(220);
    expect(moved).toBe(SLIDE_MS / FRAME_MS);
    expect(undrawn).toEqual([]);
    expect(await fixture.frames(20)).toBe(0);
  });

  it("draws a filter that got another value, which Pixi does not see", async () => {
    const fixture = await open();
    const lamp = fixture.view("fixture.lamp");
    const changes = [{ amount: 0.5 }, { shift: [0.1, 0] }, { tint: 0x00_ff_00 }, { spread: 9 }];

    // A number, one number of a vector, a colour, and the number the padding follows.
    for (const change of changes) {
      fixture.app.world.ecs.set(lamp, Glow, change);

      expect(await fixture.frames(1)).toBe(1);
      expect(await fixture.frames(5)).toBe(0);
    }
  });

  it("draws a filter that was switched off, and nothing while it stays off", async () => {
    const fixture = await open();

    fixture.app.world.ecs.set(fixture.view("fixture.lamp"), Glow, { enabled: false });

    expect(await fixture.frames(1)).toBe(1);

    // Off, the filter draws nothing: a new value changes no pixel.
    fixture.app.world.ecs.set(fixture.view("fixture.lamp"), Glow, { amount: 0.25 });

    expect(await fixture.frames(5)).toBe(0);
  });

  it("draws the frame after the window got another size, though no view moved", async () => {
    const fixture = await open();

    // Taller only: the frame keeps its scale and its place, and the browser emptied the canvas.
    fixture.page.resize(390, 900);

    expect(await fixture.frames(1)).toBe(1);
    expect(fixture.page.sizes().at(-1)).toEqual({ width: 390, height: 900 });
    expect(await fixture.frames(10)).toBe(0);
  });
});

describe("renderer.onDemand: what waits for a drawn frame still gets one", () => {
  it("draws a frame for a capture of a screen that stands still, and hands it the picture", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const fixture = await open();
    const captured = fixture.app.renderer.capture();

    expect(await fixture.frames(1)).toBe(1);

    const picture = await captured;

    expect(picture?.png.startsWith("data:image/png")).toBe(true);
  });

  it("lets a stepped game be captured through the doors, as a visual test does", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const fixture = await open();

    await run(fixture.app, commands.step, { frames: 5, deltaMs: FRAME_MS });

    const captured = run(fixture.app, commands.capture, {});

    await fixture.frames(2);

    const ran = await captured;

    expect(ran.value?.png.startsWith("data:image/png")).toBe(true);
  });
});
