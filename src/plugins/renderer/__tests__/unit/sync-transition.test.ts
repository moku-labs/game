import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import { Sprite, Transform } from "../../components";
import type { FilterSlotQuad, LeaveLook, LeaveTransition } from "../../types";
import {
  type FakeContainer,
  FakeGpuProgram,
  type FakeMesh,
  type FakeShader,
  type FakeSprite,
  type FakeTexture,
  FakeUniformGroup
} from "../fake-pixi";
import type { MockRenderer } from "../mock-renderer";
import { type ShotRenderer, settle, startShots } from "../shots-gpu";

// ---------------------------------------------------------------------------
// Unit: the transition of a scene switch (spec 36), `renderer.sync.leave.capture / play / body / reducedMotion`, over
// the real modules and the real frame of the mock renderer on the fake GPU of the shots tests. A 1080 x 1920 CSS mount
// whose canvas texture holds 2160 x 3840 device pixels: the picture is the canvas's pixels, drawn over its CSS size.
// The fake clock is `setNow`; a frame is `runPhase("render")`. `ease: "linear"` makes `e` the time.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;

/** A veil at once, out over 200 ms. */
const VEIL = { color: 0x10_20_30, alpha: 0.6, inMs: 0, outMs: 200 };

/** The common fields of the transitions below: 400 ms on a straight line. */
const COMMON = { ms: 400, ease: "linear", reduced: "cut" } as const;

const FADE: LeaveTransition = { kind: "fade", ...COMMON };
const WIPE: LeaveTransition = { kind: "wipe", ...COMMON, angle: 1.25, soft: 0.04 };
const IRIS: LeaveTransition = { kind: "iris", ...COMMON, x: 0.2, y: 0.3, soft: 0.05 };
const DISSOLVE: LeaveTransition = {
  kind: "dissolve",
  ...COMMON,
  scale: 8,
  edge: 0.08,
  edgeColor: 0xff_80_00
};

/**
 * A started renderer on the fake GPU, the scene's layer declared and one frame drawn.
 *
 * @param kind - The backend.
 * @returns The renderer and the records of its GPU.
 */
async function drawing(kind: "webgpu" | "webgl" = "webgpu"): Promise<ShotRenderer> {
  const opened = await startShots({
    shots: undefined,
    canvas: { width: 2160, height: 3840 },
    kind
  });

  opened.mock.world.projection.setLayers([{ name: "scene", sort: "none" }]);
  opened.mock.modules.sync.pass();
  opened.mock.runPhase("render");

  return opened;
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
 * Shows a look at 0, asks for its picture and draws the frame that takes it: the next `capture()` answers "ready".
 *
 * @param mock - The mock.
 * @param look - The look.
 */
function taken(mock: MockRenderer, look: LeaveLook): void {
  mock.setNow(0);
  mock.api.sync.leave.show(look);
  expect(mock.api.sync.leave.capture()).toBe("wait");
  frameAt(mock, 16);
}

/**
 * Shows a look with a transition, takes its picture and plays it at a moment of the clock, as the swap gate does.
 *
 * @param mock - The mock.
 * @param transition - The transition.
 * @param at - The clock now of the play, ms.
 */
function playedAt(mock: MockRenderer, transition: LeaveTransition, at: number): void {
  taken(mock, { cover: VEIL, transition });
  expect(mock.api.sync.leave.capture()).toBe("ready");
  mock.setNow(at);
  mock.api.sync.leave.play();
}

/**
 * The engine's container of the look.
 *
 * @param mock - The mock.
 * @returns The top.
 */
function topOf(mock: MockRenderer): FakeContainer {
  const top = mock.ctx.state.sync.leave.objects?.top;

  if (top === undefined) throw new Error("the look made no objects");

  return top as unknown as FakeContainer;
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
 * The picture of the transition asked for or playing.
 *
 * @param mock - The mock.
 * @returns Its texture.
 */
function pictureOf(mock: MockRenderer): FakeTexture {
  const picture = mock.ctx.state.sync.leave.playing?.picture;

  if (picture === undefined) throw new Error("no picture taken");

  return picture as unknown as FakeTexture;
}

/**
 * The sprite a fade or a slide draws the picture with.
 *
 * @param mock - The mock.
 * @returns The sprite.
 */
function spriteOf(mock: MockRenderer): FakeSprite {
  const sprite = mock.ctx.state.sync.leave.objects?.picture.sprite;

  if (sprite === undefined) throw new Error("no picture sprite");

  return sprite as unknown as FakeSprite;
}

/**
 * The mesh a wipe, an iris or a dissolve draws the picture with.
 *
 * @param mock - The mock.
 * @returns The mesh, and the shader on it.
 */
function meshOf(mock: MockRenderer): FakeMesh & { shader: FakeShader } {
  const mesh = mock.ctx.state.sync.leave.objects?.picture.mesh;

  if (mesh === undefined) throw new Error("no picture mesh");

  return mesh as unknown as FakeMesh & { shader: FakeShader };
}

/**
 * A set body as `effects` hands it: a program and the instance's uniform group, every number at its default.
 *
 * @param uniforms - The uniforms and their values.
 * @returns The quad, and the values its group holds.
 */
function bodyOf(uniforms: Record<string, unknown>): {
  quad: FilterSlotQuad;
  values: Record<string, unknown>;
} {
  const fu = new FakeUniformGroup(
    Object.fromEntries(Object.entries(uniforms).map(([name, value]) => [name, { value }]))
  );

  return {
    quad: { program: new FakeGpuProgram({}), fu } as unknown as FilterSlotQuad,
    values: fu.uniforms
  };
}

/**
 * Wraps the device's encoders: every render pass begun is counted.
 *
 * @param mock - The mock.
 * @returns The passes begun so far.
 */
function countPasses(mock: MockRenderer): { begun: number } {
  const device = mock.modules.host.device() as unknown as {
    createCommandEncoder(): { beginRenderPass(descriptor: unknown): unknown };
  };
  const make = device.createCommandEncoder.bind(device);
  const count = { begun: 0 };

  device.createCommandEncoder = () => {
    const encoder = make();
    const begin = encoder.beginRenderPass.bind(encoder);

    encoder.beginRenderPass = descriptor => {
      count.begun += 1;

      return begin(descriptor);
    };

    return encoder;
  };

  return count;
}

describe("capture", () => {
  // Bug: the picture is taken before the stage render (the frame before), on a frame Pixi did not draw, twice for two
  // asks, by a render pass, or at the CSS size instead of the canvas's pixels.
  it("copies the canvas once, on a drawn frame, with one copy and one submit and no render pass", async () => {
    const { mock, gpu, created } = await drawing();
    const passes = countPasses(mock);
    const submits = gpu().submits;

    mock.api.sync.leave.show({ cover: VEIL, transition: FADE });
    expect(mock.api.sync.leave.capture()).toBe("wait");
    expect(mock.api.sync.leave.capture()).toBe("wait");
    mock.modules.sync.leaveAfter(false);
    expect([gpu().copies, mock.api.sync.leave.capture()]).toEqual([[], "wait"]);

    mock.runPhase("render");
    mock.runPhase("render");

    expect(gpu().copies).toEqual(["canvas 2160x3840 > shot 2160x3840"]);
    expect(gpu().submits).toBe(submits + 1);
    expect(passes.begun).toBe(0);
    expect(created).toEqual([
      expect.objectContaining({
        width: 2160,
        height: 3840,
        resolution: 1,
        scaleMode: "linear",
        addressMode: "clamp-to-edge",
        autoGarbageCollect: false
      })
    ]);
    expect(mock.api.sync.leave.capture()).toBe("ready");
  });

  // Bug: the look is hidden for the take as for a shot, and the picture shows the scene without the veil it had.
  it("keeps the veil and the loader drawn in the frame it copies", async () => {
    const { mock } = await drawing();

    taken(mock, { cover: VEIL, loader: { afterMs: 0 }, transition: FADE });

    const objects = mock.ctx.state.sync.leave.objects;

    expect(stageOf(mock).children.at(-1)).toBe(topOf(mock));
    expect([topOf(mock).visible, objects?.veil.visible, objects?.ring.visible]).toEqual([
      true,
      true,
      true
    ]);
  });

  // Bug: a look with no transition, or one already swapped, makes the swap wait for a picture nobody plays.
  it("answers none for a look without a transition and after the swap", async () => {
    const { mock } = await drawing();

    mock.api.sync.leave.show({ cover: VEIL });
    expect(mock.api.sync.leave.capture()).toBe("none");

    mock.api.sync.leave.show({ cover: VEIL, transition: FADE });
    mock.api.sync.leave.land();
    expect(mock.api.sync.leave.capture()).toBe("none");
  });

  // Bug: a WebGL canvas is asked for a picture it cannot copy, and the swap waits its frames for nothing.
  it("answers none on WebGL", async () => {
    const { mock } = await drawing("webgl");

    mock.api.sync.leave.show({ cover: VEIL, transition: FADE });

    expect(mock.api.sync.leave.capture()).toBe("none");
  });

  // Bug: a device whose canvas gives no texture leaves the capture waiting, or throws in the frame.
  it("answers none once a drawn frame found no canvas texture", async () => {
    const { mock } = await drawing();

    // A canvas that gives no WebGPU context, as one Pixi never configured.
    Object.assign(mock.pixi.last().canvas, { getContext: () => undefined });
    mock.api.sync.leave.show({ cover: VEIL, transition: FADE });
    expect(mock.api.sync.leave.capture()).toBe("wait");
    mock.runPhase("render");

    expect(mock.api.sync.leave.capture()).toBe("none");
    expect(mock.ctx.state.sync.leave.playing).toBeUndefined();
  });
});

describe("play", () => {
  // Bug: the veil or the ring stays over the next scene as well as in the picture, the picture hangs under the root,
  // or `land` after `play` takes the picture down with the look.
  it("takes the veil and the ring down at once and draws the picture in the top, through land", async () => {
    const { mock } = await drawing();

    taken(mock, { cover: VEIL, loader: { afterMs: 0 }, transition: FADE });
    mock.setNow(1000);
    mock.api.sync.leave.play();
    mock.api.sync.leave.land();
    frameAt(mock, 1000);

    const objects = mock.ctx.state.sync.leave.objects;
    const sprite = spriteOf(mock);

    expect(mock.ctx.state.sync.leave.run).toBeUndefined();
    expect(stageOf(mock).children.at(-1)).toBe(topOf(mock));
    expect([objects?.veil.visible, objects?.frame.visible]).toEqual([false, false]);
    expect(sprite.parent).toBe(topOf(mock));
    expect(sprite.texture).toBe(pictureOf(mock));
    expect(mock.ctx.state.sync.leave.playing?.playStartedAt).toBe(1000);
  });

  // Bug: the picture takes the tap meant for the next scene.
  it("leaves the hit test to the next scene", async () => {
    const { mock } = await drawing();
    const card = mock.world.ecs.spawn(owner, [
      Layer({ name: "scene" }),
      Transform({ x: 540, y: 960 }),
      Sprite({ width: 100, height: 100 })
    ]);

    mock.modules.sync.pass();
    playedAt(mock, FADE, 1000);
    frameAt(mock, 1000);

    expect(mock.api.sync.hitTest(540, 960, () => true)).toBe(card);
  });

  // Bug: a play with no picture taken hangs an empty sprite, or starts a transition with no texture.
  it("does nothing before the picture is taken", async () => {
    const { mock } = await drawing();

    mock.api.sync.leave.show({ cover: VEIL, transition: FADE });
    mock.api.sync.leave.capture();
    mock.api.sync.leave.play();

    expect(mock.ctx.state.sync.leave.playing?.capture).toBe("asked");
    expect(mock.ctx.state.sync.leave.run).toBeDefined();
  });
});

describe("the frames of a transition", () => {
  // Bug: the fade runs on frames instead of the clock, skips the ease, covers the canvas at its pixel size, or the
  // picture outlives the transition: drawn on, or its texture kept (decision 6: 0 bytes at rest).
  it("fades the picture over the canvas from 1 to 0 on the eased clock, then frees it", async () => {
    const { mock } = await drawing();

    playedAt(mock, { ...FADE, ease: "out" }, 1000);
    frameAt(mock, 1000);

    const sprite = spriteOf(mock);
    const picture = pictureOf(mock);

    expect([sprite.alpha, sprite.position.x, sprite.position.y]).toEqual([1, 0, 0]);
    expect([sprite.scale.x, sprite.scale.y]).toEqual([0.5, 0.5]);

    frameAt(mock, 1200);
    expect(sprite.alpha).toBeCloseTo(0.25);

    frameAt(mock, 1400);
    expect(sprite.parent).toBeNull();
    expect([picture.destroyed, picture.source.destroyed]).toEqual([true, true]);
    expect(mock.ctx.state.sync.leave.playing).toBeUndefined();
    expect(stageOf(mock).children).not.toContain(topOf(mock));
  });

  // Bug: a slide moves the wrong way, by the pixel size, or along the wrong axis.
  it("slides the picture off the canvas towards to", async () => {
    const left = await drawing();

    playedAt(left.mock, { kind: "slide", ...COMMON, to: "left" }, 1000);
    frameAt(left.mock, 1200);
    expect([spriteOf(left.mock).position.x, spriteOf(left.mock).position.y]).toEqual([-540, 0]);

    const down = await drawing();

    playedAt(down.mock, { kind: "slide", ...COMMON, to: "down" }, 1000);
    frameAt(down.mock, 1200);
    expect([spriteOf(down.mock).position.x, spriteOf(down.mock).position.y]).toEqual([0, 960]);
    expect(spriteOf(down.mock).alpha).toBe(1);
  });

  // Bug: the wipe runs backwards, binds another texture than the picture, leaves the canvas numbers at zero, or keeps
  // its mesh hung after the end.
  it("wipes on the body handed for wipe: progress 1 - e, the picture bound, the canvas numbers", async () => {
    const { mock } = await drawing();
    const body = bodyOf({ progress: 0, angle: 0, soft: 0.05 });

    mock.api.sync.leave.body("wipe", body.quad, "RevealLine");
    playedAt(mock, WIPE, 1000);
    frameAt(mock, 1000);

    const mesh = meshOf(mock);
    const picture = pictureOf(mock);
    const globals = mock.ctx.state.sync.leave.objects?.picture.globals?.vectors;

    expect(mesh.parent).toBe(topOf(mock));
    expect(mesh.shader.resources.uTexture).toBe(picture.source);
    expect(mesh.shader.resources.fu).toBe(body.quad.fu);
    expect([mesh.scale.x, mesh.scale.y]).toEqual([1080, 1920]);
    expect(body.values).toEqual({ progress: 1, angle: 1.25, soft: 0.04 });
    expect([...(globals?.uInputSize ?? [])]).toEqual([
      1080,
      1920,
      Math.fround(1 / 1080),
      Math.fround(1 / 1920)
    ]);
    expect([...(globals?.uInputPixel ?? [])].slice(0, 2)).toEqual([2160, 3840]);
    expect([...(globals?.uOutputFrame ?? [])]).toEqual([0, 0, 1080, 1920]);
    expect([...(globals?.uGlobalFrame ?? [])]).toEqual([0, 0, 1080, 1920]);
    expect([...(globals?.uOutputTexture ?? [])]).toEqual([1080, 1920, -1, 0]);

    frameAt(mock, 1200);
    expect(body.values.progress).toBe(0.5);

    frameAt(mock, 1400);
    expect(mesh.parent).toBeNull();
    expect(picture.destroyed).toBe(true);
  });

  // Bug: the iris closes into the centre instead of (x, y), starts too small to show the farthest corner, or ends open.
  it("closes the iris from the farthest corner plus soft to 0 around x, y", async () => {
    const { mock } = await drawing();
    const body = bodyOf({ x: 0.5, y: 0.5, radius: 0, soft: 0.05, wobble: 0 });
    const reach = Math.hypot(1 - 0.2, 1 - 0.3) + 0.05;

    mock.api.sync.leave.body("iris", body.quad, "RevealRound");
    playedAt(mock, IRIS, 1000);
    frameAt(mock, 1000);
    expect(body.values.radius).toBeCloseTo(reach);
    expect([body.values.x, body.values.y, body.values.soft, body.values.wobble]).toEqual([
      0.2, 0.3, 0.05, 0
    ]);

    frameAt(mock, 1200);
    expect(body.values.radius).toBeCloseTo(reach / 2);
  });

  // Bug: the dissolve runs backwards, or its colour is written as a number, a new array or 0..255 channels.
  it("dissolves on progress e, its edge colour written into the colour uniform's own array", async () => {
    const { mock } = await drawing();
    const color = Float32Array.of(1, 1, 1);
    const body = bodyOf({ progress: 0, scale: 4, edge: 0.2, edgeColor: color });

    mock.api.sync.leave.body("dissolve", body.quad, "Dissolve");
    playedAt(mock, DISSOLVE, 1000);
    frameAt(mock, 1000);
    expect([body.values.progress, body.values.scale, body.values.edge]).toEqual([0, 8, 0.08]);
    expect(body.values.edgeColor).toBe(color);
    expect([...color]).toEqual([1, Math.fround(128 / 255), 0]);

    frameAt(mock, 1200);
    expect(body.values.progress).toBe(0.5);
  });

  // Bug: a second kind on the kept mesh still draws the first kind's body.
  it("draws each kind on its own body, one mesh for all", async () => {
    const { mock } = await drawing();
    const line = bodyOf({ progress: 0, angle: 0, soft: 0.05 });
    const round = bodyOf({ x: 0.5, y: 0.5, radius: 0, soft: 0.05, wobble: 0 });

    mock.api.sync.leave.body("wipe", line.quad, "RevealLine");
    mock.api.sync.leave.body("iris", round.quad, "RevealRound");
    playedAt(mock, WIPE, 1000);
    frameAt(mock, 1400);

    const mesh = meshOf(mock);

    playedAt(mock, IRIS, 2000);
    frameAt(mock, 2000);

    expect(meshOf(mock)).toBe(mesh);
    expect(mesh.shader.resources.fu).toBe(round.quad.fu);
    expect(mesh.shader.resources.uTexture).toBe(pictureOf(mock).source);
  });
});

describe("a kind without its body", () => {
  // Bug: a wipe with no `RevealLine` listed draws nothing, throws, or warns at every switch.
  it("plays as a fade, and a dev build warns once per kind with the export to list", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const { mock } = await drawing();

    playedAt(mock, WIPE, 1000);
    frameAt(mock, 1200);
    expect(spriteOf(mock).alpha).toBe(0.5);
    frameAt(mock, 1400);
    playedAt(mock, WIPE, 2000);
    playedAt(mock, IRIS, 3000);

    expect(mock.log.warn).toHaveBeenCalledTimes(2);
    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer:transition-body-missing",
      expect.objectContaining({ kind: "wipe", hint: expect.stringContaining("RevealLine") })
    );
    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer:transition-body-missing",
      expect.objectContaining({ kind: "iris" })
    );
  });

  // Bug: a production build logs the missing body, or a body taken back still draws.
  it("is silent in a production build, also for a body taken back", async () => {
    const { mock } = await drawing();
    const body = bodyOf({ progress: 0, angle: 0, soft: 0.05 });

    mock.api.sync.leave.body("wipe", body.quad, "RevealLine")();
    playedAt(mock, WIPE, 1000);
    frameAt(mock, 1000);

    expect(spriteOf(mock).parent).toBe(topOf(mock));
    expect(body.values.progress).toBe(0);
    expect(mock.log.warn).not.toHaveBeenCalled();
  });
});

describe("reduced motion", () => {
  // Bug: reduced motion plays a transition marked "cut", or cuts one marked "keep".
  it("drops a cut transition at show and plays a kept one", async () => {
    const { mock } = await drawing();

    mock.api.sync.leave.reducedMotion(true);
    mock.api.sync.leave.show({ cover: VEIL, transition: FADE });
    expect(mock.api.sync.leave.capture()).toBe("none");

    mock.api.sync.leave.show({ cover: VEIL, transition: { ...FADE, reduced: "keep" } });
    expect(mock.api.sync.leave.capture()).toBe("wait");

    mock.api.sync.leave.reducedMotion(false);
    mock.api.sync.leave.show({ cover: VEIL, transition: FADE });
    expect(mock.api.sync.leave.capture()).toBe("wait");
  });
});

describe("runs that meet", () => {
  // Bug: a picture asked for and never played (the gate gave up, the world not live) stays on the GPU after the swap.
  it("land after the ask frees the picture", async () => {
    const { mock } = await drawing();

    taken(mock, { cover: VEIL, transition: FADE });

    const picture = pictureOf(mock);

    mock.api.sync.leave.land();

    expect(picture.destroyed).toBe(true);
    expect(mock.ctx.state.sync.leave.playing).toBeUndefined();
    expect(mock.api.sync.leave.capture()).toBe("none");
  });

  // Bug: a quick second switch leaves the first picture drawn or held, or takes its own picture without the first.
  it("show during a transition ends it, then its own capture copies the screen as it stands", async () => {
    const { mock, gpu } = await drawing();

    playedAt(mock, FADE, 1000);
    frameAt(mock, 1100);

    const first = pictureOf(mock);
    const sprite = spriteOf(mock);

    mock.api.sync.leave.show({ cover: VEIL, transition: FADE });

    expect(first.destroyed).toBe(true);
    expect(sprite.parent).toBeNull();
    expect(mock.api.sync.leave.capture()).toBe("wait");
    frameAt(mock, 1116);
    expect(gpu().copies).toHaveLength(2);
    expect(mock.api.sync.leave.capture()).toBe("ready");
  });

  // Bug: an abort keeps the picture it asked for, or a drop after the play leaves it drawn.
  it("drop frees the picture asked for, and the one playing", async () => {
    const { mock } = await drawing();

    taken(mock, { cover: VEIL, transition: FADE });

    const asked = pictureOf(mock);

    mock.api.sync.leave.drop();
    expect([asked.destroyed, mock.ctx.state.sync.leave.playing]).toEqual([true, undefined]);

    playedAt(mock, FADE, 1000);
    frameAt(mock, 1100);

    const playing = pictureOf(mock);

    mock.api.sync.leave.drop();
    frameAt(mock, 1116);
    expect(playing.destroyed).toBe(true);
    expect(spriteOf(mock).parent).toBeNull();
  });

  // Bug: a lost device leaves the transition stepping objects of the dead stage, or hangs it on the new one.
  it("a loss ends the transition, and the new stage draws the scene alone", async () => {
    const { mock } = await drawing();

    playedAt(mock, FADE, 1000);
    frameAt(mock, 1100);
    mock.pixi.last().lose();
    await settle();
    frameAt(mock, 1200);

    expect(mock.ctx.state.sync.leave.playing).toBeUndefined();
    expect(stageOf(mock).children.map(child => child.label)).not.toContain("renderer.leave");
  });

  // Bug: a stop in the middle of a transition leaks the picture and the objects that draw it.
  it("a stop destroys the picture and its objects", async () => {
    const { mock } = await drawing();
    const body = bodyOf({ progress: 0, angle: 0, soft: 0.05 });

    mock.api.sync.leave.body("wipe", body.quad, "RevealLine");
    playedAt(mock, FADE, 1000);
    frameAt(mock, 1100);
    playedAt(mock, WIPE, 2000);
    frameAt(mock, 2100);

    const picture = pictureOf(mock);
    const sprite = spriteOf(mock);
    const mesh = meshOf(mock);

    mock.stop();

    expect([picture.destroyed, sprite.destroyed, mesh.destroyed]).toEqual([true, true, true]);
    expect(mock.ctx.state.sync.leave.playing).toBeUndefined();
  });
});
