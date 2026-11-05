/**
 * @file effects/set — a member's or a stage's WGSL body run in TypeScript, for the bodies whose numbers a test can work
 * out on the CPU. Not a test file. Bun has no GPU, so the test reads the body's own `let` lines and evaluates them in order with
 * the shading languages' functions, as `set-head.test.ts` does for the head and `glow-wgsl.test.ts` for the probe count:
 * a body that changes its formula changes what the test computes. Scalars and `vec2` values with `.x` and `.y` only; a
 * line that does vector arithmetic cannot run here, so a test evaluates the lines before it. A colour runs as a grey: a
 * `vec3` of one number is that number, so `c.rgb - threshold * c.a` runs for a pixel whose three channels are alike.
 */

/** A `vec2<f32>` on the CPU. */
export type Vec2 = { readonly x: number; readonly y: number };

/** A pixel or a colour on the CPU, by its channels: `{ rgb: 0.5, a: 1 }` is an opaque mid grey. */
export type Channels = { readonly [channel: string]: number };

/** What a body is evaluated with: a member's value by its bare names, `uv` and any value a line before reads. */
export type Scope = Readonly<Record<string, number | boolean | Vec2 | Channels>>;

/**
 * The value of `x` between `low` and `high`, eased: WGSL's and GLSL's `smoothstep`.
 *
 * @param low - Where it starts.
 * @param high - Where it ends.
 * @param x - The value.
 * @returns 0 up to 1.
 */
function smoothstep(low: number, high: number, x: number): number {
  const t = Math.min(Math.max((x - low) / (high - low), 0), 1);

  return t * t * (3 - 2 * t);
}

/** The functions of the shading languages a body may call, and the head's two helpers stubbed for one pixel. */
const FUNCTIONS = {
  vec2: (x: number, y: number = x): Vec2 => ({ x, y }),
  // A grey colour: its three channels are one number.
  vec3: (grey: number): number => grey,
  f32: (x: number): number => x,
  abs: Math.abs,
  exp: Math.exp,
  cos: Math.cos,
  sin: Math.sin,
  floor: Math.floor,
  max: Math.max,
  min: Math.min,
  clamp: (x: number, low: number, high: number) => Math.min(Math.max(x, low), high),
  mix: (a: number, b: number, t: number) => a + (b - a) * t,
  smoothstep,
  step: (edge: number, x: number) => (x < edge ? 0 : 1),
  distance: (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y),
  // The pixel's place is `uv` itself, and its input a white opaque pixel: `c` is 1.
  inputPlace: (uv: Vec2): Vec2 => uv,
  sampleInput: (): number => 1,
  // A stage's texel is 1 on both axes: an offset is counted in texels of its input.
  inputTexel: (): number => 1
} as const;

/**
 * An expression of a body as TypeScript runs it: the uniforms by their bare names, `vec2<f32>(` as `vec2(`.
 *
 * @param expression - The WGSL expression.
 * @returns The script.
 */
function scriptOf(expression: string): string {
  return expression.replaceAll("fu.", "").replaceAll(/\bvec([23])<f32>\(/g, "vec$1(");
}

/**
 * The `let` lines and the `return` of a body's `mainFragment`, in order, as `[name, expression]`; the return under
 * the name `return`.
 *
 * @param wgsl - The member's own WGSL body.
 * @returns The lines.
 */
function linesOf(wgsl: string): Array<[string, string]> {
  const lines: Array<[string, string]> = [];

  for (const line of wgsl.slice(wgsl.indexOf("mainFragment")).split("\n")) {
    const named = /^\s*let (\w+) = (.+);$/.exec(line);
    const returned = /^\s*return (.+);$/.exec(line);

    if (named?.[1] !== undefined && named[2] !== undefined) lines.push([named[1], named[2]]);
    if (returned?.[1] !== undefined) lines.push(["return", returned[1]]);
  }

  return lines;
}

/**
 * Evaluates a body's lines from the one named `from` down to the one named `to`, and answers that value.
 *
 * @param wgsl - The member's own WGSL body.
 * @param range - The first line's name and the last one's, `return` for the return.
 * @param range.from - The first line evaluated.
 * @param range.to - The line whose value is answered.
 * @param scope - The uniforms, `uv`, and what the skipped lines would have computed.
 * @returns The value of the line `to`.
 * @throws {Error} When the body has no such lines.
 */
export function evaluate(
  wgsl: string,
  range: { readonly from: string; readonly to: string },
  scope: Scope
): number {
  const lines = linesOf(wgsl);
  const first = lines.findIndex(([name]) => name === range.from);
  const last = lines.findIndex(([name]) => name === range.to);

  if (first === -1 || last < first)
    throw new Error(`no lines ${range.from}..${range.to} in the body`);

  const statements = lines.slice(first, last + 1).map(([name, expression]) => {
    const script = scriptOf(expression);

    return name === "return" ? `return ${script};` : `const ${name} = ${script};`;
  });

  if (range.to !== "return") statements.push(`return ${range.to};`);

  const names = [...Object.keys(FUNCTIONS), ...Object.keys(scope)];
  const values = [...Object.values(FUNCTIONS), ...Object.values(scope)];

  return new Function(...names, statements.join("\n"))(...values) as number;
}

/**
 * The values a `var` of a body takes in a loop that turns it: its first value from `var name = …;`, then each value
 * the assignment `name = …;` makes of the one before, as the loop does once a turn.
 *
 * @param wgsl - The member's or the stage's own WGSL body.
 * @param name - The `var`.
 * @param turns - How many values: the loop's count.
 * @returns The values, the first one first.
 * @throws {Error} When the body has no such `var` or no assignment of it.
 */
export function turnsOf(wgsl: string, name: string, turns: number): Vec2[] {
  const first = new RegExp(String.raw`^\s*var ${name} = (.+);$`, "m").exec(wgsl)?.[1];
  const next = new RegExp(String.raw`^\s*${name} = (.+);$`, "m").exec(wgsl)?.[1];

  if (first === undefined || next === undefined)
    throw new Error(`no var ${name} turned in the body`);

  const start = new Function("vec2", `return ${scriptOf(first)};`) as (
    vec2: typeof FUNCTIONS.vec2
  ) => Vec2;
  const turn = new Function("vec2", name, `return ${scriptOf(next)};`) as (
    vec2: typeof FUNCTIONS.vec2,
    value: Vec2
  ) => Vec2;
  const values = [start(FUNCTIONS.vec2)];

  while (values.length < turns) values.push(turn(FUNCTIONS.vec2, values.at(-1) ?? { x: 0, y: 0 }));

  return values;
}
