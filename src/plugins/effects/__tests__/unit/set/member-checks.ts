/**
 * @file effects/set — what every member's unit test checks, as one set of cases. Not a test file: the unit project
 * only collects `*.test.ts`. A member is one `defineFilter` of the set: the cases read its definition and its own
 * bodies, never `filter.source`, which carries the set head. `bodyCases` is the part of them that holds for any body
 * of the set: a chain member (`Bloom`) and the stages its chain draws, which no quad runs, take those alone.
 */
import { expect, it } from "vitest";
import type { FilterComponent, FilterDefinition, FilterFields } from "../../../filters/types";

/** The one entry point a body may have for `assembleQuad` to rewrite it, whitespace dropped. */
const PLAIN_HEAD = "@fragmentfnmainFragment(@location(0)uv:vec2<f32>)->@location(0)vec4<f32>";

/** What the cases of a body read: its definition, its two bodies, and the uniforms the bodies read. */
export type BodyUnderTest = {
  /** The definition. */
  readonly filter: FilterDefinition;
  /** Its WGSL body, without the set head. */
  readonly wgsl: string;
  /** Its GLSL body, without the set head. */
  readonly glsl: string;
  /** The uniforms the bodies read, in declaration order; every declared one when left out (a chain reads the rest). */
  readonly reads?: readonly string[];
};

/** What a member's case set reads. */
export type MemberUnderTest = {
  /** The member. */
  readonly member: FilterComponent<FilterFields>;
  /** Its WGSL body, without the set head. */
  readonly wgsl: string;
  /** Its GLSL body, without the set head. */
  readonly glsl: string;
  /** The padding the member table gives it. */
  readonly padding: number | string;
};

/**
 * The bare names a GLSL body reads, out of the names a filter declares.
 *
 * @param body - The GLSL body.
 * @param declared - The declared uniform names.
 * @returns The names the body uses.
 */
function readsOf(body: string, declared: readonly string[]): string[] {
  return declared.filter(name => new RegExp(String.raw`\b${name}\b`).test(body));
}

/**
 * The statements of a body in one spelling for both languages: the WGSL's `let`, `var`, `fu.` and `<f32>` dropped, its
 * `uv` written as the GLSL's `vTextureCoord`, its `return` as the GLSL's `finalColor =` and its `f32(` cast as the
 * GLSL's `float(`; the GLSL's declared type dropped. Constants are left out: a member's test compares those. A loop's
 * head ends in `{`, so it is left out too: the budget test compares the loop's bound in both.
 *
 * @param body - A WGSL or GLSL body.
 * @param language - Which one it is.
 * @returns The statements, in order.
 */
function twinLines(body: string, language: "wgsl" | "glsl"): string[] {
  const statements = body
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.endsWith(";") && !line.startsWith("const "))
    .map(line => line.replace(/;$/, ""));

  if (language === "glsl") return statements.map(line => line.replace(/^(?:float|vec[234]) /, ""));

  return statements.map(line =>
    line
      .replace(/^(?:let|var) /, "")
      .replace(/^return /, "finalColor = ")
      .replaceAll("fu.", "")
      .replaceAll("<f32>", "")
      .replaceAll(/\bf32\(/g, "float(")
      .replaceAll(/\buv\b/g, "vTextureCoord")
  );
}

/**
 * How often a WGSL body has the one entry point `assembleQuad` can rewrite.
 *
 * @param wgsl - The body, without the set head.
 * @returns The count: 1 for a body of the set.
 */
export function headsOf(wgsl: string): number {
  return wgsl.replaceAll(/\s/g, "").split(PLAIN_HEAD).length - 1;
}

/**
 * Declares the cases every member shares, inside the caller's `describe`.
 *
 * @param under - The member and its bodies.
 */
export function memberCases(under: MemberUnderTest): void {
  const { member, wgsl, glsl, padding } = under;
  const { filter } = member;

  // Bug: a member that fell off the quad: a body `assembleQuad` cannot rewrite pays a filter pass for every value.
  it("has the plain signature once and rides the quad", () => {
    expect(headsOf(wgsl)).toBe(1);
    expect(filter.quadSource).toContain("fn filterBody(uv: vec2<f32>) -> vec4<f32>");
  });

  // Bug: a member that reads the screen, a second texture or a padding it does not need: no kept picture, a chain.
  it('is "local", with no inputs, and the padding of the member table', () => {
    expect(filter.cache).toBe("local");
    expect(filter.inputs).toEqual([]);
    expect(filter.backdrop).toBe(false);
    expect(filter.padding).toBe(padding);
  });

  bodyCases({ filter, wgsl, glsl });
}

/**
 * Declares the cases of any body of the set, inside the caller's `describe`: its uniforms in both languages, its
 * twins line for line, its place through `inputPlace`.
 *
 * @param under - The definition and its bodies.
 */
export function bodyCases(under: BodyUnderTest): void {
  const { filter, wgsl, glsl } = under;
  const declared = filter.uniforms.map(uniform => uniform.name);
  const reads = under.reads ?? declared;

  // Bug: the WGSL reads a uniform the member never declared, or ignores one it did: a field that moves nothing.
  it("reads in its WGSL exactly the uniforms it declares", () => {
    const used = new Set([...wgsl.matchAll(/\bfu\.(\w+)/g)].map(match => match[1]));

    expect(used).toEqual(new Set(reads));
  });

  // Bug: a twin that forgot a uniform: on WebGL the field moves nothing.
  it("reads every declared uniform by its bare name in its GLSL and sets finalColor", () => {
    expect(readsOf(glsl, declared)).toEqual(reads);
    expect(glsl).toMatch(/\bvoid\s+main\s*\(/);
    expect(glsl).toMatch(/\bfinalColor\s*=/);
    expect(filter.glsl.endsWith(glsl)).toBe(true);
  });

  // Bug: a GLSL twin whose look drifts: WebGL phones draw another grade, flash or vignette than WebGPU ones.
  it("computes in its GLSL, line for line, what its WGSL computes", () => {
    expect(twinLines(glsl, "glsl")).toEqual(twinLines(wgsl, "wgsl"));
  });

  // Bug: a body that reads `sampleInput(uv)`: uv is 0..1 of a pooled texture, not of the frame, so live reads the
  // wrong texel while the quad reads the right one.
  it("places its pixel through inputPlace on both backends", () => {
    expect(wgsl).toMatch(/\binputPlace\(uv\)/);
    expect(glsl).toMatch(/\binputPlace\(vTextureCoord\)/);
  });
}
