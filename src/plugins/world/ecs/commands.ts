/**
 * @file world/ecs — the command buffer: structural changes made while a phase runs are applied in
 * call order when the phase ends.
 */
import type { WorldCtx } from "../types";
import { forgetChanges } from "./changes";
import { isAlive, ownerKey, releaseEntity } from "./entities";
import { recordDespawn } from "./history";
import { attachComponent, clearEntity, detachComponent } from "./storage";
import type { AnyComponentValue, Command, Entity, Owner } from "./types";

/**
 * Removes every component of an entity and frees its index. A stale id is a no-op. The frame
 * history records the despawn first, while the components are still there.
 *
 * @param ctx - Domain context of the world plugin.
 * @param entity - The entity to remove.
 */
export function despawnEntity(ctx: WorldCtx, entity: Entity): void {
  if (!isAlive(ctx.state.ecs, entity)) return;

  recordDespawn(ctx, entity);
  clearEntity(ctx, entity);
  releaseEntity(ctx.state.ecs, entity);
  forgetChanges(ctx.state.ecs, entity);
  ctx.state.ecs.despawns += 1;
}

/**
 * Despawns exactly the entities of one owner and tells the listeners that the owner left.
 *
 * @param ctx - Domain context of the world plugin.
 * @param owner - The owner whose entities go.
 */
export function despawnOwner(ctx: WorldCtx, owner: Owner): void {
  const owned = ctx.state.ecs.byOwner.get(ownerKey(owner));

  // A copy: despawning takes the entity out of the very set this loop walks.
  // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
  for (const entity of [...(owned ?? [])]) despawnEntity(ctx, entity);

  // A copy: a listener that removes itself must not make the loop skip the next one.
  // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
  for (const listener of [...ctx.state.ecs.ownerLeft]) listener(owner);
}

/**
 * Applies one structural command. A command whose target died meanwhile is dropped.
 *
 * @param ctx - Domain context of the world plugin.
 * @param command - The command to apply.
 */
export function applyCommand(ctx: WorldCtx, command: Command): void {
  if (command.kind === "despawnOwnedBy") {
    despawnOwner(ctx, command.owner);

    return;
  }

  if (!isAlive(ctx.state.ecs, command.entity)) return;

  switch (command.kind) {
    case "attach": {
      for (const value of command.components) attachComponent(ctx, command.entity, value);

      break;
    }
    case "add": {
      attachComponent(ctx, command.entity, command.value);

      break;
    }
    case "remove": {
      detachComponent(ctx, command.entity, command.component);

      break;
    }
    default: {
      despawnEntity(ctx, command.entity);
    }
  }
}

/**
 * Applies a command at once outside a phase, or queues it while one runs.
 *
 * @param ctx - Domain context of the world plugin.
 * @param command - The command.
 */
export function queueOrApply(ctx: WorldCtx, command: Command): void {
  if (ctx.state.ecs.running !== undefined) {
    ctx.state.ecs.commands.push(command);

    return;
  }

  applyCommand(ctx, command);
  releaseCommand(command);
}

/** An `add` command, as the pool keeps it. */
type AddCommand = Extract<Command, { kind: "add" }>;

/** A `remove` command, as the pool keeps it. */
type RemoveCommand = Extract<Command, { kind: "remove" }>;

/** How many applied commands of one kind, and how many emptied batches, are kept for the next frame. */
const POOL_SIZE = 256;

/**
 * The `add` and `remove` commands applied and kept for the next one, and the emptied batches of a flush: an
 * `Animation` counted up and down per track, a tag set and taken, queue nothing new once warm (F244 В). A command is
 * applied and forgotten before it is kept, so one object is never in two queues; the worlds of a process share them.
 */
const freeAdds: AddCommand[] = [];
const freeRemoves: RemoveCommand[] = [];
const freeBatches: Command[][] = [];

/**
 * The command that adds one component value to an entity: a kept one, written again, or a new one.
 *
 * @param entity - The entity.
 * @param value - The component or tag value.
 * @returns The command.
 */
export function addCommand(entity: Entity, value: AnyComponentValue): Command {
  const kept = freeAdds.pop();

  if (kept === undefined) return { kind: "add", entity, value };

  kept.entity = entity;
  kept.value = value;

  return kept;
}

/**
 * The command that removes one component from an entity: a kept one, written again, or a new one.
 *
 * @param entity - The entity.
 * @param component - Component name.
 * @returns The command.
 */
export function removeCommand(entity: Entity, component: string): Command {
  const kept = freeRemoves.pop();

  if (kept === undefined) return { kind: "remove", entity, component };

  kept.entity = entity;
  kept.component = component;

  return kept;
}

/**
 * Keeps an applied `add` or `remove` command for the next one, while the pool has room.
 *
 * @param command - A command that was just applied.
 */
function releaseCommand(command: Command): void {
  if (command.kind === "add" && freeAdds.length < POOL_SIZE) freeAdds.push(command);
  else if (command.kind === "remove" && freeRemoves.length < POOL_SIZE) freeRemoves.push(command);
}

/**
 * Applies every queued command in call order. A command queued by an applied command is applied
 * in the same flush, after the batch it came from. The batch applied is emptied and kept, and the
 * next queue is a kept one: a flush builds no list.
 *
 * @param ctx - Domain context of the world plugin.
 */
export function flushCommands(ctx: WorldCtx): void {
  const state = ctx.state.ecs;

  while (state.commands.length > 0) {
    const batch = state.commands;

    state.commands = freeBatches.pop() ?? [];

    // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing, also cold.
    for (let index = 0; index < batch.length; index += 1) {
      const command = batch[index];

      if (command === undefined) continue;

      applyCommand(ctx, command);
      releaseCommand(command);
    }

    // Popped, never cut with `length`: a cut releases the array's store, and the next queue would allocate it again.
    while (batch.length > 0) batch.pop();
    if (freeBatches.length < POOL_SIZE) freeBatches.push(batch);
  }
}
