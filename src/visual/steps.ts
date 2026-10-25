/**
 * @file visual — the steps of a visual test: each one is checked at definition and run through
 * the `/control` catalogue, by its short name, with `run`, so the dev guard, the journal of a
 * cheat and the envelope are the ones an editor gets. The step names come from the catalogue: a
 * command it gains is a step with no change here.
 */
import { commands } from "../plugins/flow/doors/commands";
import { run } from "../plugins/flow/doors/run";
import type { Effect, InputSchema } from "../plugins/flow/doors/types";
import type { Json } from "../plugins/model/types";
import type { StepCommand, VisualApp, VisualStep } from "./types";

/** The input of a command step as the runner hands it on: the object the step carries. */
export type StepInput = Readonly<Record<string, Json | undefined>>;

/**
 * A checkpoint step taken apart: its name, and whether it lands every motion before the snapshot
 * (`finish`, true unless the step says `finish: false`, F87).
 */
export type CheckpointEntry = { kind: "checkpoint"; name: string; finish: boolean };

/**
 * One step taken apart: a checkpoint by its name, or a command by its short name with its input.
 */
export type StepEntry = CheckpointEntry | { kind: "command"; name: StepCommand; input: StepInput };

/**
 * A command of the catalogue as the runner calls it: by its short name, with the input the step
 * type paired with that name. `run` is a method, so every command of the catalogue fits
 * whatever input its schema names, without a cast.
 */
export type StepRunner = {
  readonly id: string;
  readonly title: string;
  readonly input: InputSchema;
  readonly effect: Effect;
  run(app: VisualApp, input: StepInput): unknown;
};

/** The catalogue seen as step runners. */
const stepCommands: Readonly<Record<StepCommand, StepRunner>> = commands;

/**
 * Tells the three commands of the catalogue that are not steps: `bookmark` only reads, `capture`
 * is what the runner does by itself, and `debug` drawing would enter a baseline.
 *
 * @param name - A short name of the catalogue.
 * @returns True for `bookmark`, `capture` and `debug`.
 * @example
 * ```ts
 * isLeftOut("capture"); // true
 * ```
 */
function isLeftOut(name: string): boolean {
  return name === "bookmark" || name === "capture" || name === "debug";
}

/**
 * Tells whether a name is a step command: in the catalogue and not one of the three left out.
 *
 * @param name - The key of a step.
 * @returns True for `answer`, `tap`, `walk` and the other step commands.
 * @example
 * ```ts
 * isStepCommand("tap"); // true
 * isStepCommand("capture"); // false
 * ```
 */
function isStepCommand(name: string): name is StepCommand {
  return Object.hasOwn(commands, name) && !isLeftOut(name);
}

/**
 * Tells whether the value of a command step is an input object.
 *
 * @param value - The value under the command's name.
 * @returns True for an object that is neither `null` nor an array.
 * @example
 * ```ts
 * isInputObject({ key: "play" }); // true
 * ```
 */
function isInputObject(value: unknown): value is StepInput {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Names the step commands, for a message: the catalogue's order minus the three left out.
 *
 * @returns `answer, tap, drag, ...`.
 */
function stepNames(): string {
  return Object.keys(commands)
    .filter(name => isStepCommand(name))
    .join(", ");
}

/**
 * Takes a checkpoint step apart: its name, a string, and `finish`, a boolean when it is there; no
 * other key.
 *
 * @param at - The test and the step, for the message.
 * @param fields - The step.
 * @returns The checkpoint.
 * @throws {Error} When the name is not a string, `finish` not a boolean, or another key is there.
 * @example
 * ```ts
 * checkpointEntry('[game] Visual test "fade", step 2', { checkpoint: "glow", finish: false }); // { kind: "checkpoint", name: "glow", finish: false }
 * ```
 */
function checkpointEntry(at: string, fields: Readonly<Record<string, unknown>>): CheckpointEntry {
  const { checkpoint: name, finish = true, ...others } = fields;

  if (Object.keys(others).length > 0) {
    throw new Error(
      `${at} is not one command.\n  A checkpoint takes its name and finish, like { checkpoint: "name", finish: false }.`
    );
  }

  if (typeof name !== "string") {
    throw new TypeError(
      `${at}: the checkpoint name is not a string.\n  Write the checkpoint as { checkpoint: "name" }.`
    );
  }

  if (typeof finish !== "boolean") {
    throw new TypeError(
      `${at}: finish of the checkpoint "${name}" is not a boolean.\n  Write finish: false to keep the motions running, or leave it out.`
    );
  }

  return { kind: "checkpoint", name, finish };
}

/**
 * Takes one step apart and checks its shape: a checkpoint (its name, and `finish` when it is
 * there), or exactly one step command with an input object. The checkpoint name is checked by the
 * caller.
 *
 * @param test - The test name, for the message.
 * @param step - The step.
 * @param index - Its index in the steps, from 0.
 * @returns The checkpoint or the command with its input.
 * @throws {Error} When the step holds no key or more than one, names something that is not a
 *   step, gives a command no input object, or a checkpoint no string name or a `finish` that is
 *   not a boolean.
 * @example
 * ```ts
 * stepEntry("reward-popup", { tap: { key: "play" } }, 0); // { kind: "command", name: "tap", input: { key: "play" } }
 * ```
 */
export function stepEntry(test: string, step: VisualStep, index: number): StepEntry {
  const fields: Readonly<Record<string, unknown>> = step;
  const [name, ...others] = Object.keys(fields);
  const at = `[game] Visual test "${test}", step ${index + 1}`;

  if (Object.hasOwn(fields, "checkpoint")) return checkpointEntry(at, fields);

  if (name === undefined || others.length > 0) {
    throw new Error(
      `${at} is not one command.\n  Write one command by its short name, or { checkpoint: "name" }.`
    );
  }

  const value = fields[name];

  if (!isStepCommand(name)) {
    throw new Error(
      `${at} names "${name}", which is not a step.\n  Use a checkpoint or one of: ${stepNames()}.`
    );
  }

  if (!isInputObject(value)) {
    throw new Error(
      `${at} (${name}) has no input object.\n  Pass the input of the command, like { tap: { key: "play" } }.`
    );
  }

  return { kind: "command", name, input: value };
}

/**
 * Runs a command step through `run`, the way an editor does.
 *
 * @param app - The running app.
 * @param name - The short name of the command.
 * @param input - Its input.
 * @returns What `run` resolves with.
 * @throws {Error} Whatever the command throws.
 */
export function runStep(app: VisualApp, name: StepCommand, input: StepInput): Promise<unknown> {
  return run(app, stepCommands[name], input);
}
