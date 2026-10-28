import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { Sprite, Transform } from "../../components";
import type { LeaveLook } from "../../types";
import { type FakeContainer, type FakeSprite, FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit: the picture of a scene being left (spec 33, slice A2), `renderer.sync.leave`. A veil over the whole canvas and
// a loader at its centre, last on the stage above the root and every layer, stepped by the render phase on the clock:
// the veil fades in from `show` and out from `land`, the loader shows from `afterMs` and turns, a layer loader is drawn
// above the veil and goes back at the swap, `drop` takes everything at once. The fake clock is `setNow`; a frame is
// `runPhase("render")`. A 1080 x 1920 mount at scale 1: reference units are canvas pixels.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;

/** A veil that fades in over 100 ms to 0.6 and out over 200 ms. */
const VEIL = { color: 0x10_20_30, alpha: 0.6, inMs: 100, outMs: 200 };

/**
 * A started renderer on the scene's three layers.
 *
 * @param onDemand - `config.onDemand`.
 * @returns The mock, its first frame drawn.
 */
async function drawing(onDemand = false): Promise<MockRenderer> {
  const mock = createMockRenderer({ config: { onDemand } });

  await mock.start();
  mock.world.projection.setLayers([
    { name: "scene", sort: "none" },
    { name: "ui", sort: "order" },
    { name: "loading", sort: "none" }
  ]);
  mock.modules.sync.pass();
  mock.runPhase("render");

  return mock;
}

/**
 * Steps one frame at a moment of the clock.
 *
 * @param mock - The mock.
 * @param now - The clock now, ms.
 */
function frameAt(mock: MockRenderer, now: number): void {
  mock.setNow(now);
  mock.runPhase("render");
}

/**
 * The stage of the application.
 *
 * @param mock - The mock.
 * @returns The stage.
 */
function stageOf(mock: MockRenderer): FakeContainer {
  return mock.modules.host.stage() as unknown as FakeContainer;
}

/**
 * A named object of the picture, as the test reads it.
 *
 * @param mock - The mock.
 * @param name - `top`, `veil`, `ring`, `spinner` or `held`.
 * @returns The object.
 */
function objectOf<Name extends "top" | "veil" | "ring" | "spinner" | "held">(
  mock: MockRenderer,
  name: Name
): Name extends "veil" | "spinner" ? FakeSprite : FakeContainer {
  const objects = mock.ctx.state.sync.leave.objects;

  if (objects === undefined) throw new Error("the picture made no objects");

  return objects[name] as unknown as Name extends "veil" | "spinner" ? FakeSprite : FakeContainer;
}

/**
 * The container of a layer of the scene.
 *
 * @param mock - The mock.
 * @param name - The layer.
 * @returns Its container.
 */
function layerOf(mock: MockRenderer, name: string): FakeContainer {
  const container = mock.ctx.state.sync.layers.get(name)?.container;

  if (container === undefined) throw new Error(`no layer ${name}`);

  return container as unknown as FakeContainer;
}

/**
 * The root of the scene's layers.
 *
 * @param mock - The mock.
 * @returns The root.
 */
function rootOf(mock: MockRenderer): FakeContainer {
  return mock.ctx.state.sync.root as unknown as FakeContainer;
}

/**
 * Spawns one view of a loader in a layer and builds it, as a mounted loader projection has.
 *
 * @param mock - The mock.
 * @param layer - The layer.
 * @returns The entity; despawned, it leaves as an unmount takes it.
 */
function spawnLoaderView(mock: MockRenderer, layer = "loading"): Entity {
  const entity = mock.world.ecs.spawn(owner, [
    Layer({ name: layer }),
    Transform({ x: 540, y: 960 }),
    Sprite({ width: 96, height: 96 })
  ]);

  mock.modules.sync.pass();

  return entity;
}

/**
 * Shows a look with the layer `"loading"` as its loader at 0, lifts it at 100 and lands it at 150, the veil full: its
 * fade-out runs from 150 to 350.
 *
 * @param mock - The mock.
 */
function landLifted(mock: MockRenderer): void {
  showAt(mock, 0, { cover: VEIL, loader: { afterMs: 100, due: () => "loading" } });
  frameAt(mock, 100);
  frameAt(mock, 150);
  mock.api.sync.leave.land();
}

/**
 * Shows a look at a moment of the clock.
 *
 * @param mock - The mock.
 * @param now - The clock now, ms.
 * @param look - The look.
 */
function showAt(mock: MockRenderer, now: number, look: LeaveLook): void {
  mock.setNow(now);
  mock.api.sync.leave.show(look);
}

describe("the veil", () => {
  // Bug: the veil hangs inside the root, where the next layer list puts the layers over it, or covers the frame and
  // leaves the bars of a wide screen undimmed.
  it("hangs last on the stage, over the root, and covers the canvas", async () => {
    const mock = await drawing();

    showAt(mock, 0, { cover: { ...VEIL, inMs: 0 } });
    frameAt(mock, 0);
    mock.world.projection.setLayers([{ name: "scene", sort: "none" }]);
    mock.modules.sync.pass();
    frameAt(mock, 16);

    const stage = stageOf(mock);
    const veil = objectOf(mock, "veil");

    expect(stage.children.map(child => child.label)).toEqual(["renderer.root", "renderer.leave"]);
    expect(veil.parent?.parent).toBe(stage);
    expect([veil.position.x, veil.position.y, veil.scale.x, veil.scale.y]).toEqual([
      0, 0, 1080, 1920
    ]);
    expect([veil.tint, veil.alpha]).toEqual([0x10_20_30, 0.6]);
  });

  // Bug: the veil takes the tap meant for the scene under it, or a layer it lifts hides the views below from the hit.
  it("takes no hit", async () => {
    const mock = await drawing();
    const card = mock.world.ecs.spawn(owner, [
      Layer({ name: "scene" }),
      Transform({ x: 540, y: 960 }),
      Sprite({ width: 100, height: 100 })
    ]);

    mock.modules.sync.pass();
    showAt(mock, 0, { cover: { ...VEIL, alpha: 1, inMs: 0 }, loader: { afterMs: 0 } });
    frameAt(mock, 0);

    expect(objectOf(mock, "veil").alpha).toBe(1);
    expect(mock.api.sync.hitTest(540, 960, () => true)).toBe(card);
  });

  // Bug: the fade runs on frames instead of the clock, ignores `inMs` or `outMs`, starts the fade-out from full while
  // the veil was half in, or never leaves the stage.
  it("fades in over inMs from the show and out over outMs from the land, then leaves the stage", async () => {
    const mock = await drawing();

    showAt(mock, 1000, { cover: VEIL });
    const alphas: number[] = [];

    for (const now of [1000, 1050, 1100, 1150]) {
      frameAt(mock, now);
      alphas.push(objectOf(mock, "veil").alpha);
    }

    mock.api.sync.leave.land();

    for (const now of [1250, 1300]) {
      frameAt(mock, now);
      alphas.push(objectOf(mock, "veil").alpha);
    }

    expect(alphas.map(alpha => Number(alpha.toFixed(3)))).toEqual([0, 0.3, 0.6, 0.6, 0.3, 0.15]);
    expect(objectOf(mock, "top").parent).toBe(stageOf(mock));

    frameAt(mock, 1350);

    expect(objectOf(mock, "top").parent).toBeNull();
    expect(mock.ctx.state.sync.leave.run).toBeUndefined();
  });

  // Bug: a drop waits for the fade-out, or leaves the loader turning.
  it("goes at once at a drop", async () => {
    const mock = await drawing();

    showAt(mock, 0, { cover: VEIL, loader: { afterMs: 0 } });
    frameAt(mock, 50);
    mock.api.sync.leave.drop();

    expect(objectOf(mock, "top").parent).toBeNull();
    expect(mock.ctx.state.sync.leave.run).toBeUndefined();
  });

  // Bug: a look with nothing to fade out lingers after the swap: a loader turning over the next scene.
  it.each([
    ["a look without a veil", { loader: { afterMs: 0 } }],
    ["a veil with outMs 0", { cover: { ...VEIL, outMs: 0 }, loader: { afterMs: 0 } }]
  ] as const)("takes %s down at once at the land", async (_case, look) => {
    const mock = await drawing();

    showAt(mock, 0, look);
    frameAt(mock, 16);
    mock.api.sync.leave.land();

    expect(objectOf(mock, "top").parent).toBeNull();
    expect(mock.ctx.state.sync.leave.run).toBeUndefined();
  });

  // Bug: a still veil asks for a frame every frame (a still screen draws for good), or a moving one asks for none and
  // freezes with `onDemand`.
  it("asks for frames while it moves and none once it stands", async () => {
    const mock = await drawing(true);

    frameAt(mock, 0);
    showAt(mock, 0, { cover: VEIL });

    const drawn: boolean[] = [];

    for (const now of [0, 50, 100, 150, 200]) {
      frameAt(mock, now);
      drawn.push(mock.modules.demand.frame().drawn);
    }

    expect(drawn).toEqual([true, true, true, false, false]);
  });
});

describe("the loader", () => {
  // Bug: the ring shows before `afterMs` (every warm switch flashes it), never shows, stands still, or stays after
  // the swap.
  it("shows the engine's ring at afterMs, turns it once a second at the centre, and hides it at the land", async () => {
    const mock = await drawing();

    showAt(mock, 0, { cover: VEIL, loader: { afterMs: 400 } });
    frameAt(mock, 399);

    const ring = objectOf(mock, "ring");

    expect(ring.visible).toBe(false);

    frameAt(mock, 400);
    const first = ring.rotation;

    frameAt(mock, 650);

    expect(ring.visible).toBe(true);
    expect([ring.position.x, ring.position.y]).toEqual([540, 960]);
    expect(first).toBeCloseTo(0.8 * Math.PI);
    expect(ring.rotation).toBeCloseTo(1.3 * Math.PI);

    mock.api.sync.leave.land();
    frameAt(mock, 666);

    expect(ring.visible).toBe(false);
  });

  // Bug: the game's texture is not drawn or does not turn, or a key no bundle answers draws nothing at all.
  it("turns the game's texture, and draws the ring for a key no provider answers, warned", async () => {
    const mock = await drawing();
    const texture = new FakeTexture({ source: { width: 96, height: 96, destroyed: false } });

    mock.api.sync.textures.provide(key =>
      key === "ui.loader.ring" ? (texture as never) : undefined
    );
    showAt(mock, 0, { loader: { afterMs: 0, texture: "ui.loader.ring" } });
    frameAt(mock, 250);

    const spinner = objectOf(mock, "spinner");

    expect([spinner.visible, spinner.texture, objectOf(mock, "ring").visible]).toEqual([
      true,
      texture,
      false
    ]);
    expect(spinner.rotation).toBeCloseTo(0.5 * Math.PI);

    showAt(mock, 300, { loader: { afterMs: 0, texture: "ui.loader.missing" } });
    frameAt(mock, 300);

    expect([spinner.visible, objectOf(mock, "ring").visible]).toEqual([false, true]);
    expect(mock.log.warn).toHaveBeenCalledWith("renderer: no texture for asset key", {
      key: "ui.loader.missing"
    });
  });

  // Bug: a loader projection is made at the tap (its views built for a switch that never shows them), its layer
  // leaves the scene before `afterMs`, is drawn under the veil, or stays out of the root after the fade-out.
  it("asks for its layer once at afterMs, draws it above the veil, and puts it back in its place after the fade-out", async () => {
    const mock = await drawing();
    const root = mock.ctx.state.sync.root as unknown as FakeContainer;
    const loading = mock.ctx.state.sync.layers.get("loading")
      ?.container as unknown as FakeContainer;
    const due = vi.fn(() => "loading");

    showAt(mock, 0, { cover: VEIL, loader: { afterMs: 100, due } });
    frameAt(mock, 50);

    expect(due).not.toHaveBeenCalled();
    expect(loading.parent).toBe(root);

    frameAt(mock, 100);
    frameAt(mock, 150);

    const held = objectOf(mock, "held");

    expect(due).toHaveBeenCalledOnce();
    expect([loading.parent, held.visible]).toEqual([held, true]);
    expect(objectOf(mock, "top").children.indexOf(objectOf(mock, "veil"))).toBe(0);
    expect(root.children.map(child => child.label)).toEqual(["layer:scene", "layer:ui"]);

    mock.api.sync.leave.land();
    frameAt(mock, 350);

    expect(root.children.map(child => child.label)).toEqual([
      "layer:scene",
      "layer:ui",
      "layer:loading"
    ]);
  });

  // Bug: a switch done before `afterMs` still makes the loader's views.
  it("never asks for its layer when the land comes before afterMs", async () => {
    const mock = await drawing();
    const due = vi.fn(() => "loading");

    showAt(mock, 0, { cover: VEIL, loader: { afterMs: 400, due } });
    frameAt(mock, 200);
    mock.api.sync.leave.land();
    frameAt(mock, 400);
    frameAt(mock, 600);

    expect(due).not.toHaveBeenCalled();
  });

  // Bug: a loader with no layer to draw, or one whose making threw, leaves the wait blank or breaks the frame.
  it.each([
    ["answers no layer", (): string | undefined => undefined],
    [
      "throws",
      (): string | undefined => {
        throw new Error("view threw");
      }
    ]
  ] as const)("draws the ring when its due %s", async (_case, due) => {
    const mock = await drawing();

    showAt(mock, 0, { cover: VEIL, loader: { afterMs: 0, due } });
    frameAt(mock, 0);

    expect([objectOf(mock, "ring").visible, objectOf(mock, "held").visible]).toEqual([true, false]);
  });
});

describe("a layer loader at the swap", () => {
  // Bug: the game's loader blinks out at the swap while the veil fades, fades on a curve of its own, falls under the
  // veil before the veil is gone, or stays faded (its alpha below 1) in its layer afterwards.
  it("stays above the veil and fades with it, its alpha the veil's level, then goes back at alpha 1", async () => {
    const mock = await drawing();
    const loading = layerOf(mock, "loading");

    landLifted(mock);

    const held = objectOf(mock, "held");
    const veil = objectOf(mock, "veil");
    const fade: [number, number, boolean][] = [];

    for (const now of [200, 250, 300]) {
      frameAt(mock, now);
      fade.push([
        Number(loading.alpha.toFixed(3)),
        Number((veil.alpha / VEIL.alpha).toFixed(3)),
        loading.parent === held &&
          held.visible &&
          stageOf(mock).children.at(-1) === objectOf(mock, "top")
      ]);
    }

    expect(fade).toEqual([
      [0.75, 0.75, true],
      [0.5, 0.5, true],
      [0.25, 0.25, true]
    ]);

    frameAt(mock, 350);

    expect([loading.parent === rootOf(mock), loading.alpha]).toEqual([true, 1]);
    expect(objectOf(mock, "top").parent).toBeNull();
  });

  // Bug: the layer goes back under the root while the switch has not unmounted the loader yet (it does so in the first
  // frame `outMs` has passed in, which can come a frame after the veil is gone): the loader is drawn whole over the
  // next scene for that frame; or the layer never comes back once the loader left it.
  it("waits above the veil at alpha 0 once the veil is gone, until the loader's views left it", async () => {
    const mock = await drawing();
    const loading = layerOf(mock, "loading");
    const view = spawnLoaderView(mock);

    landLifted(mock);
    frameAt(mock, 350);

    expect([loading.parent === objectOf(mock, "held"), loading.alpha]).toEqual([true, 0]);
    expect(objectOf(mock, "top").parent).toBeNull();
    expect(mock.ctx.state.sync.leave.run).toBeUndefined();

    frameAt(mock, 366);

    expect(loading.alpha).toBe(0);

    mock.world.ecs.despawn(view);
    mock.modules.sync.pass();
    frameAt(mock, 383);

    expect(rootOf(mock).children.map(child => child.label)).toEqual([
      "layer:scene",
      "layer:ui",
      "layer:loading"
    ]);
    expect(loading.alpha).toBe(1);
  });

  // Bug: views another owner draws in the loader's layer (the scene that stands, a loader the game mounted) never
  // leave it, and the layer stays at alpha 0 for good.
  it("goes back whole after a bounded wait when views stay in it", async () => {
    const mock = await drawing();
    const loading = layerOf(mock, "loading");

    spawnLoaderView(mock);
    landLifted(mock);
    frameAt(mock, 350);

    // outMs 200: 200 / 50 + 2 frames of wait.
    for (let frame = 1; frame <= 6; frame += 1) frameAt(mock, 350 + frame * 16);

    expect([loading.parent === objectOf(mock, "held"), loading.alpha]).toEqual([true, 0]);

    frameAt(mock, 350 + 7 * 16);

    expect([loading.parent === rootOf(mock), loading.alpha]).toEqual([true, 1]);
    expect(mock.ctx.state.sync.leave.parked).toBeUndefined();
  });

  // Bug: a loader shown before the veil is full drops from whole to the veil's level at the swap.
  it("fades from whole at the swap when the veil was not full", async () => {
    const mock = await drawing();
    const loading = layerOf(mock, "loading");

    showAt(mock, 0, {
      cover: { ...VEIL, inMs: 400 },
      loader: { afterMs: 0, due: () => "loading" }
    });
    frameAt(mock, 0);
    frameAt(mock, 200);
    mock.api.sync.leave.land();
    frameAt(mock, 200);

    expect(loading.alpha).toBe(1);

    frameAt(mock, 250);

    expect(Number(loading.alpha.toFixed(3))).toBe(0.5);
  });

  // Bug: a look with nothing to fade out puts the loader's layer back under the root at the land, where it draws the
  // loader whole until the switch unmounts it.
  it("waits the same at a land with outMs 0", async () => {
    const mock = await drawing();
    const loading = layerOf(mock, "loading");

    spawnLoaderView(mock);
    showAt(mock, 0, { cover: { ...VEIL, outMs: 0 }, loader: { afterMs: 0, due: () => "loading" } });
    frameAt(mock, 16);
    mock.api.sync.leave.land();

    expect([loading.parent === objectOf(mock, "held"), loading.alpha]).toEqual([true, 0]);
    expect(objectOf(mock, "top").parent).toBeNull();
  });

  // Bug: the next scene's layer list, which declares the loader's layer too, takes the fading loader back under the
  // root at the swap: it drops under the veil, and the list's place for it is lost at the end.
  it("stays above the veil through a next list that declares its layer, then takes its place in that list", async () => {
    const mock = await drawing();
    const loading = layerOf(mock, "loading");

    landLifted(mock);
    mock.world.projection.setLayers([
      { name: "loading", sort: "none" },
      { name: "cells", sort: "none" }
    ]);
    mock.modules.sync.pass();
    frameAt(mock, 200);

    expect([loading.parent === objectOf(mock, "held"), loading.alpha]).toEqual([true, 0.75]);

    frameAt(mock, 350);

    expect(rootOf(mock).children.map(child => child.label)).toEqual([
      "layer:loading",
      "layer:cells"
    ]);
  });

  // Bug: a next scene that does not declare the loader's layer takes the fading loader away at the swap, and warns
  // that the loader's views, which the switch unmounts only after the fade, were left without a layer.
  it("fades on through a next list without its layer, unwarned, and is let go once its views left", async () => {
    const mock = await drawing();
    const loading = layerOf(mock, "loading");
    const view = spawnLoaderView(mock);

    landLifted(mock);
    mock.world.projection.setLayers([{ name: "cells", sort: "none" }]);
    mock.modules.sync.pass();
    frameAt(mock, 200);

    expect([loading.parent === objectOf(mock, "held"), loading.alpha]).toEqual([true, 0.75]);

    frameAt(mock, 350);
    mock.world.ecs.despawn(view);
    mock.modules.sync.pass();
    frameAt(mock, 366);

    expect([loading.parent === null, loading.alpha]).toEqual([true, 1]);
    expect(mock.log.warn).not.toHaveBeenCalledWith(
      "renderer: views left without a layer",
      expect.anything()
    );
  });

  // Bug: an abort fades the loader, or hides it waiting, over the scene that stays instead of taking it away with the
  // veil: the switch unmounts the loader at once then.
  it("goes back at once at a drop, its views in it", async () => {
    const mock = await drawing();
    const loading = layerOf(mock, "loading");

    spawnLoaderView(mock);
    showAt(mock, 0, { cover: VEIL, loader: { afterMs: 100, due: () => "loading" } });
    frameAt(mock, 150);
    mock.api.sync.leave.drop();

    expect([loading.parent === rootOf(mock), loading.alpha]).toEqual([true, 1]);
    expect(objectOf(mock, "top").parent).toBeNull();
  });

  // Bug: a switch started while the last loader fades puts that layer back under the root at full alpha while the
  // loader is still mounted, leaves it faded, or draws the new loader at the alpha of the old fade.
  it("restarts cleanly when a switch starts during the fade", async () => {
    const mock = await drawing();
    const loading = layerOf(mock, "loading");

    spawnLoaderView(mock);
    landLifted(mock);
    frameAt(mock, 250);
    showAt(mock, 250, { cover: VEIL, loader: { afterMs: 100, due: () => "loading" } });

    expect([loading.parent === objectOf(mock, "held"), loading.alpha]).toEqual([true, 0]);

    frameAt(mock, 300);

    expect(objectOf(mock, "veil").alpha).toBeCloseTo(VEIL.alpha);

    frameAt(mock, 350);

    expect([loading.parent === objectOf(mock, "held"), loading.alpha]).toEqual([true, 1]);

    mock.api.sync.leave.land();
    frameAt(mock, 450);

    expect(loading.alpha).toBeCloseTo(0.5);
  });

  // Bug: a second loader layer that waits makes the first one wait for good: its layer never comes back to the root.
  it("lets one layer wait at a time: the older goes back", async () => {
    const mock = await drawing();
    const loading = layerOf(mock, "loading");
    const ui = layerOf(mock, "ui");

    spawnLoaderView(mock);
    spawnLoaderView(mock, "ui");
    landLifted(mock);
    frameAt(mock, 350);
    showAt(mock, 400, { cover: VEIL, loader: { afterMs: 0, due: () => "ui" } });
    frameAt(mock, 400);
    mock.api.sync.leave.land();
    frameAt(mock, 600);

    expect([loading.parent === rootOf(mock), loading.alpha]).toEqual([true, 1]);
    expect([ui.parent === objectOf(mock, "held"), ui.alpha]).toEqual([true, 0]);
  });

  // Bug: a waiting layer keeps the tree of a lost application, or outlives the stop.
  it("is forgotten with a lost application and at the stop", async () => {
    const mock = await drawing();

    spawnLoaderView(mock);
    landLifted(mock);
    frameAt(mock, 350);
    mock.pixi.last().lose("unknown");
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();

    expect(mock.ctx.state.sync.leave.parked).toBeUndefined();

    const stopped = await drawing();

    spawnLoaderView(stopped);
    landLifted(stopped);
    frameAt(stopped, 350);
    stopped.stop();

    expect(stopped.ctx.state.sync.leave).toEqual({});
  });
});

describe("the objects of the picture", () => {
  // Bug: every switch makes new Pixi objects (a leak per switch), or a restored device draws the look nowhere.
  it("are made once per application and again on a restored device", async () => {
    const mock = await drawing();

    showAt(mock, 0, { cover: VEIL });
    frameAt(mock, 0);
    const first = objectOf(mock, "top");

    mock.api.sync.leave.drop();
    showAt(mock, 100, { cover: VEIL });
    frameAt(mock, 100);

    expect(objectOf(mock, "top")).toBe(first);

    mock.pixi.last().lose("unknown");
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    frameAt(mock, 150);

    const restored = objectOf(mock, "top");

    expect(restored).not.toBe(first);
    expect(stageOf(mock).children.at(-1)).toBe(restored);
  });

  // Bug: a stop leaks the objects of the picture, or frees the game's texture or a lifted layer with them.
  it("are freed at the stop, the game's texture and the scene's layer left alone", async () => {
    const mock = await drawing();
    const texture = new FakeTexture({ source: { width: 96, height: 96, destroyed: false } });
    const loading = mock.ctx.state.sync.layers.get("loading")
      ?.container as unknown as FakeContainer;

    mock.api.sync.textures.provide(key =>
      key === "ui.loader.ring" ? (texture as never) : undefined
    );
    showAt(mock, 0, { loader: { afterMs: 0, texture: "ui.loader.ring" } });
    frameAt(mock, 0);
    const top = objectOf(mock, "top");

    mock.api.sync.leave.show({ loader: { afterMs: 0, due: () => "loading" } });
    frameAt(mock, 16);
    mock.stop();

    expect([top.destroyed, texture.destroyed, loading.destroyed]).toEqual([true, false, false]);
    expect(mock.ctx.state.sync.leave).toEqual({});
  });
});
