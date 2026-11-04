/**
 * @file effects/set — what every member's unit test checks, as one set of cases. Not a test file: the unit project
 * only collects `*.test.ts`. A member is one `defineFilter` of the set: the cases read its definition and its own
 * bodies, never `filter.source`, which carries the set head.
 */
import { expect, it } from "vitest";
import type { FilterComponent, FilterFields } from "../../../filters/types";

/** The one entry point a body may have for `assembleQuad` to rewrite it, whitespace dropped. */
const PLAIN_HEAD = "@fragmentfnmainFragment(@location(0)uv:vec2<f32>)->@location(0)vec4<f32>";

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
 * `uv` written as the GLSL's `vTextureCoord` and its `return` as the GLSL's `finalColor =`; the GLSL's declared type
 * dropped. Constants are left out: a member's test compares those.
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
      .replaceAll(/\buv\b/g, "vTextureCoord")
  );
}

/**
 * Declares the cases every member shares, inside the caller's `describe`.
 *
 * @param under - The member and its bodies.
 */
export function memberCases(under: MemberUnderTest): void {
  const { member, wgsl, glsl, padding } = under;
  const { filter } = member;
  const declared = filter.uniforms.map(uniform => uniform.name);

  // Bug: a member that fell off the quad: a body `assembleQuad` cannot rewrite pays a filter pass for every value.
  it("has the plain signature once and rides the quad", () => {
    const heads = wgsl.replaceAll(/\s/g, "").split(PLAIN_HEAD).length - 1;

    expect(heads).toBe(1);
    expect(filter.quadSource).toContain("fn filterBody(uv: vec2<f32>) -> vec4<f32>");
  });

  // Bug: a member that reads the screen, a second texture or a padding it does not need: no kept picture, a chain.
  it('is "local", with no inputs, and the padding of the member table', () => {
    expect(filter.cache).toBe("local");
    expect(filter.inputs).toEqual([]);
    expect(filter.backdrop).toBe(false);
    expect(filter.padding).toBe(padding);
  });

  // Bug: the WGSL reads a uniform the member never declared, or ignores one it did: a field that moves nothing.
  it("reads in its WGSL exactly the uniforms it declares", () => {
    const used = new Set([...wgsl.matchAll(/\bfu\.(\w+)/g)].map(match => match[1]));

    expect(used).toEqual(new Set(declared));
  });

  // Bug: a twin that forgot a uniform: on WebGL the field moves nothing.
  it("reads every declared uniform by its bare name in its GLSL and sets finalColor", () => {
    expect(readsOf(glsl, declared)).toEqual(declared);
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
