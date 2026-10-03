/**
 * @file effects/particles — the `animate` system that runs every emitter: it starts an instance
 * when an `Emitter` names an effect, retires it when the effect changes or the component leaves,
 * steps the instances and the orphans, and keeps the particle budget. Under reduced motion a
 * stream stands still. The renderer draws nothing headless, so neither does this system.
 */
import { isDev } from "../../flow/doors/dev";
import { Transform } from "../../renderer/components";
import { rootPoseOf } from "../../renderer/sync/pose";
import type { PixiModule, PixiTexture, Point } from "../../renderer/types";
import { system } from "../../world/ecs/define";
import type { AnySystem, Entity } from "../../world/types";
import type { EffectsCtx } from "../types";
import { bakeEmitter } from "./bake";
import { Emitter } from "./component";
import { createInstance, destroyInstance } from "./instance";
import { standsStill, stepInstance } from "./step";
import type { BakedEmitter, EmitterInstance, EmitterValue } from "./types";

/** The origin of an emission that does not follow its host. */
const STILL: Readonly<Point> = Object.freeze({ x: 0, y: 0 });

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
  const pose = rootPoseOf(ecs, instance.host);

  if (instance.space === "world") {
    return { x: pose.x - instance.origin.x, y: pose.y - instance.origin.y };
  }

  // A container spawned this frame is attached when the phase ends; its Transform is this pose.
  if (ecs.has(instance.entity, Transform)) ecs.set(instance.entity, Transform, pose);

  return STILL;
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
 * Runs the `Emitter` of one entity for one frame: an instance of another effect is retired, a
 * missing one is started, and the instance steps. A local-space container follows its host even
 * while its stream stands still under reduced motion.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param host - The entity.
 * @param emitter - Its `Emitter`.
 * @param deltaMs - Milliseconds of game time.
 * @param reducedMotion - What `anim.reducedMotion()` answers this frame.
 */
function runEmitter(
  ectx: EffectsCtx,
  pixi: PixiModule,
  host: Entity,
  emitter: Readonly<EmitterValue>,
  deltaMs: number,
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
    stepInstance(instance, deltaMs, offset, emitter.active);
  }
}

/**
 * Steps the orphans, which emit nothing, and destroys the ones that ran empty.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param deltaMs - Milliseconds of game time.
 */
function runOrphans(ectx: EffectsCtx, deltaMs: number): void {
  const { state } = ectx;

  // eslint-disable-next-line unicorn/no-useless-spread -- an orphan that ran empty leaves the set
  for (const orphan of [...state.orphans]) {
    stepInstance(orphan, deltaMs, STILL, false);

    if (orphan.container.particleChildren.length > 0) continue;

    state.orphans.delete(orphan);
    destroyInstance(ectx.deps.world.ecs, orphan);
  }
}

/**
 * Counts the live particles and warns once each time they cross `config.maxParticles` upward.
 *
 * @param ectx - Domain context of the effects plugin.
 */
function countParticles(ectx: EffectsCtx): void {
  const { state, config } = ectx;
  let live = 0;

  for (const instance of state.instances.values())
    live += instance.container.particleChildren.length;
  for (const orphan of state.orphans) live += orphan.container.particleChildren.length;

  state.particles = live;

  const above = live > config.maxParticles;

  if (above && !state.over.particles) {
    ectx.log.warn("effects:particle-budget", { live, budget: config.maxParticles });
  }

  state.over.particles = above;
}

/**
 * Builds the `animate` system of the particles. It returns at once while the renderer does not
 * draw. Time is the frame's `delta` only, so `time.step(dt)` drives every test.
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

      for (const [entity, emitter] of rows) {
        runEmitter(ectx, pixi, entity, emitter, context.time.delta, reducedMotion);
      }

      runOrphans(ectx, context.time.delta);
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
