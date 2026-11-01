/**
 * @file text plugin — the fixtures of the perf tests and benches. Not a test file. The text system
 * runs here inside the real world modules over the mock world of the world unit tests, with a
 * `model`, a `flow`, an `i18n` and a `clock` that allocate nothing per read, so only the world
 * walk and the text step land in a measured window. The display adapter runs over a Pixi module
 * of three tiny classes. Everything is built and resolved once outside any window.
 */
import type { Api as ClockApi } from "../../../clock/types";
import type { Api as FlowApi } from "../../../flow/types";
import type { I18nApi } from "../../../i18n/types";
import type { Api as ModelApi, Snapshot } from "../../../model/types";
import type { PixiModule, Api as RendererApi } from "../../../renderer/types";
import type { Time } from "../../../time/types";
import { createMockWorld, type MockWorld } from "../../../world/__tests__/unit/mock-world";
import { createModules } from "../../../world/api";
import { component } from "../../../world/ecs/define";
import type { Entity, Owner } from "../../../world/ecs/types";
import { withDeps } from "../../../world/lifecycle";
import type { EcsModule } from "../../../world/types";
import { bind as builtInBind, builtInStyles, Countdown, Text, textFor } from "../../components";
import { createTextAdapter } from "../../display";
import { createTextFrame, createTextSystem, resolveAdded } from "../../resolve";
import { createTextState } from "../../state";
import type { Config, Deps, TextCtx, TextFormatAnswer, TextValue } from "../../types";

/** The `bind` of a game that named the fixture's format, the same function as the root one. */
const { bind } = textFor<string, string, "perf.pill">();

/** The component the bound labels of a fixture show. */
const Counter = component("Counter", { value: 0 });

/** Owner of every entity a fixture spawns. */
const OWNER: Owner = { kind: "plugin", name: "perf" };

/** Labels of a fixture with a plain string. */
const PLAIN = 80;

/** Labels of a fixture bound to `Counter.value`. */
const BOUND = 20;

/** The style of the labels that wrap at their box: `body` with `wrap: "box"`. */
const BOX_STYLE = "card.name";

/** The box of the first label that wraps at its box; each next one is a unit wider. */
const BOX_FROM = 120;

/** How many values the working fixture's counter cycles through, so its layouts stay cached. */
const VALUES = 10;

/**
 * A frame of the fixture's clock: whole milliseconds, as the real `clock.now()` answers
 * (`Math.trunc` of its source), so the time left is a whole number as on a device.
 */
const FRAME_MS = 17;

/** Where the fixture's clock starts: an epoch moment of a real save, far past the Smi range. */
const CLOCK_START_MS = 1_790_000_000_000;

/** How long the countdown of a fixture runs before it starts again. */
const COUNTDOWN_MS = 10_000;

/**
 * How many frames a fixture runs before it is handed out, so V8 compiled the step and every
 * layout the working case shows is cached.
 */
const WARM_FRAMES = 20_000;

/** The model snapshot every frame reads: one kept object. */
const SNAPSHOT: Snapshot = Object.freeze({
  player: {},
  session: {},
  rng: { seed: 1, streams: {} }
});

/** The flow state every frame reads: live, one kept object. */
const LIVE = Object.freeze({ mode: "live" });

/** A log that keeps nothing: no warning is expected, and a spy would allocate per call. */
const SILENT = {
  addSink: (): void => {},
  clearSinks: (): void => {},
  debug: (): void => {},
  error: (): void => {},
  expect: (): void => {},
  info: (): void => {},
  reset: (): void => {},
  trace: (): never[] => [],
  warn: (): void => {}
};

/**
 * The world modules over the mock world's state, with a `model` and a `flow` that allocate
 * nothing per read.
 *
 * @param world - The mock world.
 * @returns The ecs module, internal half included.
 */
function stableEcs(world: MockWorld): EcsModule {
  const deps = withDeps(world.ctx).deps;
  const model = { store: { snapshot: () => SNAPSHOT } } as unknown as ModelApi;
  const flow = { state: () => LIVE } as unknown as FlowApi;

  return createModules({ ...world.ctx, deps: { ...deps, model, flow } }).ecs;
}

/**
 * The domain context of the text plugin over the mock world, with the built-in styles in place.
 * Only the deps the frame step reads are real: `world`, `i18n` and `clock`.
 *
 * @param world - The mock world.
 * @param now - The clock's moment, in a typed array so moving it keeps nothing.
 * @returns The text context.
 */
function textCtx(world: MockWorld, now: Float64Array): TextCtx {
  const config: Config = { fonts: { body: "ui.font-body", digits: "ui.font-digits" } };
  const state = createTextState();
  const i18n = {
    locale: (): string => "ru",
    format: (): never[] => [],
    duration: (): string => ""
  } as unknown as I18nApi;
  const clock = { now: (): number => now[0] ?? 0 } as unknown as ClockApi;
  const deps = { world: world.api, i18n, clock } as unknown as Deps;
  const styles = builtInStyles(config.fonts);

  state.styles.set("body", styles.body);
  state.styles.set("digits", styles.digits);
  state.styles.set(BOX_STYLE, { ...styles.body, wrap: "box" });

  return {
    config,
    state,
    emit: () => undefined,
    global: {},
    log: SILENT,
    require: () => undefined,
    deps
  } as unknown as TextCtx;
}

/** The answers of the format of the named fixture, kept: what is measured is the engine's cost. */
const SAME_ANSWER: TextFormatAnswer = Object.freeze({ content: "few", style: "digits" });

/** One kept answer per value of the counter of the named fixture, each with a string of its own. */
const ANSWERS: readonly TextFormatAnswer[] = Object.freeze(
  Array.from({ length: VALUES }, (_unused, value) =>
    Object.freeze({ content: String(value), style: "digits" })
  )
);

/**
 * What moves between the frames of the named fixture: nothing, the counter of one label under a
 * step whose answer stands, or under a step whose answer writes a new string.
 */
export type MovingNamed = "nothing" | "same" | "text";

/**
 * 100 labels: 80 with a plain string, 20 bound through a format a feature registered. The format
 * answers kept objects, so a window measures what the engine keeps and not what a game's format
 * allocates. With `"same"` the counter of the first label moves every frame and the answer stands:
 * one call, no write. With `"text"` every step writes a new string.
 *
 * @param moving - What changes per frame.
 * @returns One frame: phase `layout`, then the clear of phase `signals`.
 */
export function namedFixture(moving: MovingNamed): () => void {
  const world = createMockWorld();
  const ecs = stableEcs(world);
  const ctx = textCtx(world, new Float64Array([CLOCK_START_MS]));
  const time: Time = { delta: 16.6, elapsed: 0, scale: 1, frame: 1, idle: false };

  ctx.state.formats.set("perf.pill", value =>
    moving === "text" ? (ANSWERS[value % VALUES] ?? SAME_ANSWER) : SAME_ANSWER
  );
  world.api.ecs.system(createTextSystem(ctx, createTextFrame(ctx)));

  for (let index = 0; index < PLAIN; index += 1) {
    world.api.ecs.spawn(OWNER, [Text({ content: `label ${index}` })]);
  }

  let first: Entity | undefined;

  for (let index = 0; index < BOUND; index += 1) {
    const entity = world.api.ecs.spawn(OWNER, [
      Counter({ value: index }),
      Text({ style: "digits", bind: bind(Counter, "value", { format: "perf.pill" }) })
    ]);

    first ??= entity;
  }

  // The stored value, written in place so the fixture's own write keeps nothing.
  const counter = world.api.ecs.get(first ?? 0, Counter) as { value: number };
  let tick = 0;

  const frame = (): void => {
    time.frame += 1;

    if (moving !== "nothing") {
      tick = (tick + 1) % VALUES;
      counter.value = tick;
    }

    ecs.runPhase("layout", time);
    ecs.clearChanges();
  };

  for (let index = 0; index < WARM_FRAMES; index += 1) frame();

  return frame;
}

/**
 * What moves between the frames of a fixture: nothing, the counter of one bound label, or the
 * clock under one running countdown label.
 */
export type Moving = "nothing" | "value" | "countdown";

/**
 * What one call of a fixture runs: phase `layout` with the text system and the clear of phase
 * `signals`; the step `text` runs right after the layout flush alone; or the phase after a flush
 * whose step resolved the 20 bound labels, which writes their `Text` once more.
 */
export type Measured = "phase" | "added" | "rewrite";

/**
 * How the 80 plain labels of a fixture wrap: in `body`, which does not, or in a style with
 * `wrap: "box"`, each laid out at a box of its own, as `ui` writes it (F50).
 */
export type Wrap = "own" | "box";

/**
 * 100 labels: 80 with a plain string, 20 bound to their entity's `Counter.value` in the digits
 * style, the text system registered in phase `layout`. With `"value"`, the counter of the first
 * bound label moves by one every frame, cycling through ten values. With `"countdown"`, one more
 * label shows a `Countdown` of ten seconds in `"mm:ss"`, started again whenever it ends, and the
 * clock moves a phone's frame each frame: its time left is read every frame and its string changes
 * once a second. With `measured` `"added"` a call is the step after the layout flush with no label
 * added, the frame every frame of a still screen runs (F22); with `"rewrite"` it is the phase
 * after a flush whose step resolved the 20 bound labels. With `wrap` `"box"` the 80 plain labels
 * are in a style that wraps at its box, from 120 wide on, so most of them are two lines.
 *
 * @param moving - What changes per frame.
 * @param measured - What one call runs; the whole phase when left out.
 * @param wrap - How the plain labels wrap; at their style's own rule when left out.
 * @returns One frame: phase `layout`, then the clear of phase `signals`; or the step after the
 *   layout flush.
 */
export function resolveFixture(
  moving: Moving,
  measured: Measured = "phase",
  wrap: Wrap = "own"
): () => void {
  const world = createMockWorld();
  const ecs = stableEcs(world);
  const now = new Float64Array([CLOCK_START_MS]);
  const ctx = textCtx(world, now);
  const time: Time = { delta: 16.6, elapsed: 0, scale: 1, frame: 1, idle: false };
  const textFrame = createTextFrame(ctx);

  world.api.ecs.system(createTextSystem(ctx, textFrame));

  for (let index = 0; index < PLAIN; index += 1) {
    const content = `label ${index}`;

    world.api.ecs.spawn(OWNER, [
      wrap === "box"
        ? Text({ content, style: BOX_STYLE, box: BOX_FROM + index })
        : Text({ content })
    ]);
  }

  let first: Entity | undefined;
  const bound: Entity[] = [];

  for (let index = 0; index < BOUND; index += 1) {
    const entity = world.api.ecs.spawn(OWNER, [
      Counter({ value: index }),
      Text({ style: "digits", bind: builtInBind(Counter, "value") })
    ]);

    first ??= entity;
    bound.push(entity);
  }

  const timer = world.api.ecs.spawn(OWNER, [
    Countdown({ until: CLOCK_START_MS + COUNTDOWN_MS }),
    ...(moving === "countdown"
      ? [Text({ style: "digits", bind: builtInBind(Countdown, "left", { format: "mm:ss" }) })]
      : [])
  ]);

  // The stored values, written in place so the fixture's own writes keep nothing.
  const counter = world.api.ecs.get(first ?? 0, Counter) as { value: number };
  const countdown = world.api.ecs.get(timer, Countdown) as { until: number };
  let tick = 0;

  const frame = (): void => {
    time.frame += 1;

    if (moving === "value") {
      tick = (tick + 1) % VALUES;
      counter.value = tick;
    }

    if (moving === "countdown") {
      const moment = (now[0] ?? 0) + FRAME_MS;

      now[0] = moment;

      // Started again at zero, so the strings it shows repeat and their layouts stay cached.
      if (moment >= countdown.until) countdown.until += COUNTDOWN_MS;
    }

    ecs.runPhase("layout", time);
    ecs.clearChanges();
  };

  for (let index = 0; index < WARM_FRAMES; index += 1) frame();

  if (measured === "phase") return frame;

  if (measured === "rewrite") {
    // As the step after a flush lists them: into the kept list, whose store has grown already.
    const again = (): void => {
      for (const entity of bound) ctx.state.rewrite.push(entity);
      frame();
    };

    for (let index = 0; index < WARM_FRAMES; index += 1) again();

    return again;
  }

  // The labels came before the first phase: its run emptied the list, and nothing comes after.
  const step = (): void => resolveAdded(ctx, textFrame);

  for (let index = 0; index < WARM_FRAMES; index += 1) step();

  return step;
}

/** One display object of the fixture's Pixi module: the fields and methods the adapter touches. */
class StubObject {
  x = 0;
  y = 0;
  alpha = 1;
  tint = 0xff_ff_ff;
  skew = { x: 0, y: 0 };
  text: unknown = "";
  children: StubObject[] = [];

  /**
   * Adds a child, as Pixi does.
   *
   * @param child - The child.
   * @returns The child.
   */
  addChild(child: StubObject): StubObject {
    this.children.push(child);

    return child;
  }

  /**
   * The child at an index.
   *
   * @param index - Where it sits.
   * @returns The child.
   */
  getChildAt(index: number): StubObject | undefined {
    return this.children[index];
  }

  /**
   * Takes every child out.
   *
   * @returns The children.
   */
  removeChildren(): StubObject[] {
    return this.children.splice(0);
  }

  /** Frees nothing: the fixture holds no texture. */
  destroy(): void {}
}

/** A glyph run of the fixture's Pixi module: a stub object that shows a text. */
class StubBitmapText extends StubObject {
  /**
   * Keeps the text it was built with.
   *
   * @param options - What the adapter hands Pixi.
   * @param options.text - The glyphs of the run.
   */
  constructor(options: { text: string }) {
    super();
    this.text = options.text;
  }
}

/** The fixture's Pixi module: what the adapter builds a label with. */
const STUB_PIXI = {
  Container: StubObject,
  BitmapText: StubBitmapText,
  Sprite: StubObject,
  Texture: { EMPTY: {} }
} as unknown as PixiModule;

/**
 * The display adapter's update of a label of a `"box"` style that shows its value already: the
 * renderer hands it a `Text` written again with the same string, style, anchor, alpha and box, as
 * a writeLive of `ui` does for a text whose rect moved and whose width stood (F50). The label is
 * built once outside any window, two lines at its box of 120.
 *
 * @returns One update.
 */
export function currentLabelFixture(): () => void {
  const world = createMockWorld();
  const ctx = textCtx(world, new Float64Array([CLOCK_START_MS]));
  const renderer = { host: { pixi: (): PixiModule => STUB_PIXI } } as unknown as RendererApi;
  const adapter = createTextAdapter({ ...ctx, deps: { ...ctx.deps, renderer } });
  const shown: TextValue = {
    ...Text.defaults,
    content: "label 0",
    style: BOX_STYLE,
    box: BOX_FROM,
    resolved: "label 0"
  };
  const again: TextValue = { ...shown };
  const object = adapter.create(shown, 1);
  const update = (): void => {
    adapter.update(object, shown, again);
  };

  for (let index = 0; index < WARM_FRAMES; index += 1) update();

  return update;
}
