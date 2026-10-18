/**
 * @file effects/filters — the only file that builds, writes and destroys Pixi filters. Ours: a
 * `Filter` over a `GpuProgram` of the assembled WGSL and a `GlProgram` of the assembled GLSL, with
 * one `UniformGroup` both read. The Pixi-core kinds: their own class, written through their setters
 * when a field differs from what they were last given. Every kind but `Blur` renders at
 * `resolution: "inherit"`, the resolution of the canvas, so a filtered view stays sharp on DPR 2-3
 * (decision 32), unless its value (`Alpha`) or its definition (`defineFilter`) gives a resolution of
 * its own. An `Alpha` at 1 drawn at the canvas's is switched off: it would copy the view unchanged
 * through a pass. Every write compares first: a value the filter holds already writes nothing and
 * asks the renderer for no frame. A destroy frees the uniform buffers first: `Filter.destroy()`
 * leaves them to a GC that runs after a minute (P10). A filter with inputs draws each place of its
 * chains through Pixi's public `applyFilter` from inside its own `apply`, into pooled textures given
 * back in a `finally`; a stand-in draws in place of a broken kind or instance.
 */
import type { PixiFilter, PixiFilterManager, PixiModule, PixiTexture } from "../../renderer/types";
import type { EffectsCtx } from "../types";
import { breakInstance, drawBroken, guardApply, messageOf } from "./guard";
import { brokenMark } from "./mark";
import type {
  CoreKind,
  FilterBody,
  FilterDefinition,
  FilterField,
  FilterFields,
  FilterInputDefinition,
  FilterInstance,
  FilterKind,
  FilterStage,
  FilterStep,
  InputsState,
  OursBody,
  Place,
  UniformSpec,
  UniformValues
} from "./types";

/**
 * The resolution of every filter but `Blur`: the render target's, so a filter draws at the
 * resolution of the canvas. Pixi's default of 1 would draw it at half the pixels on DPR 2.
 */
const CANVAS_RESOLUTION = "inherit";

/** One uniform as a `UniformGroup` takes it. */
type UniformStructure = { value: number | Float32Array; type: UniformSpec["type"] };

/** A GPU resource that holds a buffer of its own: a uniform group once Pixi uploaded it. */
type BufferedResource = { uniforms: object; buffer: { destroy(): void } };

/** An instance of a Pixi-core kind: the one with an `applied` copy of its fields. */
type CoreInstance = Exclude<FilterInstance, { kind: "wgsl" }>;

/** An instance of ours. */
type OursInstance = Extract<FilterInstance, { kind: "wgsl" }>;

/** The output of an `apply`. */
type Output = Parameters<PixiFilter["apply"]>[2];

/** The most steps one chain may return. */
const MAX_STEPS = 16;

/** The value a probe of the warm-up starts its uniforms at: every uniform 0. */
const PROBE_VALUE: Readonly<FilterFields> = Object.freeze({ enabled: true, order: 0 });

/** The numbers of a vector field that holds none. */
const NO_NUMBERS: readonly number[] = Object.freeze([]);

/**
 * The resolution Pixi is given for a resolution of a value or a definition: the number, or the canvas's for 0 (or
 * less, or not a number).
 *
 * @param resolution - Texels per CSS px; 0 for the canvas's.
 * @returns What a filter's `resolution` takes.
 * @example
 * ```ts
 * resolutionOf(0); // "inherit"
 * ```
 */
function resolutionOf(resolution: number): number | typeof CANVAS_RESOLUTION {
  return resolution > 0 ? resolution : CANVAS_RESOLUTION;
}

/**
 * Tells whether two numbers are the same value for the GPU: equal, or both NaN.
 *
 * @param a - One number.
 * @param b - The other.
 * @returns True when writing `b` over `a` changes nothing.
 * @example
 * ```ts
 * same(0.6, 0.6); // true
 * ```
 */
function same(a: number, b: number): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

/**
 * A number field of a stored filter value.
 *
 * @param value - The stored value.
 * @param name - The field.
 * @returns Its number, or 0 when it holds none.
 * @example
 * ```ts
 * numberOf({ enabled: true, order: 0, amount: 0.5 }, "amount"); // 0.5
 * ```
 */
function numberOf(value: Readonly<FilterFields>, name: string): number {
  const field = value[name];

  return typeof field === "number" ? field : 0;
}

/**
 * A vector field of a stored filter value.
 *
 * @param value - The stored value.
 * @param name - The field.
 * @returns Its numbers, or none.
 * @example
 * ```ts
 * vectorOf({ enabled: true, order: 0, offset: [2, 3] }, "offset"); // [2, 3]
 * ```
 */
function vectorOf(value: Readonly<FilterFields>, name: string): readonly number[] {
  const field = value[name];

  return Array.isArray(field) ? field : [];
}

/**
 * Compares one element of a vector with a number as the vector stores it, rounded to float32,
 * and writes it when it differs and `write` asks for it.
 *
 * @param target - The vector.
 * @param index - The element.
 * @param next - The number.
 * @param write - False to compare only.
 * @returns True when the element differs.
 */
function writeAt(target: Float32Array, index: number, next: number, write: boolean): boolean {
  const rounded = Math.fround(next);
  const held = target[index];

  if (held !== undefined && same(held, rounded)) return false;
  if (write) target[index] = rounded;

  return true;
}

/**
 * Writes the three channels of a `0xrrggbb` colour into a vector, 0..1 each, where they differ.
 *
 * @param target - The `vec3<f32>` of the uniform.
 * @param hex - The colour.
 * @param write - False to compare only.
 * @returns True when a channel differs.
 */
function writeColor(target: Float32Array, hex: number, write = true): boolean {
  const red = writeAt(target, 0, ((hex >> 16) & 0xff) / 255, write);
  const green = writeAt(target, 1, ((hex >> 8) & 0xff) / 255, write);
  const blue = writeAt(target, 2, (hex & 0xff) / 255, write);

  return red || green || blue;
}

/**
 * The value a uniform group starts a uniform at.
 *
 * @param uniform - The uniform.
 * @param value - The stored filter value.
 * @returns A number for an `f32`, a vector for the rest.
 */
function startValue(uniform: UniformSpec, value: Readonly<FilterFields>): number | Float32Array {
  if (uniform.form === "number") return numberOf(value, uniform.name);

  const vector = new Float32Array(uniform.size);

  if (uniform.form === "color") writeColor(vector, numberOf(value, uniform.name));
  else vector.set(vectorOf(value, uniform.name).slice(0, uniform.size));

  return vector;
}

/**
 * The padding of an instance of ours: a fixed number, or the live value of a number uniform.
 *
 * @param definition - The filter definition.
 * @param value - The stored filter value.
 * @returns Pixels.
 */
function paddingOf(definition: FilterDefinition, value: Readonly<FilterFields>): number {
  return typeof definition.padding === "number"
    ? definition.padding
    : numberOf(value, definition.padding);
}

/**
 * Builds an instance of ours with both programs; Pixi draws the one of the running backend. The
 * one uniform group binds as `fu` on WebGPU and by bare uniform name on WebGL, where the GLSL
 * header declares each name. `GpuProgram.from` and `GlProgram.from` cache by source, so every
 * view of a kind shares its programs.
 *
 * @param pixi - The module the renderer loaded.
 * @param definition - The filter definition.
 * @param value - The stored filter value.
 * @returns The Pixi object and its passes.
 */
function createOurs(
  pixi: PixiModule,
  definition: FilterDefinition,
  value: Readonly<FilterFields>
): OursBody {
  const { source } = definition;
  const gpuProgram = pixi.GpuProgram.from({
    name: definition.id,
    vertex: { source, entryPoint: "mainVertex" },
    fragment: { source, entryPoint: "mainFragment" }
  });
  const glProgram = pixi.GlProgram.from({
    name: definition.id,
    vertex: pixi.defaultFilterVert,
    fragment: definition.glsl
  });
  const structures: Record<string, UniformStructure> = {};

  for (const uniform of definition.uniforms) {
    structures[uniform.name] = { value: startValue(uniform, value), type: uniform.type };
  }

  // The engine's two uniforms per input, filled by every apply from the texture it binds.
  for (const input of definition.inputs) {
    structures[input.scale.name] = {
      value: new Float32Array(input.scale.size),
      type: input.scale.type
    };
    structures[input.clamp.name] = {
      value: new Float32Array(input.clamp.size),
      type: input.clamp.type
    };
  }

  // The canvas origin of a kept picture for `canvasPixel`: 0 drawn live, written in place by the renderer (spec 23).
  if (definition.origin !== undefined) {
    structures[definition.origin.name] = {
      value: new Float32Array(definition.origin.size),
      type: definition.origin.type
    };
  }

  // A group only for a filter that binds a uniform of its own: a declared one, an input's or the canvas origin.
  const bindsUniforms =
    definition.uniforms.length > 0 ||
    definition.inputs.length > 0 ||
    definition.origin !== undefined;
  const group = bindsUniforms ? new pixi.UniformGroup(structures) : undefined;
  const resources: Record<string, unknown> = group === undefined ? {} : { fu: group };
  const empty = pixi.Texture.EMPTY.source;

  // Each input's texture and sampler are bound before the first apply, so Pixi can build the groups.
  for (const input of definition.inputs) {
    resources[input.texture] = empty;
    resources[input.sampler] = empty.style;
  }

  const filter = new pixi.Filter({
    gpuProgram,
    glProgram,
    resources,
    padding: paddingOf(definition, value),
    resolution: resolutionOf(definition.resolution)
  });

  return {
    kind: "wgsl",
    filter,
    group,
    definition,
    passes: definition.passes,
    inputs: undefined,
    mark: undefined,
    area: { x: 0, y: 0, width: 0, height: 0, some: false },
    areaStale: false
  };
}

/**
 * The quality a `Blur` draws at: its own, or `config.blur.quality` for 0.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param value - The stored `Blur` value.
 * @returns Passes per axis.
 */
function blurQuality(ectx: EffectsCtx, value: Readonly<FilterFields>): number {
  const quality = numberOf(value, "quality");

  return quality > 0 ? quality : ectx.config.blur.quality;
}

/**
 * The resolution a `Blur` draws at: its own, or for 0 `config.blur.phoneResolution` on a phone
 * and 1 elsewhere.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param value - The stored `Blur` value.
 * @returns The resolution of the pass textures.
 */
function blurResolution(ectx: EffectsCtx, value: Readonly<FilterFields>): number {
  const resolution = numberOf(value, "resolution");

  if (resolution > 0) return resolution;

  return ectx.state.phone ? ectx.config.blur.phoneResolution : 1;
}

/**
 * The `enabled` switch of a filter for a stored value: the value's own, but off for an `Alpha` at 1 drawn at the
 * canvas's resolution, which would copy the view unchanged through a pass of its own.
 *
 * @param kind - The kind of the instance.
 * @param value - The stored filter value.
 * @returns True when Pixi is to draw the filter.
 * @example
 * ```ts
 * switchOf("alpha", { enabled: true, order: 0, alpha: 1, resolution: 0 }); // false
 * ```
 */
function switchOf(kind: FilterBody["kind"], value: Readonly<FilterFields>): boolean {
  if (!value.enabled || kind !== "alpha") return value.enabled;

  const { alpha, resolution } = value;

  return alpha !== 1 || (typeof resolution === "number" && resolution > 0);
}

/**
 * Composes a colour matrix from the identity: brightness, saturation, contrast, hue, and the
 * grayscale as a negative saturation. `ColorMatrixFilter` multiplies, so it starts from `reset()`.
 *
 * @param filter - The colour matrix filter.
 * @param value - The stored `ColorMatrix` value.
 */
function composeMatrix(
  filter: InstanceType<PixiModule["ColorMatrixFilter"]>,
  value: Readonly<FilterFields>
): void {
  const grayscale = numberOf(value, "grayscale");

  filter.reset();
  filter.brightness(numberOf(value, "brightness"), true);
  filter.saturate(numberOf(value, "saturation"), true);
  filter.contrast(numberOf(value, "contrast"), true);
  filter.hue(numberOf(value, "hue"), true);

  if (grayscale > 0) filter.saturate(-grayscale, true);
}

/**
 * The texture of a `Displacement` map, warning once per key that is not loaded. An empty key is
 * a map not chosen yet: no texture and no warning.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param key - The asset key.
 * @returns The texture, or `undefined`.
 */
function mapTexture(
  ectx: EffectsCtx,
  key: string
): ReturnType<EffectsCtx["deps"]["assets"]["texture"]> {
  if (key === "") return undefined;

  const texture = ectx.deps.assets.texture(key);

  if (texture === undefined && !ectx.state.warned.has(`texture:${key}`)) {
    ectx.state.warned.add(`texture:${key}`);
    ectx.log.warn("effects:missing-texture", { key });
  }

  return texture;
}

/**
 * The fields a core kind's setters are given: a copy of the stored value without `enabled` and
 * `order`, and its keys, listed once.
 *
 * @param value - The stored filter value.
 * @returns A fresh record, kept by the instance as `applied`, and its keys as `fields`.
 * @example
 * ```ts
 * appliedOf({ enabled: true, order: 2, alpha: 0.4 }); // { applied: { alpha: 0.4 }, fields: ["alpha"] }
 * ```
 */
function appliedOf(value: Readonly<FilterFields>): {
  applied: Record<string, FilterField>;
  fields: string[];
} {
  const applied: Record<string, FilterField> = {};
  const fields: string[] = [];

  for (const field of Object.keys(value)) {
    const held = value[field];

    if (field !== "enabled" && field !== "order" && held !== undefined) {
      applied[field] = held;
      fields.push(field);
    }
  }

  return { applied, fields };
}

/**
 * Builds a `Displacement` over a map sprite the instance owns.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param value - The stored `Displacement` value.
 * @param probeMap - The map of a warm-up probe instead of the value's key: the program does not depend on it.
 * @returns The Pixi object and its passes, or `undefined` while the map is not loaded.
 */
function createDisplacement(
  ectx: EffectsCtx,
  pixi: PixiModule,
  value: Readonly<FilterFields>,
  probeMap: PixiTexture | undefined
): FilterBody | undefined {
  const map = typeof value.map === "string" ? value.map : "";
  const texture = probeMap ?? mapTexture(ectx, map);

  if (texture === undefined) return undefined;

  const sprite = new pixi.Sprite(texture);
  const filter = new pixi.DisplacementFilter({
    sprite,
    scale: { x: numberOf(value, "scaleX"), y: numberOf(value, "scaleY") },
    resolution: CANVAS_RESOLUTION
  });

  return { kind: "displacement", filter, sprite, map, ...appliedOf(value), passes: 1 };
}

/**
 * Builds the Pixi class of a core kind from its stored value.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param core - The core kind.
 * @param value - The stored filter value.
 * @param probeMap - The map a warm-up probe of a `Displacement` draws with; `undefined` otherwise.
 * @returns The Pixi object and its passes, or `undefined` for a `Displacement` whose map is not
 * loaded.
 */
function createCore(
  ectx: EffectsCtx,
  pixi: PixiModule,
  core: CoreKind,
  value: Readonly<FilterFields>,
  probeMap: PixiTexture | undefined
): FilterBody | undefined {
  switch (core) {
    case "blur": {
      const quality = blurQuality(ectx, value);
      const filter = new pixi.BlurFilter({
        strength: numberOf(value, "strength"),
        quality,
        resolution: blurResolution(ectx, value)
      });

      filter.repeatEdgePixels = value.repeatEdgePixels === true;

      return { kind: "blur", filter, ...appliedOf(value), passes: 2 * quality };
    }
    case "colorMatrix": {
      const filter = new pixi.ColorMatrixFilter({ resolution: CANVAS_RESOLUTION });

      composeMatrix(filter, value);

      return { kind: "colorMatrix", filter, ...appliedOf(value), passes: 1 };
    }
    case "noise": {
      const filter = new pixi.NoiseFilter({
        noise: numberOf(value, "amount"),
        seed: numberOf(value, "seed"),
        resolution: CANVAS_RESOLUTION
      });

      return { kind: "noise", filter, ...appliedOf(value), passes: 1 };
    }
    case "displacement": {
      return createDisplacement(ectx, pixi, value, probeMap);
    }
    default: {
      return {
        kind: "alpha",
        filter: new pixi.AlphaFilter({
          alpha: numberOf(value, "alpha"),
          resolution: resolutionOf(numberOf(value, "resolution"))
        }),
        ...appliedOf(value),
        passes: 1
      };
    }
  }
}

/**
 * Builds the instance of one kind on one view, its uniforms or settings at the stored value, its
 * `enabled` switch set, and its sort keys: the `order` of the value and the `index` of the kind.
 * The instance is the builder's own object with its sort keys added, and its `apply` is guarded
 * (see `guardApply`). A filter with inputs gets its own `apply`, which draws its chains, and runs
 * its chains once at the renderer's resolution. A definition with an `area` is asked for it at the
 * next sync.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param kind - The registered kind.
 * @param value - The stored filter value.
 * @param probeMap - The map a warm-up probe of a `Displacement` draws with instead of an asset (spec 27).
 * @returns The instance, or `undefined` for a `Displacement` whose map is not loaded.
 */
export function createFilter(
  ectx: EffectsCtx,
  pixi: PixiModule,
  kind: FilterKind,
  value: Readonly<FilterFields>,
  probeMap?: PixiTexture
): FilterInstance | undefined {
  const body =
    kind.source === "wgsl"
      ? createOurs(pixi, kind.definition, value)
      : createCore(ectx, pixi, kind.core, value, probeMap);

  if (body === undefined) return undefined;

  body.filter.enabled = switchOf(body.kind, value);
  if (body.kind === "wgsl") body.areaStale = body.definition.area !== undefined;

  const instance: FilterInstance = Object.assign(body, {
    order: value.order,
    index: kind.index,
    broken: false,
    value,
    kindId: kind.id,
    standIn: false,
    replacement: undefined,
    entity: 0
  });

  if (instance.kind === "wgsl" && instance.definition.inputs.length > 0) {
    wireInputs(ectx, pixi, instance);
  }

  guardApply(ectx, instance, kind);

  return instance;
}

/**
 * The share of the resolution the last place of one input draws at.
 *
 * @param inputs - The chains of the instance.
 * @param index - The input.
 * @returns The scale of its last place; `undefined` for an empty chain.
 */
function lastScale(inputs: InputsState, index: number): number | undefined {
  return inputs.places[index]?.at(-1)?.scale;
}

/**
 * The Pixi filter of every place of every chain, in draw order: what the slot names for the monitor.
 *
 * @param inputs - The chains of the instance.
 * @returns A frozen list.
 */
function stagesOf(inputs: InputsState): readonly PixiFilter[] {
  return Object.freeze(inputs.places.flatMap(places => places.map(place => place.body.filter)));
}

/**
 * Gives every pooled texture the running draw took back to Pixi's pool.
 *
 * @param pixi - The module the renderer loaded.
 * @param inputs - The chains of the instance.
 */
function giveBack(pixi: PixiModule, inputs: InputsState): void {
  for (const target of inputs.taken) pixi.TexturePool.returnTexture(target);

  inputs.taken.length = 0;
}

/**
 * Draws the places of one input, each from the one before, the first from `from`, into a pooled
 * texture of `from`'s frame at `resolution × scale`; the last into `target` when one is given.
 *
 * @param pixi - The module the renderer loaded.
 * @param inputs - The chains of the instance.
 * @param index - The input.
 * @param manager - Pixi's filter system, inside an active filter pass.
 * @param from - The view's input, or a kept picture.
 * @param resolution - The resolution of `from`.
 * @param target - Where the last place draws, instead of a pooled texture.
 * @returns The texture the last place drew into; `from` for an empty chain.
 */
function drawChain(
  pixi: PixiModule,
  inputs: InputsState,
  index: number,
  manager: PixiFilterManager,
  from: PixiTexture,
  resolution: number,
  target?: PixiTexture
): PixiTexture {
  const places = inputs.places[index] ?? [];
  const { request } = inputs;
  let last = from;

  for (let at = 0; at < places.length; at += 1) {
    const place = places[at];

    if (place === undefined) continue;

    let into = at === places.length - 1 ? target : undefined;

    if (into === undefined) {
      request.width = from.frame.width;
      request.height = from.frame.height;
      request.resolution = resolution * place.scale;
      into = pixi.TexturePool.getOptimalTexture(request);
      inputs.taken.push(into);
    }

    manager.applyFilter(place.body.filter, last, into, true);
    last = into;
  }

  return last;
}

/**
 * Binds the last texture of one input to the main body and fills its scale and clamp from the
 * texture's pooled size, rounded to float32. Written only where a value differs, so Pixi's bind
 * group stays cached; no array is allocated.
 *
 * @param instance - The instance.
 * @param index - The input.
 * @param last - The texture the body reads for it.
 */
function bindInput(instance: OursInstance, index: number, last: PixiTexture): void {
  const input = instance.definition.inputs[index];
  const uniforms = instance.group?.uniforms;

  if (input === undefined || uniforms === undefined) return;

  const { source } = last;
  const { resources } = instance.filter;

  if (resources[input.texture] !== source) resources[input.texture] = source;
  if (resources[input.sampler] !== source.style) resources[input.sampler] = source.style;

  const scale = uniforms[input.scale.name];
  const clamp = uniforms[input.clamp.name];
  const halfX = 0.5 / source.pixelWidth;
  const halfY = 0.5 / source.pixelHeight;

  if (scale instanceof Float32Array) {
    writeAt(scale, 0, 1 / source.width, true);
    writeAt(scale, 1, 1 / source.height, true);
  }

  if (clamp instanceof Float32Array) {
    writeAt(clamp, 0, halfX, true);
    writeAt(clamp, 1, halfY, true);
    writeAt(clamp, 2, last.frame.width / source.width - halfX, true);
    writeAt(clamp, 3, last.frame.height / source.height - halfY, true);
  }
}

/**
 * Points every input's texture and sampler back at Pixi's empty texture: a filter never holds a
 * pooled texture between applies, which a pool trim at rest may destroy.
 *
 * @param pixi - The module the renderer loaded.
 * @param instance - The instance.
 */
function unbindInputs(pixi: PixiModule, instance: OursInstance): void {
  const { resources } = instance.filter;
  const { inputs } = instance.definition;
  const empty = pixi.Texture.EMPTY.source;

  // per apply: an index over the frozen list; `for…of` over a frozen array allocates its iterator.
  // eslint-disable-next-line unicorn/no-for-loop -- the hot path walks a frozen list by index
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];

    if (input === undefined) continue;
    if (resources[input.texture] !== empty) resources[input.texture] = empty;
    if (resources[input.sampler] !== empty.style) resources[input.sampler] = empty.style;
  }
}

/**
 * The apply of a filter with inputs, as Pixi calls it: a resolution change runs the chains once
 * at the new value, then every place draws, the last texture of each input is bound, and the main
 * body draws from the view's input. Held results are bound instead and no stage draws. The pooled
 * textures go back and the inputs are unbound in a `finally`, also when a place throws; a throw then
 * reaches the guard, which breaks the instance.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param instance - The instance.
 * @param inputs - Its chains.
 * @param manager - Pixi's filter system.
 * @param input - The view's input texture.
 * @param output - The output.
 * @param clearMode - Whether the output is cleared.
 */
function applyInputs(
  ectx: EffectsCtx,
  pixi: PixiModule,
  instance: OursInstance,
  inputs: InputsState,
  manager: PixiFilterManager,
  input: PixiTexture,
  output: Output,
  clearMode: boolean
): void {
  const { resolution } = input.source;

  if (inputs.held === undefined && resolution !== inputs.resolution) {
    evaluateInRender(ectx, pixi, instance, inputs, resolution);
  }

  // A chain the new resolution broke draws like any broken instance.
  if (instance.broken) {
    drawBroken(instance, manager, input, output, clearMode);

    return;
  }

  try {
    for (let index = 0; index < inputs.places.length; index += 1) {
      const last =
        inputs.held === undefined
          ? drawChain(pixi, inputs, index, manager, input, resolution)
          : (inputs.held[index] ?? input);

      bindInput(instance, index, last);
    }

    manager.applyFilter(instance.filter, input, output, clearMode);
  } finally {
    giveBack(pixi, inputs);
    unbindInputs(pixi, instance);
  }
}

/**
 * Draws the stages of every input from a kept picture, the last place of each into the caller's
 * target: the seam of the kept-picture cache. Inside a filter's apply only. A broken instance draws
 * nothing.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param instance - The instance.
 * @param inputs - Its chains.
 * @param manager - Pixi's filter system, inside an active filter pass.
 * @param picture - The kept picture of the view's subtree.
 * @param targets - One texture per input.
 */
function drawInto(
  ectx: EffectsCtx,
  pixi: PixiModule,
  instance: OursInstance,
  inputs: InputsState,
  manager: PixiFilterManager,
  picture: PixiTexture,
  targets: readonly PixiTexture[]
): void {
  const { resolution } = picture.source;

  if (!instance.broken && resolution !== inputs.resolution) {
    evaluateInRender(ectx, pixi, instance, inputs, resolution);
  }

  if (instance.broken) return;

  try {
    for (let index = 0; index < inputs.places.length; index += 1) {
      const target = targets[index];

      if (target !== undefined)
        drawChain(pixi, inputs, index, manager, picture, resolution, target);
    }
  } finally {
    giveBack(pixi, inputs);
  }
}

/**
 * Gives an instance of ours its chains: their state and slot seam, its own `apply`, and the first
 * evaluation at the renderer's resolution.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param instance - The instance, just built.
 */
function wireInputs(ectx: EffectsCtx, pixi: PixiModule, instance: OursInstance): void {
  const count = instance.definition.inputs.length;
  const inputs: InputsState = {
    stale: true,
    resolution: 0,
    version: 0,
    context: { resolution: 0 },
    places: Array.from({ length: count }, (): Place[] => []),
    retired: [],
    taken: [],
    request: { width: 0, height: 0, resolution: 1 },
    held: undefined,
    slot: Object.freeze({
      stages: Object.freeze([]),
      count,
      version: (): number => inputs.version,
      scaleOf: (index: number): number | undefined => lastScale(inputs, index),
      draw: (
        manager: PixiFilterManager,
        picture: PixiTexture,
        targets: readonly PixiTexture[]
      ): void => drawInto(ectx, pixi, instance, inputs, manager, picture, targets),
      hold: (results: readonly PixiTexture[] | undefined): void => {
        inputs.held = results;
      }
    })
  };

  instance.inputs = inputs;
  instance.filter.apply = (
    manager: PixiFilterManager,
    input: PixiTexture,
    output: Output,
    clearMode: boolean
  ): void => applyInputs(ectx, pixi, instance, inputs, manager, input, output, clearMode);
  evaluate(ectx, pixi, instance, inputs, ectx.deps.renderer.host.resolution());
}

/**
 * Reads one property of a value a chain returned, whatever its type.
 *
 * @param target - The value.
 * @param name - The property.
 * @returns Its value, or `undefined` for a value that is no object.
 * @example
 * ```ts
 * propertyOf({ scale: 0.5 }, "scale"); // 0.5
 * ```
 */
function propertyOf(target: unknown, name: string): unknown {
  return (typeof target === "object" || typeof target === "function") && target !== null
    ? Reflect.get(target, name)
    : undefined;
}

/**
 * The definition of the stage a step names, when the input lists it.
 *
 * @param input - The input.
 * @param stage - What the step names.
 * @returns The listed stage's definition, or `undefined`.
 */
function listedDefinition(
  input: FilterInputDefinition,
  stage: unknown
): FilterDefinition | undefined {
  const candidate = propertyOf(stage, "filter");

  for (const listed of input.stages) if (listed.filter === candidate) return listed.filter;

  return undefined;
}

/**
 * The uniform of a definition by its name.
 *
 * @param definition - The definition.
 * @param name - The name.
 * @returns The uniform, or `undefined`.
 */
function uniformNamed(definition: FilterDefinition, name: string): UniformSpec | undefined {
  for (const uniform of definition.uniforms) if (uniform.name === name) return uniform;

  return undefined;
}

/**
 * Tells whether a step's value fits the form of a uniform: a number for a number or a colour, a
 * list of exactly `size` finite numbers for a vector.
 *
 * @param uniform - The uniform.
 * @param value - The step's value.
 * @returns True when it fits.
 * @example
 * ```ts
 * fitsForm({ name: "dir", type: "vec2<f32>", form: "vector", size: 2 }, [1, 0]); // true
 * ```
 */
function fitsForm(uniform: UniformSpec, value: unknown): boolean {
  if (uniform.form !== "vector") return typeof value === "number";
  if (!Array.isArray(value) || value.length !== uniform.size) return false;

  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) return false;
  }

  return true;
}

/**
 * The first problem of one step, as the message of the log line.
 *
 * @param input - The input.
 * @param step - The step.
 * @param index - Its place in the chain.
 * @returns The problem, or `undefined` for a step that may draw.
 */
function stepProblem(
  input: FilterInputDefinition,
  step: unknown,
  index: number
): string | undefined {
  const { name } = input;
  const stage = propertyOf(step, "stage");
  const definition = listedDefinition(input, stage);

  if (definition === undefined) {
    const id = propertyOf(propertyOf(stage, "filter"), "id") ?? propertyOf(stage, "componentName");

    return `input "${name}" names stage "${String(id)}", which is not in its stages: only listed stages are checked and warmed up before they draw.`;
  }

  const scale = propertyOf(step, "scale");

  if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0 || scale > 1) {
    return `input "${name}": step ${index} has scale ${String(scale)}; a scale is a share of the input's resolution above 0 and at most 1.`;
  }

  const uniforms = propertyOf(step, "uniforms");

  if (typeof uniforms !== "object" || uniforms === null) return undefined;

  for (const key of Object.keys(uniforms)) {
    const uniform = uniformNamed(definition, key);

    if (uniform === undefined) {
      return `input "${name}": step ${index} gives "${key}", which stage "${definition.id}" does not declare.`;
    }

    if (!fitsForm(uniform, Reflect.get(uniforms, key))) {
      return `input "${name}": step ${index} gives "${key}" a value of another form.`;
    }
  }

  return undefined;
}

/**
 * The first problem of what a chain returned, as the message of the log line, in every build: a
 * step it refuses was never checked and could blank a WebGPU frame.
 *
 * @param input - The input.
 * @param steps - What its chain returned.
 * @returns The problem, or `undefined` for steps that may draw.
 */
function stepsProblem(input: FilterInputDefinition, steps: unknown): string | undefined {
  if (!Array.isArray(steps)) return `input "${input.name}": chain must return an array of steps.`;

  const list: readonly unknown[] = steps;

  if (list.length > MAX_STEPS) {
    return `input "${input.name}": chain returned ${list.length} steps; at most ${MAX_STEPS}.`;
  }

  for (const [index, step] of list.entries()) {
    const problem = stepProblem(input, step, index);

    if (problem !== undefined) return problem;
  }

  return undefined;
}

/**
 * The default of one uniform of a stage: its component's default field.
 *
 * @param stage - The stage.
 * @param name - The uniform.
 * @returns The field, or `undefined`.
 */
function defaultOf(stage: FilterStage, name: string): FilterField | undefined {
  const field: unknown = Reflect.get(stage.defaults, name);

  return typeof field === "number" || Array.isArray(field) ? (field as FilterField) : undefined;
}

/**
 * Writes the uniforms of one step into its place, with the compare on write: a uniform the step
 * leaves out takes the stage's default, never a value of an earlier frame.
 *
 * @param place - The place.
 * @param step - The step.
 * @returns True when a uniform was written.
 */
function writeStep(place: Place, step: FilterStep): boolean {
  const uniforms = place.body.group?.uniforms;
  let changed = false;

  if (uniforms === undefined) return false;

  const specs = place.definition.uniforms;

  // An index over the frozen list: `for…of` over a frozen array allocates its iterator.
  // eslint-disable-next-line unicorn/no-for-loop -- a tween's chain walks a frozen list by index
  for (let index = 0; index < specs.length; index += 1) {
    const uniform = specs[index];

    if (uniform === undefined) continue;

    const field = step.uniforms?.[uniform.name] ?? defaultOf(step.stage, uniform.name);

    if (writeField(uniforms, uniform, field, true)) changed = true;
  }

  return changed;
}

/**
 * The place that draws one step: the place at its slot when it draws the step's stage, otherwise a
 * place of its own (a `Filter` with its own uniform group) built in that slot, the old one retired.
 *
 * @param pixi - The module the renderer loaded.
 * @param retired - The bodies to destroy after the frame.
 * @param places - The places of the input, changed in place.
 * @param at - The slot of the step.
 * @param step - The step.
 * @returns The place, and true in `built` when it was built for this step.
 */
function placeFor(
  pixi: PixiModule,
  retired: OursBody[],
  places: Place[],
  at: number,
  step: FilterStep
): { place: Place; built: boolean } {
  const kept = places[at];

  if (kept?.definition === step.stage.filter) return { place: kept, built: false };

  if (kept !== undefined) retired.push(kept.body);

  const place: Place = {
    definition: step.stage.filter,
    body: createOurs(pixi, step.stage.filter, PROBE_VALUE),
    scale: step.scale
  };

  places[at] = place;

  return { place, built: true };
}

/**
 * Walks the steps of one input with its places: a place that draws the step's stage is kept and
 * written, any other is retired and a place of its own is built; places past the steps are
 * retired. A built or dropped place replaces the slot seam, so the next slot list names the new
 * stage filters.
 *
 * @param pixi - The module the renderer loaded.
 * @param inputs - The chains of the instance.
 * @param index - The input.
 * @param steps - The steps its chain returned, checked.
 * @returns True when anything differs from before: a place, a scale or a uniform.
 */
function placeSteps(
  pixi: PixiModule,
  inputs: InputsState,
  index: number,
  steps: readonly FilterStep[]
): boolean {
  const places = inputs.places[index] ?? [];
  let changed = false;
  let rebuilt = false;

  for (const [at, step] of steps.entries()) {
    const { place, built } = placeFor(pixi, inputs.retired, places, at, step);

    if (built) rebuilt = true;

    if (writeStep(place, step)) changed = true;

    if (place.scale !== step.scale) {
      place.scale = step.scale;
      changed = true;
    }
  }

  for (const left of places.splice(steps.length)) {
    inputs.retired.push(left.body);
    rebuilt = true;
  }

  if (rebuilt) inputs.slot = Object.freeze({ ...inputs.slot, stages: stagesOf(inputs) });

  return changed || rebuilt;
}

/**
 * Runs the chain of every input for the instance's value at a resolution and places its steps.
 * A chain that throws or returns a step it may not draw breaks the instance (reason `"chain"`).
 * The version moves when a place, a scale, a stage uniform or the resolution changed; the passes
 * become the main body plus every place.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param instance - The instance.
 * @param inputs - Its chains.
 * @param resolution - The resolution of the texture the view is drawn into.
 */
function evaluate(
  ectx: EffectsCtx,
  pixi: PixiModule,
  instance: OursInstance,
  inputs: InputsState,
  resolution: number
): void {
  const kind = ectx.state.kinds.get(instance.kindId);
  let changed = resolution !== inputs.resolution;
  let passes = 1;

  inputs.context.resolution = resolution;

  for (const [index, input] of instance.definition.inputs.entries()) {
    let steps: readonly FilterStep[];

    try {
      steps = input.chain(instance.value, inputs.context);
    } catch (error) {
      breakInstance(ectx, instance, kind, "chain", messageOf(error), { input: input.name });

      return;
    }

    const problem = stepsProblem(input, steps);

    if (problem !== undefined) {
      breakInstance(ectx, instance, kind, "chain", problem, { input: input.name });

      return;
    }

    if (placeSteps(pixi, inputs, index, steps)) changed = true;

    passes += steps.length;
  }

  inputs.resolution = resolution;
  inputs.stale = false;
  instance.passes = passes;

  if (changed) inputs.version += 1;
}

/**
 * Runs the chains at a new resolution from inside a render, where the view the instance belongs to is not known: the
 * next sync looks at every view, so the one that holds it hands over its new passes and stage filters and destroys
 * the places that left.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param instance - The instance.
 * @param inputs - Its chains.
 * @param resolution - The resolution of the texture the view is drawn into.
 */
function evaluateInRender(
  ectx: EffectsCtx,
  pixi: PixiModule,
  instance: OursInstance,
  inputs: InputsState,
  resolution: number
): void {
  evaluate(ectx, pixi, instance, inputs, resolution);
  ectx.state.filterSync.all = true;
}

/**
 * Brings the chains of an instance with inputs up to date in the sync: destroys the places that
 * left (outside any render), then runs the chains again when a uniform of the value changed since
 * the last run. A broken, switched-off or diagnostics-disabled filter runs nothing and catches up
 * when it is drawn again.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param instance - The instance.
 * @param off - Whether a debug switch turned its kind off.
 */
export function refreshInputs(
  ectx: EffectsCtx,
  pixi: PixiModule,
  instance: FilterInstance,
  off: boolean
): void {
  if (instance.kind !== "wgsl" || instance.inputs === undefined) return;

  const { inputs } = instance;

  if (inputs.retired.length > 0) {
    for (const body of inputs.retired) destroyBody(body);

    inputs.retired.length = 0;
  }

  if (instance.broken || !instance.filter.enabled || off || !inputs.stale) return;

  evaluate(ectx, pixi, instance, inputs, inputs.resolution);
}

/**
 * The body a stand-in of a dev build draws: the fallback with the striped mark over it, or the
 * mark alone. The pair draws the fallback into one pooled texture of the input's frame and
 * resolution, then the mark from it into the output, and gives the texture back in a `finally`.
 *
 * @param pixi - The module the renderer loaded.
 * @param fallback - The checked fallback, or `undefined`.
 * @param value - The kind's stored value.
 * @returns The body.
 */
function markedBody(
  pixi: PixiModule,
  fallback: FilterDefinition | undefined,
  value: Readonly<FilterFields>
): OursBody {
  const mark = createOurs(pixi, brokenMark().filter, value);

  if (fallback === undefined) return mark;

  const body: OursBody = { ...createOurs(pixi, fallback, value), mark, passes: 2 };
  const request = { width: 0, height: 0, resolution: 1 };

  body.filter.apply = (
    manager: PixiFilterManager,
    input: PixiTexture,
    output: Output,
    clearMode: boolean
  ): void => {
    request.width = input.frame.width;
    request.height = input.frame.height;
    request.resolution = input.source.resolution;

    const pooled = pixi.TexturePool.getOptimalTexture(request);

    try {
      manager.applyFilter(body.filter, input, pooled, true);
      manager.applyFilter(mark.filter, pooled, output, clearMode);
    } finally {
      pixi.TexturePool.returnTexture(pooled);
    }
  };

  return body;
}

/**
 * Builds what draws in place of a broken kind or instance: its declared fallback, once the
 * fallback's own check answered ok, with the kind's value; in a dev build the striped mark over it,
 * or the mark alone without a usable fallback. Nothing while the fallback's check is pending (the
 * next sync asks again), and nothing in a production build without a usable fallback. Its `apply` is
 * guarded like any instance's.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param kind - The kind it stands in for.
 * @param value - The kind's stored value.
 * @returns The stand-in, or `undefined`.
 */
export function createStandIn(
  ectx: EffectsCtx,
  pixi: PixiModule,
  kind: FilterKind,
  value: Readonly<FilterFields>
): FilterInstance | undefined {
  const fallback = kind.source === "wgsl" ? kind.definition.fallback : undefined;
  const status = fallback === undefined ? "broken" : ectx.state.checks.status.get(fallback);

  // Never an unchecked shader: a pending fallback is asked for again by the next sync.
  if (status !== "ok" && status !== "broken") return undefined;

  const usable = status === "ok" ? fallback : undefined;
  let body: OursBody | undefined;

  // Inline and positive: a release bundle drops the mark and its shader.
  if (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__ === true) {
    body = markedBody(pixi, usable, value);
  } else if (usable !== undefined) {
    body = createOurs(pixi, usable, value);
  }

  if (body === undefined) return undefined;

  body.filter.enabled = value.enabled;
  body.areaStale = body.definition.area !== undefined;

  const standIn: FilterInstance = Object.assign(body, {
    order: value.order,
    index: kind.index,
    broken: false,
    value,
    kindId: kind.id,
    standIn: true,
    replacement: undefined,
    entity: 0
  });

  guardApply(ectx, standIn, kind);

  return standIn;
}

/**
 * Builds a probe of one definition for the warm-up (spec 27): a Pixi filter over its programs with
 * every uniform at 0 and no chain wired, whose inputs stay bound to Pixi's empty texture. The
 * programs are the ones every instance and place of the definition shares.
 *
 * @param pixi - The module the renderer loaded.
 * @param definition - A definition whose check answered ok.
 * @returns The probe's filter and its teardown.
 */
export function createWarmFilter(
  pixi: PixiModule,
  definition: FilterDefinition
): { filter: PixiFilter; destroy(): void } {
  const body = createOurs(pixi, definition, PROBE_VALUE);

  return { filter: body.filter, destroy: (): void => destroyBody(body) };
}

/**
 * Compares a vector uniform with a list of numbers element by element and writes the elements that
 * differ: the indices `set(vector.slice(0, size))` would write, without the slice.
 *
 * @param target - The vector the group holds.
 * @param size - The uniform's size.
 * @param vector - The numbers.
 * @param write - False to compare only.
 * @returns True when an element differs.
 */
function writeVector(
  target: Float32Array,
  size: number,
  vector: readonly number[],
  write: boolean
): boolean {
  const count = Math.min(size, vector.length);
  let differs = false;

  for (let index = 0; index < count; index += 1) {
    if (writeAt(target, index, vector[index] ?? 0, write)) differs = true;
  }

  return differs;
}

/**
 * Compares one uniform of a uniform group with one field and writes it where it differs: a number
 * in place, a colour or a tuple element by element into the vector the group already holds,
 * rounded to float32 as the vector stores it. A vector uniform without its vector is left alone.
 *
 * @param uniforms - The values of the uniform group.
 * @param uniform - The uniform.
 * @param field - The field: the stored value's, or a step's.
 * @param write - False to compare only.
 * @returns True when the uniform differs.
 */
function writeField(
  uniforms: UniformValues,
  uniform: UniformSpec,
  field: FilterField | undefined,
  write: boolean
): boolean {
  const { name } = uniform;

  if (uniform.form === "number") {
    const next = typeof field === "number" ? field : 0;
    const held = uniforms[name];

    if (typeof held === "number" && same(held, next)) return false;
    if (write) uniforms[name] = next;

    return true;
  }

  const target = uniforms[name];

  if (!(target instanceof Float32Array)) return false;
  if (uniform.form === "color")
    return writeColor(target, typeof field === "number" ? field : 0, write);

  return writeVector(target, uniform.size, Array.isArray(field) ? field : NO_NUMBERS, write);
}

/**
 * Compares one uniform of a uniform group with the stored value and writes it where it differs.
 *
 * @param uniforms - The values of the uniform group.
 * @param uniform - The uniform.
 * @param value - The stored filter value.
 * @param write - False to compare only.
 * @returns True when the uniform differs.
 */
function writeUniform(
  uniforms: UniformValues,
  uniform: UniformSpec,
  value: Readonly<FilterFields>,
  write: boolean
): boolean {
  return writeField(uniforms, uniform, value[uniform.name], write);
}

/**
 * Tells whether one of ours holds another value than the stored one: a uniform, or a padding
 * named after a uniform.
 *
 * @param instance - The instance.
 * @param definition - Its filter definition.
 * @param value - The stored filter value.
 * @returns True when a write would change the filter.
 */
function oursDiffer(
  instance: FilterInstance & { kind: "wgsl" },
  definition: FilterDefinition,
  value: Readonly<FilterFields>
): boolean {
  if (instance.group !== undefined) {
    const specs = definition.uniforms;

    // per sync of a changed view: an index over the frozen list; `for…of` over a frozen array allocates its iterator.
    // eslint-disable-next-line unicorn/no-for-loop -- the hot path walks a frozen list by index
    for (let index = 0; index < specs.length; index += 1) {
      const uniform = specs[index];

      if (uniform !== undefined && writeUniform(instance.group.uniforms, uniform, value, false)) {
        return true;
      }
    }
  }

  return (
    typeof definition.padding === "string" &&
    !same(instance.filter.padding, paddingOf(definition, value))
  );
}

/**
 * Writes the uniforms of one of ours and the padding that differ from what the group holds;
 * nothing is written for a value the group holds already, and no `update()` (a non-static group
 * uploads every draw).
 *
 * @param instance - The instance.
 * @param definition - Its filter definition.
 * @param value - The stored filter value.
 */
function writeOurs(
  instance: FilterInstance & { kind: "wgsl" },
  definition: FilterDefinition,
  value: Readonly<FilterFields>
): void {
  if (instance.group !== undefined) {
    const specs = definition.uniforms;

    // per write: an index over the frozen list; `for…of` over a frozen array allocates its iterator.
    // eslint-disable-next-line unicorn/no-for-loop -- the hot path walks a frozen list by index
    for (let index = 0; index < specs.length; index += 1) {
      const uniform = specs[index];

      if (uniform !== undefined) writeUniform(instance.group.uniforms, uniform, value, true);
    }
  }

  if (typeof definition.padding !== "string") return;

  const padding = paddingOf(definition, value);

  if (!same(instance.filter.padding, padding)) instance.filter.padding = padding;
}

/**
 * Tells whether two stored fields are the same value: equal, or two NaN numbers.
 *
 * @param a - One field.
 * @param b - The other.
 * @returns True when a setter given `b` after `a` changes nothing.
 * @example
 * ```ts
 * sameField("fx.ripple", "fx.ripple"); // true
 * ```
 */
function sameField(a: FilterField | undefined, b: FilterField | undefined): boolean {
  return typeof a === "number" && typeof b === "number" ? same(a, b) : a === b;
}

/**
 * Tells whether a core kind's stored value differs from what its setters were last given. The
 * `Displacement` map compares with the map the sprite shows, since a map whose texture is not
 * loaded is not applied yet.
 *
 * @param instance - The instance.
 * @param value - The stored filter value.
 * @returns True when a write would call a setter with a new value.
 */
function coreDiffers(instance: CoreInstance, value: Readonly<FilterFields>): boolean {
  const { fields, applied } = instance;

  // per sync of a changed view: the keys listed once, a plain array; `Object.keys` would make one every call.
  for (const field of fields) {
    if (instance.kind === "displacement" && field === "map") {
      if (mapOf(value) !== instance.map) return true;
    } else if (!sameField(applied[field], value[field])) {
      return true;
    }
  }

  return false;
}

/**
 * The map key of a stored `Displacement` value.
 *
 * @param value - The stored value.
 * @returns The key, or `""` for a map not chosen yet.
 * @example
 * ```ts
 * mapOf({ enabled: true, order: 0, map: "fx.ripple" }); // "fx.ripple"
 * ```
 */
function mapOf(value: Readonly<FilterFields>): string {
  return typeof value.map === "string" ? value.map : "";
}

/**
 * Writes a core kind through its setters, then keeps the written fields as `applied`. Called
 * only when the component changed this frame and a field differs.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param instance - The instance.
 * @param value - The stored filter value.
 */
function writeCore(ectx: EffectsCtx, instance: CoreInstance, value: Readonly<FilterFields>): void {
  setCore(ectx, instance, value);

  const { fields, applied } = instance;

  // An `Alpha` copies its two fields by name: a fade writes them in every frame, and the keyed copy boxes a fraction.
  if (instance.kind === "alpha") {
    const { alpha, resolution } = value;

    if (alpha !== undefined) applied.alpha = alpha;
    if (resolution !== undefined) applied.resolution = resolution;

    return;
  }

  // Copied in place: the record and its keys were made once with the instance.
  for (const field of fields) {
    const next = value[field];

    if (next !== undefined) applied[field] = next;
  }
}

/**
 * Calls the setters of a core kind with the stored value. The `Displacement` map moves only
 * when its texture was found.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param instance - The instance.
 * @param value - The stored filter value.
 */
function setCore(ectx: EffectsCtx, instance: CoreInstance, value: Readonly<FilterFields>): void {
  switch (instance.kind) {
    case "blur": {
      const quality = blurQuality(ectx, value);

      instance.filter.strength = numberOf(value, "strength");
      instance.filter.quality = quality;
      instance.filter.resolution = blurResolution(ectx, value);
      instance.filter.repeatEdgePixels = value.repeatEdgePixels === true;
      instance.passes = 2 * quality;

      return;
    }
    case "colorMatrix": {
      composeMatrix(instance.filter, value);

      return;
    }
    case "noise": {
      instance.filter.noise = numberOf(value, "amount");
      instance.filter.seed = numberOf(value, "seed");

      return;
    }
    case "displacement": {
      instance.filter.scale.x = numberOf(value, "scaleX");
      instance.filter.scale.y = numberOf(value, "scaleY");

      const map = mapOf(value);
      const texture = map === instance.map ? undefined : mapTexture(ectx, map);

      if (texture === undefined) return;

      instance.sprite.texture = texture;
      instance.map = map;

      return;
    }
    default: {
      // Read by name: a fade writes them in every frame, and a number `numberOf` hands back is boxed (16 B).
      const { alpha, resolution } = value;

      instance.filter.alpha = typeof alpha === "number" ? alpha : 0;
      instance.filter.resolution = resolutionOf(typeof resolution === "number" ? resolution : 0);
    }
  }
}

/**
 * Marks the area of one of ours to be asked again at this sync (B4): the area is a pure function of the value, so only
 * a value that changed can change it.
 *
 * @param instance - The instance whose value changed.
 */
function staleArea(instance: FilterInstance): void {
  if (instance.kind === "wgsl" && instance.definition.area !== undefined) instance.areaStale = true;
}

/**
 * Keeps a broken instance switched off whatever its component says. Switched off is a change the renderer cannot see,
 * so `before` is called first, once, when the filter really flips; an instance already off asks for nothing.
 *
 * @param instance - The broken instance.
 * @param before - Called before the write.
 */
function switchOffBroken(instance: FilterInstance, before: () => void): void {
  if (!instance.filter.enabled) return;

  before();
  instance.filter.enabled = false;
}

/**
 * Brings one instance up to the stored value for a frame, comparing before anything is written.
 * A broken instance stays off whatever its component says, and an `Alpha` at 1 drawn at the
 * canvas's resolution is off too. Switching on or off is a visible change; so is a new value of a
 * filter that is on. A filter that is off and stays off still gets
 * its new values written, so it is current when it comes back on, but asks for nothing: an off
 * filter draws no pixel. Ours compare on every sync of their view (a view syncs when something of it changed); a core
 * kind only when its component changed.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param instance - The instance.
 * @param value - The stored filter value.
 * @param changed - Whether `ecs.changed(Kind)` holds the entity this frame.
 * @param before - Called once, before the first write, when the change can be seen.
 * @returns True when a change the player can see was written.
 */
export function writeFilter(
  ectx: EffectsCtx,
  instance: FilterInstance,
  value: Readonly<FilterFields>,
  changed: boolean,
  before: () => void
): boolean {
  if (instance.broken) {
    switchOffBroken(instance, before);

    return false;
  }

  const on = switchOf(instance.kind, value);
  const toggled = instance.filter.enabled !== on;
  const differs =
    instance.kind === "wgsl"
      ? oursDiffer(instance, instance.definition, value)
      : changed && coreDiffers(instance, value);

  if (!toggled && !differs) return false;

  staleArea(instance);

  const visible = toggled || on;

  if (visible) before();
  if (toggled) instance.filter.enabled = on;

  if (differs) {
    if (instance.kind === "wgsl") {
      writeOurs(instance, instance.definition, value);

      // A uniform changed: the chains run again in this sync (`refreshInputs`).
      if (instance.inputs !== undefined) instance.inputs.stale = true;
    } else {
      writeCore(ectx, instance, value);
    }
  }

  return visible;
}

/**
 * Tells whether a resource of a filter holds a GPU buffer of its own.
 *
 * @param resource - A value of `filter.resources`.
 * @returns True for a uniform group with a buffer.
 */
function isBuffered(resource: unknown): resource is BufferedResource {
  if (typeof resource !== "object" || resource === null) return false;
  if (!("uniforms" in resource) || !("buffer" in resource)) return false;

  const { buffer } = resource;

  return (
    typeof buffer === "object" &&
    buffer !== null &&
    "destroy" in buffer &&
    typeof buffer.destroy === "function"
  );
}

/**
 * Frees one body: every uniform buffer first, then a `Displacement` map sprite (its texture belongs
 * to `assets`), then the filter.
 *
 * @param body - The body.
 */
function destroyBody(body: FilterBody): void {
  const resources: Record<string, unknown> = body.filter.resources;

  for (const resource of Object.values(resources)) {
    if (isBuffered(resource)) resource.buffer.destroy();
  }

  if (body.kind === "displacement") body.sprite.destroy({ texture: false });

  body.filter.destroy();
}

/**
 * Frees an instance: the places of its chains and the places that left them, then its own filter,
 * then its dev mark and a stand-in that was built but never put in its place.
 *
 * @param instance - The instance.
 */
export function destroyFilter(instance: FilterInstance): void {
  if (instance.kind === "wgsl" && instance.inputs !== undefined) {
    for (const places of instance.inputs.places)
      for (const place of places) destroyBody(place.body);
    for (const body of instance.inputs.retired) destroyBody(body);

    instance.inputs.retired.length = 0;
  }

  destroyBody(instance);

  if (instance.kind === "wgsl" && instance.mark !== undefined) destroyBody(instance.mark);
  if (instance.replacement !== undefined) destroyFilter(instance.replacement);
}
