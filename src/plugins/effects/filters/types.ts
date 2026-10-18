/**
 * @file effects/filters — type definitions: what `defineFilter` takes and returns, the values of
 * the built-in filter components, and what the filter sync keeps per kind and per view.
 */
import type {
  FilterCache,
  FilterSlot,
  FilterSlotInputs,
  PixiFilter,
  PixiModule,
  PixiSprite,
  PixiTexture
} from "../../renderer/types";
import type { ComponentHandle, ComponentType, Entity } from "../../world/types";

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
 * A rectangle in the filtered entity's own units — the space its box, its hit box and its children's positions are in
 * (reference units for a view at the root without scale): x, y, width, height.
 *
 * @example
 * ```ts
 * // A lens disc of reach 88 around (195, 189): the 176 × 176 box it can draw in.
 * const area: FilterArea = [107, 101, 176, 176];
 * ```
 */
export type FilterArea = readonly [x: number, y: number, width: number, height: number];

/**
 * What `defineFilter` takes besides the id. Both bodies are required, so the filter draws on
 * WebGPU and on the WebGL fallback: `wgsl` is the WGSL fragment body only, the engine prepends the
 * vertex stage, the input bindings and the `FilterUniforms` struct; `glsl` is its GLSL ES 3.0 twin
 * over the same uniform names, the engine prepends the version, the inputs, `finalColor` and one
 * `uniform` per declared uniform.
 *
 * @example
 * ```ts
 * // A Memory Missing's frost: the body reads a blurred copy of the scene through sampleBlur(uv).
 * const Frost = defineFilter("Frost", {
 *   wgsl: FROST_WGSL,
 *   glsl: FROST_GLSL,
 *   uniforms: { view: [0, 0, 1], rectA: [0, 0, 0, 0], strength: 16, vivid: 1.2 },
 *   inputs: { blur: { stages: [FrostBox4, FrostHalf, FrostGauss], chain: frostChain } },
 *   fallback: FrostVeil
 * });
 * Frost.filter.fallback?.id; // "FrostVeil"
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
  /**
   * Second textures the body reads, by name: `blur` declares `sampleBlur(uv)` in the WGSL and the GLSL, with the
   * texture, its sampler and two uniforms the engine fills. Leave `passes` out: the engine counts them. Default none.
   */
  readonly inputs?: Readonly<Record<string, FilterInput<FilterValueOf<Uniforms>>>>;
  /**
   * What draws instead when the filter is broken (its shader or a stage does not compile on the device, its apply
   * throws, its chain fails): another filter over a subset of its uniforms, with the same value. Default none: a broken
   * filter leaves its view unfiltered.
   */
  readonly fallback?: FilterStage;
  /**
   * What the renderer may do with a view this filter draws on, while nothing it depends on changes: `"local"` (the
   * default) keeps it as a picture, also while the view moves; `"placed"` keeps it with its canvas origin, for a body
   * that reads where it is drawn through `canvasPixel(uv)` (a body that calls the helper is placed by itself); set
   * `false` for a body whose look depends on where the view is drawn in a way the engine cannot see (a time read from
   * a texture, a hash of the screen position): the view is then drawn live in every frame. A body that reads
   * `uGlobalFrame`, `@builtin(position)`, `gl_FragCoord`, `uOutputTexture` or the origin of `uOutputFrame` and
   * declares nothing is drawn live as well, and a dev build warns once: declare `cache: false`.
   */
  readonly cache?: "local" | "placed" | false;
  /**
   * The rectangle outside of which this filter draws nothing, in the filtered entity's own units, from the component's
   * value; `undefined` for "the view's bounds" (the default). Outside it Pixi draws nothing of the view at all — neither
   * the filter nor the view's own content — so declare it only for a filter whose output is transparent there. A view
   * with several enabled filters gets the union; a view with an enabled filter that declares no area gets none. Called
   * only when the value changed.
   */
  readonly area?: (value: Readonly<FilterValueOf<Uniforms>>) => FilterArea | undefined;
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
 * assembled GLSL in `glsl`, the uniforms in struct order, the passes one apply costs, the
 * padding, the second textures the body reads and the filter drawn in its place when it is broken.
 *
 * @example
 * ```ts
 * Tint.filter.source.includes("fn mainFragment"); // true: the WGSL, drawn on WebGPU
 * Tint.filter.glsl.startsWith("#version 300 es"); // true: the GLSL, drawn on WebGL
 * Tint.filter.uniforms.map(uniform => uniform.name); // ["amount", "color"]
 * Tint.filter.inputs.length; // 0: it reads no second texture
 * Tint.filter.cache; // "local": a still view under it is drawn from a picture
 * ```
 */
export type FilterDefinition = {
  readonly id: string;
  /** The assembled WGSL: the engine's header, the uniform struct, the input bindings, the body. */
  readonly source: string;
  /** The assembled GLSL ES 3.0: the engine's header, one `uniform` per uniform, the inputs, the body. */
  readonly glsl: string;
  readonly uniforms: readonly UniformSpec[];
  readonly passes: number;
  readonly padding: number | string;
  /** The second textures the body reads, in declaration order; empty for a filter with none. */
  readonly inputs: readonly FilterInputDefinition[];
  /** What draws in its place when it is broken: another definition over a subset of its uniforms. */
  readonly fallback: FilterDefinition | undefined;
  /** What the kept-picture cache may do with it: the worst of its declaration, its body and its stages' bodies. */
  readonly cache: FilterCache;
  /**
   * The engine's `keptOrigin` uniform (`vec2<f32>`) of a body that calls `canvasPixel(uv)`, kept out of `uniforms`;
   * `undefined` for any other body.
   */
  readonly origin: UniformSpec | undefined;
  /** The rectangle outside of which the filter draws nothing, from the value; present only when the spec gave one. */
  readonly area?: (value: Readonly<FilterFields>) => FilterArea | undefined;
};

/**
 * A filter a chain may draw: any component `defineFilter` made. Listed in an input's `stages` and named by its steps.
 * A built-in Pixi-core kind (`Blur`, `ColorMatrix`, …) has no `filter` and cannot be a stage.
 *
 * @example
 * ```ts
 * const FrostGauss = defineFilter("FrostGauss", { wgsl: gaussWgsl, glsl: gaussGlsl, uniforms: { dir: [0, 0], sigma: 0 } });
 * const stages: readonly FilterStage[] = [FrostBox4, FrostHalf, FrostGauss];
 * stages.map(stage => stage.filter.id); // ["FrostBox4", "FrostHalf", "FrostGauss"]
 * ```
 */
export type FilterStage = {
  readonly componentName: string;
  readonly defaults: object;
  readonly filter: FilterDefinition;
};

/**
 * One step of a chain: the stage that draws, the share of the input's resolution it draws at, and the stage uniforms
 * of this step. A uniform the step leaves out takes the stage's default. A colour is a `0xrrggbb` number.
 *
 * @example
 * ```ts
 * // A Gaussian along x at an eighth of the resolution of the view's input.
 * const step: FilterStep = { stage: FrostGauss, scale: 1 / 8, uniforms: { dir: [1, 0], sigma: 4.66 } };
 * ```
 */
export type FilterStep = {
  readonly stage: FilterStage;
  /** Above 0 and at most 1: the target of this step has `scale` × the resolution of the view's input. */
  readonly scale: number;
  readonly uniforms?: Readonly<Record<string, number | readonly number[]>>;
};

/**
 * What a chain is told besides the value: the real pixels per CSS pixel of the texture the view is drawn into (the
 * canvas resolution for a view at the top, less under a filter of lower resolution).
 *
 * @example
 * ```ts
 * // The owner's phone at maxResolution 3: 16 units of blur are 37 real pixels, an eighth is enough.
 * frostChain({ ...Frost().value, strength: 16, view: [0, 0, 384 / 390] }, { resolution: 2.8125 }).map(step => step.scale);
 * // [0.25, 0.125, 0.125, 0.125]
 * ```
 */
export type FilterChainContext = { readonly resolution: number };

/**
 * A second texture the body of a filter reads, named by its key in `inputs`: `blur` gives the body
 * `sampleBlur(uv)`. `chain` returns the steps that draw it from the view's own input, each from the one before;
 * the body reads the last one. `stages` lists every filter the chain may name: they are checked on the device and
 * warmed up before the first draw, and a step naming another one is refused. The chain runs again only when a uniform
 * of the value or the resolution changed, never per frame; it may return `[]`, and the body then reads the view's own
 * input.
 *
 * @example
 * ```ts
 * const input: FilterInput<{ strength: number; enabled: boolean; order: number }> = {
 *   stages: [FrostHalf, FrostGauss],
 *   chain: (value, { resolution }) => [
 *     { stage: FrostHalf, scale: 1 / 2 },
 *     { stage: FrostGauss, scale: 1 / 2, uniforms: { dir: [1, 0], sigma: (value.strength * resolution) / 2 } },
 *     { stage: FrostGauss, scale: 1 / 2, uniforms: { dir: [0, 1], sigma: (value.strength * resolution) / 2 } }
 *   ]
 * };
 * ```
 */
export type FilterInput<Value> = {
  readonly stages: readonly FilterStage[];
  /**
   * The steps of the second texture for this value and resolution. Pure: no state, no randomness; the context object
   * is the engine's and valid during the call only.
   *
   * @param value - The stored value of the filter component.
   * @param context - The resolution of the texture the view is drawn into.
   * @returns The steps in draw order, at most 16.
   * @example
   * ```ts
   * // A quarter is enough at one real pixel per CSS pixel: the box, then the Gaussian along x and along y.
   * Frost.filter.inputs[0]?.chain({ ...Frost().value, strength: 16, view: [0, 0, 1] }, { resolution: 1 }).length; // 3
   * ```
   */
  chain(value: Readonly<Value>, context: FilterChainContext): readonly FilterStep[];
};

/**
 * An input as `defineFilter` stored it: the names the engine declared for it in both shader languages, its two
 * uniforms, its stages and its chain.
 *
 * @example
 * ```ts
 * const [blur] = Frost.filter.inputs;
 * [blur?.texture, blur?.sampler, blur?.scale.name, blur?.clamp.name, blur?.sample];
 * // ["blurTexture", "blurSampler", "blurScale", "blurClamp", "sampleBlur"]
 * ```
 */
export type FilterInputDefinition = {
  readonly name: string;
  readonly texture: string;
  readonly sampler: string;
  readonly scale: UniformSpec;
  readonly clamp: UniformSpec;
  readonly sample: string;
  readonly stages: readonly FilterStage[];
  readonly chain: FilterInput<FilterFields>["chain"];
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
 * per colour and tuple. Written where they differ from the stored value.
 */
export type UniformValues = Record<string, number | Float32Array>;

/**
 * The uniform group of one of our filter instances, as the instance writes it.
 */
export type FilterUniforms = { readonly uniforms: UniformValues };

/**
 * The Pixi object of one kind on one view, with the passes one apply of it costs now: what the
 * builders of `instance.ts` make before the instance gets its sort keys. A Pixi-core kind keeps
 * the fields its setters were last given, `applied`, so an equal value calls no setter.
 */
export type FilterBody =
  | {
      readonly kind: "wgsl";
      readonly filter: PixiFilter;
      readonly group: FilterUniforms | undefined;
      readonly definition: FilterDefinition;
      passes: number;
      /** The chains and their places; `undefined` for a definition without inputs. Set once, by `createFilter`. */
      inputs: InputsState | undefined;
      /** The dev mark drawn after the fallback by a stand-in (E5.4); `undefined` otherwise. */
      readonly mark: OursBody | undefined;
      /** The definition's last area answer, filled in place; `some: false` for `undefined` (B4). */
      readonly area: AreaBox;
      /** The value changed since the area was last asked: the next sync asks the definition again. */
      areaStale: boolean;
    }
  | {
      readonly kind: "blur";
      readonly filter: InstanceType<PixiModule["BlurFilter"]>;
      /** The fields the setters were last given; compared before a write. */
      readonly applied: Record<string, FilterField>;
      /** The keys of `applied`, listed once: a compare walks them by index, with no `Object.keys` per frame. */
      readonly fields: readonly string[];
      passes: number;
    }
  | {
      readonly kind: "colorMatrix";
      readonly filter: InstanceType<PixiModule["ColorMatrixFilter"]>;
      /** The fields the setters were last given; compared before a write. */
      readonly applied: Record<string, FilterField>;
      /** The keys of `applied`, listed once: a compare walks them by index, with no `Object.keys` per frame. */
      readonly fields: readonly string[];
      passes: number;
    }
  | {
      readonly kind: "noise";
      readonly filter: InstanceType<PixiModule["NoiseFilter"]>;
      /** The fields the setters were last given; compared before a write. */
      readonly applied: Record<string, FilterField>;
      /** The keys of `applied`, listed once: a compare walks them by index, with no `Object.keys` per frame. */
      readonly fields: readonly string[];
      passes: number;
    }
  | {
      readonly kind: "displacement";
      readonly filter: InstanceType<PixiModule["DisplacementFilter"]>;
      readonly sprite: PixiSprite;
      /** The fields the setters were last given; compared before a write. */
      readonly applied: Record<string, FilterField>;
      /** The keys of `applied`, listed once: a compare walks them by index, with no `Object.keys` per frame. */
      readonly fields: readonly string[];
      /** The asset key the map sprite shows now. */
      map: string;
      passes: number;
    }
  | {
      readonly kind: "alpha";
      readonly filter: InstanceType<PixiModule["AlphaFilter"]>;
      /** The fields the setters were last given; compared before a write. */
      readonly applied: Record<string, FilterField>;
      /** The keys of `applied`, listed once: a compare walks them by index, with no `Object.keys` per frame. */
      readonly fields: readonly string[];
      passes: number;
    };

/**
 * A probe of the warm-up (spec 27 F4): the Pixi filter handed to `renderer.sync.filters.warm`, and its teardown.
 */
export type WarmProbe = { readonly filter: PixiFilter; destroy(): void };

/**
 * A filter area as the filter sync keeps it, written in place: the four numbers, and whether there is one.
 */
export type AreaBox = { x: number; y: number; width: number; height: number; some: boolean };

/**
 * The instance of one kind on one view: its Pixi object, and what it sorts by on the view, the
 * `order` of its component (written every frame) and the `index` of its kind. The instance is
 * the object the builder made, never a copy: a closure made while building (the apply guard)
 * reads and writes the same fields the filter sync does.
 */
export type FilterInstance = FilterBody & {
  order: number;
  readonly index: number;
  /** True once the instance broke (its apply threw, its chain failed): it stays broken until it is retired. */
  broken: boolean;
  /** The value the filter sync handed over last: the chain and a stand-in are built from it. */
  value: Readonly<FilterFields>;
  /** The kind this instance draws for; a stand-in carries the id of the kind it stands in for. */
  readonly kindId: string;
  /** True for an instance that draws in place of a broken kind or instance (E5). */
  readonly standIn: boolean;
  /** A stand-in built while this broken instance was drawing; the next sync puts it in its place. */
  replacement: FilterInstance | undefined;
  /**
   * The entity of the view it draws on, set when the filter sync takes it in; 0 for a warm-up probe. A break inside a
   * render tells the renderer about this view (`renderer.invalidate`) before it switches the filter off.
   */
  entity: Entity;
};

/**
 * One of our bodies: a `Filter` over the assembled programs, the kind of every place of a chain and of a mark.
 */
export type OursBody = Extract<FilterBody, { kind: "wgsl" }>;

/** One place of a chain: the Pixi filter that draws the stage there, and the share of the resolution it draws at. */
export type Place = {
  readonly definition: FilterDefinition;
  readonly body: OursBody;
  scale: number;
};

/**
 * The chains of one instance of a filter with inputs: what draws each second texture, and the seam spec 23 keeps
 * pictures through.
 */
export type InputsState = {
  /** A uniform of the value changed since the last evaluation (set by `writeFilter`). */
  stale: boolean;
  /** The resolution of the last evaluation. */
  resolution: number;
  /** Changes whenever what the stages draw changes; 1 after the first evaluation. */
  version: number;
  /** The object `chain` receives, reused: its `resolution` is written before each call. */
  readonly context: { resolution: number };
  /** Per input, its places in draw order (each with the scale of its step). */
  readonly places: Place[][];
  /** Bodies of places that left the chain, destroyed by the next sync. */
  readonly retired: OursBody[];
  /** Pooled textures taken by the running apply; emptied in its `finally`. One array, reused. */
  readonly taken: PixiTexture[];
  /** The options object handed to `TexturePool.getOptimalTexture`, reused. */
  readonly request: { width: number; height: number; resolution: number };
  /** Results lent by spec 23: while set, the apply draws the main body only, over them. */
  held: readonly PixiTexture[] | undefined;
  /** The slot seam, a frozen object replaced when a place is built or dropped. */
  slot: FilterSlotInputs;
};

/**
 * Where the shader check of every definition a kind can draw stands, in every build: one run per start of the
 * plugin.
 */
export type CheckState = {
  /** Bumped by `stopEffects`: an answer of an earlier run is ignored. */
  run: number;
  /** The checks were started on the running backend. */
  started: boolean;
  /** Where each definition stands. */
  status: WeakMap<FilterDefinition, "pending" | "ok" | "broken">;
  /** Definitions still pending. */
  waiting: number;
  /** Definitions started, for the `effects:checks` line. */
  checked: number;
  /** Definitions that failed, for the `effects:checks` line. */
  failed: number;
  /** GLSL compiles in flight under `KHR_parallel_shader_compile`. */
  gl: Array<{ definition: FilterDefinition; shader: WebGLShader }>;
  /** `performance.now()` when the checks started, for the `effects:checks` line. */
  startedAt: number;
  /** Resolves when `started` and `waiting === 0`. */
  settled: Promise<void>;
  /** Resolves `settled`. */
  resolve: () => void;
};

/**
 * What the filter sync keeps for one entity: the kinds it carries, one instance per kind, the
 * instances waiting to be destroyed after the next assignment, the slots last handed to
 * `renderer.sync.filters.set`, the run in which each core kind's component last changed, the
 * instances of this frame in their sorted order (one array, reused every frame), the one
 * `renderer.invalidate` call a visible filter write of the frame makes, and whether the next run
 * syncs it.
 */
export type FilteredView = {
  /** The entity the record is kept for. */
  readonly entity: Entity;
  readonly kinds: Set<string>;
  readonly instances: Map<string, FilterInstance>;
  readonly retired: FilterInstance[];
  assigned: readonly FilterSlot[];
  /**
   * Per kind `index`, the run of the filter sync in which its component was last seen changed; read only for a
   * Pixi-core kind, which is written only in such a run. A number per kind, so marking allocates nothing.
   */
  readonly marks: number[];
  readonly placed: FilterInstance[];
  /** True once `renderer.invalidate` was called for this view in the current frame. */
  signalled: boolean;
  /** Calls `renderer.invalidate(entity)` once per frame for this view, before the write; made once with the record. */
  readonly signal: () => void;
  /** The area last handed to `renderer.sync.filters.area`, written in place (B4). */
  readonly areaSent: AreaBox;
  /** The `enabled` switches of the placed instances when the area was last judged, one bit each in placed order. */
  areaMask: number;
  /**
   * The next run of the filter sync brings the view up to date: a filter component of it changed, came or left, its
   * map was retired, a kind of it still waits for its instance, or a chain left places to destroy.
   */
  dirty: boolean;
  /** Forgotten: out of `State.views`; the next run drops it from `State.viewList`. */
  gone: boolean;
};

/**
 * Where the filter sync stands between two runs. It syncs only the views marked dirty, and judges the full-screen
 * budget only when something it depends on moved.
 */
export type FilterSyncState = {
  /** The current run, counted from 1: a core kind's change mark holds the run it was made in. */
  round: number;
  /**
   * Every view syncs at the next run: a debug switch turned a kind off or on, or a filter broke or ran its chains at a
   * new resolution inside a render, where the view it belongs to is not known.
   */
  all: boolean;
  /** A view was marked dirty or forgotten since the last walk: the next run walks the dense list, otherwise it skips it. */
  pending: boolean;
  /** The viewport width the full-screen budget was last judged at; -1 before the first judgement. */
  width: number;
  /** The viewport height the full-screen budget was last judged at; -1 before the first judgement. */
  height: number;
};
