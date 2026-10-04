import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import { Parent, Shape, Sprite, Transform } from "../../components";
import { sourceBytes, textureUsage } from "../../host/readback";
import { createMonitorState } from "../../monitor/state";
import { beginFrame, endFrame } from "../../monitor/window";
import type { PixiApplication } from "../../types";
import { fakePictureUrl, installFakeCanvas, readFakePicture } from "../fake-canvas";
import { FAKE_PNG, FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Runs one frame of the mock: phase input at `at`, phase render `workMs` later.
 *
 * @param mock - The started mock renderer.
 * @param at - Clock time of the frame start.
 * @param workMs - How long the frame takes.
 */
function frame(mock: MockRenderer, at: number, workMs: number): void {
  mock.setNow(at);
  mock.runPhase("input");
  mock.setNow(at + workMs);
  mock.runPhase("render");
}

/**
 * Starts a mock renderer on the fake DOM.
 *
 * @returns The started mock.
 */
async function started(): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();

  return mock;
}

/**
 * Lets the promise callbacks queued so far run.
 */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe("renderer stats", () => {
  it("answers zeros while inert, with no draw-call field", () => {
    const mock = createMockRenderer({ dom: false });
    const stats = mock.api.stats();

    expect(stats).toEqual({
      fps: 0,
      frameMs: 0,
      textures: 0,
      textureMb: 0,
      views: 0,
      pooled: 0,
      renderPasses: 0
    });
    expect("drawCalls" in stats).toBe(false);
  });

  it("measures frames per second and the mean frame work over one second of clock time", async () => {
    const mock = await started();

    // 51 frames 20 ms apart: 50 intervals make the first full second.
    for (let index = 0; index <= 50; index += 1) frame(mock, index * 20, 4);

    expect(mock.api.stats()).toMatchObject({ fps: 50, frameMs: 4 });
  });

  it("reads 0 fps before the first full second", async () => {
    const mock = await started();

    for (let index = 0; index < 10; index += 1) frame(mock, index * 16, 3);

    expect(mock.api.stats()).toMatchObject({ fps: 0, frameMs: 0 });
  });

  it("reads 0 fps when no frame was drawn in the last second, as on a paused clock", async () => {
    const mock = await started();

    for (let index = 0; index <= 50; index += 1) frame(mock, index * 20, 4);
    mock.setNow(50 * 20 + 1500);

    expect(mock.api.stats().fps).toBe(0);
  });

  it("restarts the window after a long gap instead of counting it as one slow frame", () => {
    const state = createMonitorState();

    beginFrame(state, 0);
    endFrame(state, 2);
    beginFrame(state, 16);
    beginFrame(state, 5000);

    expect(state.windowMs).toBe(0);
    expect(state.intervals).toBe(0);
    expect(state.lastStart).toBe(5000);
  });

  it("ignores the end of a frame whose start it never saw", () => {
    const state = createMonitorState();

    endFrame(state, 10);

    expect(state.frames).toBe(0);
    expect(state.workMs).toBe(0);
  });

  it("counts the GPU textures and their memory, mip levels included", async () => {
    const mock = await started();

    mock.pixi
      .last()
      .renderer.texture.managedTextures.push(
        { pixelWidth: 1024, pixelHeight: 1024, mipLevelCount: 1 },
        { pixelWidth: 512, pixelHeight: 512, mipLevelCount: 1 }
      );

    // (1024 * 1024 + 512 * 512) * 4 bytes = 5 MiB.
    expect(mock.api.stats()).toMatchObject({ textures: 2, textureMb: 5 });
  });

  it("answers no texture for Pixi's canvas renderer, which keeps none on a GPU", async () => {
    const mock = await started();

    (mock.pixi.last().renderer as unknown as { texture: object }).texture = {};

    expect(mock.api.stats()).toMatchObject({ textures: 0, textureMb: 0 });
  });

  it("counts the views of sync and the pooled objects", async () => {
    const mock = await started();

    mock.ctx.state.sync.views.set(1, {} as never);
    mock.ctx.state.sync.views.set(2, {} as never);
    mock.ctx.state.sync.pooled = 3;

    expect(mock.api.stats()).toMatchObject({ views: 2, pooled: 3 });
  });

  it("skips the empty slots Pixi keeps for unloaded texture sources", () => {
    // Pixi 8.21 GpuTextureSystem and GlTextureSystem answer `Object.values` of a GCManagedHash,
    // which keeps `null` where a source was unloaded.
    // eslint-disable-next-line unicorn/no-null -- Pixi's empty slot is `null`, the bug is about it
    const emptySlot = null;
    const app = {
      renderer: {
        texture: {
          managedTextures: [
            emptySlot,
            { pixelWidth: 4, pixelHeight: 4, mipLevelCount: 1 },
            undefined,
            { pixelWidth: 2, pixelHeight: 2, mipLevelCount: 1 },
            emptySlot
          ]
        }
      }
    } as unknown as PixiApplication;

    // (16 + 4) pixels * 4 bytes.
    expect(textureUsage(app)).toEqual({ count: 2, bytes: 80 });
  });

  it("estimates the bytes of one texture source", () => {
    expect(sourceBytes({ pixelWidth: 4, pixelHeight: 4, mipLevelCount: 1 })).toBe(64);
    // 4x4, 2x2, 1x1 at 4 bytes a pixel.
    expect(sourceBytes({ pixelWidth: 4, pixelHeight: 4, mipLevelCount: 3 })).toBe(84);
    // A level never gets smaller than one pixel.
    expect(sourceBytes({ pixelWidth: 2, pixelHeight: 1, mipLevelCount: 3 })).toBe(16);
  });

  it("answers a fresh object every call", async () => {
    const mock = await started();

    expect(mock.api.stats()).not.toBe(mock.api.stats());
  });
});

describe("renderer capture", () => {
  it("answers undefined in a production build, where the dev flag is not defined", async () => {
    const mock = await started();

    await expect(mock.api.capture()).resolves.toBeUndefined();
    expect(mock.pixi.last().renderer.extract.calls).toHaveLength(0);
  });

  it("answers undefined while headless, even in a dev build", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockRenderer({ dom: false });

    await expect(mock.api.capture()).resolves.toBeUndefined();
  });

  it("takes the stage as a PNG right after the next frame is drawn", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = await started();
    const app = mock.pixi.last();
    let shot: unknown;
    const pending = mock.api.capture().then(value => {
      shot = value;
    });

    await settle();

    expect(app.renderer.extract.calls).toHaveLength(0);

    const renders = app.renderer.renders;

    frame(mock, 0, 2);
    await pending;

    expect(app.renderer.renders).toBe(renders + 1);
    expect(shot).toEqual({ png: FAKE_PNG });
    expect(app.renderer.extract.calls).toEqual([
      { target: app.stage, frame: app.screen, clearColor: 0x00_00_00, format: "png" }
    ]);
  });

  it("serves every capture of one frame with one extract", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = await started();
    const first = mock.api.capture();
    const second = mock.api.capture();

    frame(mock, 0, 2);

    await expect(first).resolves.toEqual({ png: FAKE_PNG });
    await expect(second).resolves.toEqual({ png: FAKE_PNG });
    expect(mock.pixi.last().renderer.extract.calls).toHaveLength(1);
  });

  it("takes the picture at once while the clock is paused, since no frame will come", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = await started();

    mock.setPaused(true);

    await expect(mock.api.capture()).resolves.toEqual({ png: FAKE_PNG });
  });

  it("leaves a moku:dev debug entry naming the command, like every dev command", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = await started();

    mock.setPaused(true);
    await mock.api.capture();

    expect(mock.log.debug).toHaveBeenCalledWith("moku:dev", { command: "renderer.capture" });
  });

  it("logs a failed read and answers undefined", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = await started();

    mock.pixi.last().renderer.extract.base64 = () => Promise.reject(new Error("gpu busy"));
    mock.setPaused(true);

    await expect(mock.api.capture()).resolves.toBeUndefined();
    expect(mock.log.error).toHaveBeenCalledWith("renderer: capture failed", {
      error: expect.any(Error)
    });
  });

  it("answers undefined to a capture still waiting when the renderer stops", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = await started();
    const waiting = mock.api.capture();

    mock.stop();

    await expect(waiting).resolves.toBeUndefined();
    expect(mock.ctx.state.monitor.captures).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The options of capture(): layers, legend, sheet and against
// ---------------------------------------------------------------------------

const owner = { kind: "plugin", name: "test" } as const;

/** The three layers of the scene the option tests draw. */
const LAYERS = ["board", "items", "hud"] as const;

/**
 * Starts a mock renderer in a dev build with the layers board, items and hud, every texture
 * 64 x 64.
 *
 * @param options - Options of the mock.
 * @param options.dpr - What `devicePixelRatio` answers.
 * @returns The started mock.
 */
async function scene(options: { dpr?: number } = {}): Promise<MockRenderer> {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);

  const mock = createMockRenderer(options);

  await mock.start();
  mock.api.sync.textures.provide(() => new FakeTexture({}) as never);
  mock.world.projection.setLayers(LAYERS.map(name => ({ name, sort: "none" as const })));
  mock.modules.sync.pass();

  return mock;
}

/**
 * Makes Pixi's extract answer the given pictures in turn, then the last one again, and records the
 * game time each extract saw.
 *
 * @param mock - The started mock.
 * @param pictures - The data URLs, in extract order.
 * @returns The game time of each extract, in call order.
 */
function answerPictures(mock: MockRenderer, ...pictures: string[]): number[] {
  const extract = mock.pixi.last().renderer.extract;
  const seen: number[] = [];
  let next = 0;

  extract.base64 = (options: unknown) => {
    extract.calls.push(options);
    seen.push(mock.time.snapshot().elapsed);

    const picture = pictures[Math.min(next, pictures.length - 1)] ?? FAKE_PNG;

    next += 1;

    return Promise.resolve(picture);
  };

  return seen;
}

/**
 * The container of a layer of the scene.
 *
 * @param mock - The started mock.
 * @param name - The layer name.
 * @returns The container.
 */
function layer(mock: MockRenderer, name: string) {
  const container = mock.modules.sync.layerContainer(name);

  if (container === undefined) throw new Error(`no layer ${name}`);

  return container;
}

/**
 * Spawns a keyed box of the scene.
 *
 * @param mock - The started mock.
 * @param address - Projection, key and layer.
 * @param address.projection - The projection name.
 * @param address.key - The key.
 * @param address.layer - The layer it is drawn in.
 * @param box - Where it is and how big, in reference units.
 * @param box.x - Left.
 * @param box.y - Top.
 * @param box.w - Width.
 * @param box.h - Height.
 * @returns The entity.
 */
function keyedBox(
  mock: MockRenderer,
  address: { projection: string; key: string; layer: string },
  box: { x: number; y: number; w: number; h: number }
): number {
  const entity = mock.world.ecs.spawn(owner, [
    Layer({ name: address.layer }),
    Transform({ x: box.x, y: box.y }),
    Shape({ w: box.w, h: box.h })
  ]);

  mock.world.projection.registerKey(address.projection, address.key, entity);

  return entity;
}

describe("capture layers", () => {
  it("hides the other layer containers around the extract alone", async () => {
    installFakeCanvas();
    const mock = await scene();
    const extract = mock.pixi.last().renderer.extract;
    const seen: Array<Record<string, boolean>> = [];
    let encode: ((url: string) => void) | undefined;

    mock.setPaused(true);
    extract.base64 = () => {
      seen.push(Object.fromEntries(LAYERS.map(name => [name, layer(mock, name).visible])));

      return new Promise(resolve => {
        encode = resolve;
      });
    };

    const pending = mock.api.capture({ layers: ["board", "items"] });

    expect(seen).toEqual([{ board: true, items: true, hud: false }]);
    // Shown again right after the call, while Pixi still encodes: no drawn frame sees it hidden.
    expect(layer(mock, "hud").visible).toBe(true);

    encode?.(FAKE_PNG);

    await expect(pending).resolves.toEqual({ png: FAKE_PNG });
  });

  it("hides them at the end of the next drawn frame when the clock runs", async () => {
    installFakeCanvas();
    const mock = await scene();
    const extract = mock.pixi.last().renderer.extract;
    const seen: boolean[] = [];

    extract.base64 = () => {
      seen.push(layer(mock, "board").visible);

      return Promise.resolve(FAKE_PNG);
    };

    const pending = mock.api.capture({ layers: ["hud"] });

    await settle();

    expect(seen).toEqual([]);

    frame(mock, 0, 2);

    await expect(pending).resolves.toEqual({ png: FAKE_PNG });
    expect(seen).toEqual([false]);
    expect(layer(mock, "board").visible).toBe(true);
  });

  it("leaves a container hidden that was hidden before", async () => {
    installFakeCanvas();
    const mock = await scene();

    mock.setPaused(true);
    layer(mock, "items").visible = false;

    await mock.api.capture({ layers: ["board"] });

    expect(layer(mock, "items").visible).toBe(false);
    expect(layer(mock, "hud").visible).toBe(true);
  });

  it("shows the containers again when Pixi throws inside the extract", async () => {
    installFakeCanvas();
    const mock = await scene();

    mock.setPaused(true);
    mock.pixi.last().renderer.extract.base64 = () => {
      throw new Error("gpu busy");
    };

    await expect(mock.api.capture({ layers: ["board"] })).resolves.toBeUndefined();
    expect(layer(mock, "hud").visible).toBe(true);
    expect(mock.log.error).toHaveBeenCalledWith("renderer: capture failed", {
      error: expect.any(Error)
    });
  });

  it("tells to declare the layers when the scene has none", async () => {
    installFakeCanvas();
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockRenderer();

    await mock.start();

    await expect(mock.api.capture({ layers: ["hud"] })).rejects.toThrow(
      '[game] game.capture: layer "hud" is not in the scene.\n  Declare the layers of the scene first.'
    );
  });

  it("refuses a layer that is not in the scene, and an empty list", async () => {
    installFakeCanvas();
    const mock = await scene();

    mock.setPaused(true);

    await expect(mock.api.capture({ layers: ["board", "sky"] })).rejects.toThrow(
      '[game] game.capture: layer "sky" is not in the scene.\n  Use one of "board", "items", "hud".'
    );
    await expect(mock.api.capture({ layers: [] })).rejects.toThrow(
      "[game] game.capture takes at least one layer.\n  Pass the layer names to draw, or leave layers out."
    );
    expect(mock.pixi.last().renderer.extract.calls).toHaveLength(0);
  });
});

describe("capture options and the 2D canvas", () => {
  it("needs OffscreenCanvas for an option, not for a plain capture", async () => {
    const mock = await scene();

    mock.setPaused(true);

    await expect(mock.api.capture()).resolves.toEqual({ png: FAKE_PNG });
    await expect(mock.api.capture({ legend: true })).rejects.toThrow(
      "[game] game.capture needs OffscreenCanvas for legend.\n  Capture in a browser, or leave the option out."
    );
    await expect(mock.api.capture({ layers: ["hud"] })).rejects.toThrow(
      "[game] game.capture needs OffscreenCanvas for layers."
    );
    await expect(mock.api.capture({ sheet: { frames: 2, everyMs: 100 } })).rejects.toThrow(
      "[game] game.capture needs OffscreenCanvas for sheet."
    );
    await expect(mock.api.capture({ against: FAKE_PNG })).rejects.toThrow(
      "[game] game.capture needs OffscreenCanvas for against."
    );
  });

  it("answers undefined for options too while inert", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockRenderer({ dom: false });

    await expect(mock.api.capture({ legend: true })).resolves.toBeUndefined();
  });

  it("lists the options given in its moku:dev entry", async () => {
    installFakeCanvas();
    const mock = await scene();

    mock.setPaused(true);
    await mock.api.capture({ legend: false, layers: ["hud"] });

    expect(mock.log.debug).toHaveBeenCalledWith("moku:dev", {
      command: "renderer.capture",
      options: ["layers"]
    });
  });

  it("refuses a sheet with legend or with against", async () => {
    installFakeCanvas();
    const mock = await scene();
    const message =
      "[game] game.capture takes a sheet on its own.\n  Drop legend and against, or drop sheet.";

    await expect(
      mock.api.capture({ sheet: { frames: 2, everyMs: 100 }, legend: true })
    ).rejects.toThrow(message);
    await expect(
      mock.api.capture({ sheet: { frames: 2, everyMs: 100 }, against: FAKE_PNG })
    ).rejects.toThrow(message);
  });
});

describe("capture legend", () => {
  it("numbers the claim button of the HUD on a canvas drawn at resolution 2", async () => {
    installFakeCanvas();
    const mock = await scene({ dpr: 2 });

    mock.setPaused(true);
    answerPictures(mock, fakePictureUrl(4, 4));
    keyedBox(
      mock,
      { projection: "hud", key: "claim", layer: "hud" },
      { x: 570, y: 1155, w: 283.5, h: 82 }
    );
    mock.modules.sync.pass();

    const shot = await mock.api.capture({ legend: true });

    expect(shot?.legend).toEqual([
      { n: 1, projection: "hud", key: "claim", rect: { x: 1140, y: 2310, w: 567, h: 164 } }
    ]);
    expect(shot?.png.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("lists every keyed view the player can see, sorted by y then x, with a badge each", async () => {
    installFakeCanvas();
    const mock = await scene();

    mock.setPaused(true);
    answerPictures(mock, fakePictureUrl(4, 4));

    const right = { projection: "board.items", key: "c8", layer: "items" };
    const left = { projection: "board.items", key: "c7", layer: "items" };
    const top = { projection: "hud", key: "coins", layer: "hud" };

    keyedBox(mock, right, { x: 300, y: 500, w: 100, h: 100 });
    keyedBox(mock, left, { x: 100, y: 500, w: 100, h: 100 });
    keyedBox(mock, top, { x: 800, y: 40, w: 200, h: 60 });

    const hidden = keyedBox(
      mock,
      { projection: "hud", key: "hidden", layer: "hud" },
      { x: 0, y: 0, w: 10, h: 10 }
    );
    const bare = mock.world.ecs.spawn(owner, [Layer({ name: "hud" }), Transform()]);

    mock.world.projection.registerKey("hud", "bare", bare);
    // A view without a key gets no number either.
    mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite({ texture: "a" })]);
    mock.modules.sync.pass();

    const object = mock.ctx.state.sync.views.get(hidden)?.object;

    if (object === undefined) throw new Error("the view is missing");

    object.visible = false;

    const shot = await mock.api.capture({ legend: true });

    expect(shot?.legend).toEqual([
      { n: 1, projection: "hud", key: "coins", rect: { x: 800, y: 40, w: 200, h: 60 } },
      { n: 2, projection: "board.items", key: "c7", rect: { x: 100, y: 500, w: 100, h: 100 } },
      { n: 3, projection: "board.items", key: "c8", rect: { x: 300, y: 500, w: 100, h: 100 } }
    ]);

    const texts = readFakePicture(shot?.png ?? "").ops.filter(op => op.op === "fillText");

    expect(texts).toEqual([
      { op: "fillText", text: "1", x: 802, y: 42, font: "12px sans-serif", fill: "#ffffff" },
      { op: "fillText", text: "2", x: 102, y: 502, font: "12px sans-serif", fill: "#ffffff" },
      { op: "fillText", text: "3", x: 302, y: 502, font: "12px sans-serif", fill: "#ffffff" }
    ]);
  });

  it("lists only the views of the layers drawn; a child follows its parent's layer", async () => {
    installFakeCanvas();
    const mock = await scene();

    mock.setPaused(true);
    answerPictures(mock, fakePictureUrl(4, 4));

    const panel = keyedBox(
      mock,
      { projection: "hud", key: "panel", layer: "hud" },
      { x: 100, y: 100, w: 400, h: 300 }
    );

    keyedBox(
      mock,
      { projection: "board.items", key: "c7", layer: "items" },
      { x: 0, y: 0, w: 50, h: 50 }
    );
    mock.modules.sync.pass();

    const row = mock.world.ecs.spawn(owner, [
      Transform({ x: 10, y: 20 }),
      Shape({ w: 100, h: 40 }),
      Parent({ entity: panel })
    ]);

    mock.world.projection.registerKey("hud", "row", row);
    mock.modules.sync.pass();

    const shot = await mock.api.capture({ legend: true, layers: ["hud"] });

    expect(shot?.legend?.map(entry => entry.key)).toEqual(["panel", "row"]);
  });

  it("measures the legend on the frame of the picture, not when the picture is encoded", async () => {
    installFakeCanvas();
    const mock = await scene();

    answerPictures(mock, fakePictureUrl(4, 4));

    const coin = keyedBox(
      mock,
      { projection: "board.items", key: "c7", layer: "items" },
      { x: 100, y: 100, w: 50, h: 50 }
    );

    mock.modules.sync.pass();

    const pending = mock.api.capture({ legend: true });

    frame(mock, 0, 2);
    // The game moves on before the picture comes back.
    mock.world.ecs.set(coin, Transform, { x: 900, y: 900 });
    mock.modules.sync.pass();

    const shot = await pending;

    expect(shot?.legend?.[0]?.rect).toEqual({ x: 100, y: 100, w: 50, h: 50 });
  });

  it("answers no legend field without the option", async () => {
    installFakeCanvas();
    const mock = await scene();

    mock.setPaused(true);

    const shot = await mock.api.capture({ layers: ["hud"] });

    expect(shot === undefined ? [] : Object.keys(shot)).toEqual(["png"]);
  });

  it("answers undefined when Pixi could not read the frame", async () => {
    installFakeCanvas();
    const mock = await scene();

    mock.setPaused(true);
    mock.pixi.last().renderer.extract.base64 = () => Promise.reject(new Error("gpu busy"));

    await expect(mock.api.capture({ legend: true })).resolves.toBeUndefined();
  });
});

describe("capture sheet", () => {
  it("checks the frames and the spacing of a sheet", async () => {
    installFakeCanvas();
    const mock = await scene();
    const message =
      "[game] game.capture takes a sheet of 2 to 12 frames, every 1 to 5000 ms.\n  Pass { frames, everyMs } in that range.";

    for (const sheet of [
      { frames: 1, everyMs: 100 },
      { frames: 13, everyMs: 100 },
      { frames: 2.5, everyMs: 100 },
      { frames: 2, everyMs: 0 },
      { frames: 2, everyMs: 5001 },
      { frames: 2, everyMs: Number.POSITIVE_INFINITY },
      { frames: 2, everyMs: Number.NaN }
    ]) {
      await expect(mock.api.capture({ sheet })).rejects.toThrow(message);
    }
  });

  it("steps the game time of a paused clock once between two frames", async () => {
    installFakeCanvas();
    const mock = await scene();
    let elapsed = 0;

    mock.setPaused(true);
    vi.mocked(mock.time.step).mockImplementation((deltaMs: number) => {
      elapsed += deltaMs;
      mock.setElapsed(elapsed);
    });

    const seen = answerPictures(mock, fakePictureUrl(8, 4));
    const shot = await mock.api.capture({ sheet: { frames: 3, everyMs: 100 } });

    expect(mock.time.step).toHaveBeenCalledTimes(2);
    expect(mock.time.step).toHaveBeenCalledWith(100);
    expect(seen).toEqual([0, 100, 200]);
    expect(mock.log.debug).toHaveBeenCalledWith("moku:dev", {
      command: "renderer.capture",
      step: 100
    });

    // Two columns, two rows of 8 x 4 cells with an 8 px gutter.
    const sheet = readFakePicture(shot?.png ?? "");

    expect(shot === undefined ? [] : Object.keys(shot)).toEqual(["png"]);
    expect([sheet.width, sheet.height]).toEqual([40, 32]);
    expect(sheet.ops.filter(op => op.op === "drawImage")).toEqual([
      { op: "drawImage", x: 8, y: 8, w: 8, h: 4, from: "8x4" },
      { op: "drawImage", x: 24, y: 8, w: 8, h: 4, from: "8x4" },
      { op: "drawImage", x: 8, y: 20, w: 8, h: 4, from: "8x4" }
    ]);
    expect(sheet.ops.flatMap(op => (op.op === "fillText" ? [op.text] : []))).toEqual([
      "1",
      "2",
      "3"
    ]);
  });

  it("waits for the game time of a running clock between two frames", async () => {
    installFakeCanvas();
    const mock = await scene();
    const seen = answerPictures(mock, fakePictureUrl(8, 4));
    const pending = mock.api.capture({ sheet: { frames: 2, everyMs: 50 } });

    frame(mock, 0, 2);
    await settle();

    for (const elapsed of [20, 40]) {
      mock.setElapsed(elapsed);
      frame(mock, elapsed, 2);
    }

    expect(seen).toEqual([0]);

    mock.setElapsed(60);
    frame(mock, 60, 2);

    const shot = await pending;

    expect(seen).toEqual([0, 60]);
    expect(mock.time.step).not.toHaveBeenCalled();
    expect(readFakePicture(shot?.png ?? "").width).toBe(8 * 2 + 3 * 8);
  });

  it("gives up after 600 drawn frames in which game time stood still", async () => {
    installFakeCanvas();
    const mock = await scene();

    answerPictures(mock, fakePictureUrl(8, 4));

    const outcome = mock.api.capture({ sheet: { frames: 2, everyMs: 50 } }).then(
      () => "resolved",
      (error: Error) => error.message
    );

    frame(mock, 0, 2);
    await settle();

    for (let index = 1; index <= 600; index += 1) frame(mock, index * 16, 2);

    await expect(outcome).resolves.toBe(
      "[game] game.capture sheet: game time did not advance.\n  Set game.timeScale above 0 or pause the game."
    );
    expect(mock.ctx.state.monitor.captures).toHaveLength(0);
  });

  it("answers undefined when a frame of the sheet could not be read", async () => {
    installFakeCanvas();
    const mock = await scene();

    const extract = mock.pixi.last().renderer.extract;

    mock.setPaused(true);
    extract.base64 = () => Promise.reject(new Error("gpu busy"));

    await expect(mock.api.capture({ sheet: { frames: 2, everyMs: 100 } })).resolves.toBeUndefined();

    // The first frame reads, the second does not.
    let reads = 0;

    extract.base64 = () => {
      reads += 1;

      return reads === 1
        ? Promise.resolve(fakePictureUrl(8, 4))
        : Promise.reject(new Error("lost"));
    };

    await expect(mock.api.capture({ sheet: { frames: 3, everyMs: 100 } })).resolves.toBeUndefined();
    expect(reads).toBe(2);
  });
});

describe("capture against", () => {
  it("answers the pixel diff: red where a pixel differs, the picture faded to grey elsewhere", async () => {
    installFakeCanvas();
    const mock = await scene();

    mock.setPaused(true);
    answerPictures(
      mock,
      fakePictureUrl(2, 1, index => (index === 0 ? [200, 20, 30, 255] : [10, 20, 30, 255]))
    );

    const earlier = fakePictureUrl(2, 1, () => [10, 20, 30, 255]);
    const shot = await mock.api.capture({ against: earlier });

    // Grey 18.15 of (10, 20, 30), faded: 255 - (255 - 18.15) × 0.4 = 160.26.
    expect(readFakePicture(shot?.png ?? "").data).toEqual([255, 0, 0, 255, 160, 160, 160, 255]);
    expect(shot === undefined ? [] : Object.keys(shot)).toEqual(["png"]);
  });

  it("refuses two pictures of different sizes", async () => {
    installFakeCanvas();
    const mock = await scene();

    mock.setPaused(true);
    answerPictures(mock, fakePictureUrl(2, 1));

    await expect(mock.api.capture({ against: fakePictureUrl(3, 1) })).rejects.toThrow(
      "[game] game.capture: the pictures differ in size.\n  Capture both at the same canvas size."
    );
  });

  it("draws the legend of the current frame on the diff picture", async () => {
    installFakeCanvas();
    const mock = await scene();

    mock.setPaused(true);
    answerPictures(mock, fakePictureUrl(2, 1));
    keyedBox(
      mock,
      { projection: "hud", key: "claim", layer: "hud" },
      { x: 570, y: 1155, w: 283.5, h: 82 }
    );
    mock.modules.sync.pass();

    const shot = await mock.api.capture({ legend: true, against: fakePictureUrl(2, 1) });
    const ops = readFakePicture(shot?.png ?? "").ops.map(op => op.op);

    expect(shot?.legend?.map(entry => entry.key)).toEqual(["claim"]);
    expect(ops.indexOf("putImageData")).toBeLessThan(ops.indexOf("fillText"));
  });
});
