import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, projection } from "../../../../index";
import { animPlugin } from "../../../anim";
import { assetsPlugin } from "../../../assets";
import type { AssetsIo, DecodedImage, Manifest, Texture } from "../../../assets/types";
import { i18nPlugin } from "../../../i18n";
import { inputPlugin } from "../../../input";
import { rendererPlugin } from "../../../renderer";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import { FakeRectangle, FakeTexture } from "../../../renderer/__tests__/fake-pixi";
import { stagePixi } from "../../../renderer/__tests__/stage-pixi";
import { Source, Transform } from "../../../renderer/components";
import { scenesPlugin } from "../../../scenes";
import { textPlugin } from "../../../text";
import { uiPlugin } from "../../../ui";
import { worldPlugin } from "../../../world";
import { effectsPlugin } from "../../index";
import { Frost } from "../../set/frost";

// ---------------------------------------------------------------------------
// Integration (F126 stage 5): eight `Frost` notes over a room under `Source()`, the whole app on the real Pixi stage,
// every frame drawn. Over the Source the glass breaks no canvas pass and its blur is drawn only when the room is taken;
// without it, today's backdrop path. WebGL keeps the backdrop path. A dev build warns once per note with no Source.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { n: number };
  session: Record<string, never>;
  assets: string;
  strings: Record<string, never>;
}>();

/** The bundle of the fixture holds no file. */
const MANIFEST: Manifest = {
  version: 1,
  bundles: { fixture: { feature: "fixture", tier: "boot", mb: 0, files: [] } }
};

/** The notes over the room. */
const NOTES = 8;

/** The hint of the warning, as the owner reads it. */
const HINT = "put Source() on the view under the glass";

/**
 * The in-memory io: nothing is ever fetched for the empty bundle.
 *
 * @returns The io.
 */
function createIo(): AssetsIo {
  return {
    fetch: () => Promise.reject(new Error("nothing to fetch")),
    decode: () => Promise.resolve({ width: 1, height: 1 } as unknown as DecodedImage),
    createTexture: () =>
      new FakeTexture({
        source: { width: 1, height: 1, destroyed: false },
        frame: new FakeRectangle(0, 0, 1, 1)
      }) as unknown as Texture,
    sliceTexture: () => ({ label: "slice" }) as unknown as Texture,
    destroyTexture: () => undefined
  };
}

/**
 * Yields the microtask queue to the flow loop.
 *
 * @param times - How many turns.
 */
async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * The ward: the room, under a `Source` or not, with a bed in it, and eight notes after it.
 *
 * @param source - True to put `Source()` on the room.
 * @returns The projection.
 */
function ward(source: boolean) {
  return projection({
    name: "fixture.ward",
    layer: "scene",
    from: () => ({ id: "ward" }),
    view: () => (
      <stack key="wardRoot" style={{ width: 1080, height: 1920 }}>
        <stack
          key="room"
          style={{ position: "absolute", width: 1080, height: 1920, fill: 0x9f_b7_b4 }}
          components={source ? [Source()] : []}
        >
          <stack
            key="bed"
            style={{
              position: "absolute",
              left: 100,
              top: 300,
              width: 400,
              height: 200,
              fill: 0x55_44_33
            }}
          />
        </stack>
        {Array.from({ length: NOTES }, (_, index) => (
          <stack
            key={`note${index}`}
            style={{
              position: "absolute",
              left: 60 + (index % 2) * 500,
              top: 100 + Math.floor(index / 2) * 400,
              width: 400,
              height: 300,
              fill: 0xff_f8_e7
            }}
            components={[Frost({ blur: 12, tint: 0x62_58_5b })]}
          />
        ))}
      </stack>
    )
  });
}

/**
 * Starts the ward on the real Pixi stage, every frame drawn, and lets it rest.
 *
 * @param options - The Source, the backend and the dev flag.
 * @param options.source - True to put `Source()` on the room.
 * @param options.kind - The backend.
 * @param options.dev - A dev build.
 * @returns The app and the stage.
 */
async function start(options: { source: boolean; kind?: "webgpu" | "webgl"; dev?: boolean }) {
  if (options.dev === true) vi.stubGlobal("__MOKU_GAME_DEV__", true);

  installFakeDom({ width: 1080, height: 1920 });

  const stage = stagePixi({ kind: options.kind ?? "webgpu" });
  const home = defineNode({ rest: true, outcomes: {} });
  const main = defineFlow("main", {
    nodes: { home },
    start: "home",
    outcomes: {},
    edges: { home: {} }
  });
  const feature = defineFeature("fixture", {
    flows: [main],
    projections: [ward(options.source)],
    filters: [Frost]
  });
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
      effectsPlugin,
      feature
    ],
    pluginConfigs: {
      log: { mode: "test" },
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { n: 0 }, initialSession: {}, seed: 1 },
      renderer: {
        mount: "#game",
        onDemand: false,
        loadPixi: () => Promise.resolve(stage.module),
        warm: 0
      },
      assets: { manifest: MANIFEST, io: createIo() }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();
  app.world.projection.setLayers([{ name: "scene", sort: "none" }]);
  app.world.projection.mount(["fixture.ward"], { kind: "plugin", name: "test" });

  const started = { app, stage };

  await frames(started, 12);

  return started;
}

/** The started fixture. */
type Started = Awaited<ReturnType<typeof start>>;

/**
 * Runs frames of 16 ms.
 *
 * @param started - The app.
 * @param count - How many.
 */
async function frames(started: Started, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    started.app.time.step(16);
    await tick(8);
  }
}

/**
 * The renders into a texture since a point: the takes of a Source (into its texture) and the runs of its chains (the
 * keeper's sprite).
 *
 * @param started - The app.
 * @param from - The log length to count from.
 * @returns How many of each.
 */
function sourceRenders(started: Started, from: number): { takes: number; chains: number } {
  const calls = started.stage.targets().slice(from);
  const chains = calls.filter(call => call.container.label.endsWith("#chain")).length;
  const takes = calls.filter(
    call =>
      call.target?.source.label.startsWith("source:") === true &&
      !call.container.label.endsWith("#chain")
  ).length;

  return { takes, chains };
}

/**
 * The entity of a keyed view.
 *
 * @param started - The app.
 * @param key - The key.
 * @returns The entity.
 */
function find(started: Started, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = started.app.ui.find(key);

  if (entity === undefined) throw new Error(`no ${key}`);

  return entity;
}

/**
 * The warnings of the run with a code.
 *
 * @param started - The app.
 * @param code - The code.
 * @returns Their data.
 */
function warnings(started: Started, code: string): unknown[] {
  return started.app.log
    .trace()
    .filter(entry => entry.level === "warn" && entry.event === code)
    .map(entry => entry.data);
}

describe("Frost over a Source", () => {
  // Bug: the glass still breaks the canvas pass once per note: 9 passes where 1 does (the A26 spike: 32 ms against 18).
  it("draws eight notes in one canvas pass; the same notes with no Source cost nine", async () => {
    const over = await start({ source: true });

    expect(over.app.renderer.stats().canvasPasses).toBe(1);
    expect(over.app.renderer.stats().sources.count).toBe(1);
    await over.app.stop();

    const backdrop = await start({ source: false });

    expect(backdrop.app.renderer.stats().canvasPasses).toBe(1 + NOTES);
    expect(backdrop.app.renderer.stats().sources).toEqual({ count: 0, takes: 0, mb: 0, mpx: 0 });
    await backdrop.app.stop();
  });

  // Bug: the blur runs in every frame at rest, or eight times for eight equal notes; a change of the room is missed.
  it("draws the blur once per take of the room, shared by the notes, and nothing at rest", async () => {
    const started = await start({ source: true });
    const rest = started.stage.targets().length;

    await frames(started, 10);

    expect(sourceRenders(started, rest)).toEqual({ takes: 0, chains: 0 });

    const changed = started.stage.targets().length;

    started.app.world.ecs.set(find(started, "bed"), Transform, { x: 140 });
    await frames(started, 3);

    expect(sourceRenders(started, changed)).toEqual({ takes: 1, chains: 1 });
    await started.app.stop();
  });

  // Bug: a sliding note takes the room again, or reads the blur at its old place (its offset not written).
  it("moves a note by its placement alone: no take, no chain, its offset written", async () => {
    const started = await start({ source: true });
    const note = find(started, "note0");
    const from = started.stage.targets().length;

    for (let frame = 1; frame <= 4; frame += 1) {
      started.app.world.ecs.set(note, Transform, { x: 60 + frame * 10 });
      await frames(started, 1);
    }

    expect(sourceRenders(started, from)).toEqual({ takes: 0, chains: 0 });
    expect(started.app.renderer.stats().canvasPasses).toBe(1);
    await started.app.stop();
  });

  // Bug: a Source removed leaves the notes blank, or on a quad that reads a texture that is gone.
  it("falls back to the backdrop path the frame after the Source is removed", async () => {
    // The Source is the game's own write here: a view declared with it would get it back at the next reconcile.
    const started = await start({ source: false });
    const room = find(started, "room");

    started.app.world.ecs.add(room, Source());
    await frames(started, 8);

    expect(started.app.renderer.stats().canvasPasses).toBe(1);

    started.app.world.ecs.remove(room, Source);
    await frames(started, 1);

    expect(started.app.renderer.stats().canvasPasses).toBe(1 + NOTES);
    expect(started.app.renderer.stats().sources.count).toBe(0);
    await started.app.stop();
  });

  // Bug: WebGL, with no quad twin, draws the notes on a mesh it cannot run (A7).
  it("keeps the backdrop path on WebGL: nine canvas passes, no texture", async () => {
    const started = await start({ source: true, kind: "webgl" });

    expect(started.app.renderer.stats().canvasPasses).toBe(1 + NOTES);
    expect(started.app.renderer.stats().sources.mb).toBe(0);
    await started.app.stop();
  });

  // Bug: a note frosted over nothing is silent in a dev build (the owner pays 2 passes a note and never knows), or
  // warns in every frame (A8).
  it("warns once per note with no Source, in a dev build, and never over one", async () => {
    const without = await start({ source: false, dev: true });

    await frames(without, 5);

    const data = warnings(without, "effects:frost-no-source");

    expect(data).toHaveLength(NOTES);
    expect(data[0]).toEqual({ entity: find(without, "note0"), hint: HINT });
    await without.app.stop();

    const over = await start({ source: true, dev: true });

    expect(warnings(over, "effects:frost-no-source")).toEqual([]);
    await over.app.stop();
  });
});
