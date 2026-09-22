/**
 * @file world/ecs — the command buffer: structural changes made while a phase runs are applied in
 * call order when the phase ends.
 */
import type { WorldCtx } from "../types";
import { forgetChanges } from "./changes";
import { isAlive, ownerKey, releaseEntity } from "./entities";
import { attachComponent, clearEntity, detachComponent } from "./storage";
import type { Command, Entity, Owner } from "./types";

/**
 * Removes every component of an entity and frees its index. A stale id is a no-op.
 *
 * @param ctx - Domain context of the world plugin.
 * @param entity - The entity to remove.
 */
export function despawnEntity(ctx: WorldCtx, entity: Entity): void {
  if (!isAlive(ctx.state.ecs, entity)) return;

  clearEntity(ctx, entity);
  releaseEntity(ctx.state.ecs, entity);
  forgetChanges(ctx.state.ecs, entity);
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
  if (ctx.state.ecs.running === undefined) applyCommand(ctx, command);
  else ctx.state.ecs.commands.push(command);
}

/**
 * Applies every queued command in call order. A command queued by an applied command is applied
 * in the same flush, after the batch it came from.
 *
 * @param ctx - Domain context of the world plugin.
 */
export function flushCommands(ctx: WorldCtx): void {
  while (ctx.state.ecs.commands.length > 0) {
    const batch = ctx.state.ecs.commands;

    ctx.state.ecs.commands = [];
    for (const command of batch) applyCommand(ctx, command);
  }
}
