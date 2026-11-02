/**
 * @file flow/runner — the guide of a node, derived from state (`defineNode({ guide })`). It is
 * derived when the node is entered and again after a commit while the node waits at its gate: a
 * new result narrows the gate and shows the guide through the `guide` handler, an equal one changes
 * nothing, `undefined` lifts it. A `guide` that throws fails the node.
 */
import type { Json } from "../../model/types";
import { guidePayload, jsonEquals } from "../guide";
import type { FlowCtx } from "../types";
import { asError } from "./edge";
import type { Step } from "./loop-types";
import { noop } from "./loop-types";
import { guideAnswer } from "./node";
import type { Modules, NodeGuideHost } from "./types";

/** The payload of a `guide` descriptor. */
type GuidePayload = { [key: string]: Json };

/**
 * Builds the failure of a `guide` that threw, or returned what is no `GuideOptions`. The thrown
 * message keeps its own punctuation.
 *
 * @param path - Runtime path of the node.
 * @param error - What the `guide` threw.
 * @returns The error the node fails with; the thrown value is its cause.
 * @example
 * ```ts
 * guideThrew("board/awaitIntent", new Error("no step.")).message;
 * // '[game] The guide of node "board/awaitIntent" threw: no step.\n  Return GuideOptions or undefined from guide.'
 * ```
 */
function guideThrew(path: string, error: unknown): Error {
  return new Error(
    `[game] The guide of node "${path}" threw: ${asError(error).message}\n  Return GuideOptions or undefined from guide.`,
    { cause: error }
  );
}

/**
 * Checks, in a dev build, that the answer of a blocked press is an outcome of the node: the gate
 * lists only the node's outcomes, so any other intent would be refused at every press.
 *
 * @param step - The node run in progress.
 * @param payload - The guide's payload, or `undefined` for none.
 * @returns The error of a `blocked` the node does not take, `undefined` otherwise.
 */
function wrongBlocked(step: Step, payload: GuidePayload | undefined): Error | undefined {
  // The dev guard is inline: a production `define` folds it away.
  if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) return undefined;

  const blocked = guideAnswer(payload, "blocked");

  if (blocked === undefined || Object.hasOwn(step.node.outcomes, blocked.intent)) return undefined;

  return new Error(
    `[game] The guide of node "${step.path}" blocks with "${blocked.intent}", which is no outcome of the node.\n  Add it to outcomes or drop blocked.`
  );
}

/**
 * Hands a result to the `guide` handler with a signal of its own. A handler that fails is logged,
 * `flow:guide-handler-failed`; one that fails after the node's abort was told to stop.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @param payload - The result as the descriptor's payload.
 */
function runGuide(ctx: FlowCtx, modules: Modules, step: Step, payload: GuidePayload): void {
  modules.fx.run({ kind: "guide", payload }, step.signal).catch((error: unknown) => {
    // The node was left while the handler ran: it was told to stop, nothing failed.
    if (step.signal.aborted) return;

    ctx.log.error("flow:guide-handler-failed", { path: step.path }, asError(error));
  });
}

/**
 * Shows a new result of the guide: the guide shown so far ends with its narrow, the gate is
 * narrowed to `allow` and `blocked`, and the `guide` handler gets the payload with a signal of its
 * own. A result equal to the last one changes nothing; `undefined` only lifts.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @param guide - The node's guide: its last result is compared and replaced.
 * @param payload - The new result as the descriptor's payload, or `undefined` for none.
 */
function show(
  ctx: FlowCtx,
  modules: Modules,
  step: Step,
  guide: NodeGuideHost,
  payload: GuidePayload | undefined
): void {
  if (jsonEquals(payload, guide.last)) return;

  const shown = guide.last !== undefined;

  guide.last = payload;
  // The guide shown so far leaves with the narrow it carried: the new one replaces both.
  if (shown) modules.fx.endGuides();

  if (payload === undefined) {
    // eslint-disable-next-line unicorn/no-useless-undefined -- `undefined` lifts the narrow.
    modules.gate.narrow(undefined);

    return;
  }

  modules.gate.narrow(guideAnswer(payload, "allow"), guideAnswer(payload, "blocked"));
  runGuide(ctx, modules, step, payload);
}

/**
 * Derives the guide from the committed state and shows a new result.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @param guide - The node's guide.
 * @returns The error the node fails with: its `guide` threw, or names a `blocked` it does not take.
 */
function derive(
  ctx: FlowCtx,
  modules: Modules,
  step: Step,
  guide: NodeGuideHost
): Error | undefined {
  const { player, session } = ctx.deps.model.store.snapshot();
  let payload: GuidePayload | undefined;

  try {
    const options = step.node.guide?.({ player, session });

    // Copied in the same guard: a result that is no `GuideOptions` fails as a throw does.
    payload = options === undefined ? undefined : guidePayload(options);
  } catch (error) {
    return guideThrew(step.path, error);
  }

  const wrong = wrongBlocked(step, payload);

  if (wrong !== undefined) return wrong;

  show(ctx, modules, step, guide, payload);

  return undefined;
}

/**
 * Enters the guide of a node: derives it from the committed state and keeps it in the runner state,
 * so a commit while the node waits at its gate derives it again. Called after the node's `onEnter`
 * stages and before its outcome is awaited. A node without `guide`, and one already aborted, change
 * nothing. A `guide` that throws again after a commit fails the node through `step.fail`. `reshow`
 * hands the last result to the handler again, once the mode is live after a fast walk.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @returns The error the node fails with at its entry, `undefined` when it goes on.
 */
export function enterGuide(ctx: FlowCtx, modules: Modules, step: Step): Error | undefined {
  // A node a stop or a restore left during its stages guides nothing: it ends without a wait.
  if (step.node.guide === undefined || step.signal.aborted) return undefined;

  const guide: NodeGuideHost = { last: undefined, refresh: noop, reshow: noop };

  guide.refresh = (): void => {
    // A commit after the node was left, or aborted, derives nothing for it.
    if (step.signal.aborted || ctx.state.runner.guide !== guide) return;

    const failed = derive(ctx, modules, step, guide);

    if (failed !== undefined) step.fail(failed);
  };
  guide.reshow = (): void => {
    const last = guide.last;

    // A node that was left, or guides nothing, shows nothing.
    if (step.signal.aborted || ctx.state.runner.guide !== guide || last === undefined) return;

    // The fast run's signal ends; the narrow it set stands and the handler gets the result again.
    modules.fx.endGuides();
    runGuide(ctx, modules, step, last);
  };
  ctx.state.runner.guide = guide;

  return derive(ctx, modules, step, guide);
}
