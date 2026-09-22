/**
 * @file anim/timeline — the temporary entities of a timeline: a `spawn` step made real when it is
 * reached, and the build-time check that one timeline spawns each id once. The timeline despawns
 * what it spawned when it ends (`play.ts`), so nothing a choreography made outlives it.
 */
import { Layer, Order } from "../../world/ecs/define";
import type { CursorCtx, Step } from "./types";

/**
 * Makes the entity of a `spawn` step through the runtime, drawn in the step's layer at its order,
 * and records it under its id, so later steps of the timeline can aim at it.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param step - The spawn step that was reached.
 */
export function spawnStep(cctx: CursorCtx, step: Extract<Step, { kind: "spawn" }>): void {
  const entity = cctx.rt.spawn([
    ...step.components,
    Layer({ name: step.layer }),
    Order({ value: step.order })
  ]);

  cctx.spawned.set(step.id, entity);
}

/**
 * Creates the empty id set of one check. It lives in its own non-exported function because lint
 * rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty set of spawn ids.
 */
function emptyIdSet(): Set<string> {
  return new Set();
}

/**
 * Walks the tree and throws at the second `spawn` step of an id.
 *
 * @param animation - Id of the animation being played, named in the message.
 * @param step - The step to look into.
 * @param seen - The spawn ids met so far.
 * @throws {Error} When the tree spawns one id twice.
 */
function collectSpawnIds(animation: string, step: Step, seen: Set<string>): void {
  if (step.kind === "sequence" || step.kind === "parallel") {
    for (const child of step.steps) collectSpawnIds(animation, child, seen);

    return;
  }

  if (step.kind === "use") {
    collectSpawnIds(animation, step.step, seen);

    return;
  }

  if (step.kind !== "spawn") return;

  if (seen.has(step.id)) {
    throw new Error(
      `[game] Animation "${animation}" spawns "${step.id}" twice.\n` +
        "  Give every spawned entity its own id."
    );
  }

  seen.add(step.id);
}

/**
 * Checks, right after `build`, that one timeline spawns each id once, nested animations included:
 * `spawned(id)` must name exactly one entity.
 *
 * @param animation - Id of the animation being played.
 * @param step - The step tree `build` returned.
 * @throws {Error} When the tree spawns one id twice.
 */
export function assertUniqueSpawns(animation: string, step: Step): void {
  collectSpawnIds(animation, step, emptyIdSet());
}
