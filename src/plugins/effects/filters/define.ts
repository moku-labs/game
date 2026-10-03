/**
 * @file effects/filters — `defineFilter`: a WGSL fragment body and its GLSL twin become a flat
 * component type with its filter attached. Pure: no ctx, no device; the shader of the running
 * backend is checked in dev before the first instance of the kind, by the filter sync.
 */
import { component } from "../../world/ecs/define";
import { assembleGlsl } from "./glsl";
import type {
  FilterComponent,
  FilterDefinition,
  FilterField,
  FilterSpec,
  FilterValueOf,
  UniformDeclaration,
  UniformSpec
} from "./types";
import { assemble } from "./wgsl";

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
 * Turns a WGSL fragment body and its GLSL ES 3.0 twin into a filter component type; Pixi draws
 * the one of the running backend. To the WGSL the engine prepends the vertex stage, the input
 * bindings and a `FilterUniforms` struct in declaration order, bound as `fu`. To the GLSL it
 * prepends `#version 300 es`, `vTextureCoord`, `finalColor`, `uTexture`, the global filter
 * uniforms as `vec4` and one `uniform` per declared uniform under its bare name. Every number
 * uniform is a number field, so the existing `tween` drives it; a colour is one hex field sent as
 * a `vec3`; a tuple is an array field and not tweenable. Every filter component also carries
 * `enabled: true` and `order: 0`. Register it through the `filters` key of a feature.
 *
 * @param id - The filter id, also the component name; unique, and not one of the built-ins.
 * @param spec - Both bodies, the uniforms, the passes one apply costs and the padding.
 * @returns The component type, with the frozen `filter` definition attached.
 * @throws {Error} When the id is empty, the WGSL has no `mainFragment`, the GLSL no `void main(`,
 *   a uniform is reserved, badly named or of no known form, or the passes or the padding break
 *   their rules.
 * @example
 * ```ts
 * // features/board/effects.ts: a gold tint a motion hook tweens on a merge, on WebGPU and WebGL.
 * const Tint = defineFilter("fx.tint", { wgsl: tintWgsl, glsl: tintGlsl, uniforms: { amount: 0, color: { color: 0xffd700 } } });
 * Tint({ amount: 1 }).value; // { amount: 1, color: 0xffd700, enabled: true, order: 0 }
 * Tint.filter.glsl.includes("uniform vec3 color;"); // true
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
  const passes = spec.passes ?? 1;
  const padding = spec.padding ?? 0;

  checkCost(id, passes, padding, uniforms);

  const filter: FilterDefinition = Object.freeze({
    id,
    source: assemble(uniforms, spec.wgsl),
    glsl: assembleGlsl(uniforms, spec.glsl),
    uniforms,
    passes,
    padding
  });
  // The defaults are built from the declaration, so their type is the one the declaration maps to.
  const defaults = Object.fromEntries([
    ...read.map(entry => [entry.spec.name, entry.value] as const),
    ["enabled", true],
    ["order", 0]
  ]) as FilterValueOf<Uniforms>;

  return Object.assign(component(id, defaults), { filter });
}
