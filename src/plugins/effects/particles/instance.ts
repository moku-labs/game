/**
 * @file effects/particles — one running effect: the `ParticleContainer` with its one dynamic set
 * and its bounds area, the `effects`-owned entity whose `Display` it is, and the particle pool.
 * Pixi classes come from the module the renderer loaded, never from an import.
 */
import { Display, Transform, type TransformValue } from "../../renderer/components";
import { parentOf, rootPoseOf } from "../../renderer/sync/pose";
import type { PixiModule } from "../../renderer/types";
import { Layer, Order } from "../../world/ecs/define";
import type { AnyComponentValue, EcsApi, Entity, Owner } from "../../world/types";
import type { EffectsCtx } from "../types";
import { createRng, seedOf } from "./bake";
import { fillInstance } from "./step";
import type { BakedEmitter, BornFields, EmitterInstance } from "./types";

/** The owner of every particle entity. */
const EFFECTS_OWNER: Owner = Object.freeze({ kind: "plugin", name: "effects" });

/** How deep a parent chain is followed, as `rootPoseOf` does; deeper is treated as a loop. */
const MAX_DEPTH = 32;

/**
 * The one dynamic set of an emitter container (P9): positions, frames, rotations and colours
 * upload every frame; `uvs` stays static, because a frame is set at birth and the same `update()`
 * uploads it. Typed as a plain record: Pixi's own type refuses a `ParticleProperties` value under
 * `exactOptionalPropertyTypes`.
 *
 * @returns A fresh set.
 */
function dynamicSet(): Record<string, boolean> {
  return { position: true, vertex: true, rotation: true, color: true, uvs: false };
}

/**
 * Creates the per-particle fields of an instance, one entry per possible particle.
 *
 * @param size - The instance's `maxParticles`.
 * @returns Six zeroed arrays.
 */
export function bornFields(size: number): BornFields {
  return {
    age: new Float32Array(size),
    life: new Float32Array(size),
    vx: new Float32Array(size),
    vy: new Float32Array(size),
    spin: new Float32Array(size),
    variant: new Float32Array(size)
  };
}

/**
 * The top of the host's `Parent` chain: the first ancestor without a `Parent`, or the host itself.
 *
 * @param ecs - The world.
 * @param host - The entity whose `Emitter` started the instance.
 * @returns The entity the chain ends at.
 */
function topOf(ecs: EcsApi, host: Entity): Entity {
  let top = host;

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const parent = parentOf(ecs, top);

    if (parent === 0) break;

    top = parent;
  }

  return top;
}

/**
 * The `Layer` and the `Order` of the top of the host's `Parent` chain, copied: the renderer draws
 * a parented view inside the layer of its top ancestor, so a burst on a slot-hosted view draws
 * above the screen that hosts it, and a layer sorted by `"y"` or `"order"` ties the particles with
 * that ancestor and Pixi's stable sort draws them just above it.
 *
 * @param ecs - The world.
 * @param host - The entity whose `Emitter` started the instance.
 * @returns The copies of the components the top of the chain has.
 */
function placementOf(ecs: EcsApi, host: Entity): AnyComponentValue[] {
  const top = topOf(ecs, host);
  const layer = ecs.get(top, Layer);
  const order = ecs.get(top, Order);
  const placement: AnyComponentValue[] = [];

  if (layer !== undefined) placement.push(Layer({ name: layer.name }));
  if (order !== undefined) placement.push(Order({ value: order.value }));

  return placement;
}

/**
 * Starts an instance of a baked effect on a host: the container, the particle entity, the seed,
 * then the prewarm and the burst. World space places the container at the host's root point,
 * turned and scaled by nothing, and leaves it there; local space gives it the host's whole root
 * pose, which the step writes again every frame. Neither uses `Parent`.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param host - The entity whose `Emitter` names the effect.
 * @param baked - The baked effect.
 * @param emitting - Whether a stream emits during its prewarm.
 * @returns The running instance.
 */
export function createInstance(
  ectx: EffectsCtx,
  pixi: PixiModule,
  host: Entity,
  baked: BakedEmitter,
  emitting: boolean
): EmitterInstance {
  const ecs = ectx.deps.world.ecs;
  const { config, reach } = baked;
  const hostPose = rootPoseOf(ecs, host);
  const pose: TransformValue =
    config.space === "local"
      ? hostPose
      : { x: hostPose.x, y: hostPose.y, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } };
  const first = baked.textures[0];
  const container = new pixi.ParticleContainer({
    dynamicProperties: dynamicSet(),
    blendMode: config.blend,
    ...(first === undefined ? {} : { texture: first })
  });

  // The engine never culls; the area keeps a future `cullable` from hiding the container (P9).
  container.boundsArea = new pixi.Rectangle(-reach, -reach, 2 * reach, 2 * reach);

  const entity = ecs.spawn(EFFECTS_OWNER, [
    Display({ object: container }),
    Transform(pose),
    ...placementOf(ecs, host)
  ]);
  const instance: EmitterInstance = {
    id: baked.id,
    baked,
    host,
    entity,
    container,
    pool: [],
    born: bornFields(config.maxParticles),
    carry: 0,
    rng: createRng(seedOf(baked.id, ectx.state.seedCounter)),
    origin: { x: hostPose.x, y: hostPose.y },
    space: config.space,
    particleClass: pixi.Particle
  };

  ectx.state.seedCounter += 1;
  fillInstance(instance, emitting);

  return instance;
}

/**
 * Ends an instance: the particle entity is despawned, so the renderer detaches the container
 * (it never destroys a `Display` object), the container is destroyed with its particles and
 * without the textures, which `assets` owns, and the pool is dropped.
 *
 * @param ecs - The world.
 * @param instance - The instance.
 */
export function destroyInstance(ecs: EcsApi, instance: EmitterInstance): void {
  ecs.despawn(instance.entity);
  instance.container.destroy({ children: true, texture: false });
  instance.pool.length = 0;
}
