/**
 * @file input plugin — the dev log of a lost tap (F122). A button that showed its press look and
 * did nothing is told in dev builds, with the reason, named by its projection key. A good tap
 * logs nothing and allocates nothing: a payload is built only for a line that is written.
 */
import type { Answer } from "../flow/types";
import type { Entity } from "../world/types";
import { Tappable } from "./components";
import type { InputCtx } from "./types";

/**
 * Why a press with the press look did not become a tap: the finger left the tap slop, the press
 * went to the scroll it pans, the browser cancelled it or took the capture away, another finger
 * took the pointer over, the world paused or turned fast, the view left during the press.
 */
export type LostPress =
  | "moved-off"
  | "scroll"
  | "cancelled"
  | "capture-lost"
  | "other-finger"
  | "paused"
  | "fast"
  | "view-gone";

/**
 * Tells whether the dev log is on: a dev build, `__MOKU_GAME_DEV__` defined true.
 *
 * @returns True in a dev build.
 */
function dev(): boolean {
  return typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__;
}

/**
 * Logs a press that wore the press look of a button and will not be a tap. Only a pressed view
 * that carries `Tappable` (or left the world during the press) is told; a press caught by a
 * scroll was the scroll's from its start, and a view without a tap has nothing to lose.
 *
 * @param ctx - Domain context of the input plugin.
 * @param reason - Why the press is lost.
 */
export function lostPress(ctx: InputCtx, reason: LostPress): void {
  if (!dev()) return;

  const { entity, caught, key } = ctx.state;

  if (entity === undefined || caught) return;
  if (reason !== "view-gone" && !ctx.deps.world.ecs.has(entity, Tappable)) return;

  ctx.log.warn("input: pressed, but the tap was not counted", { view: key ?? entity, reason });
}

/**
 * Logs an answer the gate did not take. A closed gate holds it for the next gate, so that is told
 * at debug level only: `flow` warns when the held answer is dropped. Otherwise the line says what
 * the gate said: `no-edge`, the resting node does not list the intent; `refused`, a guide's narrow
 * dropped it and names no `blocked`; `blocked`, it answered the guide's `blocked` in its place.
 *
 * @param ctx - Domain context of the input plugin.
 * @param entity - The view the answer came from.
 * @param answer - The answer the gate refused.
 * @param gate - What the gate said.
 * @param gate.open - Whether the gate was open.
 * @param gate.allowed - The intents the open gate lists.
 * @param blocked - Whether the guide's `blocked` was taken in the answer's place.
 */
export function lostAnswer(
  ctx: InputCtx,
  entity: Entity,
  answer: Answer,
  gate: { readonly open: boolean; readonly allowed: readonly string[] },
  blocked: boolean
): void {
  if (!dev()) return;

  const view = ctx.deps.world.projection.keyOf(entity) ?? entity;

  if (!gate.open && !blocked) {
    ctx.log.debug("input: counted, the gate is closed: held for the next gate", {
      view,
      intent: answer.intent
    });

    return;
  }

  let said = "refused";

  if (blocked) said = "blocked";
  else if (!gate.allowed.includes(answer.intent)) said = "no-edge";

  ctx.log.warn("input: counted, but the gate took nothing", {
    view,
    intent: answer.intent,
    gate: said
  });
}
