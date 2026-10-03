import { describe, expect, it } from "vitest";
import { type } from "../../../flow/runner/define";
import { Sprite, Transform } from "../../../renderer/components";
import { Frames } from "../../components";
import { stopAnim } from "../../lifecycle";
import {
  defineAnimation,
  frames,
  haptic,
  mark,
  parallel,
  sequence,
  set,
  sfx,
  tween,
  use,
  wait
} from "../../timeline/steps";
import type { Step, Target } from "../../types";
import type { MockAnim } from "./mock-anim";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

/**
 * Starts a one-slot animation over a fresh entity.
 *
 * @param mock - The mock anim world.
 * @param entity - The entity the slot points at.
 * @param build - The step tree of the animation.
 * @returns The play handle.
 */
function playOn(mock: MockAnim, entity: Target, build: (target: Target) => Step) {
  const animation = defineAnimation("test.tree", {
    slots: { it: type<Target>() },
    build: ({ it }) => build(it)
  });

  return mock.api.play(animation, { it: entity });
}

describe("anim/timeline cursor", () => {
  it("carries the remainder of a wait into the next step of the same frame", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = playOn(mock, entity, it =>
      sequence(wait(50), tween(it, Transform, { x: 100 }, { ms: 100, ease: "linear" }))
    );

    mock.frame(150);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(handle.active()).toBe(false);
    expect(mock.api.active()).toBe(0);
  });

  it("takes exactly the sum of its steps", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = playOn(mock, entity, it =>
      sequence(wait(100), tween(it, Transform, { x: 100 }, { ms: 200, ease: "linear" }))
    );

    mock.frame(100);
    mock.frame(100);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(50);
    expect(handle.active()).toBe(true);

    mock.frame(100);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(handle.active()).toBe(false);
  });

  it("ends a parallel with its longest child", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = playOn(mock, entity, () => parallel(wait(100), wait(300)));

    mock.frame(100);

    expect(handle.active()).toBe(true);

    mock.frame(200);

    expect(handle.active()).toBe(false);
  });

  it("jumps every mark in tree order on finish and fires no effect", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = playOn(mock, entity, () =>
      sequence(mark("a"), sfx("board.merge"), haptic("light"), mark("b"))
    );

    handle.finish();

    expect(handle.marks()).toEqual(["a", "b"]);
    expect(mock.dispatched).toEqual([]);
    expect(mock.emitted.filter(entry => entry.name === "anim:mark")).toHaveLength(2);
  });

  it("dispatches the descriptor steps when they are reached", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);

    playOn(mock, entity, () => sequence(sfx("board.merge"), haptic("light")));
    mock.frame(16);

    expect(mock.dispatched).toEqual([
      { kind: "sfx", payload: { key: "board.merge", bus: "sfx" }, cosmetic: true },
      { kind: "haptic", payload: { kind: "light" }, cosmetic: true }
    ]);
  });

  it("emits nothing when a timeline is cancelled", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = playOn(mock, entity, it =>
      sequence(mark("a"), tween(it, Transform, { x: 10 }, { ms: 100 }))
    );

    handle.cancel();

    expect(mock.emitted).toEqual([]);
    expect(handle.marks()).toEqual([]);
    expect(mock.api.active()).toBe(0);
  });

  it("writes a set step at once and ends", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Sprite({ texture: "a" })]);

    playOn(mock, entity, it => set(it, Sprite, { texture: "b" }));
    mock.frame(16);

    expect(mock.world.ecs.get(entity, Sprite)?.texture).toBe("b");
  });

  it("writes one texture key per frame of a frames step", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Sprite({ texture: "start" })]);
    const handle = playOn(mock, entity, it =>
      frames(it, { keys: ["a", "b", "c"], fps: 10, loop: false })
    );

    mock.frame(50);

    expect(mock.world.ecs.get(entity, Sprite)?.texture).toBe("a");

    mock.frame(100);

    expect(mock.world.ecs.get(entity, Sprite)?.texture).toBe("b");

    mock.frame(100);

    expect(mock.world.ecs.get(entity, Sprite)?.texture).toBe("c");
    expect(handle.active()).toBe(true);

    mock.frame(100);

    expect(mock.world.ecs.get(entity, Sprite)?.texture).toBe("c");
    expect(handle.active()).toBe(false);
  });

  it("never ends a looping frames step until it is finished", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Sprite({ texture: "start" })]);
    const handle = playOn(mock, entity, it =>
      frames(it, { keys: ["a", "b"], fps: 10, loop: true })
    );

    for (let index = 0; index < 20; index += 1) mock.frame(100);

    expect(handle.active()).toBe(true);

    handle.finish();

    expect(handle.active()).toBe(false);
    expect(mock.world.ecs.get(entity, Sprite)?.texture).toBe("b");
  });

  it("ends an empty frames step at once", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Sprite()]);
    const handle = playOn(mock, entity, it => frames(it, { keys: [], fps: 10 }));

    mock.frame(16);

    expect(handle.active()).toBe(false);
  });

  it("ends a step whose key has no live view", () => {
    const mock = createMockAnim();

    mock.start();

    const handle = playOn(mock, { projection: "hud", key: "ghost" }, it =>
      tween(it, Transform, { x: 10 }, { ms: 100 })
    );

    mock.frame(16);

    expect(handle.active()).toBe(false);
    expect(mock.api.active()).toBe(0);
  });

  it("ends a set step whose key has no live view without writing", () => {
    const mock = createMockAnim();

    mock.start();

    const handle = playOn(mock, { projection: "hud", key: "ghost" }, it =>
      set(it, Sprite, { alpha: 0 })
    );

    mock.frame(16);

    expect(handle.active()).toBe(false);
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  it("ends a step whose entity died", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = playOn(mock, entity, it => tween(it, Transform, { x: 10 }, { ms: 100 }));

    mock.world.ecs.despawn(entity);
    mock.frame(16);

    expect(handle.active()).toBe(false);
  });

  it("writes the target of a tween that never started when it is finished", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = playOn(mock, entity, it =>
      sequence(wait(1000), tween(it, Transform, { x: 42 }, { ms: 100 }))
    );

    handle.finish();

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(42);
    expect(handle.active()).toBe(false);
  });

  it("reports the marks of a nested animation under the nested id", () => {
    const mock = createMockAnim();

    mock.start();

    const inner = defineAnimation("inner.one", { slots: {}, build: () => mark("deep") });
    const outer = defineAnimation("outer.one", {
      slots: {},
      build: () => sequence(use(inner, {}))
    });
    const handle = mock.api.play(outer, {});

    mock.frame(16);

    expect(handle.marks()).toEqual(["deep"]);
    expect(mock.emitted).toContainEqual({
      name: "anim:mark",
      payload: { animation: "inner.one", mark: "deep" }
    });
  });
});

/**
 * Starts the mock world with one entity that carries a `Frames` loop of three keys at 10 fps.
 *
 * @returns The mock, the entity and a reader of its texture.
 */
function looping(): { mock: MockAnim; entity: number; texture: () => string | undefined } {
  const mock = createMockAnim();

  mock.start();

  const entity = spawnTestEntity(mock, [
    Sprite({ texture: "c0" }),
    Frames({ keys: ["c0", "c1", "c2"], fps: 10 })
  ]);

  return { mock, entity, texture: () => mock.world.ecs.get(entity, Sprite)?.texture };
}

describe("anim/timeline cursor: a frames step over a Frames loop", () => {
  it("blocks the writes of the component from its first advance", () => {
    const { mock, entity, texture } = looping();

    playOn(mock, entity, it => frames(it, { keys: ["s0", "s1"], fps: 10, loop: false }));
    mock.frame(16);

    expect(texture()).toBe("s0");
    expect(mock.state.framesHeld.get(entity)).toBe(1);

    mock.frame(100);

    expect(texture()).toBe("s1");
  });

  it("hands the sprite back when the step ends by its last key", () => {
    const { mock, entity, texture } = looping();

    playOn(mock, entity, it => frames(it, { keys: ["s0", "s1"], fps: 10, loop: false }));
    mock.frame(16);
    mock.frame(100);
    mock.frame(100);

    // The loop kept its clock while held: 216 ms is its key 2.
    expect(texture()).toBe("c2");
    expect(mock.state.framesHeld.has(entity)).toBe(false);
  });

  it("hands the sprite back after finish()", () => {
    const { mock, entity, texture } = looping();
    const handle = playOn(mock, entity, it =>
      frames(it, { keys: ["s0", "s1"], fps: 10, loop: true })
    );

    mock.frame(16);
    handle.finish();

    expect(texture()).toBe("s1");
    expect(mock.state.framesHeld.size).toBe(0);

    mock.frame(16);

    expect(texture()).toBe("c0");
  });

  it("hands the sprite back after cancel()", () => {
    const { mock, entity, texture } = looping();
    const handle = playOn(mock, entity, it =>
      frames(it, { keys: ["s0", "s1"], fps: 10, loop: true })
    );

    mock.frame(16);
    handle.cancel();

    expect(texture()).toBe("s0");
    expect(mock.state.framesHeld.size).toBe(0);

    mock.frame(16);

    expect(texture()).toBe("c0");
  });

  it("releases after the second of two steps on one entity", () => {
    const { mock, entity, texture } = looping();
    const long = playOn(mock, entity, it =>
      frames(it, { keys: ["s0", "s1"], fps: 10, loop: true })
    );

    playOn(mock, entity, it => frames(it, { keys: ["t0"], fps: 10, loop: false }));
    mock.frame(16);

    expect(mock.state.framesHeld.get(entity)).toBe(2);

    mock.frame(100);

    expect(mock.state.framesHeld.get(entity)).toBe(1);
    expect(texture()).toBe("s1");

    long.finish();
    mock.frame(16);

    expect(mock.state.framesHeld.size).toBe(0);
    expect(texture()).toBe("c1");
  });

  it("releases every hold on finishAll", () => {
    const { mock, entity, texture } = looping();

    playOn(mock, entity, it => frames(it, { keys: ["s0", "s1"], fps: 10, loop: true }));
    mock.frame(16);
    mock.api.finishAll();

    expect(mock.state.framesHeld.size).toBe(0);

    mock.frame(16);

    expect(texture()).toBe("c0");
  });

  it("releases the hold when its entity dies mid-step", () => {
    const { mock, entity } = looping();
    const handle = playOn(mock, entity, it =>
      frames(it, { keys: ["s0", "s1"], fps: 10, loop: true })
    );

    mock.frame(16);
    mock.world.ecs.despawn(entity);
    mock.frame(16);

    expect(handle.active()).toBe(false);
    expect(mock.state.framesHeld.size).toBe(0);
  });

  it("holds nothing when the step ends before it resolved an entity", () => {
    const { mock } = looping();

    playOn(mock, { projection: "hud", key: "ghost" }, it => frames(it, { keys: ["s0"], fps: 10 }));
    mock.frame(16);

    expect(mock.state.framesHeld.size).toBe(0);
  });

  it("leaves framesHeld empty after stopAnim", () => {
    const { mock, entity } = looping();

    playOn(mock, entity, it => frames(it, { keys: ["s0", "s1"], fps: 10, loop: true }));
    mock.frame(16);
    stopAnim(mock.state);

    expect(mock.state.framesHeld.size).toBe(0);
  });
});
