/**
 * @file effects/filters — the only file that builds, writes and destroys Pixi filters. Ours: a
 * `Filter` over a `GpuProgram` of the assembled WGSL and a `GlProgram` of the assembled GLSL, with
 * one `UniformGroup` both read. The Pixi-core kinds: their own class, written through their setters
 * when a field differs from what they were last given. Every kind but `Blur` renders at
 * `resolution: "inherit"`, the resolution of the canvas, so a filtered view stays sharp on DPR 2-3
 * (decision 32). Every write compares first: a value the filter holds already writes nothing and
 * asks the renderer for no frame. A destroy frees the uniform buffers first: `Filter.destroy()`
 * leaves them to a GC that runs after a minute (P10).
 */
import type { PixiModule } from "../../renderer/types";
import type { EffectsCtx } from "../types";
import { guardApply } from "./guard";
import type {
  CoreKind,
  FilterBody,
  FilterDefinition,
  FilterField,
  FilterFields,
  FilterInstance,
  FilterKind,
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
): FilterBody {
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

  const group = definition.uniforms.length > 0 ? new pixi.UniformGroup(structures) : undefined;
  const filter = new pixi.Filter({
    gpuProgram,
    glProgram,
    resources: group === undefined ? {} : { fu: group },
    padding: paddingOf(definition, value),
    resolution: CANVAS_RESOLUTION
  });

  return { kind: "wgsl", filter, group, definition, passes: definition.passes };
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
 * `order`.
 *
 * @param value - The stored filter value.
 * @returns A fresh record, kept by the instance as `applied`.
 * @example
 * ```ts
 * appliedOf({ enabled: true, order: 2, alpha: 0.4 }); // { alpha: 0.4 }
 * ```
 */
function appliedOf(value: Readonly<FilterFields>): Record<string, FilterField> {
  const applied: Record<string, FilterField> = {};

  for (const field of Object.keys(value)) {
    const held = value[field];

    if (field !== "enabled" && field !== "order" && held !== undefined) applied[field] = held;
  }

  return applied;
}

/**
 * Builds a `Displacement` over a map sprite the instance owns.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param value - The stored `Displacement` value.
 * @returns The Pixi object and its passes, or `undefined` while the map is not loaded.
 */
function createDisplacement(
  ectx: EffectsCtx,
  pixi: PixiModule,
  value: Readonly<FilterFields>
): FilterBody | undefined {
  const map = typeof value.map === "string" ? value.map : "";
  const texture = mapTexture(ectx, map);

  if (texture === undefined) return undefined;

  const sprite = new pixi.Sprite(texture);
  const filter = new pixi.DisplacementFilter({
    sprite,
    scale: { x: numberOf(value, "scaleX"), y: numberOf(value, "scaleY") },
    resolution: CANVAS_RESOLUTION
  });

  return { kind: "displacement", filter, sprite, map, applied: appliedOf(value), passes: 1 };
}

/**
 * Builds the Pixi class of a core kind from its stored value.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param core - The core kind.
 * @param value - The stored filter value.
 * @returns The Pixi object and its passes, or `undefined` for a `Displacement` whose map is not
 * loaded.
 */
function createCore(
  ectx: EffectsCtx,
  pixi: PixiModule,
  core: CoreKind,
  value: Readonly<FilterFields>
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

      return { kind: "blur", filter, applied: appliedOf(value), passes: 2 * quality };
    }
    case "colorMatrix": {
      const filter = new pixi.ColorMatrixFilter({ resolution: CANVAS_RESOLUTION });

      composeMatrix(filter, value);

      return { kind: "colorMatrix", filter, applied: appliedOf(value), passes: 1 };
    }
    case "noise": {
      const filter = new pixi.NoiseFilter({
        noise: numberOf(value, "amount"),
        seed: numberOf(value, "seed"),
        resolution: CANVAS_RESOLUTION
      });

      return { kind: "noise", filter, applied: appliedOf(value), passes: 1 };
    }
    case "displacement": {
      return createDisplacement(ectx, pixi, value);
    }
    default: {
      return {
        kind: "alpha",
        filter: new pixi.AlphaFilter({
          alpha: numberOf(value, "alpha"),
          resolution: CANVAS_RESOLUTION
        }),
        applied: appliedOf(value),
        passes: 1
      };
    }
  }
}

/**
 * Builds the instance of one kind on one view, its uniforms or settings at the stored value, its
 * `enabled` switch set, and its sort keys: the `order` of the value and the `index` of the kind.
 * The instance is the builder's own object with its sort keys added, and its `apply` is guarded
 * (see `guardApply`).
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param kind - The registered kind.
 * @param value - The stored filter value.
 * @returns The instance, or `undefined` for a `Displacement` whose map is not loaded.
 */
export function createFilter(
  ectx: EffectsCtx,
  pixi: PixiModule,
  kind: FilterKind,
  value: Readonly<FilterFields>
): FilterInstance | undefined {
  const body =
    kind.source === "wgsl"
      ? createOurs(pixi, kind.definition, value)
      : createCore(ectx, pixi, kind.core, value);

  if (body === undefined) return undefined;

  body.filter.enabled = value.enabled;

  const instance: FilterInstance = Object.assign(body, {
    order: value.order,
    index: kind.index,
    broken: false
  });

  guardApply(ectx, instance, kind.id);

  return instance;
}

/**
 * Compares one uniform of a uniform group with the stored value and writes it where it differs:
 * a number in place, a colour or a tuple element by element into the vector the group already
 * holds, rounded to float32 as the vector stores it. A vector uniform without its vector is left
 * alone.
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
  const { name } = uniform;

  if (uniform.form === "number") {
    const next = numberOf(value, name);
    const held = uniforms[name];

    if (typeof held === "number" && same(held, next)) return false;
    if (write) uniforms[name] = next;

    return true;
  }

  const target = uniforms[name];

  if (!(target instanceof Float32Array)) return false;
  if (uniform.form === "color") return writeColor(target, numberOf(value, name), write);

  // The indices `set(vector.slice(0, size))` would write, without the slice.
  const vector = vectorOf(value, name);
  const count = Math.min(uniform.size, vector.length);
  let differs = false;

  for (let index = 0; index < count; index += 1) {
    if (writeAt(target, index, vector[index] ?? 0, write)) differs = true;
  }

  return differs;
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
    for (const uniform of definition.uniforms) {
      if (writeUniform(instance.group.uniforms, uniform, value, false)) return true;
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
    for (const uniform of definition.uniforms)
      writeUniform(instance.group.uniforms, uniform, value, true);
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
  for (const field of Object.keys(instance.applied)) {
    if (instance.kind === "displacement" && field === "map") {
      if (mapOf(value) !== instance.map) return true;
    } else if (!sameField(instance.applied[field], value[field])) {
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

  // Copied in place: the record was made once with the instance.
  for (const field of Object.keys(instance.applied)) {
    const next = value[field];

    if (next !== undefined) instance.applied[field] = next;
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
      instance.filter.alpha = numberOf(value, "alpha");
    }
  }
}

/**
 * Brings one instance up to the stored value for a frame, comparing before anything is written.
 * A broken instance stays off whatever its component says. Switching on or off is a visible
 * change; so is a new value of a filter that is on. A filter that is off and stays off still gets
 * its new values written, so it is current when it comes back on, but asks for nothing: an off
 * filter draws no pixel. Ours compare every frame; a core kind only when its component changed.
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
    instance.filter.enabled = false;

    return false;
  }

  const toggled = instance.filter.enabled !== value.enabled;
  const differs =
    instance.kind === "wgsl"
      ? oursDiffer(instance, instance.definition, value)
      : changed && coreDiffers(instance, value);

  if (!toggled && !differs) return false;

  const visible = toggled || value.enabled;

  if (visible) before();
  if (toggled) instance.filter.enabled = value.enabled;

  if (differs) {
    if (instance.kind === "wgsl") writeOurs(instance, instance.definition, value);
    else writeCore(ectx, instance, value);
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
 * Frees an instance: every uniform buffer first, then a `Displacement` map sprite (its texture
 * belongs to `assets`), then the filter.
 *
 * @param instance - The instance.
 */
export function destroyFilter(instance: FilterInstance): void {
  const resources: Record<string, unknown> = instance.filter.resources;

  for (const resource of Object.values(resources)) {
    if (isBuffered(resource)) resource.buffer.destroy();
  }

  if (instance.kind === "displacement") instance.sprite.destroy({ texture: false });

  instance.filter.destroy();
}
