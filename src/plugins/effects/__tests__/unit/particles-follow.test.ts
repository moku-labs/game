import { describe, expect, it, vi } from "vitest";
import { Parent, Transform } from "../../../renderer/components";
import { rootPoseOf } from "../../../renderer/sync/pose";
import type { Entity } from "../../../world/types";
import { Emitter } from "../../particles/component";
import { defineEmitter } from "../../particles/define";
import { atlasTexture } from "../fake-effects-pixi";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: a local-space container follows its host by writing its `Transform` only when the
// host's root pose moved (change 2026-10-18-cheap-idle-tick, E2)
// ---------------------------------------------------------------------------

const steam = defineEmitter("fx.steam", {
  textures: ["fx.puff"],
  rate: 12,
  lifeMs: [900, 1400],
  space: "local",
  maxParticles: 30
});

/**
 * A started mock with the local-space stream registered, a host of it under a scaled slot, and the
 * first frame run.
 *
 * @returns The mock, the host and its container's entity.
 */
function following(): { mock: MockEffects; host: Entity; container: Entity } {
  const mock = createMockEffects();

  mock.features.push({ name: "board", description: { emitters: [steam] } });
  mock.textures.set("fx.puff", atlasTexture({ width: 64, height: 64, destroyed: false }));
  mock.start();

  const slot = mock.spawn([Transform({ x: 40, y: 60, scale: 0.5 })]);
  const host = mock.spawn([
    Emitter({ effect: "fx.steam" }),
    Transform({ x: 100, y: 200, rotation: 0.3 }),
    Parent({ entity: slot })
  ]);

  mock.frame();

  return { mock, host, container: mock.state.instances.get(host)?.entity ?? 0 };
}

describe("the particle system — a local-space container follows its host", () => {
  it("writes nothing for a host that stands still", () => {
    // Bug: the container's Transform was set every frame, so the renderer synced it every frame.
    const { mock, container } = following();
    const set = vi.spyOn(mock.world.ecs, "set");

    mock.frame();
    mock.frame();

    expect(set.mock.calls.filter(([entity]) => entity === container)).toEqual([]);
  });

  it("takes the host's new pivot, so it turns around the same point as the host", () => {
    // Bug: a compare of the four numbers alone left the container on the host's old pivot.
    const { mock, host, container } = following();

    mock.world.ecs.set(host, Transform, { pivot: { x: 12, y: -8 } });
    mock.frame();

    expect(mock.world.ecs.get(container, Transform)).toEqual(rootPoseOf(mock.world.ecs, host));
    expect(mock.world.ecs.get(container, Transform)?.pivot).toEqual({ x: 12, y: -8 });
  });
});
