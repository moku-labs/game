/**
 * @file The page of the effect set's browser leg (`tests/visual/effects-set.visual.ts`, F126 stage 3 slices 1 to 3).
 * Not a test: the leg bundles it with the flags of a dev page and opens it in Chrome on WebGPU and on WebGL
 * (`?renderer=webgl`), at resolution 1 and 2 (`?resolution=2`). A small game lists every member of the set and
 * runs on the real engine, the real Pixi and the real GPU, with `debug.verifyFrames` on. Each member plays three rows:
 * a held value, kept as a picture and held against its live frame; a tweening value, which on WebGPU runs on the
 * view's own quad and is held against its live frame; and one pixel worked out by hand (`RevealLine` two, its corners
 * at a quarter turn of the diagonal; `Shine` two, its line and a transparent corner). `Bloom`, the member with a chain:
 * its held rows at radius 16 and 32 are its kept picture (stage 3) within 1/255 of live; its `strength` tween runs on
 * the view's own quad on WebGPU over the held chain result, within 1/255 of live; and a `threshold` tween after it
 * reruns the chain, which leaves the quad in that frame for stage 2 and 3, within 1/255 of live. Every capture stays in the
 * page, so the leg can hand the WebGPU pictures to the WebGL page (`compareSet`) and hold the GLSL twins against the
 * WGSL bodies. It answers in `globalThis.effectsSet`.
 *
 * The clock is paused and every frame is a `time.step`, as in `kept-quad/page.ts`.
 */

import { defineGameApp } from "../../../src/app";
import type { Assets, World } from "../../../src/index";
import {
  Aura,
  Bloom,
  Dissolve,
  defineGame,
  Flash,
  Fold,
  Grade,
  Layer,
  Parent,
  RevealLine,
  RevealRound,
  Shape,
  Shine,
  Transform,
  type,
  Vignette
} from "../../../src/index";
import manifestJson from "../../fixtures/mini-game/generated/manifest.json";

/** What one row answered. */
export type SetRow = {
  /** `member: kind`. */
  name: string;
  /**
   * `held`, `tween`, `probe`, or `rerun`: the tween of a field a member's chain reads, after a tween that brought the
   * view on its quad, captured in a frame whose write reran the chain.
   */
  kind: "held" | "tween" | "probe" | "rerun";
  /** Held within 1/255 of its live frame on both backends, not only within the frame oracle's thresholds. */
  strict?: boolean;
  /** Pictures the renderer kept when the row was captured. */
  pictures: number;
  /** Views drawn through their own shader when the row was captured. */
  shaded: number;
  /** For a `rerun` row: views drawn through their own shader in the frame before the first write the chain reads. */
  before?: number;
  /** Pixels of the capture that differ from the live capture by more than 24 in a channel: the frame oracle's. */
  differing: number;
  /** Pixels of the capture that differ from the live capture by more than 1 in a channel. */
  overOne: number;
  /** The largest difference of a channel from the live capture. */
  largest: number;
  /** Pixels of a capture. */
  total: number;
  /** Pixels of the capture with any colour: a blank row proves nothing. */
  lit: number;
  /** For a probe: how far the pixel misses the value by hand, the largest channel. */
  probe?: { wanted: readonly number[]; got: readonly number[]; off: number };
};

/** What the page answers. */
export type SetResult = {
  backend: string;
  resolution: number;
  rows: SetRow[];
  /** The warnings of the run that fail it: stale pictures, compile and pipeline errors, an unlisted member. */
  warnings: Array<{ event: string; data: unknown }>;
};

/** One row of the comparison of this page's captures with another backend's. */
export type CrossRow = {
  name: string;
  /** The share of pixels within 8 of the other in each colour channel and within 2 in alpha. */
  share: number;
  /** The largest difference of a colour channel. */
  color: number;
  /** The largest difference of the alpha. */
  alpha: number;
};

/** One game frame of the paused clock. */
const FRAME_MS = 1000 / 60;

/** The most frames a held row may take to be kept as a picture. */
const SETTLE_FRAMES = 60;

/** Writes of a number that bring a kept view on its shader, past `QUAD_AFTER`. */
const WRITES = 5;

/** Writes of a field a chain reads, after the writes that brought the view on its shader: each reruns the chain. */
const RERUNS = 3;

/** A change of a channel the frame oracle does not count. */
const CHANNEL = 24;

/** How far a colour channel of the other backend may be. */
const CROSS_COLOR = 8;

/** How far the alpha of the other backend may be. */
const CROSS_ALPHA = 2;

/** The log lines that fail a run. */
const FAILS = new Set([
  "renderer:stale-picture",
  "renderer:missed-frame",
  "renderer:missed-mark",
  "renderer:warm-invalid",
  "renderer:warm-failed",
  "effects:wgsl",
  "effects:glsl",
  "effects:broken",
  "effects:filter-unlisted"
]);

/** The fill of a card a bloom shows on: dark, so the gold square is the only bright part. */
const DARK = 0x20_20_40;

/** The owner of every view the page spawns. */
const OWNER = { kind: "plugin", name: "visual" } as const;

/** The kit of the page's game. */
const kit = defineGame<{
  player: Record<string, never>;
  session: Record<string, never>;
  assets: never;
  scenes: "main";
  strings: Record<string, never>;
  textStyles: never;
  emitters: never;
}>();

const rest = kit.defineNode({
  scene: "main",
  outcomes: { go: type() },
  rest: true,
  checkpoint: true
});
const flow = kit.defineFlow("main", {
  nodes: { rest },
  start: "rest",
  edges: { rest: { go: "rest" } }
});
const main = kit.defineScene("main", {
  bundle: "ui",
  layers: { main: { sort: "order" } },
  projections: []
});
const feature = kit.defineFeature("visual", {
  scenes: [main],
  filters: [Flash, Grade, Vignette, RevealLine, RevealRound, Dissolve, Shine, Aura, Fold, Bloom]
});

/** The manifest of the page: the mini game's `ui` bundle without its files, so the scene loads nothing. */
const manifest: Assets.Manifest = {
  ...(manifestJson as unknown as Assets.Manifest),
  bundles: { ui: { feature: "ui", tier: "boot", mb: 0, files: [] } }
};

/** The app of the page. */
type App = ReturnType<ReturnType<typeof defineGameApp>["screen"]>["app"];

/** The captures of the rows, by name, as PNG data URLs: what `compareSet` holds another backend's against. */
const captures = new Map<string, string>();

/** The page's backend writes straight alpha into a capture (WebGPU) and the row compares premultiplied: `premultiplied`. */
const page = { straight: false };

/**
 * Waits for frames of the page, while the clock still runs on them.
 *
 * @param count - How many.
 */
async function frames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
}

/**
 * Runs game frames on the paused clock, each followed by a task.
 *
 * @param app - The app.
 * @param count - How many.
 */
async function step(app: App, count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    app.time.step(FRAME_MS);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

/**
 * The RGBA pixels of a PNG data URL.
 *
 * @param png - The data URL.
 * @returns The pixels.
 */
async function pixelsOf(png: string): Promise<ImageData> {
  const response = await fetch(png);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");

  if (context === null) throw new Error("no 2d context");

  context.drawImage(bitmap, 0, 0);

  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

/**
 * Compares two pictures of the same size.
 *
 * @param one - A capture.
 * @param other - The capture it is held against.
 * @returns The pixels over the oracle's channel and over 1, the largest channel difference, the lit pixels of `one`.
 */
function compare(
  one: ImageData,
  other: ImageData
): Pick<SetRow, "differing" | "overOne" | "largest" | "lit" | "total"> {
  let differing = 0;
  let overOne = 0;
  let largest = 0;
  let lit = 0;

  for (let at = 0; at < one.data.length; at += 4) {
    let most = 0;

    for (let channel = 0; channel < 4; channel += 1) {
      most = Math.max(
        most,
        Math.abs((one.data[at + channel] ?? 0) - (other.data[at + channel] ?? 0))
      );
    }

    if (most > CHANNEL) differing += 1;
    if (most > 1) overOne += 1;
    largest = Math.max(largest, most);
    if ((one.data[at] ?? 0) + (one.data[at + 1] ?? 0) + (one.data[at + 2] ?? 0) > 0) lit += 1;
  }

  return { differing, overOne, largest, lit, total: one.data.length / 4 };
}

/**
 * Takes the capture of a frame.
 *
 * @param app - The app.
 * @param name - The row, for the error.
 * @returns The PNG data URL.
 */
async function captured(app: App, name: string): Promise<string> {
  const shot = await app.renderer.capture();

  if (shot === undefined) throw new Error(`no capture of ${name}`);

  return shot.png;
}

/**
 * What a row draws: its views, the writes of one frame of its tween, and, for a `rerun` row, the writes of one frame of
 * the tween of a field the chain reads, played after it; the row is captured in the frame of the last of those.
 */
type Scene = {
  readonly entities: readonly World.Entity[];
  readonly write?: (turn: number) => void;
  readonly rerun?: (turn: number) => void;
};

/**
 * The views drawn through their own shader now.
 *
 * @param app - The app.
 * @returns How many.
 */
function shadedNow(app: App): number {
  return app.renderer.sync.debug.why().filter(entry => entry.quad === true).length;
}

/** A pixel worked out by hand: where it is, in CSS px of the canvas, and what it must be. */
type Probe = { readonly x: number; readonly y: number; readonly rgb: readonly number[] };

/**
 * Brings a row's scene to the state it is captured in: at rest until it is kept, or through its tween, and for a
 * `rerun` row through the writes its chain reads after it.
 *
 * @param app - The app.
 * @param scene - What the row draws.
 * @returns For a `rerun` row, the views on their own shader before its first write the chain reads.
 */
async function bring(app: App, scene: Scene): Promise<number | undefined> {
  const { write, rerun } = scene;

  if (write === undefined) {
    // At rest until it is kept as a picture.
    for (let frame = 0; frame < SETTLE_FRAMES; frame += 1) {
      await step(app, 1);
      if (app.renderer.stats().kept.pictures > 0) break;
    }

    return undefined;
  }

  await step(app, 6);

  for (let turn = 0; turn < WRITES; turn += 1) {
    write(turn);
    await step(app, 1);
  }

  if (rerun === undefined) {
    // The view stays on its shader for `QUAD_CALM` frames after the last write.
    await step(app, 12);

    return undefined;
  }

  // Captured in the frame of the last write the chain reads: the chain was drawn again in it.
  const before = shadedNow(app);

  for (let turn = 0; turn < RERUNS; turn += 1) {
    rerun(turn);
    await step(app, 1);
  }

  return before;
}

/**
 * Plays one row: brings it to its state, captures it, captures it again drawn live, takes it away.
 *
 * @param app - The app.
 * @param row - The row.
 * @param row.name - Its name.
 * @param row.kind - What it holds.
 * @param row.scene - What it draws.
 * @param row.probe - The pixel by hand of a probe row.
 * @param row.strict - Whether the row is held within 1/255 of live.
 * @returns What it answered.
 */
async function play(
  app: App,
  row: { name: string; kind: SetRow["kind"]; scene: Scene; probe?: Probe; strict?: true }
): Promise<SetRow> {
  const { name, kind, scene, probe, strict } = row;
  const before = await bring(app, scene);
  const pictures = app.renderer.stats().kept.pictures;
  const shaded = shadedNow(app);
  const png = await captured(app, name);

  app.renderer.sync.debug.kept(false);
  await step(app, 3);

  const live = await captured(app, name);

  app.renderer.sync.debug.kept(true);

  for (const entity of scene.entities) app.world.ecs.despawn(entity);
  await step(app, 3);

  captures.set(name, png);

  // Held against live as the canvas composites them, premultiplied: a straight-alpha capture rounds the colour of a
  // half-transparent pixel by 255 / alpha.
  const composited = async (shot: string): Promise<ImageData> =>
    page.straight ? premultiplied(await pixelsOf(shot)) : pixelsOf(shot);
  const mode = await composited(png);
  const answer: SetRow = {
    name,
    kind,
    ...(strict === undefined ? {} : { strict }),
    pictures,
    shaded,
    ...(before === undefined ? {} : { before }),
    ...compare(mode, await composited(live))
  };

  if (probe === undefined) return answer;

  const resolution = mode.width / globalThis.innerWidth;
  const at = (Math.round(probe.y * resolution) * mode.width + Math.round(probe.x * resolution)) * 4;
  const got = [0, 1, 2].map(channel => mode.data[at + channel] ?? 0);
  const off = Math.max(...got.map((value, channel) => Math.abs(value - (probe.rgb[channel] ?? 0))));

  return { ...answer, probe: { wanted: probe.rgb, got, off } };
}

/**
 * Plays the rows of the page.
 *
 * @returns The answer.
 */
async function run(): Promise<SetResult> {
  const query = new URLSearchParams(location.search);
  const resolution = Number(query.get("resolution") ?? 1);
  const preference = query.get("renderer") === "webgl" ? "webgl" : "webgpu";
  const mount = document.createElement("div");

  mount.id = "game";
  mount.style.width = "480px";
  mount.style.height = "480px";
  document.body.append(mount);

  const { app } = defineGameApp({
    flow,
    safeNode: "rest",
    player: {},
    session: {},
    referenceSide: 480,
    features: [feature],
    pluginConfigs: {
      renderer: { preference, maxResolution: resolution, debug: { verifyFrames: true } }
    }
  }).screen({ manifest, renderer: { mount: "#game" } });

  await app.start();
  app.flow.run().catch(() => undefined);
  page.straight = app.renderer.host.kind() === "webgpu";

  for (let frame = 0; frame < 300 && app.flow.state().path !== "rest"; frame += 1) await frames(1);

  await frames(30);
  app.time.pause();

  const gpuErrors: string[] = [];

  app.renderer.host.device()?.addEventListener("uncapturederror", event => {
    gpuErrors.push((event as GPUUncapturedErrorEvent).error.message);
  });

  const { ecs } = app.world;
  const { scale } = app.renderer.viewport.size();
  const css = (length: number): number => length / scale;
  const at = (x: number, y: number): { x: number; y: number } =>
    app.renderer.viewport.toReference(x, y);

  /**
   * A card 240 × 160 CSS px at 120, 160 of the canvas, a square in it, the filter on the card: its centre is 240, 240.
   *
   * @param filter - The member's value.
   * @param fill - The card's fill.
   * @param square - Whether the card holds a square.
   * @param rounded - Whether its corners are rounded, 12 CSS px; a square corner is a lit pixel at the corner.
   * @returns The card and the square, children first.
   */
  const card = (
    filter: World.AnyComponentValue,
    fill = 0x33_88_ff,
    square = true,
    rounded = true
  ): World.Entity[] => {
    const parent = ecs.spawn(OWNER, [
      Layer({ name: "main" }),
      Transform(at(120, 160)),
      Shape({ w: css(240), h: css(160), fill, radius: rounded ? css(12) : 0 }),
      filter
    ]);

    if (!square) return [parent];

    const child = ecs.spawn(OWNER, [
      Parent({ entity: parent }),
      Transform({ x: css(20), y: css(20) }),
      Shape({ w: css(80), h: css(80), fill: 0xff_cc_00 })
    ]);

    return [child, parent];
  };

  /**
   * The tween of a member's field on a card: the card, and a write of the field in each frame.
   *
   * @param make - The member's value at the start.
   * @param write - The field's patch at a turn.
   * @param fill - The card's fill.
   * @param rerun - The patch of a field the chain reads at a turn, played after the tween.
   * @returns The scene.
   */
  const tweened = (
    make: () => World.AnyComponentValue,
    write: (entity: World.Entity, turn: number) => void,
    fill?: number,
    rerun?: (entity: World.Entity, turn: number) => void
  ): Scene => {
    const entities = card(make(), fill);
    const parent = entities.at(-1) ?? 0;

    return {
      entities,
      write: turn => write(parent, turn),
      ...(rerun === undefined ? {} : { rerun: (turn: number) => rerun(parent, turn) })
    };
  };

  // The rows play one after another: an array literal evaluates its awaits in order.
  const rows: SetRow[] = [
    // Flash: a gold wash.
    await play(app, {
      name: "Flash: held",
      kind: "held",
      scene: { entities: card(Flash({ amount: 0.6, color: 0xff_d7_00 })) }
    }),
    await play(app, {
      name: "Flash: tween",
      kind: "tween",
      scene: tweened(
        () => Flash({ amount: 0.2, color: 0xff_d7_00 }),
        (entity, turn) => ecs.set(entity, Flash, { amount: 0.2 + 0.1 * turn })
      )
    }),
    await play(app, {
      name: "Flash: probe, amount 1 at a lit pixel is the colour",
      kind: "probe",
      scene: { entities: card(Flash({ amount: 1, color: 0xff_d7_00 })) },
      probe: { x: 240, y: 240, rgb: [0xff, 0xd7, 0x00] }
    }),
    // Grade: less saturation, then a red greyed.
    await play(app, {
      name: "Grade: held",
      kind: "held",
      scene: { entities: card(Grade({ saturation: 0.3, contrast: 1.2 })) }
    }),
    await play(app, {
      name: "Grade: tween",
      kind: "tween",
      scene: tweened(
        () => Grade({ saturation: 0.2 }),
        (entity, turn) => ecs.set(entity, Grade, { saturation: 0.2 + 0.1 * turn })
      )
    }),
    await play(app, {
      name: "Grade: probe, saturation 0 at a red pixel is its luma",
      kind: "probe",
      scene: { entities: card(Grade({ saturation: 0 }), 0xff_00_00, false) },
      probe: { x: 240, y: 240, rgb: [54, 54, 54] }
    }),
    // Vignette: the defaults, soft 0.25.
    await play(app, {
      name: "Vignette: held",
      kind: "held",
      scene: { entities: card(Vignette()) }
    }),
    await play(app, {
      name: "Vignette: tween",
      kind: "tween",
      scene: tweened(
        () => Vignette({ amount: 0.5 }),
        (entity, turn) => ecs.set(entity, Vignette, { amount: 0.5 + 0.1 * turn })
      )
    }),
    await play(app, {
      name: "Vignette: probe, the centre is the source",
      kind: "probe",
      scene: { entities: card(Vignette(), 0x33_88_ff, false) },
      probe: { x: 240, y: 240, rgb: [0x33, 0x88, 0xff] }
    }),
    // RevealLine: half shown along a slant; the diagonal at progress 1 shows both far corners.
    await play(app, {
      name: "RevealLine: held",
      kind: "held",
      scene: { entities: card(RevealLine({ progress: 0.5, angle: 0.6, soft: 0.1 })) }
    }),
    await play(app, {
      name: "RevealLine: tween",
      kind: "tween",
      scene: tweened(
        () => RevealLine({ progress: 0.3, soft: 0.1 }),
        (entity, turn) => ecs.set(entity, RevealLine, { progress: 0.3 + 0.1 * turn })
      )
    }),
    await play(app, {
      name: "RevealLine: probe, at π/4 and progress 1 the top-left corner is the source",
      kind: "probe",
      scene: {
        entities: card(RevealLine({ progress: 1, angle: Math.PI / 4 }), 0x33_88_ff, false, false)
      },
      probe: { x: 121, y: 161, rgb: [0x33, 0x88, 0xff] }
    }),
    await play(app, {
      name: "RevealLine: probe, at π/4 and progress 1 the bottom-right corner is the source",
      kind: "probe",
      scene: {
        entities: card(RevealLine({ progress: 1, angle: Math.PI / 4 }), 0x33_88_ff, false, false)
      },
      probe: { x: 359, y: 319, rgb: [0x33, 0x88, 0xff] }
    }),
    // RevealRound: a window with a wavy edge; one off the centre shows its own centre.
    await play(app, {
      name: "RevealRound: held",
      kind: "held",
      scene: { entities: card(RevealRound({ radius: 0.4, soft: 0.1, wobble: 0.05 })) }
    }),
    await play(app, {
      name: "RevealRound: tween",
      kind: "tween",
      scene: tweened(
        () => RevealRound({ radius: 0.3, soft: 0.1 }),
        (entity, turn) => ecs.set(entity, RevealRound, { radius: 0.3 + 0.1 * turn })
      )
    }),
    await play(app, {
      name: "RevealRound: probe, the centre of a window at x 0.25 is the source",
      kind: "probe",
      scene: {
        entities: card(RevealRound({ x: 0.25, radius: 0.2, soft: 0.1 }), 0x33_88_ff, false)
      },
      probe: { x: 180, y: 240, rgb: [0x33, 0x88, 0xff] }
    }),
    // Dissolve: the defaults' rim, part eaten; at progress 0 the view is whole.
    await play(app, {
      name: "Dissolve: held",
      kind: "held",
      scene: { entities: card(Dissolve({ progress: 0.4 })) }
    }),
    await play(app, {
      name: "Dissolve: tween",
      kind: "tween",
      scene: tweened(
        () => Dissolve({ progress: 0.2 }),
        (entity, turn) => ecs.set(entity, Dissolve, { progress: 0.2 + 0.1 * turn })
      )
    }),
    await play(app, {
      name: "Dissolve: probe, at progress 0 the centre is the source",
      kind: "probe",
      scene: { entities: card(Dissolve(), 0x33_88_ff, false) },
      probe: { x: 240, y: 240, rgb: [0x33, 0x88, 0xff] }
    }),
    // Shine: the band in the middle; its light on the colour only.
    await play(app, {
      name: "Shine: held",
      kind: "held",
      scene: { entities: card(Shine({ position: 0.5 })) }
    }),
    await play(app, {
      name: "Shine: tween",
      kind: "tween",
      scene: tweened(
        () => Shine({ position: 0.2 }),
        (entity, turn) => ecs.set(entity, Shine, { position: 0.2 + 0.1 * turn })
      )
    }),
    await play(app, {
      name: "Shine: probe, its line at the centre adds 0.6 of light",
      kind: "probe",
      scene: { entities: card(Shine({ position: 0.5, angle: 0 }), 0x33_88_ff, false) },
      probe: { x: 240, y: 240, rgb: [204, 255, 255] }
    }),
    await play(app, {
      name: "Shine: probe, a transparent corner under the line stays transparent",
      kind: "probe",
      scene: {
        entities: card(Shine({ position: 0, angle: Math.PI / 4, strength: 2 }), 0x33_88_ff, false)
      },
      probe: { x: 121, y: 161, rgb: [0, 0, 0] }
    }),
    // Aura: a gold halo; next to a straight edge at strength 2 it is full.
    await play(app, {
      name: "Aura: held",
      kind: "held",
      scene: { entities: card(Aura({ color: 0xff_d7_00 })) }
    }),
    await play(app, {
      name: "Aura: tween",
      kind: "tween",
      scene: tweened(
        () => Aura({ strength: 0.5 }),
        (entity, turn) => ecs.set(entity, Aura, { strength: 0.5 + 0.1 * turn })
      )
    }),
    await play(app, {
      name: "Aura: probe, next to a straight edge at strength 2 the halo is its colour",
      kind: "probe",
      scene: { entities: card(Aura({ strength: 2 }), 0x33_88_ff, false) },
      probe: { x: 119, y: 240, rgb: [0xff, 0xff, 0xff] }
    }),
    // Fold: turned about each axis; a half turn shows the back in shade.
    await play(app, {
      name: "Fold: held",
      kind: "held",
      scene: { entities: card(Fold({ angle: 0.8 })) }
    }),
    await play(app, {
      name: "Fold: held, axis 1",
      kind: "held",
      scene: { entities: card(Fold({ angle: 0.8, axis: 1 })) }
    }),
    await play(app, {
      name: "Fold: tween",
      kind: "tween",
      scene: tweened(
        () => Fold({ angle: 0.3 }),
        (entity, turn) => ecs.set(entity, Fold, { angle: 0.3 + 0.1 * turn })
      )
    }),
    await play(app, {
      name: "Fold: probe, a half turn at the centre is the colour at 0.6",
      kind: "probe",
      scene: { entities: card(Fold({ angle: Math.PI }), 0x33_88_ff, false) },
      probe: { x: 240, y: 240, rgb: [31, 82, 153] }
    }),
    // Bloom: the gold square on a dark card blooms. Still, it is kept as a picture; a moving strength rides its quad over
    // the held chain result; a moving threshold reruns the chain, off the quad.
    await play(app, {
      name: "Bloom: held, radius 16",
      kind: "held",
      strict: true,
      scene: { entities: card(Bloom(), DARK) }
    }),
    await play(app, {
      name: "Bloom: held, radius 32",
      kind: "held",
      strict: true,
      scene: { entities: card(Bloom({ radius: 32 }), DARK) }
    }),
    await play(app, {
      name: "Bloom: tween",
      kind: "tween",
      strict: true,
      scene: tweened(
        () => Bloom({ strength: 0.2 }),
        (entity, turn) => ecs.set(entity, Bloom, { strength: 0.2 + 0.1 * turn }),
        DARK
      )
    }),
    await play(app, {
      name: "Bloom: threshold tween after a strength tween, off the quad in a frame that reran the chain",
      kind: "rerun",
      strict: true,
      scene: tweened(
        () => Bloom({ strength: 0.2 }),
        (entity, turn) => ecs.set(entity, Bloom, { strength: 0.2 + 0.1 * turn }),
        DARK,
        (entity, turn) => ecs.set(entity, Bloom, { threshold: 0.6 - 0.1 * turn })
      )
    }),
    // The blur reaches about 26 CSS px (its outer ring at sigma, the radius 16 px, and a texel at ¼ for each linear
    // read): the middle of the 80 px square, 40 px from its edges, sees only gold, and the blur's weights are
    // normalised, so it gains 0.6 × its light over 0.7: green 0.8 + 0.6 × 0.1, 204 + 15.3; red is full, blue stays 0.
    await play(app, {
      name: "Bloom: probe, the middle of the gold square gains 0.6 of its light over 0.7",
      kind: "probe",
      scene: { entities: card(Bloom(), DARK) },
      probe: { x: 180, y: 220, rgb: [255, 219, 0] }
    }),
    await play(app, {
      name: "Bloom: probe, at threshold 1 the centre is the source",
      kind: "probe",
      scene: { entities: card(Bloom({ threshold: 1 }), 0x33_88_ff, false) },
      probe: { x: 240, y: 240, rgb: [0x33, 0x88, 0xff] }
    })
  ];

  const warnings = app.log
    .trace()
    .filter(entry => FAILS.has(entry.event))
    .map(entry => ({ event: entry.event, data: entry.data }));

  return {
    backend: app.renderer.host.kind(),
    resolution,
    rows,
    warnings: [...warnings, ...gpuErrors.map(data => ({ event: "gpu-error", data }))]
  };
}

/**
 * A capture's colour multiplied by its alpha, in place: what the canvas composites. Pixi's WebGL extract reads the
 * canvas back premultiplied and writes it as it is (`GlTextureSystem.getPixels` skips its `unpremultiplyAlpha`), while
 * the WebGPU one writes straight alpha; so a WebGPU capture is premultiplied before a WebGL one is held against it. An
 * opaque pixel is the same either way; a half-transparent one (a reveal's soft edge, a halo) differs by its alpha.
 *
 * @param image - The pixels of a straight-alpha capture.
 * @returns The same pixels, premultiplied.
 */
function premultiplied(image: ImageData): ImageData {
  const { data } = image;

  for (let at = 0; at < data.length; at += 4) {
    const alpha = (data[at + 3] ?? 0) / 255;

    for (let channel = 0; channel < 3; channel += 1) {
      data[at + channel] = Math.round((data[at + channel] ?? 0) * alpha);
    }
  }

  return image;
}

/**
 * Holds this page's captures, WebGL's, against WebGPU's of the same rows, both premultiplied.
 *
 * @param others - The WebGPU page's captures, by row name, as PNG data URLs.
 * @returns One line per row both have.
 */
async function compareSet(others: Readonly<Record<string, string>>): Promise<CrossRow[]> {
  const lines: CrossRow[] = [];

  for (const [name, png] of captures) {
    const other = others[name];

    if (other === undefined) continue;

    const one = await pixelsOf(png);
    const two = premultiplied(await pixelsOf(other));
    let within = 0;
    let color = 0;
    let alpha = 0;

    for (let at = 0; at < one.data.length; at += 4) {
      let colorOff = 0;

      for (let channel = 0; channel < 3; channel += 1) {
        colorOff = Math.max(
          colorOff,
          Math.abs((one.data[at + channel] ?? 0) - (two.data[at + channel] ?? 0))
        );
      }

      const alphaOff = Math.abs((one.data[at + 3] ?? 0) - (two.data[at + 3] ?? 0));

      if (colorOff <= CROSS_COLOR && alphaOff <= CROSS_ALPHA) within += 1;
      color = Math.max(color, colorOff);
      alpha = Math.max(alpha, alphaOff);
    }

    lines.push({ name, share: within / (one.data.length / 4), color, alpha });
  }

  return lines;
}

const target = globalThis as unknown as {
  effectsSet?: SetResult | { error: string };
  effectsSetCaptures?: () => Record<string, string>;
  compareSet?: typeof compareSet;
};

target.effectsSetCaptures = () => Object.fromEntries(captures);
target.compareSet = compareSet;

try {
  target.effectsSet = await run();
} catch (error) {
  target.effectsSet = {
    error: error instanceof Error ? (error.stack ?? error.message) : String(error)
  };
}
