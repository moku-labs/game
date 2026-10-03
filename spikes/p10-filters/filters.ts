// Spike P10. The planned filter model: plain descriptors on an entity, one Filter instance per
// descriptor kept by the renderer's sync, numeric uniforms written every frame, custom WGSL-only
// filters through defineFilter, a dev budget warning.

import { AlphaFilter, BlurFilter, ColorMatrixFilter, type Container, Filter, GpuProgram, NoiseFilter, UniformGroup } from "pixi.js";
import { DropShadowFilter, GlowFilter, OutlineFilter } from "pixi-filters";

/** A WGSL uniform type the spike supports. Pixi lays them out with WGSL alignment rules. */
export type UniformType = "f32" | "vec2<f32>" | "vec3<f32>" | "vec4<f32>";

export type UniformSpec = { type: UniformType; value: number | number[] };

export type FilterDef = {
  /** WGSL that defines `fn mainFragment(@location(0) uv: vec2<f32>, @builtin(position) position: vec4<f32>) -> @location(0) vec4<f32>`. */
  wgsl: string;
  uniforms: Record<string, UniformSpec>;
  padding?: number;
};

/** A descriptor as it sits in the `Filters` component. Numbers only, besides `kind`. */
export type Descriptor = { kind: string } & Record<string, number | number[] | string>;

// The header every custom filter shares. It is the same header Pixi's own filters inline:
// group 0 = global filter uniforms + input texture + sampler (set by FilterSystem),
// group 1 binding 0 = the filter's own uniform struct.
const HEADER = /* wgsl */ `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32> {
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

fn filterTextureCoord(aPosition: vec2<f32>) -> vec2<f32> {
  return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  return VSOutput(filterVertexPosition(aPosition), filterTextureCoord(aPosition));
}
`;

export const HEADER_FOR_TEST = HEADER;

const registry = new Map<string, (d: Descriptor) => Filter>();
const writers = new Map<string, (f: Filter, d: Descriptor) => void>();

/** The engine's planned API. The uniform struct is generated from `uniforms`, so the WGSL and the layout cannot drift. */
export function defineFilter(id: string, def: FilterDef) {
  const names = Object.keys(def.uniforms);
  const struct = `struct FilterUniforms {\n${names.map(n => `  ${n}: ${(def.uniforms[n] as UniformSpec).type},`).join("\n")}\n};\n@group(1) @binding(0) var<uniform> fu: FilterUniforms;\n`;
  const source = `${HEADER}\n${struct}\n${def.wgsl}`;
  // One GpuProgram per id. GpuProgram.from also caches by source.
  const gpuProgram = GpuProgram.from({
    name: `filter-${id}`,
    vertex: { source, entryPoint: "mainVertex" },
    fragment: { source, entryPoint: "mainFragment" }
  });

  registry.set(id, d => {
    const structure: Record<string, { type: UniformType; value: number | Float32Array }> = {};
    for (const n of names) {
      const spec = def.uniforms[n] as UniformSpec;
      structure[n] = { type: spec.type, value: Array.isArray(spec.value) ? new Float32Array(spec.value) : spec.value };
    }
    const filter = new Filter({
      gpuProgram, // no glProgram: compatibleRenderers becomes WEBGPU only
      resources: { fu: new UniformGroup(structure) },
      padding: def.padding ?? 0
    });
    writeCustom(filter, d, names);
    return filter;
  });
  writers.set(id, (f, d) => writeCustom(f, d, names));
}

// The per-frame write: plain property writes on the uniform object, vectors copied in place. No allocation.
function writeCustom(filter: Filter, d: Descriptor, names: string[]) {
  const u = (filter.resources.fu as UniformGroup).uniforms as Record<string, number | Float32Array>;
  for (const n of names) {
    const v = d[n];
    if (v === undefined) continue;
    if (typeof v === "number") u[n] = v;
    else if (Array.isArray(v)) (u[n] as Float32Array).set(v);
  }
}

// Built-in kinds map onto Pixi core and pixi-filters classes. Their numeric fields are setters.
const builtIns: Record<string, (d: Descriptor) => Filter> = {
  alpha: d => new AlphaFilter({ alpha: (d.alpha as number) ?? 0.5 }),
  blur: d => new BlurFilter({ strength: (d.strength as number) ?? 8, quality: (d.quality as number) ?? 4 }),
  colorMatrix: () => {
    const f = new ColorMatrixFilter();
    f.greyscale(0.5, false);
    return f;
  },
  noise: d => new NoiseFilter({ noise: (d.noise as number) ?? 0.5, seed: 0.5 }),
  pfGlow: d => new GlowFilter({ distance: (d.distance as number) ?? 10, outerStrength: (d.strength as number) ?? 2, color: 0xffcc00 }),
  pfOutline: d => new OutlineFilter({ thickness: (d.thickness as number) ?? 4, color: 0x00ff88 }),
  pfDropShadow: () => new DropShadowFilter({ offset: { x: 8, y: 8 }, blur: 4 })
};

const builtInWrite: Record<string, (f: Filter, d: Descriptor) => void> = {
  alpha: (f, d) => void ((f as AlphaFilter).alpha = d.alpha as number),
  blur: (f, d) => void ((f as BlurFilter).strength = d.strength as number),
  pfGlow: (f, d) => void ((f as GlowFilter).outerStrength = d.strength as number)
};

export function createFilter(d: Descriptor): Filter {
  const make = registry.get(d.kind) ?? builtIns[d.kind];
  if (!make) throw new Error(`unknown filter kind ${d.kind}`);
  return make(d);
}

export function writeFilter(f: Filter, d: Descriptor) {
  (writers.get(d.kind) ?? builtInWrite[d.kind])?.(f, d);
}

/** What the renderer keeps per view: the filter instances by slot, and the array Pixi holds. */
export type FilterSlot = { kinds: string[]; instances: Filter[] };

export const stats = { assigns: 0, created: 0, budgetWarnings: 0, freeBuffers: false };

/** Filter.destroy() leaves the UniformGroup GPU buffers to Pixi's GC. This frees them now. */
export function disposeFilter(f: Filter) {
  if (stats.freeBuffers) {
    const visit = (x: Filter) => {
      const res = x.resources as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(res)) {
        const r = res[name] as UniformGroup | undefined;
        if (r?.isUniformGroup) r.buffer?.destroy();
      }
    };
    visit(f);
    const blur = f as unknown as { blurXFilter?: Filter; blurYFilter?: Filter };
    if (blur.blurXFilter) visit(blur.blurXFilter);
    if (blur.blurYFilter) visit(blur.blurYFilter);
  }
  f.destroy();
}
export const BUDGET = { filteredViews: 8 };

/**
 * The planned `sync` step for one view. Keeps one instance per descriptor slot, reassigns
 * `view.filters` only when the list of kinds changed, and writes uniforms every frame.
 */
export function syncFilters(view: Container, slot: FilterSlot, list: readonly Descriptor[]) {
  let changed = list.length !== slot.kinds.length;
  for (let i = 0; i < list.length; i++) {
    const d = list[i] as Descriptor;
    if (slot.kinds[i] !== d.kind) {
      changed = true;
      if (slot.instances[i]) disposeFilter(slot.instances[i] as Filter);
      slot.instances[i] = createFilter(d);
      slot.kinds[i] = d.kind;
      stats.created++;
    } else writeFilter(slot.instances[i] as Filter, d);
  }
  for (let i = list.length; i < slot.instances.length; i++) disposeFilter(slot.instances[i] as Filter);
  slot.instances.length = list.length;
  slot.kinds.length = list.length;
  if (changed) {
    view.filters = list.length === 0 ? null : slot.instances; // Pixi slices and freezes the array
    stats.assigns++;
  }
}

/** A variant that keeps instances per kind for the life of the view and never destroys on removal. */
export function syncFiltersPooled(view: Container, pool: Map<string, Filter>, current: { key: string }, list: readonly Descriptor[]) {
  let key = "";
  for (const d of list) key += `${d.kind}|`;
  const out: Filter[] = [];
  for (const d of list) {
    let f = pool.get(d.kind);
    if (!f) {
      f = createFilter(d);
      pool.set(d.kind, f);
      stats.created++;
    } else writeFilter(f, d);
    out.push(f);
  }
  if (key !== current.key) {
    view.filters = out.length === 0 ? null : out;
    current.key = key;
    stats.assigns++;
  }
}

// ---- the two custom filters the spike defines ----

defineFilter("glow", {
  padding: 16,
  uniforms: {
    uStrength: { type: "f32", value: 2 },
    uRadius: { type: "f32", value: 12 },
    uColor: { type: "vec3<f32>", value: [1, 0.8, 0.2] }
  },
  wgsl: /* wgsl */ `
const DIRS: i32 = 12;
const STEPS: i32 = 3;

@fragment
fn mainFragment(@location(0) uv: vec2<f32>, @builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let base = textureSample(uTexture, uSampler, uv);
  let px = gfu.uInputSize.zw;
  var sum = 0.0;
  for (var i = 0; i < DIRS; i++) {
    let a = f32(i) * 6.2831853 / f32(DIRS);
    let dir = vec2<f32>(cos(a), sin(a)) * px;
    for (var s = 1; s <= STEPS; s++) {
      let p = clamp(uv + dir * fu.uRadius * f32(s) / f32(STEPS), gfu.uInputClamp.xy, gfu.uInputClamp.zw);
      sum += textureSample(uTexture, uSampler, p).a;
    }
  }
  let glow = clamp(sum / f32(DIRS * STEPS) * fu.uStrength, 0.0, 1.0) * (1.0 - base.a);
  return base + vec4<f32>(fu.uColor * glow, glow);
}
`
});

defineFilter("tint", {
  uniforms: {
    uAmount: { type: "f32", value: 0.5 },
    uColor: { type: "vec3<f32>", value: [1, 0, 0] }
  },
  wgsl: /* wgsl */ `
@fragment
fn mainFragment(@location(0) uv: vec2<f32>, @builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let c = textureSample(uTexture, uSampler, uv);
  return vec4<f32>(mix(c.rgb, fu.uColor * c.a, fu.uAmount), c.a);
}
`
});
