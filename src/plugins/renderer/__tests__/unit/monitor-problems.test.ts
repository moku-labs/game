/* eslint-disable unicorn/no-null -- a log line is JSON: a problem of the whole canvas has owner and view `null`. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { Sprite, Transform } from "../../components";
import type { KeptRecord } from "../../kept/types";
import type { PerfEventLine, PerfLogLine } from "../../monitor/log-types";
import type { FilterSlot, PixiFilter } from "../../types";
import {
  FakeFilter,
  type FakeFilterSystem,
  type FakeGpuTextureSystem,
  fakeExtensions,
  WEBGPU_SYSTEM
} from "../fake-pixi";
import { type AgentRenderer, linesOf, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the problem rules of a debug build (U5), judged once a second from
// accumulators and written once per crossing: `filter-still` (a still filtered
// view the kept cache does not keep), `target-churn` (render targets made and
// dropped all the time, while idle, or right after a pool trim) and `retakes`
// (a kept view taken again and again). The fake Pixi keeps no picture, so a
// test hands the kept cache the record it would hold.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The owner of every entity these tests spawn. */
const OWNER = { kind: "plugin", name: "test" } as const;

/** A frame every 16 ms: 60 drawn frames a second. */
const FRAME_MS = 16;

/**
 * The `problem` event lines a listener got.
 *
 * @param lines - The lines.
 * @returns The problem events.
 */
function problemsIn(lines: readonly PerfLogLine[]): PerfEventLine[] {
  return linesOf(lines, "event").filter(line => line.name === "problem");
}

/**
 * Runs `work` in the render phase of every frame, before the renderer's own callback, until `stop` is called.
 *
 * @param agent - The started agent build.
 * @param work - The scripted work.
 * @returns The stop.
 */
function script(agent: AgentRenderer, work: () => void): () => void {
  const registration = { phase: "render" as const, callback: work };

  agent.mock.frames.unshift(registration);

  return () => {
    agent.mock.frames.splice(agent.mock.frames.indexOf(registration), 1);
  };
}

/**
 * Draws frames 16 ms apart from `from` ms on.
 *
 * @param agent - The started agent build.
 * @param from - The page time of the first, ms.
 * @param count - How many.
 * @param idle - True for frames under the idle cap.
 * @returns The page time of the next frame.
 */
function frames(agent: AgentRenderer, from: number, count: number, idle = false): number {
  for (let index = 0; index < count; index += 1) {
    agent.frame({ at: from + index * FRAME_MS, gapMs: FRAME_MS, idle });
  }

  return from + count * FRAME_MS;
}

/** The kept record a test hands the cache: the fields the rules read. */
type RecordFields = Pick<KeptRecord, "mode" | "quiet" | "refused" | "s1Version">;

/**
 * Puts a stand-in kept record for an entity into the kept state, in `byEntity` alone or in the list of records too.
 *
 * @param agent - The started agent build.
 * @param entity - The entity.
 * @param fields - What the record says.
 * @param listed - True to put it into the list of records, which the `retakes` rule walks.
 * @returns The record.
 */
function keptRecord(
  agent: AgentRenderer,
  entity: Entity,
  fields: Partial<RecordFields>,
  listed = false
): KeptRecord {
  const kept = agent.mock.ctx.state.kept;
  const record = {
    entity,
    mode: "live",
    quiet: 0,
    refused: 0,
    s1Version: 0,
    slots: [{ kind: "fog.blur" }],
    ...fields
  } as unknown as KeptRecord;

  kept.byEntity.set(entity, record);
  if (listed) kept.records.push(record);

  return record;
}

/**
 * Spawns a sprite with its view in `items`, its filter of kind `fog.blur` hung, and a counting filter system that
 * applies it every frame over `width` x `width` CSS px.
 *
 * @param agent - The started agent build.
 * @param width - The side of the filtered area.
 * @returns The entity and the stop of the applies.
 */
function filteredView(agent: AgentRenderer, width = 500): { entity: Entity; stop: () => void } {
  const { mock } = agent;

  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
  mock.modules.sync.pass();

  const entity = mock.world.ecs.spawn(OWNER, [
    Layer({ name: "items" }),
    Transform(),
    Sprite({ texture: "board.fog" })
  ]);
  const fog = new FakeFilter();
  const slot: FilterSlot = { filter: fog as unknown as PixiFilter, passes: 1, kind: "fog.blur" };
  const Filters = fakeExtensions.named(
    WEBGPU_SYSTEM,
    "filter"
  ) as unknown as new () => FakeFilterSystem;
  const filters = new Filters();
  const input = { frame: { width, height: width }, source: { resolution: 1 } };

  mock.modules.sync.pass();
  mock.api.sync.filters.set(entity, [slot]);

  return { entity, stop: script(agent, () => filters.applyFilter(fog, input, {}, true)) };
}

describe("filter-still", () => {
  // Bug caught: a still filtered view the budget refused to keep is filtered again in every frame and nothing says
  // so; or the problem is written once a second instead of once per crossing.
  it("opens once for a still, unkept filtered view with the budget's reason, and clears with owner and view when it stops", async () => {
    const agent = await startAgent();
    const lines = agent.listen();
    const { entity, stop } = filteredView(agent);

    keptRecord(agent, entity, { quiet: 120, refused: 4096 });

    const at = frames(agent, 0, 140);
    const label = agent.mock.ctx.state.sync.views.get(entity)?.object.label;

    expect(problemsIn(lines).map(line => line.detail)).toEqual([
      {
        rule: "filter-still",
        severity: "warn",
        owner: entity,
        view: label,
        filter: "fog.blur",
        value: 63,
        threshold: 60,
        since: 1,
        frames: 63,
        reason: "budget"
      }
    ]);

    stop();
    frames(agent, at, 70);

    expect(problemsIn(lines).map(line => line.detail)).toEqual([
      expect.objectContaining({ rule: "filter-still", reason: "budget" }),
      { rule: "filter-still", cleared: true, owner: entity, view: label }
    ]);
  });

  // Bug caught: a still view the kept policy may not keep is reported with the budget's reason, which sends the
  // reader to the wrong fix.
  it("names not-eligible when no take was refused", async () => {
    const agent = await startAgent();
    const lines = agent.listen();
    const { entity } = filteredView(agent);

    keptRecord(agent, entity, { quiet: 120, refused: 0 });
    frames(agent, 0, 70);

    expect(problemsIn(lines)[0]?.detail).toMatchObject({
      rule: "filter-still",
      reason: "not-eligible"
    });
  });

  // Bug caught: the rule fires below its line: a small filter, a view that changed, or a view whose picture is kept.
  it("stays quiet under 0.25 Mpx, for a subtree that changed, and for a kept view", async () => {
    const small = await startAgent();
    const smallLines = small.listen();

    keptRecord(small, filteredView(small, 400).entity, { quiet: 120, refused: 4096 });
    frames(small, 0, 70);

    const moving = await startAgent();
    const movingLines = moving.listen();

    keptRecord(moving, filteredView(moving).entity, { quiet: 59, refused: 4096 });
    frames(moving, 0, 70);

    const kept = await startAgent();
    const keptLines = kept.listen();

    keptRecord(kept, filteredView(kept).entity, { mode: "kept", quiet: 120 });
    frames(kept, 0, 70);

    expect([smallLines, movingLines, keptLines].map(lines => problemsIn(lines))).toEqual([
      [],
      [],
      []
    ]);
  });
});

/**
 * The counting WebGPU texture system of the application.
 *
 * @returns A new instance of it.
 */
function textureSystem(): FakeGpuTextureSystem {
  const Textures = fakeExtensions.named(
    WEBGPU_SYSTEM,
    "texture"
  ) as unknown as new () => FakeGpuTextureSystem;

  return new Textures();
}

/**
 * Makes and drops one render target in every frame.
 *
 * @param agent - The started agent build.
 * @returns The stop.
 */
function churn(agent: AgentRenderer): () => void {
  const textures = textureSystem();

  return script(agent, () => {
    const target = { uploadMethodId: "unknown", resource: null, pixelWidth: 64, pixelHeight: 64 };

    textures.initSource(target);
    textures.unload(target);
  });
}

describe("target-churn", () => {
  // Bug caught: a create and destroy loop that runs for seconds is never flagged, or flagged in its first second.
  it("opens after three seconds of churn in a row, once, and clears when it stops", async () => {
    const agent = await startAgent();
    const lines = agent.listen();
    const stop = churn(agent);
    let at = frames(agent, 0, 130);

    expect(problemsIn(lines)).toEqual([]);

    at = frames(agent, at, 130);

    expect(problemsIn(lines).map(line => line.detail)).toEqual([
      expect.objectContaining({ rule: "target-churn", reason: "rate", owner: null, threshold: 4 })
    ]);

    stop();
    frames(agent, at, 130);

    expect(problemsIn(lines).at(-1)?.detail).toEqual({
      rule: "target-churn",
      cleared: true,
      owner: null,
      view: null
    });
  });

  // Bug caught: a render target made in an idle frame (nothing should be drawn into a new target then) is not flagged.
  it("opens at once for a target made while idle", async () => {
    const agent = await startAgent();
    const lines = agent.listen();
    const textures = textureSystem();
    const stop = script(agent, () => {
      textures.initSource({
        uploadMethodId: "unknown",
        resource: null,
        pixelWidth: 8,
        pixelHeight: 8
      });
    });

    frames(agent, 0, 1, true);
    stop();
    frames(agent, FRAME_MS, 70, true);

    expect(problemsIn(lines)[0]?.detail).toMatchObject({ rule: "target-churn", reason: "idle" });
  });

  // Bug caught: a pool trim followed at once by new targets (the trim gave back what the next frame needs) is not
  // flagged; or a create long after the trim is.
  it("opens for a target made within a second after a pool trim, and not for one made later", async () => {
    const trimmed = await startAgent();
    const lines = trimmed.listen();
    const textures = textureSystem();
    const target = { uploadMethodId: "unknown", resource: null, pixelWidth: 8, pixelHeight: 8 };

    frames(trimmed, 0, 30);
    trimmed.clock.now = 480;
    for (const listener of trimmed.mock.ctx.state.host.onTrim) listener("rest", 12);
    script(trimmed, () => textures.initSource(target));
    frames(trimmed, 496, 40);

    const late = await startAgent();
    const lateLines = late.listen();
    const lateTextures = textureSystem();

    frames(late, 0, 10);
    late.clock.now = 100;
    for (const listener of late.mock.ctx.state.host.onTrim) listener("rest", 12);
    script(late, () => lateTextures.initSource(target));
    frames(late, 1200, 70);

    expect(problemsIn(lines)[0]?.detail).toMatchObject({
      rule: "target-churn",
      reason: "after-trim"
    });
    expect(problemsIn(lateLines)).toEqual([]);
  });
});

describe("retakes", () => {
  // Bug caught: a kept view retaken again and again (its subtree keeps changing) is not flagged, or its first take
  // counts as a retake.
  it("opens when a kept view is taken again three times in two seconds, with the takes per second, and clears", async () => {
    const agent = await startAgent();
    const lines = agent.listen();
    const entity = agent.mock.world.ecs.spawn(OWNER, [Transform()]);
    const record = keptRecord(agent, entity, { mode: "kept", s1Version: 1 }, true);
    let at = frames(agent, 0, 70);

    record.s1Version = 3;
    at = frames(agent, at, 70);

    expect(problemsIn(lines)).toEqual([]);

    record.s1Version = 4;
    at = frames(agent, at, 70);

    expect(problemsIn(lines).map(line => line.detail)).toEqual([
      expect.objectContaining({ rule: "retakes", owner: entity, value: 1.5, threshold: 1.5 })
    ]);

    frames(agent, at, 140);

    expect(problemsIn(lines).at(-1)?.detail).toEqual({
      rule: "retakes",
      cleared: true,
      owner: entity,
      view: null
    });
  });
});
