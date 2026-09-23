/**
 * @file flow/runner — the memoised `flow.state()`. The state is rebuilt only when the graph
 * moved, so an editor that polls it every frame allocates nothing while the game rests.
 */
import type { FlowCtx } from "../types";
import { framePath } from "./registry";
import type { FlowState, StateView } from "./types";

/**
 * Tells whether the view was read from the fields the graph stands on now.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param view - The last view.
 * @returns True while nothing the state shows moved.
 */
function isCurrent(ctx: FlowCtx, view: StateView): boolean {
  const runner = ctx.state.runner;

  return (
    view.running === (runner.running !== undefined) &&
    view.depth === runner.stack.length &&
    view.top === runner.stack.at(-1) &&
    view.open === ctx.state.gate.open &&
    view.mode === ctx.state.fx.mode &&
    view.journalIndex === runner.journalIndex
  );
}

/**
 * Builds a frozen state and the fields it was read from.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns The new view.
 */
function viewOf(ctx: FlowCtx): StateView {
  const runner = ctx.state.runner;
  const open = ctx.state.gate.open;
  const pending = open === undefined ? {} : { gate: Object.freeze([...open.allowed]) };
  const state: FlowState = Object.freeze({
    running: runner.running !== undefined,
    path: framePath(runner.stack),
    stack: Object.freeze([...runner.stack]),
    pending: Object.freeze(pending),
    mode: ctx.state.fx.mode
  });

  return {
    running: state.running,
    depth: runner.stack.length,
    top: runner.stack.at(-1),
    open,
    mode: state.mode,
    journalIndex: runner.journalIndex,
    state
  };
}

/**
 * Reads where the graph stands: the last state while nothing moved, a new frozen one otherwise.
 * `flow.state()` and the end of `flow.walk()` both read through here.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns Whether it runs, the path, the stack, what it waits for and the mode.
 */
export function readState(ctx: FlowCtx): FlowState {
  const runner = ctx.state.runner;
  const view = runner.view;

  if (view !== undefined && isCurrent(ctx, view)) return view.state;

  const next = viewOf(ctx);

  runner.view = next;

  return next.state;
}
