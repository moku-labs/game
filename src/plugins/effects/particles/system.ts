/**
 * @file effects/particles — the `animate` system that runs every emitter: it starts an instance
 * when an `Emitter` names an effect, retires it when the effect changes or the component leaves,
 * steps the instances and the orphans, and keeps the particle budget. Under reduced motion a
 * stream stands still. The renderer draws nothing headless, so neither does this system.
 *
 * Per frame it allocates nothing: the host's root pose is written into one scratch pose, the
 * emission offset into one scratch point, and a local-space container's `Transform` is written
 * only when the host's pose moved.
 */
import { isDev } from "../../flow/doors/dev";
import { Transform, type TransformValue } from "../../renderer/components";
import { rootPoseInto } from "../../renderer/sync/pose";
import type { PixiModule, PixiTexture, Point } from "../../renderer/types";
import { system } from "../../world/ecs/define";
import type { AnySystem, EcsApi, Entity } from "../../world/types";
import type { EffectsCtx } from "../types";
import { bakeEmitter } from "./bake";
import { Emitter } from "./component";
import { createInstance, destroyInstance } from "./instance";
import { standsStill, stepBy } from "./step";
import type { BakedEmitter, EmitterInstance, EmitterValue, StepTime } from "./types";

/** The origin of an emission that does not follow its host. */
const STILL: Readonly<Point> = Object.freeze({ x: 0, y: 0 });

/** The host's root pose of the emitter being run: one object for the module, written in place every frame. */
const POSE: TransformValue = { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } };

/** Where a world-space stream emits from this frame, written in place; the step reads it at once and keeps nothing. */
const OFFSET: Point = { x: 0, y: 0 };

/** The four numbers of a local-space container's move, handed to `ecs.set`, which copies them: reused. */
const MOVE: Pick<TransformValue, "x" | "y" | "rotation" | "scale"> = {
  x: 0,
  y: 0,
  rotation: 0,
  scale: 1
};

/** The live particles `countParticles` sums, read by its module-level callback: no closure per frame. */
const tally = { live: 0 };

/**
 * Warns once per key. The key is kept in `state.warned`, so a bundle that comes back can let it
 * warn again.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param key - The one-shot key, `"emitter:fx.x"`, `"texture:fx.star"` or `"atlas:fx.x"`.
 * @param event - The log event.
 * @param data - What the log line carries.
 */
function warnOnce(ectx: EffectsCtx, key: string, event: string, data: object): void {
  if (ectx.state.warned.has(key)) return;

  ectx.state.warned.add(key);
  ectx.log.warn(event, data);
}

/**
 * Keeps the textures that sample the first texture's source. Pixi binds one source per particle
 * container and samples the wrong page silently (P9); loose dev files sit on one source each, so
 * the dropped keys warn `effects:atlas` once per effect id.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param id - The effect id.
 * @param keys - The asset keys of the effect, in the order of `config.textures`.
 * @param textures - Their resolved textures, in the same order.
 * @returns The textures the instance draws with.
 */
function firstSource(
  ectx: EffectsCtx,
  id: string,
  keys: readonly string[],
  textures: readonly PixiTexture[]
): readonly PixiTexture[] {
  const source = textures[0]?.source;
  const dropped = keys.filter((_key, index) => textures[index]?.source !== source);

  if (dropped.length === 0) return textures;

  warnOnce(ectx, `atlas:${id}`, "effects:atlas", { effect: id, keys, dropped });

  return textures.filter(texture => texture.source === source);
}

/**
 * Bakes an effect on its first use. An unknown id warns once per id; a texture that is not
 * loaded warns once per key and is asked again next frame; in a dev build, textures of two
 * sources warn once per id and the effect draws with the ones on the first texture's source.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param id - The effect id.
 * @returns The baked effect, or `undefined` when it cannot draw this frame.
 */
function bake(ectx: EffectsCtx, id: string): BakedEmitter | undefined {
  const { state } = ectx;
  const definition = state.emitters.get(id);

  if (definition === undefined) {
    warnOnce(ectx, `emitter:${id}`, "effects:unknown-emitter", { effect: id });

    return undefined;
  }

  const keys = definition.config.textures;
  const textures: PixiTexture[] = [];

  for (const key of keys) {
    const texture = ectx.deps.assets.texture(key);

    if (texture === undefined) {
      warnOnce(ectx, `texture:${key}`, "effects:missing-texture", { key });

      return undefined;
    }

    textures.push(texture);
  }

  const baked = bakeEmitter(definition, isDev() ? firstSource(ectx, id, keys, textures) : textures);

  state.baked.set(id, baked);

  return baked;
}

/**
 * Ends the run of an instance whose host lost it: a local-space instance and an empty one are
 * destroyed now; a world-space instance with live particles becomes an orphan, which flies until
 * its last particle died.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param instance - The instance, already out of `state.instances`.
 */
function retireInstance(ectx: EffectsCtx, instance: EmitterInstance): void {
  if (instance.space === "local" || instance.container.particleChildren.length === 0) {
    destroyInstance(ectx.deps.world.ecs, instance);

    return;
  }

  ectx.state.orphans.add(instance);
}

/**
 * Where a stream emits from this frame. World space: the host's root point now, relative to
 * where the container stands. Local space: the container's own origin, after its `Transform`
 * took the host's root pose again, so the particles follow the host.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param instance - The instance.
 * @returns The offset of the emission in the container's space.
 */
function followHost(ectx: EffectsCtx, instance: EmitterInstance): Readonly<Point> {
  const ecs = ectx.deps.world.ecs;
  const pose = rootPoseInto(ecs, instance.host, POSE);

  if (instance.space === "world") {
    OFFSET.x = pose.x - instance.origin.x;
    OFFSET.y = pose.y - instance.origin.y;

    return OFFSET;
  }

  // A container spawned this frame is attached when the phase ends; its Transform is this pose.
  const placed = ecs.get(instance.entity, Transform);

  if (placed !== undefined) movePlaced(ecs, instance.entity, placed, pose);

  return STILL;
}

/**
 * Writes the host's root pose into a local-space container's `Transform` when it differs from what the container
 * holds: a still host writes nothing, so the renderer has nothing to sync. The pivot gets an object of its own only
 * when it moved; the four numbers go through the reused `MOVE`.
 *
 * @param ecs - The world.
 * @param entity - The container's entity.
 * @param placed - Its stored `Transform`.
 * @param pose - The host's root pose of this frame.
 */
function movePlaced(
  ecs: EcsApi,
  entity: Entity,
  placed: Readonly<TransformValue>,
  pose: Readonly<TransformValue>
): void {
  if (placed.pivot.x !== pose.pivot.x || placed.pivot.y !== pose.pivot.y) {
    ecs.set(entity, Transform, { pivot: { x: pose.pivot.x, y: pose.pivot.y } });
  }

  const still =
    placed.x === pose.x &&
    placed.y === pose.y &&
    placed.rotation === pose.rotation &&
    placed.scale === pose.scale;

  if (still) return;

  MOVE.x = pose.x;
  MOVE.y = pose.y;
  MOVE.rotation = pose.rotation;
  MOVE.scale = pose.scale;
  ecs.set(entity, Transform, MOVE);
}

/**
 * Starts the instance an `Emitter` names, when it can draw.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param host - The entity.
 * @param emitter - Its `Emitter`.
 * @returns The new instance, or `undefined`.
 */
function startInstance(
  ectx: EffectsCtx,
  pixi: PixiModule,
  host: Entity,
  emitter: Readonly<EmitterValue>
): EmitterInstance | undefined {
  const { state } = ectx;
  const id = emitter.effect;

  if (id === "") return undefined;

  const baked = state.baked.get(id) ?? bake(ectx, id);

  if (baked === undefined) return undefined;

  const instance = createInstance(ectx, pixi, host, baked, emitter.active);

  state.instances.set(host, instance);

  return instance;
}

/**
 * Steps an instance and tells the renderer about it, since the particles of a container are
 * written straight into Pixi: before the step when the container holds particles (they move or
 * die now, judged as they were drawn), after it when it held none and now holds some (an empty
 * container shows nothing before the step). A step of no time moves nothing and tells nothing.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param instance - The instance.
 * @param time - The frame's time: `delta` milliseconds of game time.
 * @param offset - Where the emission is, in the container's space.
 * @param emitting - True while the stream emits.
 */
function stepShown(
  ectx: EffectsCtx,
  instance: EmitterInstance,
  time: StepTime,
  offset: Readonly<Point>,
  emitting: boolean
): void {
  const moves = time.delta > 0;
  const held = instance.container.particleChildren.length > 0;

  if (moves && held) ectx.deps.renderer.invalidate(instance.entity);

  stepBy(instance, time, offset, emitting);

  if (moves && !held && instance.container.particleChildren.length > 0) {
    ectx.deps.renderer.invalidate(instance.entity);
  }
}

/**
 * Runs the `Emitter` of one entity for one frame: an instance of another effect is retired, a
 * missing one is started, and the instance steps. A local-space container follows its host even
 * while its stream stands still under reduced motion.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param host - The entity.
 * @param emitter - Its `Emitter`.
 * @param time - The frame's time: `delta` milliseconds of game time.
 * @param reducedMotion - What `anim.reducedMotion()` answers this frame.
 */
function runEmitter(
  ectx: EffectsCtx,
  pixi: PixiModule,
  host: Entity,
  emitter: Readonly<EmitterValue>,
  time: StepTime,
  reducedMotion: boolean
): void {
  const { state } = ectx;
  const current = state.instances.get(host);

  if (current !== undefined && current.id !== emitter.effect) {
    state.instances.delete(host);
    retireInstance(ectx, current);
  }

  const instance = state.instances.get(host) ?? startInstance(ectx, pixi, host, emitter);

  if (instance === undefined) return;

  const offset = followHost(ectx, instance);

  if (!standsStill(instance, reducedMotion)) {
    stepShown(ectx, instance, time, offset, emitter.active);
  }
}

/**
 * Steps the orphans, which emit nothing, and destroys the ones that ran empty.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param time - The frame's time: `delta` milliseconds of game time.
 */
function runOrphans(ectx: EffectsCtx, time: StepTime): void {
  const { state } = ectx;

  // per frame: nothing to copy while no orphan flies.
  if (state.orphans.size === 0) return;

  // eslint-disable-next-line unicorn/no-useless-spread -- an orphan that ran empty leaves the set
  for (const orphan of [...state.orphans]) {
    stepShown(ectx, orphan, time, STILL, false);

    if (orphan.container.particleChildren.length > 0) continue;

    state.orphans.delete(orphan);
    destroyInstance(ectx.deps.world.ecs, orphan);
  }
}

/**
 * Adds the live particles of one instance to `tally`.
 *
 * @param instance - A running instance or an orphan.
 */
function addLive(instance: EmitterInstance): void {
  tally.live += instance.container.particleChildren.length;
}

/**
 * Counts the live particles and warns once each time they cross `config.maxParticles` upward.
 *
 * @param ectx - Domain context of the effects plugin.
 */
function countParticles(ectx: EffectsCtx): void {
  const { state, config } = ectx;

  // per frame: `forEach` with a module-level callback, no iterator and no closure.
  tally.live = 0;
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Map, read without an iterator, by a module-level callback
  state.instances.forEach(addLive);
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Set, read without an iterator, by a module-level callback
  state.orphans.forEach(addLive);

  const live = tally.live;

  state.particles = live;

  const above = live > config.maxParticles;

  if (above && !state.over.particles) {
    ectx.log.warn("effects:particle-budget", { live, budget: config.maxParticles });
  }

  state.over.particles = above;
}

/**
 * Builds the `animate` system of the emitters. It runs while an entity carries `Emitter` (the world
 * skips a system whose query has no entity) and returns at once while the renderer does not draw.
 * Time is the frame's `delta` only, so `time.step(dt)` drives every test.
 *
 * @param ectx - Domain context of the effects plugin.
 * @returns The system `world.ecs.system` takes.
 */
export function createParticleSystem(ectx: EffectsCtx): AnySystem {
  return system({
    name: "effects:particles",
    phase: "animate",
    query: [Emitter],
    run: (rows, context): void => {
      const host = ectx.deps.renderer.host;
      const pixi = host.ready() ? host.pixi() : undefined;

      if (pixi === undefined) return;

      const reducedMotion = ectx.deps.anim.reducedMotion();

      // per frame: the frame's time is handed down as the object it is, never as a number (a double handed to a
      // call is boxed).
      for (const [entity, emitter] of rows) {
        runEmitter(ectx, pixi, entity, emitter, context.time, reducedMotion);
      }
    }
  });
}

/**
 * Builds the `animate` system of the orphans, registered right after the emitters: the particles
 * of an emitter whose host left fly on after the last `Emitter` is gone, so this system has no
 * query and runs every frame. It returns at once while the renderer does not draw, then steps the
 * orphans and keeps the particle budget.
 *
 * @param ectx - Domain context of the effects plugin.
 * @returns The system `world.ecs.system` takes.
 */
export function createOrphanSystem(ectx: EffectsCtx): AnySystem {
  return system({
    name: "effects:orphans",
    phase: "animate",
    query: [],
    run: (_rows, context): void => {
      const host = ectx.deps.renderer.host;

      if (!host.ready() || host.pixi() === undefined) return;

      runOrphans(ectx, context.time);
      countParticles(ectx);
    }
  });
}

/**
 * The `onRemoved(Emitter)` hook: the host lost its effect, or left. Its instance is retired
 * before the renderer's next pass.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param host - The entity that lost its `Emitter`.
 */
export function forgetEmitter(ectx: EffectsCtx, host: Entity): void {
  const instance = ectx.state.instances.get(host);

  if (instance === undefined) return;

  ectx.state.instances.delete(host);
  retireInstance(ectx, instance);
}

/**
 * Destroys every instance whose textures meet `keys`, orphans included, and drops the bake of
 * every effect that names one of them. The next `Emitter` that names such an effect bakes it
 * again once the bundle is back.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param keys - The asset keys that left.
 */
export function retireParticleKeys(ectx: EffectsCtx, keys: readonly string[]): void {
  const { state } = ectx;
  const ecs = ectx.deps.world.ecs;
  const touches = (textures: readonly string[]): boolean =>
    textures.some(key => keys.includes(key));

  for (const [host, instance] of state.instances) {
    if (!touches(instance.baked.config.textures)) continue;

    state.instances.delete(host);
    destroyInstance(ecs, instance);
  }

  // eslint-disable-next-line unicorn/no-useless-spread -- a destroyed orphan leaves the set
  for (const orphan of [...state.orphans]) {
    if (!touches(orphan.baked.config.textures)) continue;

    state.orphans.delete(orphan);
    destroyInstance(ecs, orphan);
  }

  for (const [id, definition] of state.emitters) {
    if (!touches(definition.config.textures)) continue;

    state.baked.delete(id);
  }
}

/**
 * Destroys every instance and orphan: the teardown, while `world` still runs.
 *
 * @param ectx - Domain context of the effects plugin.
 */
export function retireAllParticles(ectx: EffectsCtx): void {
  const { state } = ectx;
  const ecs = ectx.deps.world.ecs;

  for (const instance of state.instances.values()) destroyInstance(ecs, instance);
  for (const orphan of state.orphans) destroyInstance(ecs, orphan);

  state.instances.clear();
  state.orphans.clear();
  state.particles = 0;
}
