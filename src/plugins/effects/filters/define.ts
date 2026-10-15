/**
 * @file effects/filters — `defineFilter`: a WGSL fragment body and its GLSL twin become a flat
 * component type with its filter attached, with the second textures the body reads (`inputs`) and
 * the filter drawn in its place when it is broken (`fallback`). Pure: no ctx, no device; every
 * shader a kind can draw is checked on the running backend when the renderer first draws, in
 * every build, by the filter sync.
 */
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

/** The WGSL type of a vector uniform, by its size minus 2. */
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
  /^(?:enabled|order|uInputSize|uInputPixel|uInputClamp|uOutputFrame|uGlobalFrame|uOutputTexture|uTexture|uSampler|finalColor|vTextureCoord)$/;

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
    value.length >= 2 &&
    value.length <= 4 &&
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

  const type = isVector(declaration) ? VECTOR_TYPES[declaration.length - 2] : undefined;

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
    let clash: string | undefined;

    if (uniforms.some(uniform => uniform.name === made)) clash = "a uniform of the filter";
    else if (RESERVED_NAME.test(made)) clash = "reserved";
    else if (taken.has(made)) clash = "made by another input";

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
 * Turns a WGSL fragment body and its GLSL ES 3.0 twin into a filter component type; Pixi draws
 * the one of the running backend. To the WGSL the engine prepends the vertex stage, the input
 * bindings and a `FilterUniforms` struct in declaration order, bound as `fu`. To the GLSL it
 * prepends `#version 300 es`, `vTextureCoord`, `finalColor`, `uTexture`, the global filter
 * uniforms as `vec4` and one `uniform` per declared uniform under its bare name. Every number
 * uniform is a number field, so the existing `tween` drives it; a colour is one hex field sent as
 * a `vec3`; a tuple is an array field and not tweenable. Every filter component also carries
 * `enabled: true` and `order: 0`. An input `blur` gives the body `sampleBlur(uv)`: the last texture
 * of its chain, read at the body's `uv`. A `fallback` draws instead when the filter is broken.
 * Register it through the `filters` key of a feature.
 *
 * @param id - The filter id, also the component name; unique, and not one of the built-ins.
 * @param spec - Both bodies, the uniforms, the passes one apply costs, the padding, the inputs and the fallback.
 * @returns The component type, with the frozen `filter` definition attached.
 * @throws {Error} When the id is empty, the WGSL has no `mainFragment`, the GLSL no `void main(`,
 *   a uniform is reserved, badly named or of no known form, the passes or the padding break
 *   their rules, an input or the fallback breaks one of its rules, or `passes` is given with inputs.
 * @example
 * ```ts
 * // features/board/effects.ts: a gold tint a motion hook tweens on a merge, on WebGPU and WebGL.
 * const Tint = defineFilter("fx.tint", { wgsl: tintWgsl, glsl: tintGlsl, uniforms: { amount: 0, color: { color: 0xffd700 } } });
 * Tint({ amount: 1 }).value; // { amount: 1, color: 0xffd700, enabled: true, order: 0 }
 * Tint.filter.glsl.includes("uniform vec3 color;"); // true
 * // A Memory Missing's frost reads a blurred copy of the scene drawn by its chain.
 * const Frost = defineFilter("Frost", { wgsl: FROST_WGSL, glsl: FROST_GLSL, uniforms: { strength: 16 }, inputs: { blur: { stages: [FrostBox4, FrostGauss], chain: frostChain } } });
 * Frost.filter.inputs.map(input => input.sample); // ["sampleBlur"]
 * ```
 */
export function defineFilter<
  Uniforms extends Record<string, UniformDeclaration> = Record<never, never>
>(id: string, spec: FilterSpec<Uniforms>): FilterComponent<FilterValueOf<Uniforms>> {
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

  const filter: FilterDefinition = Object.freeze({
    id,
    source: assemble(uniforms, inputs, spec.wgsl),
    glsl: assembleGlsl(uniforms, inputs, spec.glsl),
    uniforms,
    passes,
    padding,
    inputs,
    fallback
  });
  // The defaults are built from the declaration, so their type is the one the declaration maps to.
  const defaults = Object.fromEntries([
    ...read.map(entry => [entry.spec.name, entry.value] as const),
    ["enabled", true],
    ["order", 0]
  ]) as FilterValueOf<Uniforms>;

  return Object.assign(component(id, defaults), { filter });
}
