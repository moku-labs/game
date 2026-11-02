import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { Sprite, Transform } from "../../components";
import { stopRenderer } from "../../lifecycle";
import { type FakeContainer, type FakeSprite, FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";
import { createShotRenderer, holdCompiles, settle, startShots } from "../shots-gpu";

// ---------------------------------------------------------------------------
// Unit: `renderer.shots` over the real modules and the real frame of the mock renderer, on a fake GPU: when a take is
// taken, when it does nothing, how many shots stand, and what a lost device or a stop leaves. A frame is
// `runPhase("render")`. What the chain draws is `shots-passes.test.ts`.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;

/** The key most tests take. */
const KEY = "shot.room.hall";

/**
 * Spawns a sprite that draws a key and builds its view.
 *
 * @param mock - The mock.
 * @param texture - The asset key.
 * @returns The entity.
 */
function spawnSprite(mock: MockRenderer, texture: string): Entity {
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);

  const entity = mock.world.ecs.spawn(owner, [
    Layer({ name: "items" }),
    Transform(),
    Sprite({ texture })
  ]);

  mock.modules.sync.pass();

  return entity;
}

/**
 * The texture a sprite's view draws now.
 *
 * @param mock - The mock.
 * @param entity - The entity.
 * @returns Its texture.
 */
function textureOf(mock: MockRenderer, entity: Entity): unknown {
  return (mock.ctx.state.sync.views.get(entity)?.object as unknown as FakeSprite).texture;
}

/**
 * Takes keys, each in a drawn frame of its own.
 *
 * @param mock - The mock.
 * @param keys - The keys, oldest first.
 */
function takeEach(mock: MockRenderer, ...keys: string[]): void {
  for (const key of keys) {
    mock.api.shots.take(key);
    mock.runPhase("render");
  }
}

/**
 * The container of the look.
 *
 * @param mock - The mock.
 * @returns The top.
 */
function topOf(mock: MockRenderer): FakeContainer {
  return mock.ctx.state.sync.leave.objects?.top as unknown as FakeContainer;
}

describe("a take", () => {
  // Bug: the shot lands nowhere the chain looks, so `Sprite` and `image` draw the placeholder.
  it("stands under its key after the next drawn frame, a texture through the provider chain", async () => {
    const { mock } = await startShots();

    mock.api.shots.take(KEY);
    expect(mock.api.shots.has(KEY)).toBe(false);

    mock.runPhase("render");
    expect(mock.api.shots.has(KEY)).toBe(true);

    const entity = spawnSprite(mock, KEY);

    expect(textureOf(mock, entity)).toBe(mock.ctx.state.shots.taken.get(KEY));
  });

  // Bug: a shot read before the stage render holds the frame before, or a read after the task finds no texture.
  it("reads the canvas in the frame it waits for, after the stage render", async () => {
    const { mock, gpu } = await startShots();

    mock.runPhase("render");
    mock.api.shots.take(KEY);
    mock.runPhase("render");

    expect(gpu().canvasReads).toEqual([mock.pixi.last().renderer.renders]);
  });

  // Bug: a still screen with `onDemand` never draws the frame, or the look never shows after it.
  it("asks for its frame with onDemand, and one more after the shot", async () => {
    const { mock } = await startShots({ onDemand: true });
    const { renderer } = mock.pixi.last();

    mock.runPhase("render");
    mock.runPhase("render");

    const still = renderer.renders;

    mock.runPhase("render");
    expect(renderer.renders).toBe(still);

    mock.api.shots.take(KEY);
    mock.runPhase("render");
    expect(renderer.renders).toBe(still + 1);
    expect(mock.api.shots.has(KEY)).toBe(true);

    mock.runPhase("render");
    expect(renderer.renders).toBe(still + 2);

    mock.runPhase("render");
    expect(renderer.renders).toBe(still + 2);
  });

  // Bug: a key taken twice before its frame runs the chain twice in one frame.
  it("keeps a key taken twice before the frame once", async () => {
    const { mock, gpu } = await startShots();

    mock.api.shots.take(KEY);
    mock.api.shots.take(KEY);
    expect(mock.ctx.state.shots.wanted).toEqual([KEY]);

    mock.runPhase("render");
    expect(gpu().submits).toBe(1);
  });

  // Bug: a view that named the key before the shot keeps its magenta placeholder for good.
  it("reaches a view that waited for the key", async () => {
    const { mock } = await startShots();
    const entity = spawnSprite(mock, KEY);

    takeEach(mock, KEY);
    mock.modules.sync.pass();

    expect(textureOf(mock, entity)).toBe(mock.ctx.state.shots.taken.get(KEY));
  });
});

describe("a take that does nothing", () => {
  // Bug: a game without `shots` pays for pipelines, a provider or a queue of keys.
  it("without shots in the config: no pipeline, no provider, no key", async () => {
    const { mock, gpu } = await startShots({ shots: undefined });
    const providers = mock.ctx.state.sync.providers.length;

    mock.api.shots.take(KEY);
    mock.runPhase("render");

    expect(gpu().compiles).toEqual([]);
    expect(providers).toBe(0);
    expect(mock.ctx.state.shots.wanted).toEqual([]);
    expect(mock.api.shots.has(KEY)).toBe(false);
    expect(gpu().canvasReads).toEqual([]);
  });

  // Bug: a headless test or a server run throws or warns from a game's take.
  it("headless: nothing kept, nothing warned", async () => {
    const mock = createMockRenderer({
      dom: false,
      config: { shots: { width: 96, height: 208, blur: 22 } }
    });

    await mock.start();
    mock.api.shots.take(KEY);

    expect(mock.ctx.state.shots.wanted).toEqual([]);
    expect(mock.api.shots.has(KEY)).toBe(false);
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  // Bug: a fast walk keeps asking for frames, or a shot of a world that draws nothing live.
  it("while the world is not live: nothing kept, no frame asked, nothing warned", async () => {
    const { mock } = await startShots({ onDemand: true });

    mock.runPhase("render");
    mock.runPhase("render");
    mock.world.ecs.setMode("fast");

    const { requests } = mock.ctx.state.demand;

    mock.api.shots.take(KEY);

    expect(mock.ctx.state.shots.wanted).toEqual([]);
    expect(mock.ctx.state.demand.requests).toBe(requests);
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  // Bug: a take in the tap frame blocks on a sync compile, or waits on the frame until the compile lands.
  it("before the pipelines compiled: no key waits for them", async () => {
    const opened = createShotRenderer();

    holdCompiles(opened);
    await opened.mock.start();
    await settle();
    opened.mock.api.shots.take(KEY);

    expect(opened.mock.ctx.state.shots.wanted).toEqual([]);
    expect(opened.gpu().compiles).toHaveLength(2);
  });

  // Bug: WebGL throws on a GPU call, or warns at every start of a browser without WebGPU.
  it("on WebGL: no compile, nothing warned", async () => {
    const { mock, gpus } = await startShots({ kind: "webgl" });

    mock.api.shots.take(KEY);

    expect(gpus).toEqual([]);
    expect(mock.ctx.state.shots.wanted).toEqual([]);
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  // Bug: after a failed compile a take queues keys no frame can serve, and the look hides for nothing.
  it("after a failed compile, which warned once", async () => {
    const opened = createShotRenderer();
    const error = new Error("no pipeline");

    opened.compile.failure = error;
    await opened.mock.start();
    await settle();
    opened.mock.api.shots.take(KEY);

    expect(opened.mock.ctx.state.shots.wanted).toEqual([]);
    expect(opened.mock.log.warn).toHaveBeenCalledTimes(1);
    expect(opened.mock.log.warn).toHaveBeenCalledWith("renderer:shots-unavailable", { error });
  });
});

describe("a frame that takes no shot", () => {
  // Bug: a take that meets the heat map stays wanted for good, and holds the look off the screen.
  it("empties what was wanted and keeps nothing", async () => {
    const { mock, gpu } = await startShots();

    mock.api.shots.take(KEY);
    mock.modules.shots.after(false);

    expect(mock.ctx.state.shots.wanted).toEqual([]);
    expect(mock.api.shots.has(KEY)).toBe(false);
    expect(gpu().passes).toEqual([]);
  });

  // Bug: the frame hands `after` a true for the heat map, and the shot keeps the map's greys.
  it("is the frame of the heat map", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const { mock, gpu } = await startShots();

    mock.api.sync.debug.overdraw(true);
    mock.api.shots.take(KEY);
    mock.runPhase("render");

    expect(mock.pixi.last().renderer.renders).toBeGreaterThan(0);
    expect(mock.ctx.state.shots.wanted).toEqual([]);
    expect(mock.api.shots.has(KEY)).toBe(false);
    expect(gpu().canvasReads).toEqual([]);
  });

  // Bug: every frame reads the canvas, which is a GPU call on the main thread of every frame of the game.
  it("touches nothing with nothing wanted", async () => {
    const { mock, gpu } = await startShots();

    mock.runPhase("render");
    mock.runPhase("render");

    expect(gpu().canvasReads).toEqual([]);
  });
});

describe("the shots kept", () => {
  // Bug: the limit is off by one, or a new texture is made for every take and the memory grows.
  it("lets the oldest taken go at `keep` and reuses its texture", async () => {
    const { mock, created } = await startShots({
      shots: { width: 96, height: 208, blur: 0, keep: 2 }
    });

    takeEach(mock, "shot.a", "shot.b");

    const oldest = mock.ctx.state.shots.taken.get("shot.a");

    takeEach(mock, "shot.c");

    expect(created).toHaveLength(2);
    expect(mock.api.shots.has("shot.a")).toBe(false);
    expect(mock.api.shots.has("shot.b")).toBe(true);
    expect(mock.ctx.state.shots.taken.get("shot.c")).toBe(oldest);
  });

  // Bug: the default is lost when `keep` is left out, and a game holds every shot it ever took.
  it("keeps 8 when `keep` is left out", async () => {
    const { mock } = await startShots();

    takeEach(mock, "1", "2", "3", "4", "5", "6", "7", "8");
    expect(mock.api.shots.has("1")).toBe(true);

    takeEach(mock, "9");
    expect(mock.api.shots.has("1")).toBe(false);
    expect(mock.ctx.state.shots.taken.size).toBe(8);
  });

  // Bug: a retake keeps its old age, so the shot just taken goes first; or it makes a second texture.
  it("gives a retaken key its texture back, as the newest", async () => {
    const { mock, created } = await startShots({
      shots: { width: 96, height: 208, blur: 0, keep: 2 }
    });

    takeEach(mock, "shot.a", "shot.b");

    const held = mock.ctx.state.shots.taken.get("shot.a");

    takeEach(mock, "shot.a");
    expect(mock.ctx.state.shots.taken.get("shot.a")).toBe(held);
    expect(created).toHaveLength(2);

    takeEach(mock, "shot.c");
    expect(mock.api.shots.has("shot.a")).toBe(true);
    expect(mock.api.shots.has("shot.b")).toBe(false);
  });

  // Bug: a view of the key that went goes on drawing the newer shot in its texture, another room behind the loader.
  it("lets go of the view of a key that went", async () => {
    const { mock } = await startShots({ shots: { width: 96, height: 208, blur: 0, keep: 1 } });

    takeEach(mock, "shot.a");

    const entity = spawnSprite(mock, "shot.a");

    takeEach(mock, "shot.b");
    mock.modules.sync.pass();

    expect(textureOf(mock, entity)).toBe(FakeTexture.WHITE);
  });

  // Bug: two keys of one frame run two chains, or the second key gets the last shot's picture.
  it("gives two keys of one frame the one picture", async () => {
    const { mock, gpu } = await startShots();

    mock.api.shots.take("shot.a");
    mock.api.shots.take("shot.b");
    mock.runPhase("render");

    expect(mock.api.shots.has("shot.a")).toBe(true);
    expect(mock.api.shots.has("shot.b")).toBe(true);
    expect(gpu().submits).toBe(1);
    expect(gpu().copies).toEqual(["shot 96x208 > shot 96x208"]);
    expect(mock.ctx.state.shots.taken.get("shot.a")).not.toBe(
      mock.ctx.state.shots.taken.get("shot.b")
    );
  });

  // Bug: two keys that end up on one texture copy it onto itself, which the GPU refuses, and the frame's work is lost.
  it("copies nothing onto itself when `keep` holds fewer than a frame's keys", async () => {
    const { mock, gpu } = await startShots({ shots: { width: 96, height: 208, blur: 0, keep: 1 } });

    mock.api.shots.take("shot.a");
    mock.api.shots.take("shot.b");
    mock.runPhase("render");

    expect(gpu().copies).toEqual([]);
    expect(mock.api.shots.has("shot.a")).toBe(false);
    expect(mock.api.shots.has("shot.b")).toBe(true);
  });
});

describe("the look of a scene being left", () => {
  // Bug: the look stands in the shot, or stays hidden after it, or the frame after the shot is never drawn.
  it("is hidden for the frame a take waits for, and that frame only", async () => {
    const { mock } = await startShots({ onDemand: true });

    mock.runPhase("render");
    mock.api.sync.leave.show({ cover: { color: 0, alpha: 0.5, inMs: 0, outMs: 0 } });
    mock.runPhase("render");
    expect(topOf(mock).visible).toBe(true);

    const { renderer } = mock.pixi.last();
    const still = renderer.renders;

    mock.api.shots.take(KEY);
    mock.runPhase("render");
    expect(topOf(mock).visible).toBe(false);
    expect(renderer.renders).toBe(still + 1);

    mock.runPhase("render");
    expect(topOf(mock).visible).toBe(true);
    expect(renderer.renders).toBe(still + 2);
  });

  // Bug: a take on the heat map leaves the look hidden.
  it("shows again after a frame that took nothing", async () => {
    const { mock } = await startShots();

    mock.api.sync.leave.show({ cover: { color: 0, alpha: 0.5, inMs: 0, outMs: 0 } });
    mock.api.shots.take(KEY);
    mock.modules.shots.after(false);
    mock.runPhase("render");

    expect(topOf(mock).visible).toBe(true);
  });
});

describe("a lost device", () => {
  // Bug: `has` still answers true for a texture that went with the device, and the game draws an empty quad.
  it("loses the shots and the takes, silently", async () => {
    const { mock } = await startShots();

    takeEach(mock, KEY);
    mock.api.shots.take("shot.waiting");
    mock.pixi.last().lose();
    await settle();

    expect(mock.api.shots.has(KEY)).toBe(false);
    expect(mock.ctx.state.shots.wanted).toEqual([]);
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  // Bug: the pipelines of the dead device stay, or none are made on the new one, or the provider is doubled.
  it("compiles again on the new device, and provides once", async () => {
    const { mock, gpus } = await startShots();
    const providers = mock.ctx.state.sync.providers.length;

    mock.pixi.last().lose();
    await settle();

    expect(gpus).toHaveLength(2);
    expect(gpus[1]?.compiles).toHaveLength(2);
    expect(mock.ctx.state.shots.pipes?.box).toBe(gpus[1]?.pipelines[0]);
    expect(mock.ctx.state.sync.providers).toHaveLength(providers);

    takeEach(mock, KEY);
    expect(mock.api.shots.has(KEY)).toBe(true);
  });

  // Bug: a compile that outlives its device installs dead pipelines, and every take after the restore fails on the GPU.
  it("drops a compile that ends after the loss", async () => {
    const opened = createShotRenderer();
    const held = holdCompiles(opened);

    await opened.mock.start();
    await settle();

    const first = opened.gpu();

    held.release();
    opened.mock.pixi.last().lose();
    await settle();
    held.finish();
    await settle();

    expect(first.pipelines).toHaveLength(2);
    expect(opened.mock.ctx.state.shots.pipes?.box).toBe(opened.gpu().pipelines[0]);
    expect(opened.gpu()).not.toBe(first);
  });

  // Bug: a compile the loss broke warns of a device that is gone: the restore works, and the log says it does not.
  it("warns nothing of a compile the loss broke", async () => {
    const opened = createShotRenderer();
    const held = holdCompiles(opened);

    await opened.mock.start();
    await settle();
    held.release();
    opened.mock.pixi.last().lose();
    await settle();
    held.fail(new Error("device lost"));
    await settle();

    expect(opened.mock.log.warn).not.toHaveBeenCalled();
  });

  // Bug: every restore on a device without the shaders logs the same line again.
  it("warns of a failed compile once, over two devices", async () => {
    const opened = createShotRenderer();

    opened.compile.failure = new Error("no pipeline");
    await opened.mock.start();
    await settle();
    opened.mock.pixi.last().lose();
    await settle();

    expect(opened.gpus).toHaveLength(2);
    expect(opened.mock.log.warn).toHaveBeenCalledTimes(1);
  });
});

describe("the textures the host answers", () => {
  // Bug: a WebGL canvas is asked for a WebGPU context, which it refuses, or its texture system for a GPU source.
  it("are none on WebGL", async () => {
    const { mock } = await startShots({ kind: "webgl" });

    expect(mock.modules.host.canvasTexture()).toBeUndefined();
    expect(mock.modules.host.gpuTexture(FakeTexture.WHITE.source as never)).toBeUndefined();
  });

  // Bug: a frame of a lost device reads the canvas of an application on its way out.
  it("are none while nothing draws", async () => {
    const { mock } = await startShots();

    mock.ctx.state.host.ready = false;

    expect(mock.modules.host.canvasTexture()).toBeUndefined();
    expect(mock.modules.host.gpuTexture(FakeTexture.WHITE.source as never)).toBeUndefined();
  });
});

describe("a stop", () => {
  // Bug: the shots leak with the application, or their provider answers destroyed textures in the next app.
  it("destroys the textures and removes the provider", async () => {
    const { mock } = await startShots();

    takeEach(mock, KEY);

    const texture = mock.ctx.state.shots.taken.get(KEY) as unknown as FakeTexture;
    const providers = mock.ctx.state.sync.providers.length;

    mock.stop();

    expect(texture.destroyed).toBe(true);
    expect(texture.destroyedSource).toBe(true);
    expect(texture.source.released).toContain("change");
    expect(mock.ctx.state.sync.providers).toHaveLength(providers - 1);
    expect(mock.api.shots.has(KEY)).toBe(false);
  });

  // Bug: a stop in the middle of a compile installs pipelines on an application that is gone.
  it("drops a compile that ends after it", async () => {
    const opened = createShotRenderer();
    const held = holdCompiles(opened);

    await opened.mock.start();
    await settle();
    opened.mock.stop();
    held.finish();
    await settle();

    expect(opened.mock.ctx.state.shots.pipes).toBeUndefined();
  });

  // Bug: a game without `shots`, or a renderer that never started, throws in its stop.
  it("stops cleanly with nothing to stop", () => {
    const mock = createMockRenderer({ dom: false });

    expect(() => stopRenderer({ config: mock.ctx.config, state: mock.ctx.state })).not.toThrow();
  });
});
