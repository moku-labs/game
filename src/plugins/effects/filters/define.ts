/**
 * @file effects/filters — `defineFilter`: a WGSL fragment body and its GLSL twin become a flat
 * component type with its filter attached, with the second textures the body reads (`inputs`) and
 * the filter drawn in its place when it is broken (`fallback`). Pure: no ctx, no device; every
 * shader a kind can draw is checked on the running backend when the renderer first draws, in
 * every build, by the filter sync.
 */
import type { FilterCache } from "../../renderer/types";
import { component } from "../../world/ecs/define";
import { assembleGlsl } from "./glsl";
import type {
  FilterComponent,
  FilterDefinition,
  FilterField,
  FilterInput,
  FilterInputDefinition,
  FilterSpec,
  FilterStage,
  FilterValueOf,
  UniformDeclaration,
  UniformSpec
} from "./types";
import { assemble } from "./wgsl";

/** The most inputs one filter reads: each is a texture the body samples. */
const MAX_INPUTS = 4;

/** What a uniform name looks like: a WGSL member name the engine can also use as a field. */
const UNIFORM_NAME = /^[a-z][\dA-Za-z]*$/;

/** The fewest numbers a vector uniform holds: a `vec2`. */
const MIN_VECTOR_SIZE = 2;

/** The most numbers a vector uniform holds: a `vec4`. */
const MAX_VECTOR_SIZE = 4;

/** The WGSL type of a vector uniform, by its size minus `MIN_VECTOR_SIZE`. */
const VECTOR_TYPES: readonly UniformSpec["type"][] = ["vec2<f32>", "vec3<f32>", "vec4<f32>"];

/** What a WGSL body must define. */
const MAIN_FRAGMENT = /\bfn\s+mainFragment\s*\(/;

/** What a GLSL body must define. */
const MAIN_GLSL = /\bvoid\s+main\s*\(/;

/**
 * Names a uniform cannot take: the two fields every filter component carries, and the names the
 * shader headers declare, which a game uniform would clash with (on WebGL only, for most). The
 * GLSL header also declares `finalColor` and `vTextureCoord`.
 */
const RESERVED_NAME =
  /^(?:enabled|order|uInputSize|uInputPixel|uInputClamp|uOutputFrame|uGlobalFrame|uOutputTexture|uTexture|uSampler|finalColor|vTextureCoord|keptOrigin|canvasPixel)$/;

/**
 * What a body reads of the screen: the root target's frame, the fragment position, the output target's size, the
 * origin of the output frame (its size `.zw` is the same in a picture and live).
 */
const SCREEN_READS: readonly RegExp[] = [
  /\buGlobalFrame\b/,
  /@builtin\s*\(\s*position\s*\)/,
  /\bgl_FragCoord\b/,
  /\buOutputTexture\b/,
  /\buOutputFrame\b(?!\s*\.\s*[wz]{1,2}\b)/
];

/** A body that asks for its canvas position. */
const CANVAS_PIXEL_CALL = /\bcanvasPixel\s*\(/;

/** A line comment or a block comment of WGSL or GLSL. */
const COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

/** The engine's uniform of a body that calls `canvasPixel`: the canvas origin of a kept picture. */
const KEPT_ORIGIN: UniformSpec = Object.freeze({
  name: "keptOrigin",
  type: "vec2<f32>",
  form: "vector",
  size: 2
});

/**
 * Creates the set of the definitions whose bodies read the screen. A function: the module-scope rule sees no
 * collection literal.
 *
 * @returns An empty weak set.
 */
function emptyReaders(): WeakSet<FilterDefinition> {
  return new WeakSet();
}

/** The definitions whose bodies read the screen: a dev build warns about the ones that declared no `cache: false`. */
const screenReaders = emptyReaders();

/** How bad a category is for the cache, for "the worst of": a screen read beats a placed one beats a local one. */
const WORST: Readonly<Record<FilterCache, number>> = { local: 0, placed: 1, screen: 2 };

/**
 * The text of a shader body without its comments.
 *
 * @param body - A WGSL or GLSL body.
 * @returns The body, comments stripped.
 * @example
 * ```ts
 * codeOf("let a = 1; // uGlobalFrame"); // "let a = 1; "
 * ```
 */
function codeOf(body: string): string {
  return body.replaceAll(COMMENT, "");
}

/**
 * Tells whether a body reads the screen: `uGlobalFrame`, `@builtin(position)`, `gl_FragCoord`, `uOutputTexture` or
 * the origin of `uOutputFrame`, outside a comment.
 *
 * @param body - A WGSL or GLSL body the game wrote.
 * @returns True when it does.
 * @example
 * ```ts
 * readsScreenIn("let p = gfu.uOutputFrame.xy + uv * gfu.uInputSize.xy;"); // true
 * ```
 */
function readsScreenIn(body: string): boolean {
  const code = codeOf(body);

  return SCREEN_READS.some(read => read.test(code));
}

/**
 * The worst of two categories: the one the cache may do less with.
 *
 * @param a - One category.
 * @param b - The other.
 * @returns The worse one.
 * @example
 * ```ts
 * worstOf("local", "placed"); // "placed"
 * ```
 */
function worstOf(a: FilterCache, b: FilterCache): FilterCache {
  return WORST[b] > WORST[a] ? b : a;
}

/**
 * What the kept-picture cache may do with a filter, from what the game declared and what its bodies read only, never
 * the engine's header (LEAD-FIXES-4 item 3): `cache: false` is `"screen"`; a body that reads the screen and declares
 * nothing is `"screen"` too (the safe direction); a body that calls `canvasPixel` is `"placed"`, as is
 * `cache: "placed"`; everything else is `"local"`.
 *
 * @param wgsl - The WGSL body.
 * @param glsl - The GLSL body.
 * @param cache - What the game declared.
 * @returns The category.
 * @example
 * ```ts
 * cacheOf("let p = gfu.uOutputFrame.xy + uv * gfu.uInputSize.xy;", "", undefined); // "screen"
 * ```
 */
function cacheOf(
  wgsl: string,
  glsl: string,
  cache: "local" | "placed" | false | undefined
): FilterCache {
  if (cache === false) return "screen";
  if (cache === undefined && (readsScreenIn(wgsl) || readsScreenIn(glsl))) return "screen";
  if (cache === "placed" || callsCanvasPixel(wgsl, glsl)) return "placed";

  return "local";
}

/**
 * Tells whether a body asks for its canvas position through the engine's helper.
 *
 * @param wgsl - The WGSL body.
 * @param glsl - The GLSL body.
 * @returns True when either calls `canvasPixel(`.
 * @example
 * ```ts
 * callsCanvasPixel("let canvas = canvasPixel(uv);", ""); // true
 * ```
 */
function callsCanvasPixel(wgsl: string, glsl: string): boolean {
  return CANVAS_PIXEL_CALL.test(codeOf(wgsl)) || CANVAS_PIXEL_CALL.test(codeOf(glsl));
}

/**
 * Tells whether a definition's bodies read the screen while it declared no `cache: false`: a dev build warns once per
 * kind, "Filter "X" reads the screen; declare cache: false".
 *
 * @param definition - A definition `defineFilter` made.
 * @returns True when it reads the screen undeclared.
 */
export function readsScreen(definition: FilterDefinition): boolean {
  return screenReaders.has(definition);
}

/**
 * Checks the declared cache category: a JavaScript caller may pass anything.
 *
 * @param id - The filter id.
 * @param cache - What the game declared.
 * @throws {Error} When it is not `"local"`, `"placed"`, `false` or left out.
 */
function checkCache(id: string, cache: unknown): void {
  if (cache === undefined || cache === false || cache === "local" || cache === "placed") return;

  throw new Error(
    `[game] Filter "${id}": cache must be "local", "placed" or false.\n  Got ${JSON.stringify(cache)}.`
  );
}

/**
 * Reads the declared area: a function of the value, or left out. A JavaScript caller may pass anything.
 *
 * @param id - The filter id.
 * @param area - What the game declared.
 * @returns The function with the kind erased, or `undefined`.
 * @throws {TypeError} When it is given and is not a function.
 */
function readArea(id: string, area: unknown): FilterDefinition["area"] {
  if (area === undefined) return undefined;

  if (typeof area !== "function") {
    throw new TypeError(
      `[game] Filter "${id}": area must be a function of the value.\n  Give (value) => [x, y, width, height], or leave it out.`
    );
  }

  // The area reads the stored value of this filter; the engine hands it over with the kind erased.
  return area as FilterDefinition["area"];
}

/**
 * Reads the declared resolution: texels per CSS px, or 0 for the canvas's. A JavaScript caller may pass anything.
 *
 * @param id - The filter id.
 * @param resolution - What the game declared.
 * @returns The resolution; 0 when it was left out.
 * @throws {Error} When it is given and is not a finite number of 0 or more.
 */
function readResolution(id: string, resolution: unknown): number {
  if (resolution === undefined) return 0;
  if (typeof resolution === "number" && Number.isFinite(resolution) && resolution >= 0) {
    return resolution;
  }

  throw new Error(
    `[game] Filter "${id}": resolution must be 0 or more, 0 for the resolution of the canvas.\n  Got ${String(resolution)}.`
  );
}

/**
 * Tells whether a value is a list of 2 to 4 finite numbers.
 *
 * @param value - A uniform declaration.
 * @returns True for a vector.
 * @example
 * ```ts
 * isVector([1, 2, 3, 4, 5]); // false
 * ```
 */
function isVector(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.length >= MIN_VECTOR_SIZE &&
    value.length <= MAX_VECTOR_SIZE &&
    value.every(entry => typeof entry === "number" && Number.isFinite(entry))
  );
}

/**
 * Tells whether a value is a `{ color: 0xrrggbb }` declaration.
 *
 * @param value - A uniform declaration.
 * @returns True for a colour.
 * @example
 * ```ts
 * isColor({ color: 0xffd700 }); // true
 * ```
 */
function isColor(value: unknown): value is { readonly color: number } {
  if (typeof value !== "object" || value === null || !("color" in value)) return false;

  const { color } = value;

  return typeof color === "number" && Number.isInteger(color) && color >= 0 && color <= 0xff_ff_ff;
}

/**
 * Reads one uniform declaration: its spec and the default its component field starts at.
 *
 * @param id - The filter id.
 * @param name - The uniform name.
 * @param declaration - What the game declared.
 * @returns The spec and the default.
 * @throws {Error} When the name is reserved or not valid, or the declaration of no known form.
 */
function readUniform(
  id: string,
  name: string,
  declaration: UniformDeclaration
): { spec: UniformSpec; value: FilterField } {
  // The two fields every filter component carries, and the names of the shader headers.
  if (RESERVED_NAME.test(name)) {
    throw new Error(`[game] Filter "${id}": uniform "${name}" is reserved.\n  Rename it.`);
  }

  if (!UNIFORM_NAME.test(name)) {
    throw new Error(
      `[game] Filter "${id}": uniform "${name}" is not a valid name.\n` +
        "  Start with a lower-case letter and use letters and digits only."
    );
  }

  if (typeof declaration === "number" && Number.isFinite(declaration)) {
    return { spec: { name, type: "f32", form: "number", size: 1 }, value: declaration };
  }

  if (isColor(declaration)) {
    return { spec: { name, type: "vec3<f32>", form: "color", size: 3 }, value: declaration.color };
  }

  const type = isVector(declaration)
    ? VECTOR_TYPES[declaration.length - MIN_VECTOR_SIZE]
    : undefined;

  if (type === undefined || !isVector(declaration)) {
    throw new Error(
      `[game] Filter "${id}": uniform "${name}" must be a number, { color } or 2 to 4 numbers.\n` +
        `  Got ${JSON.stringify(declaration)}.`
    );
  }

  return {
    spec: { name, type, form: "vector", size: declaration.length },
    value: Object.freeze([...declaration])
  };
}

/**
 * Checks the passes and the padding of a definition.
 *
 * @param id - The filter id.
 * @param passes - The passes one apply costs.
 * @param padding - Pixels, or the name of a number uniform.
 * @param uniforms - The read uniforms.
 * @throws {Error} When either breaks its rule.
 */
function checkCost(
  id: string,
  passes: number,
  padding: number | string,
  uniforms: readonly UniformSpec[]
): void {
  if (!Number.isInteger(passes) || passes < 1) {
    throw new Error(
      `[game] Filter "${id}": passes must be an integer of at least 1.\n  Got ${passes}.`
    );
  }

  if (typeof padding === "number" && !(Number.isFinite(padding) && padding >= 0)) {
    throw new Error(`[game] Filter "${id}": padding must be 0 or more pixels.\n  Got ${padding}.`);
  }

  if (
    typeof padding === "string" &&
    !uniforms.some(uniform => uniform.name === padding && uniform.form === "number")
  ) {
    throw new Error(
      `[game] Filter "${id}": padding names no number uniform "${padding}".\n` +
        "  Name one of its number uniforms."
    );
  }
}

/**
 * Tells whether a value is a component `defineFilter` made: a component type with a definition
 * holding its assembled source.
 *
 * @param value - An entry of `stages`, or a `fallback`.
 * @returns True for a filter of ours; a built-in Pixi-core kind has no `filter`.
 */
function isDefinedFilter(value: unknown): value is FilterStage {
  if (typeof value !== "function") return false;

  const filter: unknown = Reflect.get(value, "filter");

  return (
    typeof Reflect.get(value, "componentName") === "string" &&
    typeof filter === "object" &&
    filter !== null &&
    typeof Reflect.get(filter, "id") === "string" &&
    typeof Reflect.get(filter, "source") === "string" &&
    Array.isArray(Reflect.get(filter, "uniforms"))
  );
}

/**
 * Tells whether a definition draws alone: no input of its own and no fallback.
 *
 * @param definition - A stage's or a fallback's definition.
 * @returns True when it has neither.
 */
function drawsAlone(definition: FilterDefinition): boolean {
  return definition.inputs.length === 0 && definition.fallback === undefined;
}

/**
 * The names the engine declares for an input: its texture, sampler, scale and clamp uniforms and
 * its sample function.
 *
 * @param name - The input name.
 * @returns The five names.
 * @example
 * ```ts
 * namesOf("blur"); // { texture: "blurTexture", sampler: "blurSampler", scale: "blurScale", clamp: "blurClamp", sample: "sampleBlur" }
 * ```
 */
function namesOf(name: string): {
  texture: string;
  sampler: string;
  scale: string;
  clamp: string;
  sample: string;
} {
  const upper = `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

  return {
    texture: `${name}Texture`,
    sampler: `${name}Sampler`,
    scale: `${name}Scale`,
    clamp: `${name}Clamp`,
    sample: `sample${upper}`
  };
}

/**
 * What a name an input makes clashes with: a uniform of the filter, a reserved name or a name an
 * earlier input made, in that order.
 *
 * @param made - A name the input makes.
 * @param uniforms - The read uniforms.
 * @param taken - The names earlier inputs made.
 * @returns The clash as the error message words it, or `undefined` when the name is free.
 * @example
 * ```ts
 * clashOf("blurTexture", [], new Set(["blurTexture"])); // "made by another input"
 * ```
 */
function clashOf(
  made: string,
  uniforms: readonly UniformSpec[],
  taken: ReadonlySet<string>
): string | undefined {
  if (uniforms.some(uniform => uniform.name === made)) return "a uniform of the filter";
  if (RESERVED_NAME.test(made)) return "reserved";
  if (taken.has(made)) return "made by another input";

  return undefined;
}

/**
 * Checks the name of an input and the names it makes against the uniforms, the reserved names and
 * the names earlier inputs made, which it then joins.
 *
 * @param id - The filter id.
 * @param name - The input name.
 * @param uniforms - The read uniforms.
 * @param taken - The names earlier inputs made; the new ones are added.
 * @returns The five names.
 * @throws {Error} When the name is not valid or a made name clashes.
 */
function checkInputNames(
  id: string,
  name: string,
  uniforms: readonly UniformSpec[],
  taken: Set<string>
): ReturnType<typeof namesOf> {
  if (!UNIFORM_NAME.test(name) || RESERVED_NAME.test(name)) {
    throw new Error(
      `[game] Filter "${id}": input "${name}" is not a valid name.\n` +
        "  Start with a lower-case letter and use letters and digits only."
    );
  }

  const names = namesOf(name);

  for (const made of Object.values(names)) {
    const clash = clashOf(made, uniforms, taken);

    if (clash !== undefined) {
      throw new Error(
        `[game] Filter "${id}": input "${name}" makes "${made}", which is ${clash}.\n` +
          "  Rename the input or the uniform."
      );
    }
  }

  for (const made of Object.values(names)) taken.add(made);

  return names;
}

/**
 * Checks the stages of an input: a non-empty list of filters made by `defineFilter`, each drawing
 * alone.
 *
 * @param id - The filter id.
 * @param name - The input name.
 * @param stages - What the game listed.
 * @returns The distinct stages by identity, in listed order, frozen.
 * @throws {Error} When the list is empty or not a list, or an entry is no filter of ours or has inputs or a fallback.
 */
function readStages(id: string, name: string, stages: unknown): readonly FilterStage[] {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new Error(
      `[game] Filter "${id}": input "${name}" needs stages: the filters its chain may draw.\n` +
        "  List each defineFilter the chain names."
    );
  }

  const read: FilterStage[] = [];

  for (const [index, stage] of stages.entries()) {
    if (!isDefinedFilter(stage)) {
      throw new Error(
        `[game] Filter "${id}": stage ${index} of input "${name}" is not a filter made by defineFilter.\n` +
          "  List what defineFilter returned; a built-in kind cannot be a stage."
      );
    }

    if (!drawsAlone(stage.filter)) {
      throw new Error(
        `[game] Filter "${id}": stage "${stage.filter.id}" of input "${name}" has inputs or a fallback of its own.\n` +
          "  A stage draws alone: give it neither."
      );
    }

    if (!read.includes(stage)) read.push(stage);
  }

  return Object.freeze(read);
}

/**
 * Reads the inputs of a definition: the names the engine declares for each, its two uniforms, its
 * stages and its chain.
 *
 * @param id - The filter id.
 * @param declared - What the game declared under `inputs`.
 * @param uniforms - The read uniforms.
 * @returns The inputs in declaration order, frozen; empty without `inputs`.
 * @throws {Error} When `inputs` is not an object, has more than four entries, or an input breaks one of its rules.
 */
function readInputs<Value>(
  id: string,
  declared: Readonly<Record<string, FilterInput<Value>>> | undefined,
  uniforms: readonly UniformSpec[]
): readonly FilterInputDefinition[] {
  if (declared === undefined) return Object.freeze([]);

  if (typeof declared !== "object" || declared === null || Array.isArray(declared)) {
    throw new Error(
      `[game] Filter "${id}": inputs must be an object of named inputs.\n` +
        "  Write inputs: { blur: { stages: [...], chain } }."
    );
  }

  const entries = Object.entries(declared);

  if (entries.length > MAX_INPUTS) {
    throw new Error(
      `[game] Filter "${id}" has ${entries.length} inputs; at most ${MAX_INPUTS}.\n` +
        "  Each input is a texture the body reads: merge the chains."
    );
  }

  const taken = new Set<string>();

  return Object.freeze(
    entries.map(([name, input]) => {
      const names = checkInputNames(id, name, uniforms, taken);
      const stages = readStages(id, name, input.stages);

      if (typeof input.chain !== "function") {
        throw new TypeError(
          `[game] Filter "${id}": input "${name}" needs a chain.\n` +
            "  Write chain: (value, { resolution }) => [{ stage, scale }]."
        );
      }

      return Object.freeze({
        name,
        texture: names.texture,
        sampler: names.sampler,
        scale: Object.freeze({ name: names.scale, type: "vec2<f32>", form: "vector", size: 2 }),
        clamp: Object.freeze({ name: names.clamp, type: "vec4<f32>", form: "vector", size: 4 }),
        sample: names.sample,
        stages,
        // The chain reads the stored value of this filter; the engine hands it over with the kind erased.
        chain: input.chain as FilterInputDefinition["chain"]
      } satisfies FilterInputDefinition);
    })
  );
}

/**
 * Reads the fallback of a definition: another filter of ours, drawing alone, over a subset of its
 * uniforms with the same types.
 *
 * @param id - The filter id.
 * @param fallback - What the game declared under `fallback`.
 * @param uniforms - The read uniforms.
 * @returns The fallback's definition, or `undefined` without one.
 * @throws {Error} When it is no filter of ours, has the same id, has inputs or a fallback, or a uniform of it is not
 *   one of this filter's with the same type.
 */
function readFallback(
  id: string,
  fallback: unknown,
  uniforms: readonly UniformSpec[]
): FilterDefinition | undefined {
  if (fallback === undefined) return undefined;

  if (!isDefinedFilter(fallback)) {
    throw new Error(
      `[game] Filter "${id}": fallback is not a filter made by defineFilter.\n  Pass what defineFilter returned.`
    );
  }

  const definition = fallback.filter;

  if (definition.id === id) {
    throw new Error(
      `[game] Filter "${id}": its fallback has the same id.\n  Give the fallback an id of its own.`
    );
  }

  if (!drawsAlone(definition)) {
    throw new Error(
      `[game] Filter "${id}": its fallback "${definition.id}" has inputs or a fallback of its own.\n` +
        "  A fallback draws alone and simply: give it neither."
    );
  }

  for (const uniform of definition.uniforms) {
    const own = uniforms.find(candidate => candidate.name === uniform.name);
    const sameType = own?.type === uniform.type && own.form === uniform.form;

    if (!sameType) {
      throw new Error(
        `[game] Filter "${id}": its fallback "${definition.id}" declares "${uniform.name}", which "${id}" ${own === undefined ? "does not declare" : "declares as another type"}.\n` +
          `  A fallback draws with the value of ${id}: use a subset of its uniforms.`
      );
    }
  }

  return definition;
}

/**
 * Refuses a definition without an id or without the entry point of a body: `mainFragment` in the WGSL, `void main(`
 * in the GLSL.
 *
 * @param id - The filter id.
 * @param spec - Both bodies of the definition.
 * @param spec.wgsl - The WGSL body.
 * @param spec.glsl - The GLSL body.
 * @throws {Error} When the id is empty or a body has no entry point.
 */
function readSpec(id: string, spec: Readonly<{ wgsl: string; glsl: string }>): void {
  if (typeof id !== "string" || id === "") {
    throw new Error(
      "[game] A filter needs an id.\n  Pass a non-empty string as the first argument."
    );
  }

  if (!MAIN_FRAGMENT.test(spec.wgsl)) {
    throw new Error(
      `[game] Filter "${id}" has no mainFragment.\n` +
        "  Write fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32>."
    );
  }

  // A JavaScript caller may leave `glsl` out: the test of `undefined` finds no main either.
  if (!MAIN_GLSL.test(spec.glsl)) {
    throw new Error(
      `[game] Filter "${id}" has no main in its glsl.\n` +
        "  Write void main() in GLSL ES 3.0 and set finalColor."
    );
  }
}

/**
 * The cache category of a filter with its inputs: as bad as the worst of its body and its stages, since a kept
 * pre-pass result is a picture of the stages.
 *
 * @param cache - The category of the body.
 * @param inputs - The read inputs.
 * @returns The category of the whole filter.
 */
function cacheWithInputs(
  cache: FilterCache,
  inputs: readonly FilterInputDefinition[]
): FilterCache {
  let worst = cache;

  for (const input of inputs) {
    for (const stage of input.stages) worst = worstOf(worst, stage.filter.cache);
  }

  return worst;
}

/**
 * Turns a WGSL fragment body and its GLSL ES 3.0 twin into a filter component type; Pixi draws
 * the one of the running backend. A still view under the filter is kept as a picture by the
 * renderer (`cache`, default `"local"`); a body that needs its canvas position calls
 * `canvasPixel(uv)`, and then the view can still be kept as a picture. To the WGSL the engine prepends the vertex stage, the input
 * bindings and a `FilterUniforms` struct in declaration order, bound as `fu`. To the GLSL it
 * prepends `#version 300 es`, `vTextureCoord`, `finalColor`, `uTexture`, the global filter
 * uniforms as `vec4` and one `uniform` per declared uniform under its bare name. Every number
 * uniform is a number field, so the existing `tween` drives it; a colour is one hex field sent as
 * a `vec3`; a tuple is an array field and not tweenable. Every filter component also carries
 * `enabled: true` and `order: 0`. An input `blur` gives the body `sampleBlur(uv)`: the last texture
 * of its chain, read at the body's `uv`. A `fallback` draws instead when the filter is broken.
 * An `area` answers, from the value, the rectangle in the entity's own units outside of which the
 * filter draws nothing: Pixi then renders and fills only that box, not the view's bounds. A
 * `resolution` draws the view and its filters at that many texels per CSS px instead of the
 * canvas's.
 * Register it through the `filters` key of a feature. The README shows a filter with a blur input
 * and one with an `area`.
 *
 * @param id - The filter id, also the component name; unique, and not one of the built-ins.
 * @param spec - Both bodies, the uniforms, the passes one apply costs, the padding, the inputs, the fallback, the
 *   cache category, the area and the resolution.
 * @returns The component type, with the frozen `filter` definition attached.
 * @throws {Error} When the id is empty, the WGSL has no `mainFragment`, the GLSL no `void main(`,
 *   a uniform is reserved, badly named or of no known form, the passes or the padding break
 *   their rules, an input or the fallback breaks one of its rules, `passes` is given with inputs,
 *   `area` is not a function, or `resolution` is not a finite number of 0 or more.
 * @example
 * ```ts
 * // features/board/effects.ts: a gold tint a motion hook tweens on a merge, on WebGPU and WebGL.
 * const Tint = defineFilter("fx.tint", { wgsl: tintWgsl, glsl: tintGlsl, uniforms: { amount: 0, color: { color: 0xffd700 } } });
 * Tint({ amount: 1 }).value; // { amount: 1, color: 0xffd700, enabled: true, order: 0 }
 * Tint.filter.glsl.includes("uniform vec3 color;"); // true
 * Tint.filter.cache; // "local"
 * ```
 */
export function defineFilter<
  Uniforms extends Record<string, UniformDeclaration> = Record<never, never>
>(id: string, spec: FilterSpec<Uniforms>): FilterComponent<FilterValueOf<Uniforms>> {
  readSpec(id, spec);

  // Read the declaration in order: each reader throws on the first rule it breaks.
  const read = Object.entries(spec.uniforms ?? {}).map(([name, declaration]) =>
    readUniform(id, name, declaration)
  );
  const uniforms = Object.freeze(read.map(entry => entry.spec));
  const inputs = readInputs(id, spec.inputs, uniforms);

  if (spec.inputs !== undefined && spec.passes !== undefined) {
    throw new Error(
      `[game] Filter "${id}": passes is counted by the engine for a filter with inputs.\n  Leave passes out.`
    );
  }

  const fallback = readFallback(id, spec.fallback, uniforms);
  const passes = spec.passes ?? 1;
  const padding = spec.padding ?? 0;

  checkCost(id, passes, padding, uniforms);
  checkCache(id, spec.cache);

  const area = readArea(id, spec.area);
  const resolution = readResolution(id, spec.resolution);

  // Assemble the frozen definition: both shaders with the engine's header, and what the renderer's cache may keep.
  const origin = callsCanvasPixel(spec.wgsl, spec.glsl) ? KEPT_ORIGIN : undefined;
  const cache = cacheWithInputs(cacheOf(spec.wgsl, spec.glsl, spec.cache), inputs);
  const filter: FilterDefinition = Object.freeze({
    id,
    source: assemble(uniforms, inputs, spec.wgsl, origin),
    glsl: assembleGlsl(uniforms, inputs, spec.glsl, origin),
    uniforms,
    passes,
    padding,
    inputs,
    fallback,
    cache,
    origin,
    resolution,
    // The key is there only when the spec gave an area (`exactOptionalPropertyTypes`).
    ...(area === undefined ? {} : { area })
  });

  if (spec.cache !== false && (readsScreenIn(spec.wgsl) || readsScreenIn(spec.glsl))) {
    screenReaders.add(filter);
  }

  // The component type: its defaults are built from the declaration, so their type is the one the declaration maps to.
  const defaults = Object.fromEntries([
    ...read.map(entry => [entry.spec.name, entry.value] as const),
    ["enabled", true],
    ["order", 0]
  ]) as FilterValueOf<Uniforms>;

  return Object.assign(component(id, defaults), { filter });
}
