import { describe, expect, it, vi } from "vitest";
import { Sprite } from "../../../renderer/components";
import { Animation, Frames } from "../../components";
import { stopAnim } from "../../lifecycle";
import { frameIndexAt } from "../../timeline/frames";
import type { FramesValue } from "../../types";
import type { MockAnim } from "./mock-anim";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit test: the `Frames` component (Delta 8). The real `ecs` of `world` under a fake `time`;
// `fps: 10`, so one key is on the screen for 100 ms.
// ---------------------------------------------------------------------------

const KEYS = ["k0", "k1", "k2", "k3"] as const;

/** A started mock world with one entity that carries a `Sprite` and a `Frames` loop. */
type LoopSetup = { mock: MockAnim; entity: number; texture: () => string | undefined };

/**
 * Starts the mock world and spawns one looping coin.
 *
 * @param frames - Overrides of the `Frames` value.
 * @returns The mock, the entity and a reader of its texture.
 */
function setup(frames: Partial<FramesValue> = {}): LoopSetup {
  const mock = createMockAnim();

  mock.start();

  const entity = spawnTestEntity(mock, [
    Sprite({ texture: "start" }),
    Frames({ keys: KEYS, fps: 10, ...frames })
  ]);

  return { mock, entity, texture: () => mock.world.ecs.get(entity, Sprite)?.texture };
}

describe("anim Frames component", () => {
  it("writes the first key on the first step", () => {
    const { mock, texture } = setup();

    mock.frame(16);

    expect(texture()).toBe("k0");
  });

  it("follows the keys at 1000 / fps: the key written is keys[floor(elapsed / 100)]", () => {
    const { mock, texture } = setup();
    const seen: Array<string | undefined> = [];
    const expected: string[] = [];

    for (let elapsed = 16; elapsed < 400; elapsed += 16) {
      mock.frame(16);
      seen.push(texture());
      expected.push(KEYS[Math.floor(elapsed / 100)] ?? "");
    }

    expect(seen).toEqual(expected);
  });

  it("wraps after the last key when it loops", () => {
    const { mock, texture } = setup();

    for (let frame = 0; frame < 4; frame += 1) mock.frame(100);

    expect(texture()).toBe("k0");

    mock.frame(100);

    expect(texture()).toBe("k1");
  });

  it("stops on the last key and writes nothing more when loop is false", () => {
    const { mock, entity, texture } = setup({ loop: false });

    for (let frame = 0; frame < 4; frame += 1) mock.frame(100);

    expect(texture()).toBe("k3");

    mock.world.ecs.set(entity, Sprite, { texture: "other" });
    for (let frame = 0; frame < 5; frame += 1) mock.frame(100);

    expect(texture()).toBe("other");
  });

  it("holds the key while playing is false and resumes from it", () => {
    const { mock, entity, texture } = setup();

    mock.frame(150);
    mock.world.ecs.set(entity, Frames, { playing: false });
    mock.frame(500);

    expect(texture()).toBe("k1");

    mock.world.ecs.set(entity, Frames, { playing: true });
    mock.frame(40);

    expect(texture()).toBe("k1");

    mock.frame(10);

    expect(texture()).toBe("k2");
  });

  it("restarts at key 0 on a new keys reference and keeps its phase on the same one", () => {
    const { mock, entity, texture } = setup();

    mock.frame(250);
    mock.world.ecs.set(entity, Frames, { keys: KEYS });
    mock.frame(10);

    expect(texture()).toBe("k2");

    mock.world.ecs.set(entity, Frames, { keys: [...KEYS] });
    mock.frame(10);

    expect(texture()).toBe("k0");
  });

  it("keeps the position when fps changes", () => {
    const { mock, entity, texture } = setup();

    mock.frame(150);
    mock.world.ecs.set(entity, Frames, { fps: 20 });
    mock.frame(10);

    expect(texture()).toBe(KEYS[frameIndexAt(KEYS, 20, true, 160)]);
    expect(texture()).toBe("k3");
  });

  it("writes nothing and logs nothing without a Sprite, and writes once a Sprite is added", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Frames({ keys: KEYS, fps: 10 })]);

    mock.frame(150);

    expect(mock.world.ecs.get(entity, Sprite)).toBeUndefined();
    expect(mock.log.warn).not.toHaveBeenCalled();
    expect(mock.log.error).not.toHaveBeenCalled();

    mock.world.ecs.add(entity, Sprite({ texture: "start" }));
    mock.frame(10);

    expect(mock.world.ecs.get(entity, Sprite)?.texture).toBe("k1");
  });

  it("stops writing when Frames is removed", () => {
    const { mock, entity, texture } = setup();

    mock.frame(16);
    mock.world.ecs.remove(entity, Frames);
    for (let frame = 0; frame < 3; frame += 1) mock.frame(100);

    expect(texture()).toBe("k0");
    expect(mock.state.frameLoops.has(entity)).toBe(false);
  });

  it("drops the entry when the entity is despawned", () => {
    const { mock, entity } = setup();

    mock.frame(16);
    mock.world.ecs.despawn(entity);
    mock.frame(16);

    expect(mock.state.frameLoops.size).toBe(0);
  });

  it("drops an entry whose entity no longer carries Frames at its step", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Sprite({ texture: "start" })]);

    mock.state.frameLoops.set(entity, { keys: KEYS, elapsed: 0, index: -1, written: false });
    mock.frame(16);

    expect(mock.state.frameLoops.has(entity)).toBe(false);
    expect(mock.world.ecs.get(entity, Sprite)?.texture).toBe("start");
  });

  it("writes nothing for an empty keys list and keeps the entry", () => {
    const { mock, entity, texture } = setup({ keys: [] });

    for (let frame = 0; frame < 3; frame += 1) mock.frame(100);

    expect(texture()).toBe("start");
    expect(mock.state.frameLoops.has(entity)).toBe(true);
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  it("freezes the clock in paused and fast mode and goes on in live mode", () => {
    const { mock, texture } = setup();

    mock.frame(150);
    mock.world.ecs.setMode("paused");
    mock.frame(500);

    expect(texture()).toBe("k1");

    mock.world.ecs.setMode("fast");
    mock.frame(500);

    expect(texture()).toBe("k1");

    mock.world.ecs.setMode("live");
    mock.frame(40);

    expect(texture()).toBe("k1");

    mock.frame(10);

    expect(texture()).toBe("k2");
  });

  it("freezes on its current frame under reduced motion and resumes from that frame", () => {
    const { mock, texture } = setup();

    mock.frame(150);
    mock.api.setReducedMotion(true);

    expect(mock.state.reducedMotion).toBe(true);

    const writes = vi.spyOn(mock.world.ecs, "set");

    for (let frame = 0; frame < 5; frame += 1) mock.frame(100);

    expect(writes).not.toHaveBeenCalled();
    expect(texture()).toBe("k1");

    mock.api.setReducedMotion(false);
    mock.frame(40);

    expect(texture()).toBe("k1");

    mock.frame(10);

    expect(texture()).toBe("k2");
  });

  it("is not counted by Animation or active() and never wakes the clock", () => {
    const { mock, entity } = setup();
    const wakes = mock.wakes.count;

    for (let frame = 0; frame < 10; frame += 1) {
      mock.frame(50);

      expect(mock.world.ecs.has(entity, Animation)).toBe(false);
      expect(mock.api.active()).toBe(0);
    }

    expect(mock.wakes.count).toBe(wakes);
  });

  it("seeds the table with the entities that carried Frames before onStart", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [
      Sprite({ texture: "start" }),
      Frames({ keys: KEYS, fps: 10 })
    ]);

    mock.start();
    mock.frame(16);

    expect(mock.world.ecs.get(entity, Sprite)?.texture).toBe("k0");
  });

  it("removes the hooks and clears the tables on stop", () => {
    const { mock } = setup();

    mock.frame(16);
    stopAnim(mock.state);

    expect(mock.state.frameLoops.size).toBe(0);
    expect(mock.state.framesHeld.size).toBe(0);
    expect(mock.state.offFrames).toEqual([]);

    spawnTestEntity(mock, [Sprite(), Frames({ keys: KEYS })]);

    expect(mock.state.frameLoops.size).toBe(0);
  });

  it("mutes Sprite.texture for the projection while the entity carries Frames", () => {
    const mock = createMockAnim();
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    const mute = vi.spyOn(mock.world.projection, "mute").mockImplementation(() => {
      const release = vi.fn();

      releases.push(release);

      return release;
    });
    const before = spawnTestEntity(mock, [Sprite(), Frames({ keys: KEYS })]);

    mock.start();

    const added = spawnTestEntity(mock, [Sprite(), Frames({ keys: KEYS })]);

    expect(mute.mock.calls).toEqual([
      [before, Sprite, ["texture"]],
      [added, Sprite, ["texture"]]
    ]);

    mock.world.ecs.remove(before, Frames);

    expect(releases.map(release => release.mock.calls.length)).toEqual([1, 0]);

    mock.world.ecs.despawn(added);

    expect(releases.map(release => release.mock.calls.length)).toEqual([1, 1]);
  });

  it("mutes once on a re-add and releases every mute on stop", () => {
    const mock = createMockAnim();
    const release = vi.fn();
    const mute = vi.spyOn(mock.world.projection, "mute").mockReturnValue(release);

    mock.start();

    const entity = spawnTestEntity(mock, [Sprite(), Frames({ keys: KEYS })]);

    mock.world.ecs.add(entity, Frames({ keys: [...KEYS] }));

    expect(mute).toHaveBeenCalledTimes(1);

    stopAnim(mock.state);

    expect(release).toHaveBeenCalledTimes(1);
    expect(mock.state.frameMutes.size).toBe(0);
  });

  it("has the typed defaults [], 12, true, true", () => {
    expect(Frames.defaults).toEqual({ keys: [], fps: 12, loop: true, playing: true });
    expect(Frames.componentName).toBe("Frames");
  });
});
