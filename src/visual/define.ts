/**
 * @file visual — `defineVisualTest`: a name, where the test starts, its steps and whether it runs
 * in the WebGL leg, checked and frozen. Nothing runs at definition.
 */
import { stepEntry } from "./steps";
import type { VisualStart, VisualStep, VisualTest } from "./types";

/** A file name: lowercase letters and digits, words joined by single dashes. */
const fileName = /^[\da-z]+(?:-[\da-z]+)*$/u;

/** The second line of every file name message. */
const FILE_NAME_RULE = "Use lowercase letters, digits and dashes.";

/**
 * Freezes a value and everything it holds.
 *
 * @param value - A copy nobody else holds.
 * @returns The same value, frozen all the way down.
 * @example
 * ```ts
 * Object.isFrozen(freezeDeep({ steps: [{ checkpoint: "open" }] }).steps[0]); // true
 * ```
 */
function freezeDeep<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) freezeDeep(child);

    Object.freeze(value);
  }

  return value;
}

/**
 * Checks the steps: each holds one command or one checkpoint, and every checkpoint name is a
 * file name used once in the test.
 *
 * @param test - The test name.
 * @param steps - The steps.
 * @throws {Error} When a step is not one command, or a checkpoint name is not a file name or
 *   is used twice.
 */
function checkSteps(test: string, steps: readonly VisualStep[]): void {
  const checkpoints: string[] = [];

  for (const [index, step] of steps.entries()) {
    const entry = stepEntry(test, step, index);

    if (entry.kind === "command") continue;

    const at = `[game] Visual test "${test}", step ${index + 1}`;

    if (!fileName.test(entry.name)) {
      throw new Error(
        `${at}: the checkpoint name "${entry.name}" is not a file name.\n  ${FILE_NAME_RULE}`
      );
    }

    if (checkpoints.includes(entry.name)) {
      throw new Error(
        `${at}: the checkpoint "${entry.name}" is already a step.\n  Give every checkpoint of a test its own name.`
      );
    }

    checkpoints.push(entry.name);
  }
}

/**
 * Checks a visual test: its name and its checkpoint names are file names, no checkpoint name is
 * used twice, and every step is one step command. `defineVisualTest` checks at definition, and
 * the runner checks again, so a descriptor written by hand cannot reach outside its folder.
 *
 * @param name - The test name.
 * @param steps - The steps.
 * @throws {Error} When a name is not a file name, a checkpoint name is used twice, or a step is
 *   not one step command.
 */
export function checkVisualTest(name: string, steps: readonly VisualStep[]): void {
  if (!fileName.test(name)) {
    throw new Error(
      `[game] The visual test name "${name}" is not a file name.\n  ${FILE_NAME_RULE}`
    );
  }

  checkSteps(name, steps);
}

/**
 * Defines a visual test: where it starts, what `game.restore` loads, and its steps. A step is a
 * `/control` command by its short name with that command's input, or `{ checkpoint: name }`,
 * where the runner saves `state.json` and `describe.json` next to the test. `walk` runs fast: a
 * popup its last node opens never mounts, so the step before a checkpoint that shows a node's
 * result is `answer` or `tap`. With `webgl: true` the test also runs in the WebGL leg
 * (`--webgl`), whose pictures go to `screen.webgl.webp`: set it on a screen with a custom filter.
 * The answer is a frozen copy; nothing runs here.
 *
 * @param name - The test name, also its folder: lowercase letters, digits and dashes.
 * @param test - Where it starts, its steps and its WebGL leg.
 * @param test.start - The player, and optionally the session, the rng and the checkpoint.
 * @param test.steps - The commands and the checkpoints, in order.
 * @param test.webgl - True to run the test in the WebGL leg too; false by default.
 * @returns The test, frozen.
 * @throws {Error} When the name or a checkpoint name is not a file name, a checkpoint name is
 *   used twice, or a step is not one step command.
 * @example
 * ```ts
 * // tests/visual/reward-popup.visual.ts: Play, deliver the first order, claim the reward.
 * export const rewardPopup = defineVisualTest("reward-popup", {
 *   start: { player: fixtures.ready, checkpoint: "home" },
 *   steps: [{ tap: { key: "play" } }, { answer: { intent: "deliver", payload: { orderId: "o1" } } },
 *     { checkpoint: "open" }, { tap: { key: "claim" } }, { checkpoint: "claimed" }]
 * });
 * // A board drawn through a custom filter: the test also runs in the WebGL leg (`--webgl`).
 * export const boardMerge = defineVisualTest("board-merge", {
 *   start: atHome,
 *   steps: [{ tap: { key: "play" } }, { drag: { from: { projection: "board.items", key: "i2" },
 *     to: { projection: "board.items", key: "i3" } } }, { checkpoint: "merged" }],
 *   webgl: true
 * });
 * boardMerge.webgl; // true
 * ```
 */
export function defineVisualTest(
  name: string,
  test: { start: VisualStart; steps: readonly VisualStep[]; webgl?: boolean }
): VisualTest {
  checkVisualTest(name, test.steps);

  const webgl = test.webgl ?? false;

  return freezeDeep(structuredClone({ name, start: test.start, steps: test.steps, webgl }));
}
