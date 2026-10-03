/**
 * @file visual — the headless leg: plain Bun, the renderer inert, the mode `live`. Each test gets
 * a fresh app: start, restore its start through `game.restore`, play its steps through the
 * `/control` commands, and at each checkpoint land every motion and compare `state.json` and
 * `describe.json` with their baselines, or write them.
 */
import { commands } from "../plugins/flow/doors/commands";
import { run } from "../plugins/flow/doors/run";
import { describeOf, stateOf } from "./capture";
import { stableJson } from "./compare";
import { baselineFile, checkBaseline } from "./files";
import { frames, settle } from "./settle";
import { runStep, stepEntry } from "./steps";
import type {
  CheckpointResult,
  VisualApp,
  VisualRun,
  VisualSetup,
  VisualTest,
  VisualTestResult
} from "./types";

/** Where the rejection of `flow.run()` waits until a settle asks for it. */
type Loop = { error: unknown };

/** What one test plays on: its app, the test, the run options and the loop's error. */
type Play = { app: VisualApp; test: VisualTest; run: VisualRun; loop: Loop };

/** The frames run after `finishAll`, so the landed pose is laid out and synced. */
const REST_FRAMES = 2;

/**
 * Sets the dev flag for a run: the `/control` commands run in dev builds only, and this is a test
 * tool a game calls on purpose.
 *
 * @returns Puts the flag back as it was.
 */
function enableDevelopment(): () => void {
  const had = Object.hasOwn(globalThis, "__MOKU_GAME_DEV__");
  const before = globalThis.__MOKU_GAME_DEV__;

  globalThis.__MOKU_GAME_DEV__ = true;

  return () => {
    if (had) globalThis.__MOKU_GAME_DEV__ = before;
    else Reflect.deleteProperty(globalThis, "__MOKU_GAME_DEV__");
  };
}

/**
 * Reads the message of whatever a test threw.
 *
 * @param error - What was thrown.
 * @returns The message of an error, the value as text otherwise.
 * @example
 * ```ts
 * messageOf(new Error("[game] Boom.\n  Fix it.")); // "[game] Boom.\n  Fix it."
 * ```
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Turns the message of a failure into the second line of the test's error: one sentence or
 * more, without the `[game]` mark, ending with a period.
 *
 * @param error - What the command threw.
 * @returns The reason.
 * @example
 * ```ts
 * reasonOf(new Error("[game] No element.\n  Read sources.ui.")); // "No element. Read sources.ui."
 * ```
 */
export function reasonOf(error: unknown): string {
  const text = messageOf(error)
    .replace(/^\[game\] /u, "")
    .replaceAll(/\n\s*/gu, " ")
    .trim();

  return text.endsWith(".") ? text : `${text}.`;
}

/**
 * Builds the error of a step that failed: the test, the step and the reason. Both legs use it.
 *
 * @param test - The test name.
 * @param where - The step, such as `step 2 (tap)`.
 * @param error - What the step threw, or the message of it.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * stepFailure("reward-popup", "step 1 (tap)", "Target crashed").message;
 * // '[game] Visual test "reward-popup", step 1 (tap) failed.\n  Target crashed.'
 * ```
 */
export function stepFailure(test: string, where: string, error: unknown): Error {
  return new Error(`[game] Visual test "${test}", ${where} failed.\n  ${reasonOf(error)}`);
}

/**
 * Runs `work`, and turns its rejection into the error of a step.
 *
 * @param test - The test name.
 * @param where - The step, such as `step 2 (tap)`.
 * @param work - What the step does.
 * @throws {Error} `[game] Visual test "<test>", <where> failed.` with the reason below it.
 */
async function failing(test: string, where: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    throw stepFailure(test, where, error);
  }
}

/**
 * Starts the one loop unless the app's own `onStart` did, keeping its rejection.
 *
 * @param app - The started app.
 * @returns Where the rejection waits.
 */
function startLoop(app: VisualApp): Loop {
  const loop: Loop = { error: undefined };

  if (app.flow.state().running) return loop;

  app.flow.run().catch((error: unknown) => {
    loop.error = error;
  });

  return loop;
}

/**
 * Settles, then throws the rejection of the loop if it came.
 *
 * @param play - The test being played.
 * @param where - The step, for the message.
 * @throws {Error} When the graph does not settle, or the loop failed.
 */
async function settleAt(play: Play, where: string): Promise<void> {
  await settle(play.app, play.run.settleFrames, { test: play.test.name, where });

  if (play.loop.error !== undefined) throw play.loop.error;
}

/**
 * Plays a checkpoint: settle, land every track and loop, two frames, then read and compare.
 *
 * @param play - The test being played.
 * @param name - The checkpoint name.
 * @param where - The step, for the message.
 * @returns The outcome of the checkpoint; `pixels` is skipped in this leg.
 */
async function checkpoint(play: Play, name: string, where: string): Promise<CheckpointResult> {
  const { app, test, run: options } = play;

  await settleAt(play, where);
  app.anim.finishAll();
  await frames(app, REST_FRAMES);

  const file = (kind: string): string => baselineFile(options.dir, test.name, name, kind);
  const state = await checkBaseline(file("state.json"), stableJson(stateOf(app)), options.update);
  const describe = await checkBaseline(
    file("describe.json"),
    stableJson(describeOf(app)),
    options.update
  );
  const first = state.first ?? describe.first;
  const result: CheckpointResult = {
    name,
    state: state.outcome,
    describe: describe.outcome,
    pixels: "skipped"
  };

  return first === undefined ? result : { ...result, first };
}

/**
 * Plays the start and the steps of a test on a started app.
 *
 * @param play - The test being played.
 * @param checkpoints - Where each checkpoint's outcome goes, as soon as it is known.
 */
async function playSteps(play: Play, checkpoints: CheckpointResult[]): Promise<void> {
  const { app, test } = play;
  const repro = { ...test.start, route: [] };

  await settleAt(play, "the start");
  await failing(test.name, "the start", () => run(app, commands.restore, { repro }));
  await settleAt(play, "the start");

  for (const [index, step] of test.steps.entries()) {
    const entry = stepEntry(test.name, step, index);
    const where = `step ${index + 1} (${entry.kind === "checkpoint" ? "checkpoint" : entry.name})`;

    if (entry.kind === "checkpoint") {
      checkpoints.push(await checkpoint(play, entry.name, where));
      continue;
    }

    await failing(test.name, where, () => runStep(app, entry.name, entry.input));
    await settleAt(play, where);
  }
}

/**
 * Plays one test on a fresh app, live, and stops the app at the end.
 *
 * @param setup - How the runner builds a game.
 * @param test - The test.
 * @param options - The run options.
 * @param checkpoints - Where each checkpoint's outcome goes.
 */
async function playTest(
  setup: VisualSetup,
  test: VisualTest,
  options: VisualRun,
  checkpoints: CheckpointResult[]
): Promise<void> {
  const app = setup.app();

  app.flow.setMode("live");
  await app.start();

  try {
    await playSteps({ app, test, run: options, loop: startLoop(app) }, checkpoints);
  } finally {
    await app.stop();
  }
}

/**
 * Plays one test and turns its outcome into a result. A test that fails keeps the checkpoints it
 * reached and carries the error instead of throwing it.
 *
 * @param setup - How the runner builds a game.
 * @param test - The test to play.
 * @param options - The run options.
 * @returns The result of the test.
 */
async function playOne(
  setup: VisualSetup,
  test: VisualTest,
  options: VisualRun
): Promise<VisualTestResult> {
  const checkpoints: CheckpointResult[] = [];

  try {
    await playTest(setup, test, options, checkpoints);

    return { name: test.name, checkpoints };
  } catch (error) {
    return { name: test.name, checkpoints, error: messageOf(error) };
  }
}

/**
 * Runs the headless leg over the selected tests, one after the other. The dev flag is on for the
 * run and put back after it. A test that fails keeps the checkpoints it reached and carries the
 * error; the next test still runs.
 *
 * @param setup - How the runner builds a game.
 * @param tests - The selected tests.
 * @param options - The run options.
 * @returns One result per test, in order.
 */
export async function runHeadlessLeg(
  setup: VisualSetup,
  tests: readonly VisualTest[],
  options: VisualRun
): Promise<VisualTestResult[]> {
  const restore = enableDevelopment();
  const results: VisualTestResult[] = [];

  try {
    for (const test of tests) results.push(await playOne(setup, test, options));
  } finally {
    restore();
  }

  return results;
}
