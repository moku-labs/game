import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config, PixiContainer, PixiFilter } from "../../types";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";
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

/** The four content subjects in the order the renderer queues them. */
const CONTENT = ["sprite", "graphics", "particles-normal", "particles-add"];

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
 * What a probe root holds while it is rendered: the subject, and the target it is drawn into.
 *
 * @param root - The probe root handed to `renderer.render`.
 * @param names - The labels of handed filters.
 * @returns `"subject variant"`.
 */
function probeOf(root: pixi.Container, names: Map<unknown, string>): string {
  let node: pixi.Container | undefined = root.children[0];
  let target = "canvas";
  let clip = "";

  if (node?.label === "renderer.warm.texture") {
    target = "texture";
    node = node.children[0];
  }

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
    if (call.target !== undefined) return;

    if (call.container === stage.last().stage) {
      // The stage never holds a piece of the warm-up.
      expect(holdsProbe(call.container)).toBe(false);
      calls.push("stage");

      return;
    }

    // A probe root is never in the stage, and holds its one subject only.
    expect(call.container.parent).toBeNull();
    expect(call.container.children).toHaveLength(1);
    calls.push(probeOf(call.container, names));
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

    expect(warmed.frames(16)).toBe(16);
    expect(warmed.calls).toEqual(
      CONTENT.flatMap(subject => inFour(subject)).flatMap(probe => [probe, "stage"])
    );
    // Every one of those frames created pipelines: none is a sample of the adaptive rate.
    expect(warmed.mock.time.frameProbed).toHaveBeenCalledTimes(16);
    expect(warmed.mock.drawnCount()).toBe(16);

    // The queue is empty: a still screen drawing on demand draws nothing more.
    expect(warmed.frames(5)).toBe(0);
    expect(warmed.probes()).toHaveLength(16);
  });

  it("warm: 3 draws three probes a frame", async () => {
    const warmed = await startWarm({ config: { warm: 3 } });

    warmed.frame();

    expect(warmed.calls).toEqual([...inFour("sprite").slice(0, 3), "stage"]);
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

    expect(warmed.frames(6)).toBe(4);
    expect(warmed.probes()).toEqual(CONTENT.map(subject => `${subject} canvas`));
  });

  // Bug: on a canvas the stage pass does not clear, a probe drawn onto it stays on screen.
  it("a canvas that is not cleared before the frame gets texture variants only", async () => {
    const warmed = await startWarm();

    warmed.stage.last().renderer.background.clearBeforeRender = false;
    warmed.mock.modules.sync.forget();
    warmed.mock.modules.sync.rebuildAll();
    warmed.frames(10);

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

    warmed.frames(16);
    warmed.name(filter, "probe");

    const answer = watchAnswer(warmed.mock.api.sync.filters.warm(filter));

    warmed.frames(3);
    await settle();

    expect(answer.answer).toBeUndefined();

    warmed.frame();
    await settle();

    expect(answer.answer).toBe(true);
    expect(warmed.probes().slice(16)).toEqual(inFour("probe"));
    // Handed over again on the same device: done already.
    expect(await warmed.mock.api.sync.filters.warm(filter)).toBe(true);
    expect(warmed.probes()).toHaveLength(20);
  });

  it("the text probe is queued when the first font is installed, ahead of waiting filters", async () => {
    const warmed = await startWarm();
    const filter = new pixi.AlphaFilter();

    warmed.name(filter, "probe");
    warmed.mock.api.sync.filters.warm(filter);
    installFont(warmed);
    warmed.frames(24);

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
    warmed.frames(24);

    const first = warmed.probes();

    // What the host's restore runs: the old tree is let go, the new one built.
    warmed.mock.modules.sync.forget();
    warmed.mock.modules.sync.rebuildAll();

    const again = watchAnswer(warmed.mock.api.sync.filters.warm(filter));

    warmed.frames(24);
    await settle();

    expect(warmed.probes().slice(24)).toEqual(first);
    expect(again.answer).toBe(true);
  });

  // Bug: a broken probe stops the queue, or floods the log once per variant.
  it("a probe whose render throws is counted done and reported once", async () => {
    const warmed = await startWarm();
    const filter = new pixi.AlphaFilter();

    warmed.stage.last().renderer.watchers.unshift(call => {
      const holder = call.container.children[0];

      if (holder !== undefined && holdsFilter(holder, filter)) throw new Error("no pipeline");
    });
    warmed.frames(16);

    const answer = watchAnswer(warmed.mock.api.sync.filters.warm(filter));

    warmed.frames(4);
    await settle();

    expect(answer.answer).toBe(true);
    expect(warmed.mock.log.warn).toHaveBeenCalledTimes(1);
    expect(warmed.mock.log.warn).toHaveBeenCalledWith(
      "renderer:warm-failed",
      expect.objectContaining({ subject: "filter", variant: "canvas" })
    );
    // The queue went on: nothing left, nothing drawn on the next still frame.
    expect(warmed.frames(2)).toBe(0);
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

    const destroyAlpha = vi.spyOn(objects.probeAlpha, "destroy");

    running.splice(0);
    warmed.mock.stop();
    await settle();

    expect(answer.answer).toBe(false);
    expect(objects.root.destroyed).toBe(true);
    expect(objects.mask.destroyed).toBe(true);
    expect(destroyAlpha).toHaveBeenCalled();
    expect(destroyFilter).not.toHaveBeenCalled();
    expect(await warmed.mock.api.sync.filters.warm(filter)).toBe(false);
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
    warmed.frames(15);

    expect(heard).toEqual([]);

    warmed.frames(3);

    expect(heard).toEqual([16]);
  });
});
