/**
 * @file effects/filters — the only file that builds, writes and destroys Pixi filters. Ours: a
 * `Filter` over a `GpuProgram` of the assembled WGSL with a `UniformGroup` bound as `fu`, written
 * every frame. The Pixi-core kinds: their own class, written through their setters when the
 * component changed. A destroy frees the uniform buffers first: `Filter.destroy()` leaves them to
 * a GC that runs after a minute (P10).
 */
import type { PixiModule } from "../../renderer/types";
import type { EffectsCtx } from "../types";
import type {
  CoreKind,
  FilterDefinition,
  FilterFields,
  FilterInstance,
  FilterKind,
  UniformSpec,
  UniformValues
} from "./types";

/** One uniform as a `UniformGroup` takes it. */
type UniformStructure = { value: number | Float32Array; type: UniformSpec["type"] };

/** A GPU resource that holds a buffer of its own: a uniform group once Pixi uploaded it. */
type BufferedResource = { uniforms: object; buffer: { destroy(): void } };

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
 * Writes the three channels of a `0xrrggbb` colour into a vector, 0..1 each.
 *
 * @param target - The `vec3<f32>` of the uniform.
 * @param hex - The colour.
 */
function writeColor(target: Float32Array, hex: number): void {
  target[0] = ((hex >> 16) & 0xff) / 255;
  target[1] = ((hex >> 8) & 0xff) / 255;
  target[2] = (hex & 0xff) / 255;
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
 * Builds an instance of ours. `GpuProgram.from` caches by source, so every view of a kind shares
 * one program. No `glProgram`: the engine draws with WebGPU only.
 *
 * @param pixi - The module the renderer loaded.
 * @param definition - The filter definition.
 * @param value - The stored filter value.
 * @returns The instance.
 */
function createOurs(
  pixi: PixiModule,
  definition: FilterDefinition,
  value: Readonly<FilterFields>
): FilterInstance {
  const { source } = definition;
  const gpuProgram = pixi.GpuProgram.from({
    name: definition.id,
    vertex: { source, entryPoint: "mainVertex" },
    fragment: { source, entryPoint: "mainFragment" }
  });
  const structures: Record<string, UniformStructure> = {};

  for (const uniform of definition.uniforms) {
    structures[uniform.name] = { value: startValue(uniform, value), type: uniform.type };
  }

  const group = definition.uniforms.length > 0 ? new pixi.UniformGroup(structures) : undefined;
  const filter = new pixi.Filter({
    gpuProgram,
    resources: group === undefined ? {} : { fu: group },
    padding: paddingOf(definition, value)
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
 * Builds a `Displacement` over a map sprite the instance owns.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param value - The stored `Displacement` value.
 * @returns The instance, or `undefined` while the map is not loaded.
 */
function createDisplacement(
  ectx: EffectsCtx,
  pixi: PixiModule,
  value: Readonly<FilterFields>
): FilterInstance | undefined {
  const map = typeof value.map === "string" ? value.map : "";
  const texture = mapTexture(ectx, map);

  if (texture === undefined) return undefined;

  const sprite = new pixi.Sprite(texture);
  const filter = new pixi.DisplacementFilter({
    sprite,
    scale: { x: numberOf(value, "scaleX"), y: numberOf(value, "scaleY") }
  });

  return { kind: "displacement", filter, sprite, map, passes: 1 };
}

/**
 * Builds the Pixi class of a core kind from its stored value.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param core - The core kind.
 * @param value - The stored filter value.
 * @returns The instance, or `undefined` for a `Displacement` whose map is not loaded.
 */
function createCore(
  ectx: EffectsCtx,
  pixi: PixiModule,
  core: CoreKind,
  value: Readonly<FilterFields>
): FilterInstance | undefined {
  switch (core) {
    case "blur": {
      const quality = blurQuality(ectx, value);
      const filter = new pixi.BlurFilter({
        strength: numberOf(value, "strength"),
        quality,
        resolution: blurResolution(ectx, value)
      });

      filter.repeatEdgePixels = value.repeatEdgePixels === true;

      return { kind: "blur", filter, passes: 2 * quality };
    }
    case "colorMatrix": {
      const filter = new pixi.ColorMatrixFilter();

      composeMatrix(filter, value);

      return { kind: "colorMatrix", filter, passes: 1 };
    }
    case "noise": {
      const filter = new pixi.NoiseFilter({
        noise: numberOf(value, "amount"),
        seed: numberOf(value, "seed")
      });

      return { kind: "noise", filter, passes: 1 };
    }
    case "displacement": {
      return createDisplacement(ectx, pixi, value);
    }
    default: {
      return {
        kind: "alpha",
        filter: new pixi.AlphaFilter({ alpha: numberOf(value, "alpha") }),
        passes: 1
      };
    }
  }
}

/**
 * Builds the instance of one kind on one view, its uniforms or settings at the stored value and
 * its `enabled` switch set.
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
  const instance =
    kind.source === "wgsl"
      ? createOurs(pixi, kind.definition, value)
      : createCore(ectx, pixi, kind.core, value);

  if (instance !== undefined) instance.filter.enabled = value.enabled;

  return instance;
}

/**
 * Writes the uniforms of one of ours: every uniform, every frame, no `update()` (a non-static
 * group uploads every draw), and the live padding.
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
    const uniforms: UniformValues = instance.group.uniforms;

    for (const uniform of definition.uniforms) {
      const target = uniforms[uniform.name];

      if (uniform.form === "number") uniforms[uniform.name] = numberOf(value, uniform.name);
      else if (!(target instanceof Float32Array)) continue;
      else if (uniform.form === "color") writeColor(target, numberOf(value, uniform.name));
      else target.set(vectorOf(value, uniform.name).slice(0, uniform.size));
    }
  }

  if (typeof definition.padding === "string")
    instance.filter.padding = paddingOf(definition, value);
}

/**
 * Writes a core kind through its setters. Called only when the component changed this frame.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param instance - The instance.
 * @param value - The stored filter value.
 */
function writeCore(
  ectx: EffectsCtx,
  instance: FilterInstance,
  value: Readonly<FilterFields>
): void {
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

      const map = typeof value.map === "string" ? value.map : "";
      const texture = map === instance.map ? undefined : mapTexture(ectx, map);

      if (texture === undefined) return;

      instance.sprite.texture = texture;
      instance.map = map;

      return;
    }
    case "alpha": {
      instance.filter.alpha = numberOf(value, "alpha");

      return;
    }
    default: {
      return;
    }
  }
}

/**
 * Writes one instance for a frame: `enabled` always (a disabled filter costs nothing and is
 * reassigned nothing), the uniforms of ours always, a core kind when its component changed.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param instance - The instance.
 * @param value - The stored filter value.
 * @param changed - Whether `ecs.changed(Kind)` holds the entity this frame.
 */
export function writeFilter(
  ectx: EffectsCtx,
  instance: FilterInstance,
  value: Readonly<FilterFields>,
  changed: boolean
): void {
  instance.filter.enabled = value.enabled;

  if (instance.kind === "wgsl") writeOurs(instance, instance.definition, value);
  else if (changed) writeCore(ectx, instance, value);
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
