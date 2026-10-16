/* eslint-disable unicorn/no-null -- a frame record and a log line are JSON: "not measured" is null. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { Sprite, Transform } from "../../components";
import { recordCompile } from "../../monitor/compiles";
import type { PerfEventLine, PerfLogLine } from "../../monitor/log-types";
import type { FilterSlot, PixiFilter } from "../../types";
import {
  FakeFilter,
  FakeFilterSystem,
  type FakeGpuEncoderSystem,
  type FakeGpuTextureSystem,
  type FakeRenderTarget,
  fakeExtensions,
  WEBGPU_SYSTEM
} from "../fake-pixi";
import { type AgentRenderer, linesOf, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the telemetry of a debug build for the editor's Mission control (U3,
// U4): the detail of every render pass (owner, filter kind, draws, format,
// resolution, kept), the compile attribution and the `shader` events, the
// render targets made and dropped, the live object counts and their registry,
// the app id of the header.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeFilterSystem.onApply = undefined;
});

/** The owner of every entity these tests spawn. */
const OWNER = { kind: "plugin", name: "test" } as const;

/** What the scripted work of a frame draws with: the counting classes of the application, and its bound target. */
type Tools = {
  encoder: FakeGpuEncoderSystem;
  filters: FakeFilterSystem;
  textures: FakeGpuTextureSystem;
  bound: { renderTarget: FakeRenderTarget };
  /** The canvas target of the application. */
  canvas: FakeRenderTarget;
};

/**
 * The counting classes the host installed, made for a test: they count into the started monitor's sinks.
 *
 * @param agent - The started agent build.
 * @returns The tools.
 */
function toolsOf(agent: AgentRenderer): Tools {
  const canvas = agent.mock.pixi.last().renderer.view.renderTarget;
  const bound = { renderTarget: canvas };
  const Encoder = fakeExtensions.named(WEBGPU_SYSTEM, "encoder") as unknown as new (
    renderer: unknown
  ) => FakeGpuEncoderSystem;
  const Filters = fakeExtensions.named(
    WEBGPU_SYSTEM,
    "filter"
  ) as unknown as new () => FakeFilterSystem;
  const Textures = fakeExtensions.named(
    WEBGPU_SYSTEM,
    "texture"
  ) as unknown as new () => FakeGpuTextureSystem;

  return {
    encoder: new Encoder({ renderTarget: bound, drawn: 0 }),
    filters: new Filters(),
    textures: new Textures(),
    bound,
    canvas
  };
}

/**
 * Runs `work` in the render phase of every frame from now on, before the renderer's own frame callback, so its passes
 * and draws are the frame's.
 *
 * @param agent - The started agent build.
 * @param work - The scripted work.
 */
function script(agent: AgentRenderer, work: () => void): void {
  agent.mock.frames.unshift({ phase: "render", callback: work });
}

/**
 * Spawns a sprite with its view in the layer `items`.
 *
 * @param agent - The started agent build.
 * @returns The entity.
 */
function spawnView(agent: AgentRenderer): Entity {
  const { mock } = agent;

  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
  mock.modules.sync.pass();

  const entity = mock.world.ecs.spawn(OWNER, [
    Layer({ name: "items" }),
    Transform(),
    Sprite({ texture: "board.fog" })
  ]);

  mock.modules.sync.pass();

  return entity;
}

/**
 * Hangs a filter of a kind on an entity, through the seam effects uses.
 *
 * @param agent - The started agent build.
 * @param entity - The entity.
 * @param kind - The filter's kind id.
 * @returns The filter.
 */
function hangFilter(agent: AgentRenderer, entity: Entity, kind: string): FakeFilter {
  const filter = new FakeFilter();
  const slot: FilterSlot = { filter: filter as unknown as PixiFilter, passes: 1, kind };

  agent.mock.api.sync.filters.set(entity, [slot]);

  return filter;
}

/** A filter input of 500 x 500 CSS px at resolution 1: 0.25 Mpx. */
const INPUT = { frame: { width: 500, height: 500 }, source: { resolution: 1 } };

/**
 * One drawn frame of 30 ms of work, over the budget, then a quiet frame a second later: the spike is in the stream.
 *
 * @param agent - The started agent build.
 */
function spikeThenFlush(agent: AgentRenderer): void {
  agent.frame({ at: 0, workMs: 30 });
  agent.mock.frames.shift();
  agent.frame({ at: 1100 });
}

/**
 * The scene of the pass tests: a canvas pass of 2 draws, the fog's filter pass of 1 draw on a pooled target, and the
 * take of a kept picture of 3 draws on a 2x rgba8 target.
 *
 * @param agent - The started agent build.
 * @param tools - The counting classes.
 * @param fog - The fog's filter.
 */
function drawScene(agent: AgentRenderer, tools: Tools, fog: FakeFilter): void {
  const { encoder, filters, bound, canvas } = tools;

  script(agent, () => {
    bound.renderTarget = canvas;
    encoder.beginRenderPass({ descriptor: {} });
    encoder.draw({});
    encoder.draw({});
    FakeFilterSystem.onApply = () => {
      bound.renderTarget = { isRoot: true, pixelWidth: 500, pixelHeight: 500 };
      encoder.beginRenderPass({ descriptor: {} });
      encoder.draw({});
    };
    filters.applyFilter(fog, INPUT, {}, true);
    FakeFilterSystem.onApply = undefined;
    bound.renderTarget = {
      isRoot: true,
      pixelWidth: 256,
      pixelHeight: 128,
      colorTexture: {
        label: "kept:Sprite#1 board.fog#1",
        source: { format: "rgba8unorm", resolution: 2 }
      }
    };
    encoder.beginRenderPass({ descriptor: {} });
    encoder.draw({});
    encoder.draw({});
    encoder.draw({});
  });
}

describe("the detail of a render pass", () => {
  // Bug caught: the owner or the kind of a filter pass is not written, so Mission control cannot say which view's
  // filter a pass belongs to.
  it("carries the entity of the filtered view, its view's label and its kind, in the ring and in a spike", async () => {
    const agent = await startAgent();
    const lines = agent.listen();
    const tools = toolsOf(agent);
    const entity = spawnView(agent);
    const fog = hangFilter(agent, entity, "fog.blur");

    drawScene(agent, tools, fog);
    spikeThenFlush(agent);

    const { passes, kindNames } = agent.mock.api.monitor.frames();
    const kind2 = passes.kind2[1] ?? 0;

    expect(passes.owner[1]).toBe(entity);
    expect(kindNames[kind2 - 1]).toBe("fog.blur");
    expect([passes.owner[0], passes.kind2[0], passes.owner[2], passes.kind2[2]]).toEqual([
      0, 0, 0, 0
    ]);
    expect(linesOf(lines, "spike")[0]?.passes[1]).toMatchObject({
      kind: "filter",
      owner: entity,
      view: agent.mock.ctx.state.sync.views.get(entity)?.object.label,
      filter: "fog.blur"
    });
  });

  // Bug caught: the draw snapshot is taken after the pass's own draws, or the last pass misses the frame's total, so
  // the draws of the passes do not add up to the frame's.
  it("splits the draws of the frame over its passes: they add up to the frame's draws", async () => {
    const agent = await startAgent();
    const lines = agent.listen();
    const tools = toolsOf(agent);
    const fog = hangFilter(agent, spawnView(agent), "fog.blur");

    drawScene(agent, tools, fog);
    spikeThenFlush(agent);

    const spike = linesOf(lines, "spike")[0];

    expect(spike?.passes.map(pass => pass.draws)).toEqual([2, 1, 3]);
    expect(spike?.frame.draws).toBe(6);
  });

  // Bug caught: the label prefix of a kept take is not read, or the target's source is not, so a picture's take looks
  // like any texture pass and its memory format is unknown.
  it("says kept for the take of a kept picture, with its target's format and resolution", async () => {
    const agent = await startAgent();
    const lines = agent.listen();
    const tools = toolsOf(agent);
    const fog = hangFilter(agent, spawnView(agent), "fog.blur");

    drawScene(agent, tools, fog);
    spikeThenFlush(agent);

    const passes = linesOf(lines, "spike")[0]?.passes ?? [];

    expect(passes.map(pass => pass.kept)).toEqual([false, false, true]);
    expect(passes[2]).toMatchObject({ format: "rgba8unorm", resolution: 2 });
    expect(passes[0]).toMatchObject({ format: null, resolution: null });
  });
});

/**
 * Compiles one pipeline inside the fog's filter apply and one of a plain batch, in the first drawn frame, and a third
 * in the second frame.
 *
 * @param agent - The started agent build.
 * @param fog - The fog's filter.
 */
function compileScene(agent: AgentRenderer, fog: FakeFilter): void {
  const { filters } = toolsOf(agent);
  const { sinks } = agent.pc;

  script(agent, () => {
    FakeFilterSystem.onApply = () =>
      recordCompile(sinks, agent.pc.perf.frame, "PIXI Pipeline (blur)", 4.2);
    filters.applyFilter(fog, INPUT, {}, true);
    FakeFilterSystem.onApply = undefined;
    recordCompile(sinks, agent.pc.perf.frame, "PIXI Pipeline (batch)", 1.5);
  });
  agent.frame({ at: 0 });
  agent.mock.frames.shift();
  script(agent, () => recordCompile(sinks, agent.pc.perf.frame, "PIXI Pipeline (graphics)", 0.5));
  agent.frame({ at: 8 });
  agent.mock.frames.shift();
  agent.frame({ at: 1100 });
}

/**
 * The `shader` event lines a listener got.
 *
 * @param lines - The lines.
 * @returns The shader events.
 */
function shadersIn(lines: readonly PerfLogLine[]): PerfEventLine[] {
  return linesOf(lines, "event").filter(line => line.name === "shader");
}

describe("the shader events", () => {
  // Bug caught: a compile inside a filter apply is not tied to the filter's entity, or a plain batch's compile is
  // given an owner it does not have.
  it("ties a compile inside a filter apply to its owner and view, and gives a plain batch's none", async () => {
    const agent = await startAgent();
    const lines = agent.listen();
    const entity = spawnView(agent);

    compileScene(agent, hangFilter(agent, entity, "fog.blur"));

    const [blur, batch] = shadersIn(lines);

    expect(blur?.detail).toMatchObject({
      what: "compile",
      label: "PIXI Pipeline (blur)",
      ms: 4.2,
      during: {
        filter: "fog.blur",
        owner: entity,
        view: agent.mock.ctx.state.sync.views.get(entity)?.object.label
      }
    });
    expect(batch?.detail).toMatchObject({
      label: "PIXI Pipeline (batch)",
      during: { filter: null, owner: null, view: null }
    });
  });

  // Bug caught: the boot compiles are dropped as the old `compile` event drops them, or a record is sent twice.
  it("sends every compile once, the ones up to the first drawn frame with boot: true", async () => {
    const agent = await startAgent();
    const lines = agent.listen();

    compileScene(agent, hangFilter(agent, spawnView(agent), "fog.blur"));
    agent.frame({ at: 2200 });

    expect(shadersIn(lines).map(line => [line.detail.label, line.detail.boot])).toEqual([
      ["PIXI Pipeline (blur)", true],
      ["PIXI Pipeline (batch)", true],
      ["PIXI Pipeline (graphics)", false]
    ]);
  });
});

describe("the render targets made and dropped", () => {
  // Bug caught: every initSource of a target counts as a create (Pixi calls it again for a target it made), an image
  // counts as a target, or an unload is not counted, so churn shows where there is none or hides where there is.
  it("counts a target once when it is made and once when it is dropped, in the ring and the sample", async () => {
    const agent = await startAgent();
    const lines = agent.listen();
    const { textures } = toolsOf(agent);
    const target = { uploadMethodId: "unknown", resource: null, pixelWidth: 64, pixelHeight: 64 };
    const image = { uploadMethodId: "image", resource: {}, pixelWidth: 64, pixelHeight: 64 };

    script(agent, () => {
      textures.initSource(target);
      textures.initSource(target);
      textures.initSource(image);
      textures.unload(target);
    });
    agent.frame({ at: 0 });
    agent.mock.frames.shift();
    agent.frame({ at: 1100 });

    const { columns } = agent.mock.api.monitor.frames();

    expect([columns.targetsCreated[0], columns.targetsDestroyed[0]]).toEqual([1, 1]);
    expect(linesOf(lines, "sample")[0]?.targets).toEqual({ created: 1, destroyed: 1 });
  });
});

describe("the live object counts", () => {
  // Bug caught: a count reads another source (timers from the listeners, views from the entities), or a registered
  // count is missing from the sample.
  it("samples the entities, views, timers, frame and clock listeners and every registered count", async () => {
    const agent = await startAgent();
    const lines = agent.listen();

    spawnView(agent);
    agent.mock.world.ecs.spawn(OWNER, [Transform()]);
    agent.mock.setClockCounts(1, 3);
    agent.mock.api.monitor.counts.register("inputListeners", () => 6);
    agent.frame({ at: 0 });
    agent.frame({ at: 1100 });

    expect(linesOf(lines, "sample")[0]?.counts).toEqual({
      entities: 2,
      views: 1,
      timers: 1,
      frameListeners: agent.mock.frames.length,
      clockListeners: 3,
      inputListeners: 6
    });
    expect(agent.mock.api.stats().counts).toEqual(linesOf(lines, "sample")[0]?.counts);
  });

  // Bug caught: the table grows past its size, or a full table drops a count already registered.
  it("refuses a 17th count with the table's message, and the first 16 still read", async () => {
    const agent = await startAgent();
    const { counts } = agent.mock.api.monitor;

    for (let index = 0; index < 16; index += 1) counts.register(`count${index}`, () => index);

    expect(() => counts.register("count16", () => 16)).toThrow(
      "[game] Monitor count table is full (16).\n  Remove a registered count or raise the table size."
    );
    expect(agent.mock.api.stats().counts).toMatchObject({ count0: 0, count15: 15 });
    expect(agent.mock.api.stats().counts).not.toHaveProperty("count16");
  });

  // Bug caught: a second register of a name takes a second slot (a plugin that restarts fills the table), or the
  // remover of an old reader takes the new one off.
  it("gives a registered name its new reader in the same slot, and the old remover leaves it", async () => {
    const agent = await startAgent();
    const { counts } = agent.mock.api.monitor;
    const offOld = counts.register("sparks", () => 1);

    counts.register("sparks", () => 2);
    offOld();

    for (let index = 0; index < 15; index += 1) counts.register(`count${index}`, () => index);

    expect(agent.mock.api.stats().counts?.sparks).toBe(2);
  });

  // Bug caught: a throwing reader breaks the sample of the whole second.
  it("leaves out a reader that throws and warns once", async () => {
    const agent = await startAgent();

    agent.mock.api.monitor.counts.register("broken", () => {
      throw new Error("no pool");
    });
    agent.mock.api.stats();
    agent.mock.api.stats();

    expect(agent.mock.api.stats().counts).not.toHaveProperty("broken");
    expect(agent.mock.log.warn).toHaveBeenCalledTimes(1);
  });

  // Bug caught: the registry keeps a count of a plugin that stopped, so a restarted app reads a dead state.
  it("drops every registered count when the renderer stops", async () => {
    const agent = await startAgent();

    agent.mock.api.monitor.counts.register("inputListeners", () => 6);
    agent.mock.stop();

    expect(agent.mock.api.stats().counts).not.toHaveProperty("inputListeners");
  });

  // Bug caught: the registry keeps counts in a release build, or stats() of a release build grows a field.
  it("keeps nothing and refuses nothing without the agent flag", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", false);
    const { createMockRenderer } = await import("../mock-renderer");
    const mock = createMockRenderer();

    await mock.start();

    for (let index = 0; index < 20; index += 1)
      mock.api.monitor.counts.register(`count${index}`, () => index);

    expect(mock.api.stats()).not.toHaveProperty("counts");
  });
});

describe("the header's app id", () => {
  // Bug caught: the build's app id never reaches the header, so the editor cannot pair a phone's stream with its
  // project.
  it("carries __MOKU_GAME_APP__, and null on a page without one", async () => {
    vi.stubGlobal("__MOKU_GAME_APP__", "com.mokulabs.timber.debug");
    const agent = await startAgent();

    expect(linesOf(agent.listen(), "header")[0]?.app).toEqual({ id: "com.mokulabs.timber.debug" });

    vi.stubGlobal("__MOKU_GAME_APP__", undefined);

    expect(linesOf(agent.listen(), "header")[0]?.app).toEqual({ id: null });
  });
});
