import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config, PixiContainer, PixiFilter } from "../../types";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";
import { quadOfFilter } from "../quad-harness";
import { type StagePixi, stagePixi } from "../stage-pixi";

// ---------------------------------------------------------------------------
// Unit test of the pipeline warm-up (F4) on the real Pixi of `stagePixi`: the
// probes are drawn onto the canvas before the stage pass of a drawn frame,
// `renderer.warm` a frame, every subject in every target a WebGPU pipeline is
// keyed by, and the stage never holds one.
// ---------------------------------------------------------------------------

/** A tiny BMFont in the text format: one glyph, "0". */
const FONT = [
  'info face="probe" size=32',
  "common lineHeight=32 base=26 scaleW=64 scaleH=64 pages=1",
  'page id=0 file="probe.png"',
  "chars count=1",
  "char id=48 x=0 y=0 width=16 height=16 xoffset=0 yoffset=0 xadvance=16 page=0 chnl=15"
].join("\n");

/** The six content subjects in the order the renderer queues them. */
const CONTENT = [
  "sprite",
  "sprite-add",
  "sprite-screen",
  "graphics",
  "particles-normal",
  "particles-add"
];

/** The four WebGPU targets, in queue order. */
const VARIANTS = ["canvas", "canvas+clip", "texture", "texture+clip"];

/** A running renderer with the warm-up on, and what every render of its frames drew. */
type Warmed = {
  mock: MockRenderer;
  stage: StagePixi;
  /** Every render onto the canvas since the start, in order: `"stage"`, or the probe as `"subject variant"`. */
  calls: string[];
  /** The probes drawn since the start, as `"subject variant"`. */
  probes(): string[];
  /** Names a handed filter in `calls`. */
  name(filter: PixiFilter, label: string): void;
  /** One frame: the sync pass, the change sets closed, then input and render; true when drawn. */
  frame(): boolean;
  /** Frames in a row; answers how many were drawn. */
  frames(count: number): number;
};

const running: MockRenderer[] = [];

afterEach(() => {
  for (const mock of running.splice(0)) mock.stop();
  vi.unstubAllGlobals();
});

/**
 * The name of a probe's target.
 *
 * @param into - The texture it renders into, none for the canvas.
 * @returns `"canvas"`, `"plain"` for the texture no clip draws into, else `"texture"`.
 */
function targetOf(into: pixi.Texture | undefined): string {
  if (into === undefined) return "canvas";

  return into.source.label === "renderer.warm.plain" ? "plain" : "texture";
}

/**
 * What a probe root holds while it is rendered: the subject, and the target it is drawn into.
 *
 * @param root - The probe root handed to `renderer.render`.
 * @param into - The texture of the render; `undefined` for the canvas.
 * @param names - The labels of handed filters.
 * @returns `"subject variant"`.
 */
function probeOf(
  root: pixi.Container,
  into: pixi.Texture | undefined,
  names: Map<unknown, string>
): string {
  let node: pixi.Container | undefined = root.children[0];
  const target = targetOf(into);
  let clip = "";

  if (node?.label === "renderer.warm.clip") {
    clip = "+clip";
    node = node.children[0]?.children[0];
  }

  const subject =
    node?.label === "renderer.warm.filter"
      ? (names.get(node.filters?.[0]) ?? "filter")
      : (node?.label ?? "").replace("renderer.warm.", "");

  return `${subject ?? "nothing"} ${target}${clip}`;
}

/**
 * Tells whether a container or anything under it is a piece of the warm-up.
 *
 * @param node - The container.
 * @returns True when a probe hangs in it.
 */
function holdsProbe(node: pixi.Container): boolean {
  // Pixi's label is `null` until one is given.
  const label: string | null = node.label;

  return (
    (label ?? "").startsWith("renderer.warm") || node.children.some(child => holdsProbe(child))
  );
}

/**
 * Tells whether a probe's subject is the holder of one filter.
 *
 * @param node - The top under the probe root.
 * @param filter - The filter.
 * @returns True while the filter is drawn.
 */
function holdsFilter(node: PixiContainer, filter: PixiFilter): boolean {
  if (node.label === "renderer.warm.filter") return node.filters?.[0] === filter;

  return node.children.some(child => holdsFilter(child, filter));
}

/**
 * The most filtered containers on one path of a tree: 1 for a filter alone, 2 for a filter inside a filter.
 *
 * @param node - The root of the tree.
 * @returns The depth of filters; 0 for a tree with none.
 */
function filterDepth(node: PixiContainer): number {
  const own = (node.filters?.length ?? 0) > 0 ? 1 : 0;
  let deepest = 0;

  for (const child of node.children) deepest = Math.max(deepest, filterDepth(child));

  return own + deepest;
}

/**
 * Starts the renderer over the real Pixi of `stagePixi`, drawing on demand with the warm-up on, and watches every
 * render onto the canvas. No frame runs yet.
 *
 * @param options - The backend and other config.
 * @param options.kind - The backend the stand-in reports; WebGPU when left out.
 * @param options.config - Config of the renderer: `warm: 1` and `onDemand: true` unless given.
 * @param options.without - A class the module lacks, as a trimmed Pixi does.
 * @returns The running renderer.
 */
async function startWarm(
  options: { kind?: "webgpu" | "webgl"; config?: Partial<Config>; without?: string } = {}
): Promise<Warmed> {
  const stage = stagePixi(options.kind === undefined ? {} : { kind: options.kind });
  const module =
    options.without === undefined
      ? stage.module
      : ({ ...stage.module, [options.without]: undefined } as unknown as typeof stage.module);
  const mock = createMockRenderer({
    config: {
      onDemand: true,
      warm: 1,
      ...options.config,
      loadPixi: () => Promise.resolve(module)
    }
  });
  const calls: string[] = [];
  const names = new Map<unknown, string>();

  running.push(mock);
  await mock.start();
  mock.world.projection.setLayers([{ name: "items", sort: "order" }]);
  stage.last().renderer.watchers.push(call => {
    if (call.container.label === "renderer.warm") {
      // A probe root is never in the stage, and holds its one subject only.
      expect(call.container.parent).toBeNull();
      expect(call.container.children).toHaveLength(1);
      calls.push(probeOf(call.container, call.target, names));

      return;
    }

    if (call.target !== undefined) return;

    // Onto the canvas the renderer draws the probes and the stage, nothing else.
    expect(call.container).toBe(stage.last().stage);
    // The stage never holds a piece of the warm-up.
    expect(holdsProbe(call.container)).toBe(false);
    calls.push("stage");
  });

  const frame = (): boolean => {
    const before = stage.renders();

    mock.modules.sync.pass();
    mock.world.clearChanges();
    mock.runPhase("input");
    mock.runPhase("render");

    return stage.renders() > before;
  };

  return {
    mock,
    stage,
    calls,
    probes: () => calls.filter(call => call !== "stage"),
    name: (filter, label) => names.set(filter, label),
    frame,
    frames: count => {
      let drawn = 0;

      for (let index = 0; index < count; index += 1) drawn += frame() ? 1 : 0;

      return drawn;
    }
  };
}

/**
 * Lets the promises answered in a frame run.
 */
async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

/**
 * Watches a promise: whether it settled, and with what.
 *
 * @param promise - The promise.
 * @returns A record filled when it settles.
 */
function watchAnswer(promise: Promise<boolean>): { answer: boolean | undefined } {
  const record: { answer: boolean | undefined } = { answer: undefined };

  promise.then(answer => {
    record.answer = answer;
  });

  return record;
}

/**
 * The draws of one subject in every WebGPU target.
 *
 * @param subject - The subject.
 * @returns `"subject variant"` per target.
 */
function inFour(subject: string): string[] {
  return VARIANTS.map(variant => `${subject} ${variant}`);
}

/**
 * Installs a font on the renderer.
 *
 * @param warmed - The running renderer.
 */
function installFont(warmed: Warmed): void {
  const texture = new pixi.Texture({ source: new pixi.TextureSource({ width: 64, height: 64 }) });

  warmed.mock.api.sync.fonts.install("hud.probe", FONT, texture);
}

describe("the warm-up of the content pipelines", () => {
  // Bug: a pipeline is created in the frame a screen first needs it; or a probe is drawn after the stage, on screen.
  it("a WebGPU warm-up draws each content subject in four variants, one draw a frame, before the stage pass", async () => {
    const warmed = await startWarm();

    expect(warmed.frames(24)).toBe(24);
    expect(warmed.calls).toEqual(
      CONTENT.flatMap(subject => inFour(subject)).flatMap(probe => [probe, "stage"])
    );
    // Every one of those frames created pipelines: none is a sample of the adaptive rate.
    expect(warmed.mock.time.frameProbed).toHaveBeenCalledTimes(24);
    expect(warmed.mock.drawnCount()).toBe(24);

    // The queue is empty: a still screen drawing on demand draws nothing more.
    expect(warmed.frames(5)).toBe(0);
    expect(warmed.probes()).toHaveLength(24);
  });

  it("warm: 3 draws three probes a frame", async () => {
    const warmed = await startWarm({ config: { warm: 3 } });

    warmed.frame();

    expect(warmed.calls).toEqual([...inFour("sprite").slice(0, 3), "stage"]);
  });

  // Bug: the glow probes draw with the normal blend, so the add and screen pipelines of the sprite batch are still
  // created in the frame a glow first shows.
  it("draws the glow probes as white sprites with the add and the screen blend", async () => {
    const warmed = await startWarm({ config: { warm: 4 } });
    const sprites: string[] = [];

    warmed.stage.last().renderer.watchers.push(call => {
      const subject = call.container.children[0];

      if (call.container.label !== "renderer.warm" || !(subject instanceof pixi.Sprite)) return;

      sprites.push(
        `${subject.label} ${subject.blendMode} ${subject.texture === pixi.Texture.WHITE}`
      );
    });
    warmed.frames(3);

    expect([...new Set(sprites)]).toEqual([
      "renderer.warm.sprite inherit true",
      "renderer.warm.sprite-add add true",
      "renderer.warm.sprite-screen screen true"
    ]);
  });

  // Bug: the game's "nothing ahead while the config is off".
  it("warm: 0 answers false at once and draws nothing", async () => {
    const warmed = await startWarm({ config: { warm: 0 } });
    const answer = watchAnswer(warmed.mock.api.sync.filters.warm(new pixi.AlphaFilter()));

    await settle();

    expect(answer.answer).toBe(false);
    expect(warmed.frames(20)).toBe(1);
    expect(warmed.probes()).toEqual([]);
    expect(warmed.mock.time.frameProbed).not.toHaveBeenCalled();
  });

  // Bug: the game's "keeps an item until a frame really drew it": a probe is counted in a frame that drew nothing.
  it("a frame the renderer does not draw draws no probe, and the queue asks for the next frame", async () => {
    const warmed = await startWarm();

    warmed.frame();
    warmed.mock.ctx.state.host.ready = false;

    expect(warmed.frames(3)).toBe(0);
    expect(warmed.probes()).toEqual(["sprite canvas"]);

    warmed.mock.ctx.state.host.ready = true;

    // Nothing on screen changed: only the queue asks for the frame.
    expect(warmed.frame()).toBe(true);
    expect(warmed.mock.modules.demand.frame().reason).toBe("request");
    expect(warmed.probes()).toEqual(["sprite canvas", "sprite canvas+clip"]);
  });

  it("WebGL draws one variant", async () => {
    const warmed = await startWarm({ kind: "webgl" });

    expect(warmed.frames(8)).toBe(6);
    expect(warmed.probes()).toEqual(CONTENT.map(subject => `${subject} canvas`));
  });

  // Bug: on a canvas the stage pass does not clear, a probe drawn onto it stays on screen.
  it("a canvas that is not cleared before the frame gets texture variants only", async () => {
    const warmed = await startWarm();

    warmed.stage.last().renderer.background.clearBeforeRender = false;
    warmed.mock.modules.sync.forget();
    warmed.mock.modules.sync.rebuildAll();
    warmed.frames(14);

    expect(warmed.probes()).toEqual(
      CONTENT.flatMap(subject => [`${subject} texture`, `${subject} texture+clip`])
    );
    expect(
      vi
        .mocked(warmed.mock.log.warn)
        .mock.calls.filter(([message]) => message === "renderer:warm-canvas-off")
    ).toHaveLength(1);
  });
});

describe("the warm-up of a filter", () => {
  // Bug: the promise answers before every target was drawn, and the shop opens on a missing pipeline.
  it("a filter handed to warm is drawn in four variants and its promise answers true after the fourth", async () => {
    const warmed = await startWarm();
    const filter = new pixi.AlphaFilter({ alpha: 0.5 });

    warmed.frames(24);
    warmed.name(filter, "probe");

    const answer = watchAnswer(warmed.mock.api.sync.filters.warm(filter));

    warmed.frames(3);
    await settle();

    expect(answer.answer).toBeUndefined();

    warmed.frame();
    await settle();

    expect(answer.answer).toBe(true);
    expect(warmed.probes().slice(24)).toEqual(inFour("probe"));
    // Handed over again on the same device: done already.
    expect(await warmed.mock.api.sync.filters.warm(filter)).toBe(true);
    expect(warmed.probes()).toHaveLength(28);
  });

  it("the text probe is queued when the first font is installed, ahead of waiting filters", async () => {
    const warmed = await startWarm();
    const filter = new pixi.AlphaFilter();

    warmed.name(filter, "probe");
    warmed.mock.api.sync.filters.warm(filter);
    installFont(warmed);
    warmed.frames(32);

    expect(warmed.probes()).toEqual([
      ...CONTENT.flatMap(subject => inFour(subject)),
      ...inFour("text"),
      ...inFour("probe")
    ]);
  });

  // Bug: the new device of a restore has none of the pipelines, and the first screen after it compiles them all.
  it("after a device restore everything is drawn again", async () => {
    const warmed = await startWarm();
    const filter = new pixi.AlphaFilter();

    warmed.name(filter, "probe");
    warmed.mock.api.sync.filters.warm(filter);
    installFont(warmed);
    warmed.frames(32);

    const first = warmed.probes();

    // What the host's restore runs: the old tree is let go, the new one built.
    warmed.mock.modules.sync.forget();
    warmed.mock.modules.sync.rebuildAll();

    const again = watchAnswer(warmed.mock.api.sync.filters.warm(filter));

    warmed.frames(32);
    await settle();

    expect(warmed.probes().slice(32)).toEqual(first);
    expect(again.answer).toBe(true);
  });

  // Bug: a texture variant draws its filter through a second filter (a filter inside a filter). Pixi 8.21 reads the
  // input texture that second level of its filter stack used last at its next push; a pool trim destroys that texture
  // in between, the probe's render throws inside Pixi, and the stack it leaves unbalanced makes every later frame's
  // filters throw: the merge game lost its Glow for the session.
  it("a filter probe is the only filter of its render: a texture variant draws into a texture of its own", async () => {
    const warmed = await startWarm();
    const filter = new pixi.AlphaFilter();
    const drawn: Array<{ onto: string; depth: number }> = [];

    warmed.stage.last().renderer.watchers.push(call => {
      const top = call.container.children[0];

      if (call.container.label !== "renderer.warm" || top === undefined) return;
      if (!holdsFilter(top, filter)) return;

      drawn.push({
        onto: call.target === undefined ? "canvas" : "texture",
        depth: filterDepth(call.container)
      });
    });
    warmed.frames(24);
    warmed.mock.api.sync.filters.warm(filter);
    warmed.frames(4);

    expect(drawn).toEqual([
      { onto: "canvas", depth: 1 },
      { onto: "canvas", depth: 1 },
      { onto: "texture", depth: 1 },
      { onto: "texture", depth: 1 }
    ]);
  });

  // Bug: a probe whose render throws is counted done and the queue goes on. A throw inside Pixi's render leaves its
  // filter stack unbalanced, which no public API rebalances: every probe after it throws again, and the stage pass of
  // the same frame throws in a real filter's apply, which effects then breaks for the session.
  it("a probe whose render throws ends the warm-up of the application, logged once as an error", async () => {
    const warmed = await startWarm({ config: { warm: 3 } });
    const broken = new pixi.AlphaFilter();
    const after = new pixi.AlphaFilter();
    const heard: number[] = [];

    // An agent build: a run that ended on a throw is not reported as a finished warm-up.
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    warmed.mock.modules.sync.onWarm(draws => heard.push(draws));

    warmed.name(broken, "broken");
    warmed.name(after, "after");
    // After the watcher that records the probe: the broken one is seen, then throws.
    warmed.stage.last().renderer.watchers.push(call => {
      const top = call.container.children[0];

      if (top !== undefined && holdsFilter(top, broken)) throw new Error("no pipeline");
    });

    const answers = [
      watchAnswer(warmed.mock.api.sync.filters.warm(broken)),
      watchAnswer(warmed.mock.api.sync.filters.warm(after))
    ];

    // 24 content draws, three a frame: the eighth frame draws the last content probe, the ninth the broken one.
    expect(warmed.frames(9)).toBe(9);
    await settle();

    expect(warmed.probes().slice(23)).toEqual(["particles-add texture+clip", "broken canvas"]);
    expect(warmed.calls.at(-1)).toBe("stage");
    expect(answers.map(answer => answer.answer)).toEqual([false, false]);
    expect(heard).toEqual([]);
    expect(warmed.mock.log.warn).not.toHaveBeenCalled();
    expect(warmed.mock.log.error).toHaveBeenCalledTimes(1);
    expect(warmed.mock.log.error).toHaveBeenCalledWith("renderer:warm-failed", {
      subject: "filter",
      filter: "AlphaFilter",
      variant: "canvas",
      error: expect.any(Error)
    });

    // Nothing more on this application: not the queue, not a filter handed over now, not the text of a new font.
    const late = watchAnswer(warmed.mock.api.sync.filters.warm(new pixi.AlphaFilter()));

    installFont(warmed);
    await settle();

    expect(late.answer).toBe(false);
    expect(warmed.frames(3)).toBe(0);
    expect(warmed.probes()).toHaveLength(25);

    // A new application has a new filter stack: its warm-up runs again, without the filters whose callers were told
    // false (they may have destroyed them).
    warmed.mock.modules.sync.forget();
    warmed.mock.modules.sync.rebuildAll();
    warmed.frames(10);

    expect(warmed.probes().slice(25)).toEqual([
      ...CONTENT.flatMap(subject => inFour(subject)),
      ...inFour("text")
    ]);
  });

  // Bug: the renderer destroys a filter `effects` owns, or a waiting caller hangs forever.
  it("stopping answers waiting promises false and destroys the probe objects, never a handed filter", async () => {
    const warmed = await startWarm();
    const filter = new pixi.AlphaFilter();
    const destroyFilter = vi.spyOn(filter, "destroy");
    const answer = watchAnswer(warmed.mock.api.sync.filters.warm(filter));

    warmed.frame();

    const objects = warmed.mock.ctx.state.sync.warm.objects;

    if (objects === undefined) throw new Error("no probe tree after a warm frame");

    running.splice(0);
    warmed.mock.stop();
    await settle();

    expect(answer.answer).toBe(false);
    expect(objects.root.destroyed).toBe(true);
    expect(objects.mask.destroyed).toBe(true);
    expect(objects.target.destroyed).toBe(true);
    expect(destroyFilter).not.toHaveBeenCalled();
    expect(await warmed.mock.api.sync.filters.warm(filter)).toBe(false);
  });

  // Bug: the probe target Pixi drew was destroyed with the listeners of its cached bind groups still on it, and each
  // warned "[BindGroup] ... destroyed while still bound to a shader".
  it("stopping destroys the probe target without a bind group warning", async () => {
    const warmed = await startWarm();

    warmed.mock.api.sync.filters.warm(new pixi.AlphaFilter()).catch(() => undefined);
    warmed.frame();

    const target = warmed.mock.ctx.state.sync.warm.objects?.target;

    if (target === undefined) throw new Error("no probe tree after a warm frame");

    // What drawing leaves behind in Pixi: a cached batch bind group over the target.
    pixi.getTextureBatchBindGroup([target.source], 1, 16);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    running.splice(0);
    warmed.mock.stop();
    await settle();

    expect(target.destroyed).toBe(true);
    expect(
      warn.mock.calls.filter(call => call.some(part => String(part).includes("[BindGroup]")))
    ).toEqual([]);
  });
});

/**
 * A renderer past its content probes, with a named filter handed over with its quad.
 *
 * @param options - As `startWarm`.
 * @param options.kind - The backend.
 * @returns The renderer, and the answer of the hand-over.
 */
async function handed(
  options: { kind?: "webgpu" | "webgl" } = {}
): Promise<{ warmed: Warmed; answer: { answer: boolean | undefined }; content: number }> {
  const warmed = await startWarm(options);
  const filter = new pixi.AlphaFilter();
  const content = options.kind === "webgl" ? CONTENT.length : CONTENT.length * VARIANTS.length;

  warmed.frames(content);
  warmed.name(filter, "probe");

  return {
    warmed,
    content,
    answer: watchAnswer(warmed.mock.api.sync.filters.warm(filter, quadOfFilter("kind.quad")))
  };
}

describe("the warm-up of a filter's quad", () => {
  // Bug: a pipeline compiled in play, in the first frame of a view on its shader.
  it("draws the quad after its filter in one frame, on two targets, and the promise answers after that frame", async () => {
    const { warmed, answer, content } = await handed();

    warmed.frames(4);
    await settle();

    expect(answer.answer).toBeUndefined();

    warmed.frame();
    await settle();

    expect(answer.answer).toBe(true);
    expect(warmed.probes().slice(content)).toEqual([
      ...inFour("probe"),
      "quad canvas",
      "quad plain"
    ]);
    expect(warmed.stage.last().renderer.gpu?.scopes).toEqual({
      opened: ["validation", "validation"],
      open: 0
    });
  });

  // Bug: the first frame of a glow under a filter compiles in play: the target of the texture variants holds the stencil
  // of its first clip, so a draw there hits the pipeline of the canvas.
  it("the plain draw goes into a texture of its own, which no clip draws into, and the tree destroys it", async () => {
    const { warmed, content } = await handed();

    warmed.frames(5);

    const { warm } = warmed.mock.ctx.state.sync;
    const plain = warm.objects?.plain as pixi.RenderTexture;
    const target = warm.objects?.target as pixi.RenderTexture;

    expect(plain).not.toBe(target);
    expect(warmed.probes().slice(content).at(-1)).toBe("quad plain");
    expect(
      warmed.probes().filter(probe => probe.includes("plain") && probe.includes("+clip"))
    ).toEqual([]);

    warmed.mock.modules.sync.forget();
    warmed.mock.modules.sync.rebuildAll();

    expect(plain.destroyed).toBe(true);
  });

  // Bug: 16 quads make 16 warm frames more, over the line of the A26.
  it("the plain draw asks for no frame of its own, at any budget", async () => {
    const warmed = await startWarm({ config: { warm: 2 } });
    const filter = new pixi.AlphaFilter();

    warmed.frames(Math.ceil((CONTENT.length * VARIANTS.length) / 2));
    warmed.name(filter, "probe");

    const before = warmed.probes().length;

    const answer = watchAnswer(
      warmed.mock.api.sync.filters.warm(filter, quadOfFilter("kind.quad"))
    );
    const frames = warmed.frames(3);

    await settle();

    expect(answer.answer).toBe(true);
    expect(warmed.probes().slice(before).slice(-2)).toEqual(["quad canvas", "quad plain"]);
    expect(frames).toBe(3);
    expect(warmed.frame()).toBe(false);
  });

  // Bug: a GPU program on WebGL: a probe that logs a warning, or a throw that ends the warm-up.
  it("WebGL draws the filter alone", async () => {
    const { warmed, answer, content } = await handed({ kind: "webgl" });

    warmed.frames(1);
    await settle();

    expect(answer.answer).toBe(true);
    expect(warmed.probes().slice(content)).toEqual(["probe canvas"]);
  });

  // Bug: the pipeline hangs off a geometry another module destroys, and a lost device abandons the whole warm-up.
  it("draws on a geometry of its own, destroyed with the probe tree and with no shader left behind", async () => {
    const { warmed } = await handed();

    warmed.frames(8);

    const { warm } = warmed.mock.ctx.state.sync;
    const probe = warm.objects?.quad;

    expect(probe?.shader).toBeUndefined();
    expect(probe?.mesh.geometry).toBe(probe?.geometry);
    expect(probe?.mesh.geometry).not.toBe(warmed.mock.ctx.state.kept.quadGeometry);

    const geometry = vi.spyOn(probe?.geometry as pixi.MeshGeometry, "destroy");
    const mesh = vi.spyOn(probe?.mesh as pixi.Mesh, "destroy");

    warmed.mock.modules.sync.forget();
    warmed.mock.modules.sync.rebuildAll();

    expect(geometry).toHaveBeenCalledOnce();
    expect(mesh).toHaveBeenCalledOnce();
  });

  // Bug: a silent blank view: a program that fails its pipeline fails asynchronously.
  it("logs an error of the scope with the program's name, and the warm-up goes on", async () => {
    const { warmed, answer } = await handed();
    const gpu = warmed.stage.last().renderer.gpu;
    const after = new pixi.AlphaFilter();

    if (gpu === undefined) throw new Error("no device");

    gpu.scopeError = { message: "layout mismatch" };

    const next = watchAnswer(warmed.mock.api.sync.filters.warm(after));

    warmed.frames(12);
    await settle();

    expect(warmed.mock.ctx.log.error).toHaveBeenCalledWith("renderer:warm-invalid", {
      program: "kind.quad",
      message: "layout mismatch"
    });
    expect(answer.answer).toBe(true);
    expect(next.answer).toBe(true);
    expect(warmed.mock.ctx.state.sync.warm.failed).toBe(false);
  });

  // Bug: the first quad of a restored device compiles in play.
  it("is drawn again after a device restore", async () => {
    const { warmed, content } = await handed();

    warmed.frames(8);

    const first = warmed.probes().slice(content);
    const before = warmed.probes().length;

    warmed.mock.modules.sync.forget();
    warmed.mock.modules.sync.rebuildAll();
    warmed.frames(content + 8);

    expect(warmed.probes().slice(before + content)).toEqual(first);
  });

  // Bug: a program that throws leaves the scope open, and every later error lands in it.
  it("closes the scope of a draw whose render threw, and ends the warm-up as any probe", async () => {
    const { warmed, answer } = await handed();
    const { renderer } = warmed.stage.last();

    warmed.frames(4);

    const render = renderer.render;

    renderer.render = options => {
      render(options);

      if (typeof options === "object" && "label" in options) return;

      throw new Error("no pipeline");
    };
    warmed.frame();
    renderer.render = render;
    await settle();

    expect(answer.answer).toBe(false);
    expect(renderer.gpu?.scopes.open).toBe(0);
    expect(warmed.mock.ctx.state.sync.warm.quads.size).toBe(0);
    expect(warmed.mock.ctx.log.error).toHaveBeenCalledWith(
      "renderer:warm-failed",
      expect.objectContaining({ subject: "filter", variant: "canvas" })
    );
  });
});

describe("a Pixi without the pieces of the probes", () => {
  // Bug: a trimmed Pixi throws in the render phase of every frame, and nothing is drawn any more.
  it("ends the warm-up, answers false, reports it once, and the frame draws on", async () => {
    const warmed = await startWarm({ without: "ParticleContainer" });
    const answer = watchAnswer(warmed.mock.api.sync.filters.warm(new pixi.AlphaFilter()));

    expect(warmed.frame()).toBe(true);
    await settle();

    expect(answer.answer).toBe(false);
    expect(warmed.probes()).toEqual([]);
    expect(warmed.mock.log.warn).toHaveBeenCalledWith(
      "renderer:warm-failed",
      expect.objectContaining({ subject: "probes", error: expect.any(TypeError) })
    );
    expect(warmed.frames(3)).toBe(0);
    expect(warmed.mock.log.warn).toHaveBeenCalledTimes(1);
  });
});

describe("the end of a warm-up run", () => {
  // Bug: the monitor never learns when the warm-up ended, or hears a draw count of another run.
  it("tells the listeners of an agent build the draws the run made, once", async () => {
    const warmed = await startWarm();
    const heard: number[] = [];

    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    warmed.mock.modules.sync.onWarm(draws => heard.push(draws));
    warmed.frames(23);

    expect(heard).toEqual([]);

    warmed.frames(3);

    expect(heard).toEqual([24]);
  });
});
