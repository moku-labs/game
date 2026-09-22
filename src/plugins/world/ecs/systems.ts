/**
 * @file world/ecs — the phases: system registration, the effective mode and one phase run.
 */
import type { Snapshot } from "../../model/types";
import type { Time } from "../../time/types";
import type { WorldCtx } from "../types";
import { flushCommands } from "./commands";
import { runQuery } from "./query";
import { asError, registerType, resourceValue, termType } from "./storage";
import type { AnySystem, EcsApi, ResourceType, SystemContext, WorldPhase } from "./types";

/** The one phase that runs in every mode, because `renderer.sync` lives in it. */
const ALWAYS = "sync";

/**
 * The effective mode: a fast walk of the graph makes the world fast, whatever it stored.
 *
 * @param ctx - Domain context of the world plugin.
 * @returns The mode this frame runs in.
 */
export function effectiveMode(ctx: WorldCtx): "live" | "paused" | "fast" {
  return ctx.deps.flow.state().mode === "fast" ? "fast" : ctx.state.ecs.mode;
}

/**
 * Reads the model snapshot of this frame, once. Four phases of one frame see the same object.
 *
 * @param ctx - Domain context of the world plugin.
 * @param time - The frame's `Time`.
 * @returns The frozen snapshot.
 */
export function frameSnapshot(ctx: WorldCtx, time: Readonly<Time>): Snapshot {
  const cached = ctx.state.ecs.frameSnapshot;

  if (cached !== undefined && cached.frame === time.frame) return cached.snapshot;

  const snapshot = ctx.deps.model.store.snapshot();

  ctx.state.ecs.frameSnapshot = { frame: time.frame, snapshot };

  return snapshot;
}

/**
 * Registers a system at the end of its phase list and returns the remover.
 *
 * @param ctx - Domain context of the world plugin.
 * @param definition - The system.
 * @returns The remover; calling it twice is a no-op.
 * @throws {Error} When a system of that name is already registered.
 */
export function registerSystem(ctx: WorldCtx, definition: AnySystem): () => void {
  const state = ctx.state.ecs;
  const phases: WorldPhase[] = ["input", "animate", "layout", "sync"];

  for (const phase of phases) {
    if (state.systems[phase].some(entry => entry.definition.name === definition.name)) {
      throw new Error(
        `[game] System "${definition.name}" is registered twice.\n` +
          "  Give the second system another name, or remove the first one."
      );
    }
  }

  for (const term of definition.query) registerType(ctx, termType(term));

  const entry = { definition, frame: ctx.deps.time.snapshot().frame };
  const list = state.systems[definition.phase];

  list.push(entry);

  return (): void => {
    const at = list.indexOf(entry);

    if (at !== -1) list.splice(at, 1);
  };
}

/**
 * Runs the systems of one phase and flushes the commands they queued. A throwing system is
 * reported and skipped for this frame; the frame goes on.
 *
 * @param ctx - Domain context of the world plugin.
 * @param world - The ecs API a system's `run` receives.
 * @param phase - The phase to run.
 * @param time - The frame's `Time`.
 */
export function runPhase(
  ctx: WorldCtx,
  world: EcsApi,
  phase: WorldPhase,
  time: Readonly<Time>
): void {
  const state = ctx.state.ecs;

  if (phase !== ALWAYS && effectiveMode(ctx) !== "live") return;

  const context: SystemContext = {
    world,
    res: <Value extends object>(resourceType: ResourceType<Value>): Value =>
      resourceValue(state, resourceType),
    snapshot: frameSnapshot(ctx, time),
    time
  };

  state.running = phase;

  for (const entry of state.systems[phase]) {
    if (entry.frame >= time.frame) continue;

    try {
      entry.definition.run(runQuery(ctx, entry.definition.query), context);
    } catch (error) {
      ctx.log.error(
        "world:system-failed",
        { system: entry.definition.name, phase },
        asError(error)
      );
    }
  }

  state.running = undefined;
  flushCommands(ctx);
}
