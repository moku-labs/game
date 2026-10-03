/**
 * @file effects/filters — type definitions: what `defineFilter` takes and returns, the values of
 * the built-in filter components, and what the filter sync keeps per kind and per view.
 */
import type { FilterSlot, PixiFilter, PixiModule, PixiSprite } from "../../renderer/types";
import type { ComponentHandle, ComponentType } from "../../world/types";

/**
 * One uniform of a custom filter, as declared: a number is an `f32` (`float` in GLSL), `{ color }`
 * a `0xrrggbb` hex sent as a `vec3<f32>` (`vec3`), a tuple of 2 to 4 numbers a `vecN<f32>`
 * (`vecN`).
 *
 * @example
 * ```ts
 * const uniforms: Record<string, UniformDeclaration> = { amount: 0.5, color: { color: 0xffd700 }, offset: [2, 2] };
 * ```
 */
export type UniformDeclaration =
  | number
  | { readonly color: number }
  | readonly [number, number]
  | readonly [number, number, number]
  | readonly [number, number, number, number];

/**
 * The component field a uniform declaration becomes: a number for a number and for a colour, a
 * list of numbers for a tuple.
 *
 * @example
 * ```ts
 * type Amount = UniformValue<0.5>; // number
 * ```
 */
export type UniformValue<Declaration> = Declaration extends number
  ? number
  : Declaration extends { readonly color: number }
    ? number
    : readonly number[];

/**
 * The value of a filter component made by `defineFilter`: one field per uniform, then `enabled`
 * and `order`.
 *
 * @example
 * ```ts
 * type TintValue = FilterValueOf<{ amount: number; color: { color: number } }>;
 * // { amount: number; color: number; enabled: boolean; order: number }
 * ```
 */
export type FilterValueOf<Uniforms extends Record<string, UniformDeclaration>> = {
  -readonly [Name in keyof Uniforms]: UniformValue<Uniforms[Name]>;
} & { enabled: boolean; order: number };

/**
 * What `defineFilter` takes besides the id. Both bodies are required, so the filter draws on
 * WebGPU and on the WebGL fallback: `wgsl` is the WGSL fragment body only, the engine prepends the
 * vertex stage, the input bindings and the `FilterUniforms` struct; `glsl` is its GLSL ES 3.0 twin
 * over the same uniform names, the engine prepends the version, the inputs, `finalColor` and one
 * `uniform` per declared uniform.
 *
 * @example
 * ```ts
 * const spec: FilterSpec<{ amount: number }> = {
 *   wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv) * fu.amount; }",
 *   glsl: "void main() { finalColor = texture(uTexture, vTextureCoord) * amount; }",
 *   uniforms: { amount: 1 }
 * };
 * ```
 */
export type FilterSpec<Uniforms extends Record<string, UniformDeclaration>> = {
  /** The WGSL fragment body: `fn mainFragment` and its helpers, without the engine's header. */
  readonly wgsl: string;
  /**
   * The GLSL ES 3.0 fragment body: `void main()`, which sets `finalColor`, and its helpers, without
   * the engine's header. It reads each uniform under its bare name: `amount`, not `fu.amount`.
   */
  readonly glsl: string;
  /** The uniforms in struct order. Default `{}`. */
  readonly uniforms?: Uniforms;
  /** Render passes one apply of the filter costs, an integer of at least 1. Default `1`. */
  readonly passes?: number;
  /** Pixels around the view's bounds, or the name of a number uniform whose live value they are. Default `0`. */
  readonly padding?: number | string;
};

/**
 * How one uniform travels to the GPU: its name, its WGSL type and the form it was declared in.
 *
 * @example
 * ```ts
 * const spec: UniformSpec = { name: "color", type: "vec3<f32>", form: "color", size: 3 };
 * ```
 */
export type UniformSpec = {
  readonly name: string;
  readonly type: "f32" | "vec2<f32>" | "vec3<f32>" | "vec4<f32>";
  readonly form: "number" | "color" | "vector";
  readonly size: number;
};

/**
 * The filter a component made by `defineFilter` carries: the assembled WGSL in `source`, the
 * assembled GLSL in `glsl`, the uniforms in struct order, the passes one apply costs and the
 * padding.
 *
 * @example
 * ```ts
 * Tint.filter.source.includes("fn mainFragment"); // true: the WGSL, drawn on WebGPU
 * Tint.filter.glsl.startsWith("#version 300 es"); // true: the GLSL, drawn on WebGL
 * Tint.filter.uniforms.map(uniform => uniform.name); // ["amount", "color"]
 * ```
 */
export type FilterDefinition = {
  readonly id: string;
  /** The assembled WGSL: the engine's header, the uniform struct, the body. */
  readonly source: string;
  /** The assembled GLSL ES 3.0: the engine's header, one `uniform` per uniform, the body. */
  readonly glsl: string;
  readonly uniforms: readonly UniformSpec[];
  readonly passes: number;
  readonly padding: number | string;
};

/**
 * A filter component type: the `component()` of its id, with the filter definition attached. Its
 * numeric fields are tweenable like any component.
 *
 * @example
 * ```ts
 * const Tint: FilterComponent<{ amount: number; enabled: boolean; order: number }> =
 *   defineFilter("fx.tint", { wgsl: tintWgsl, glsl: tintGlsl, uniforms: { amount: 0 } });
 * Tint.componentName; // "fx.tint"
 * ```
 */
export type FilterComponent<Value extends object> = ComponentType<Value> & {
  readonly filter: FilterDefinition;
};

/**
 * One field of a stored filter value: a number, a switch, an asset key or a vector.
 *
 * @example
 * ```ts
 * const field: FilterField = 0.5;
 * ```
 */
export type FilterField = number | boolean | string | readonly number[];

/**
 * The stored value of any filter component, with the kind erased: the filter sync reads every
 * kind through it.
 */
export type FilterFields = {
  readonly enabled: boolean;
  readonly order: number;
  readonly [field: string]: FilterField;
};

/**
 * `Glow`: a soft halo of `color` around the opaque pixels of the view.
 *
 * @example
 * ```ts
 * const value: GlowValue = { strength: 2, distance: 10, color: 0xffffff, alpha: 1, enabled: true, order: 0 };
 * ```
 */
export type GlowValue = {
  strength: number;
  distance: number;
  color: number;
  alpha: number;
  enabled: boolean;
  order: number;
};

/**
 * `Outline`: a ring of `thickness` pixels in `color` around the opaque pixels of the view.
 *
 * @example
 * ```ts
 * const value: OutlineValue = { thickness: 2, color: 0x000000, alpha: 1, enabled: true, order: 0 };
 * ```
 */
export type OutlineValue = {
  thickness: number;
  color: number;
  alpha: number;
  enabled: boolean;
  order: number;
};

/**
 * `Blur`: Pixi's blur. `quality: 0` means `config.blur.quality`; `resolution: 0` means
 * `config.blur.phoneResolution` on a phone, otherwise 1.
 *
 * @example
 * ```ts
 * const value: BlurValue = { strength: 8, quality: 0, resolution: 0, repeatEdgePixels: true, enabled: true, order: 0 };
 * ```
 */
export type BlurValue = {
  strength: number;
  quality: number;
  resolution: number;
  repeatEdgePixels: boolean;
  enabled: boolean;
  order: number;
};

/**
 * `ColorMatrix`: brightness, saturation, contrast, hue and grayscale composed in that order.
 * Every default is the identity.
 *
 * @example
 * ```ts
 * const value: ColorMatrixValue = { brightness: 1, saturation: 0, contrast: 0, hue: 0, grayscale: 1, enabled: true, order: 0 };
 * ```
 */
export type ColorMatrixValue = {
  brightness: number;
  saturation: number;
  contrast: number;
  hue: number;
  grayscale: number;
  enabled: boolean;
  order: number;
};

/**
 * `Noise`: Pixi's noise with its seed always given, so two runs draw the same grain.
 *
 * @example
 * ```ts
 * const value: NoiseValue = { amount: 0.5, seed: 7, enabled: true, order: 0 };
 * ```
 */
export type NoiseValue = { amount: number; seed: number; enabled: boolean; order: number };

/**
 * `Displacement`: Pixi's displacement over the texture of an asset key.
 *
 * @example
 * ```ts
 * const value: DisplacementValue = { map: "fx.ripple", scaleX: 20, scaleY: 20, enabled: true, order: 0 };
 * ```
 */
export type DisplacementValue = {
  map: string;
  scaleX: number;
  scaleY: number;
  enabled: boolean;
  order: number;
};

/**
 * `Alpha`: Pixi's alpha over the whole subtree, as one layer.
 *
 * @example
 * ```ts
 * const value: AlphaValue = { alpha: 0.5, enabled: true, order: 0 };
 * ```
 */
export type AlphaValue = { alpha: number; enabled: boolean; order: number };

/**
 * The five built-in kinds drawn by a Pixi core filter.
 *
 * @example
 * ```ts
 * const kind: CoreKind = "blur";
 * ```
 */
export type CoreKind = "blur" | "colorMatrix" | "noise" | "displacement" | "alpha";

/**
 * Where a filter kind comes from: our or a game's shaders (`"wgsl"`, with the GLSL twin beside
 * it), or a Pixi core filter.
 */
export type KindSource =
  | { readonly source: "wgsl"; readonly definition: FilterDefinition }
  | { readonly source: "core"; readonly core: CoreKind };

/**
 * A filter kind before it is registered: its id, its component and its source.
 */
export type KindEntry = KindSource & {
  readonly id: string;
  readonly component: ComponentHandle<FilterFields>;
};

/**
 * One registered filter kind. `index` is the registration order: the built-ins first, then the
 * filters of every feature in feature order.
 */
export type FilterKind = KindEntry & { readonly index: number };

/**
 * The values of the uniform group of one of our filter instances: a number per `f32`, a vector
 * per colour and tuple. Written every frame.
 */
export type UniformValues = Record<string, number | Float32Array>;

/**
 * The uniform group of one of our filter instances, as the instance writes it.
 */
export type FilterUniforms = { readonly uniforms: UniformValues };

/**
 * The Pixi object of one kind on one view, with the passes one apply of it costs now: what the
 * builders of `instance.ts` make before the instance gets its sort keys.
 */
export type FilterBody =
  | {
      readonly kind: "wgsl";
      readonly filter: PixiFilter;
      readonly group: FilterUniforms | undefined;
      readonly definition: FilterDefinition;
      passes: number;
    }
  | {
      readonly kind: "blur";
      readonly filter: InstanceType<PixiModule["BlurFilter"]>;
      passes: number;
    }
  | {
      readonly kind: "colorMatrix";
      readonly filter: InstanceType<PixiModule["ColorMatrixFilter"]>;
      passes: number;
    }
  | {
      readonly kind: "noise";
      readonly filter: InstanceType<PixiModule["NoiseFilter"]>;
      passes: number;
    }
  | {
      readonly kind: "displacement";
      readonly filter: InstanceType<PixiModule["DisplacementFilter"]>;
      readonly sprite: PixiSprite;
      /** The asset key the map sprite shows now. */
      map: string;
      passes: number;
    }
  | {
      readonly kind: "alpha";
      readonly filter: InstanceType<PixiModule["AlphaFilter"]>;
      passes: number;
    };

/**
 * The instance of one kind on one view: its Pixi object, and what it sorts by on the view, the
 * `order` of its component (written every frame) and the `index` of its kind.
 */
export type FilterInstance = FilterBody & { order: number; readonly index: number };

/**
 * What the filter sync keeps for one entity: the kinds it carries, one instance per kind, the
 * instances waiting to be destroyed after the next assignment, the slots last handed to
 * `renderer.sync.filters.set`, the core kinds whose component changed this frame, and the
 * instances of this frame in their sorted order (one array, reused every frame).
 */
export type FilteredView = {
  readonly kinds: Set<string>;
  readonly instances: Map<string, FilterInstance>;
  readonly retired: FilterInstance[];
  assigned: readonly FilterSlot[];
  readonly changed: Set<string>;
  readonly placed: FilterInstance[];
};
