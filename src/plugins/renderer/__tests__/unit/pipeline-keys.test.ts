import * as pixi from "pixi.js";
import { describe, expect, it } from "vitest";
import { NO_KEY, restKey } from "../../host/pipeline-keys";
import { createLazyCanvasClasses } from "../../host/render-pass";
import type { PixiModule } from "../../types";
import { createPassStage } from "../pass-stage";

// ---------------------------------------------------------------------------
// The pipeline lookup in front of Pixi's (item 6). Bug it guards: a front table that keys fewer fields than Pixi's
// answers one draw with another draw's pipeline (a wrong blend, topology or stencil write mask on screen), or keeps a
// pipeline across a change of the pass's global state. And a Pixi upgrade that changes the key the table copies.
// ---------------------------------------------------------------------------

const classes = createLazyCanvasClasses(pixi as unknown as PixiModule);

/** A geometry whose layout key is set, as Pixi leaves it after its first draw. */
function geometryOf(layoutKey: number, topology: pixi.Topology): pixi.Geometry {
  return {
    _layoutKey: layoutKey,
    topology,
    buffers: [],
    attributes: {},
    indexBuffer: undefined
  } as unknown as pixi.Geometry;
}

/** A program with no attribute and a layout key. */
function programOf(layoutKey: number): pixi.GpuProgram {
  return {
    _layoutKey: layoutKey,
    _attributeLocationsKey: layoutKey,
    attributeData: {},
    layout: [],
    name: `program ${layoutKey}`,
    vertex: { source: `vertex ${layoutKey}`, entryPoint: "main" },
    fragment: { source: `fragment ${layoutKey}`, entryPoint: "main" }
  } as unknown as pixi.GpuProgram;
}

/** A state with a blend mode, and depth on or off. */
function stateOf(blendMode: pixi.BLEND_MODES, depth: boolean): pixi.State {
  const state = pixi.State.for2d();

  state.blendMode = blendMode;
  state.depthTest = depth;

  return state;
}

/**
 * A source text without its comments and white space, so a reformat of Pixi's build is not a change.
 *
 * @param source - The text.
 * @returns It without white space.
 */
function flat(source: string): string {
  return source.replaceAll(/\/\*.*?\*\//g, "").replaceAll(/\s+/g, "");
}

/** One draw's request: every field Pixi's key reads, varied one at a time. */
type Request = {
  geometry: pixi.Geometry;
  program: pixi.GpuProgram;
  state: pixi.State;
  topology: pixi.Topology | undefined;
  overrides: pixi.ShaderOverrides | undefined;
};

const triangles = geometryOf(1, "triangle-list");
const BASE: Request = {
  geometry: triangles,
  program: programOf(1),
  state: stateOf("normal", false),
  topology: undefined,
  overrides: undefined
};
const REQUESTS: Request[] = [
  BASE,
  { ...BASE, geometry: geometryOf(2, "triangle-list") },
  { ...BASE, geometry: geometryOf(3, "line-list") },
  { ...BASE, program: programOf(2) },
  { ...BASE, state: stateOf("add", false) },
  { ...BASE, state: stateOf("multiply", false) },
  { ...BASE, state: stateOf("normal", true) },
  { ...BASE, topology: "triangle-strip" },
  { ...BASE, topology: "line-list" },
  { ...BASE, overrides: new pixi.ShaderOverrides({}) },
  { ...BASE, overrides: new pixi.ShaderOverrides({ strength: 2 }) },
  { ...BASE, overrides: new pixi.ShaderOverrides({ strength: 3 }) }
];

/**
 * Asks a pipeline system for a request.
 *
 * @param system - Ours, or Pixi's own method called on it.
 * @param request - The request.
 * @returns The pipeline.
 */
function ask(
  system: (...args: Parameters<pixi.PipelineSystem["getPipeline"]>) => GPURenderPipeline,
  request: Request
): GPURenderPipeline {
  return system(
    request.geometry,
    request.program,
    request.state,
    request.topology,
    request.overrides
  );
}

describe("the pipeline lookup in front of Pixi's", () => {
  it("answers every request with Pixi's own pipeline, under each stencil mode, asked twice", () => {
    const stage = createPassStage({ targets: classes.targets, pipeline: classes.pipeline });
    const system = stage.renderer.pipeline;
    const ours = system.getPipeline.bind(system);
    const pixis = pixi.PipelineSystem.prototype.getPipeline.bind(system);

    stage.open();

    for (const mode of [pixi.STENCIL_MODES.DISABLED, pixi.STENCIL_MODES.RENDERING_MASK_ADD]) {
      system.setStencilMode(mode);

      for (const request of REQUESTS) {
        const first = ask(ours, request);

        expect(ask(ours, request)).toBe(first);
        expect(ask(pixis, request)).toBe(first);
      }
    }

    // Back to the first mode: its pipelines again, not the mask's (the mask's write mask is 0).
    system.setStencilMode(pixi.STENCIL_MODES.DISABLED);
    for (const request of REQUESTS) expect(ask(ours, request)).toBe(ask(pixis, request));

    stage.close();
  });

  it("tells apart exactly the requests Pixi's key tells apart", () => {
    const stage = createPassStage({ targets: classes.targets, pipeline: classes.pipeline });
    const ours = new Set<GPURenderPipeline>();
    const pixiKeys = new Set<number>();

    stage.open();
    for (const request of REQUESTS) {
      ours.add(ask(stage.renderer.pipeline.getPipeline.bind(stage.renderer.pipeline), request));
      pixiKeys.add(
        stage.renderer.pipeline.getPipelineKey(
          request.geometry,
          request.program,
          request.state,
          request.topology ?? request.geometry.topology,
          request.overrides ?? new pixi.ShaderOverrides({})
        )
      );
    }
    stage.close();

    expect(ours.size).toBe(pixiKeys.size);
  });

  // Fails on a Pixi upgrade that changes what the table copies: then read the new `getPipeline` and `_updatePipeHash`,
  // change `pipeline-keys.ts` to match, and record the new text here.
  it("copies Pixi 8.22's key: the source of getPipeline and of the pipe cache swap", () => {
    const proto = pixi.PipelineSystem.prototype as unknown as Record<string, () => void>;

    expect(flat(String(proto.getPipeline))).toBe(
      flat(`getPipeline(geometry, program, state, topology, overrides) {
        if (!geometry._layoutKey) {
          ensureAttributes(geometry, program.attributeData);
          this._generateBufferKey(geometry);
        }
        topology || (topology = geometry.topology);
        overrides || (overrides = emptyOverrides);
        const key = getGraphicsStateKey(
          geometry._layoutKey,
          program._layoutKey,
          state.data,
          state._blendModeId,
          topologyStringToId[topology],
          overrides.id
        );
        let pipeline = this._pipeCache.get(key);
        if (!pipeline) {
          pipeline = this._createPipeline(geometry, program, state, topology, overrides);
          this._pipeCache.set(key, pipeline);
        }
        return pipeline;
      }`)
    );
    expect(flat(String(proto._updatePipeHash))).toContain(
      "this._pipeCache=(_a=this._pipeStateCaches)[key]??(_a[key]=newMap"
    );
  });
});

describe("restKey", () => {
  it("packs the fields as Pixi does, an absent overrides in a slot of its own", () => {
    expect(restKey(0, 0, "triangle-list", undefined)).toBe(3);
    expect(restKey(0, 1, "triangle-list", 0)).toBe(16_395);
    expect(restKey(63, 31, "triangle-strip", 65_534)).toBe(
      65_535 * 16_384 + (63 << 8) + (31 << 3) + 4
    );
  });

  it("answers NO_KEY for a field the packing cannot hold", () => {
    expect(restKey(64, 0, "triangle-list", undefined)).toBe(NO_KEY);
    expect(restKey(0, 32, "triangle-list", undefined)).toBe(NO_KEY);
    expect(restKey(0, 0, "quad-list", undefined)).toBe(NO_KEY);
    expect(restKey(0, 0, "triangle-list", 65_535)).toBe(NO_KEY);
  });
});
