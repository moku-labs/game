/**
 * @file text plugin — the fixtures of the perf tests and benches. Not a test file. The text system
 * runs here inside the real world modules over the mock world of the world unit tests, with a
 * `model`, a `flow`, an `i18n` and a `clock` that allocate nothing per read, so only the world
 * walk and the text step land in a measured window. Everything is built and resolved once outside
 * any window.
 */
import type { Api as ClockApi } from "../../../clock/types";
import type { Api as FlowApi } from "../../../flow/types";
import type { I18nApi } from "../../../i18n/types";
import type { Api as ModelApi, Snapshot } from "../../../model/types";
import type { Time } from "../../../time/types";
import { createMockWorld, type MockWorld } from "../../../world/__tests__/unit/mock-world";
import { createModules } from "../../../world/api";
import { component } from "../../../world/ecs/define";
import type { Entity, Owner } from "../../../world/ecs/types";
import { withDeps } from "../../../world/lifecycle";
import type { EcsModule } from "../../../world/types";
import { bind, builtInStyles, Countdown, Text } from "../../components";
import { createTextSystem } from "../../resolve";
import { createTextState } from "../../state";
import type { Config, Deps, TextCtx } from "../../types";

/** The component the bound labels of a fixture show. */
const Counter = component("Counter", { value: 0 });

/** Owner of every entity a fixture spawns. */
const OWNER: Owner = { kind: "plugin", name: "perf" };

/** Labels of a fixture with a plain string. */
const PLAIN = 80;

/** Labels of a fixture bound to `Counter.value`. */
const BOUND = 20;

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

/**
 * What moves between the frames of a fixture: nothing, the counter of one bound label, or the
 * clock under one running countdown label.
 */
export type Moving = "nothing" | "value" | "countdown";

/**
 * 100 labels: 80 with a plain string, 20 bound to their entity's `Counter.value` in the digits
 * style, the text system registered in phase `layout`. With `"value"`, the counter of the first
 * bound label moves by one every frame, cycling through ten values. With `"countdown"`, one more
 * label shows a `Countdown` of ten seconds in `"mm:ss"`, started again whenever it ends, and the
 * clock moves a phone's frame each frame: its time left is read every frame and its string changes
 * once a second.
 *
 * @param moving - What changes per frame.
 * @returns One frame: phase `layout`, then the clear of phase `signals`.
 */
export function resolveFixture(moving: Moving): () => void {
  const world = createMockWorld();
  const ecs = stableEcs(world);
  const now = new Float64Array([CLOCK_START_MS]);
  const ctx = textCtx(world, now);
  const time: Time = { delta: 16.6, elapsed: 0, scale: 1, frame: 1, idle: false };

  world.api.ecs.system(createTextSystem(ctx));

  for (let index = 0; index < PLAIN; index += 1) {
    world.api.ecs.spawn(OWNER, [Text({ content: `label ${index}` })]);
  }

  let first: Entity | undefined;

  for (let index = 0; index < BOUND; index += 1) {
    const entity = world.api.ecs.spawn(OWNER, [
      Counter({ value: index }),
      Text({ style: "digits", bind: bind(Counter, "value") })
    ]);

    first ??= entity;
  }

  const timer = world.api.ecs.spawn(OWNER, [
    Countdown({ until: CLOCK_START_MS + COUNTDOWN_MS }),
    ...(moving === "countdown"
      ? [Text({ style: "digits", bind: bind(Countdown, "left", { format: "mm:ss" }) })]
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

  return frame;
}
