import { describe, expect, it } from "vitest";
import { type } from "../../../flow/runner/define";
import { NineSlice, Shape, Transform } from "../../../renderer/components";
import { animFor } from "../../bind";
import { defineMotion } from "../../motion";
import { frameIndexAt, frameMsOf, framesDurationMs } from "../../timeline/frames";
import {
  defineAnimation,
  frames,
  isFxStep,
  mark,
  parallel,
  play,
  sequence,
  sfx,
  tween,
  use,
  wait
} from "../../timeline/steps";
import type { Target } from "../../types";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

describe("anim bind", () => {
  it("hands back the same helpers, typed with the game's asset keys", () => {
    const kit = animFor<"board.merge">();

    expect(kit.defineAnimation).toBe(defineAnimation);
    expect(kit.frames).toBe(frames);
    expect(kit.sfx).toBe(sfx);
    expect(kit.play).toBe(play);
    expect(kit.sfx("board.merge").payload.key).toBe("board.merge");
  });
});

describe("anim/timeline frame maths", () => {
  it("answers 0 for a list with no frame rate", () => {
    expect(frameMsOf(0)).toBe(0);
    expect(framesDurationMs(["a", "b"], 0)).toBe(0);
    expect(frameIndexAt(["a", "b"], 0, false, 0)).toBe(1);
  });

  it("wraps a looping list and stops on the last key of a list that plays once", () => {
    expect(frameIndexAt(["a", "b"], 10, true, 250)).toBe(0);
    expect(frameIndexAt(["a", "b"], 10, false, 900)).toBe(1);
    expect(frameIndexAt(["a", "b"], 10, false, 0)).toBe(0);
  });
});

describe("anim/timeline step guards", () => {
  it("tells the two descriptor steps from the rest", () => {
    expect(isFxStep(sfx("board.merge"))).toBe(true);
    expect(isFxStep(wait(10))).toBe(false);
  });
});

describe("anim defineMotion over the other display components", () => {
  it("resolves every component name it knows", () => {
    const motion = defineMotion({
      states: {
        hidden: { NineSlice: { width: 10 }, Shape: { alpha: 0 }, Transform: { scale: 0 } }
      },
      on: { change: ["NineSlice", "Shape", "Transform"] }
    });

    expect(Object.keys(motion.change ?? {})).toEqual(["NineSlice", "Shape", "Transform"]);
    expect(NineSlice.componentName).toBe("NineSlice");
    expect(Shape.componentName).toBe("Shape");
  });

  it("answers an empty hook table when no name resolves", () => {
    const motion = defineMotion({
      states: { hidden: {} },
      on: { change: ["Nope"] as never }
    });

    expect(motion.change).toEqual({});
  });
});

describe("anim play handler payloads", () => {
  it("throws for a descriptor that play() did not build", () => {
    const mock = createMockAnim();

    mock.start();

    const handler = mock.handlers.get("play");

    expect(() =>
      handler?.run(
        { kind: "play", payload: { nothing: true } },
        { signal: new AbortController().signal, mode: "live" }
      )
    ).toThrow("[game] A play effect carries no animation id.");
  });

  it("drops a slot the payload cannot answer and still plays the rest", async () => {
    const mock = createMockAnim();
    const animation = defineAnimation("hud.pair", {
      slots: { items: type<Target[]>(), card: type<Target>() },
      build: ({ items }) =>
        items.length === 0
          ? mark("empty")
          : parallel(...items.map(item => tween(item, Transform, { x: 5 }, { ms: 10 })))
    });

    mock.features.push({ name: "hud", description: { animations: [animation] } });
    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handler = mock.handlers.get("play");
    const running = handler?.run(
      {
        kind: "play",
        payload: { animation: "hud.pair", slots: { items: [entity, "junk"], card: true } }
      },
      { signal: new AbortController().signal, mode: "live" }
    );

    mock.frame(20);
    await running;

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(5);
  });

  it("warns about a feature entry that is not an animation and skips it", () => {
    const mock = createMockAnim();

    mock.features.push({ name: "hud", description: { animations: [{ id: "hud.broken" }] } });
    mock.start();

    expect(mock.state.registry.size).toBe(0);
    expect(mock.log.warn).toHaveBeenCalledWith("anim:bad-feature-entry", { feature: "hud" });
  });
});

describe("anim/timeline cancel over a tree", () => {
  it("cancels every child of a parallel and of a nested animation", () => {
    const mock = createMockAnim();
    const inner = defineAnimation("inner.two", {
      slots: { it: type<Target>() },
      build: ({ it }) => tween(it, Transform, { y: 50 }, { ms: 200, ease: "linear" })
    });
    const outer = defineAnimation("outer.two", {
      slots: { it: type<Target>() },
      build: ({ it }) =>
        parallel(tween(it, Transform, { x: 50 }, { ms: 200, ease: "linear" }), use(inner, { it }))
    });

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = mock.api.play(outer, { it: entity });

    mock.frame(100);

    expect(mock.api.active()).toBe(2);

    handle.cancel();

    expect(mock.api.active()).toBe(0);
    expect(mock.world.ecs.get(entity, Transform)).toEqual({ x: 25, y: 25, rotation: 0, scale: 1 });
  });

  it("finishes every child of a nested animation", () => {
    const mock = createMockAnim();
    const inner = defineAnimation("inner.three", {
      slots: { it: type<Target>() },
      build: ({ it }) => sequence(tween(it, Transform, { y: 50 }, { ms: 200 }), mark("deep"))
    });
    const outer = defineAnimation("outer.three", {
      slots: { it: type<Target>() },
      build: ({ it }) => use(inner, { it })
    });

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = mock.api.play(outer, { it: entity });

    handle.finish();

    expect(handle.marks()).toEqual(["deep"]);
    expect(mock.world.ecs.get(entity, Transform)?.y).toBe(50);
  });

  it("ends an empty parallel and an empty sequence at once", () => {
    const mock = createMockAnim();
    const animation = defineAnimation("empty.tree", {
      slots: {},
      build: () => sequence(parallel(), sequence())
    });

    mock.start();

    const handle = mock.api.play(animation, {});

    mock.frame(16);

    expect(handle.active()).toBe(false);
  });

  it("ends a frames step whose target has no sprite", () => {
    const mock = createMockAnim();
    const animation = defineAnimation("frames.nosprite", {
      slots: { it: type<Target>() },
      build: ({ it }) => frames(it, { keys: ["a"], fps: 10 })
    });

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = mock.api.play(animation, { it: entity });

    handle.finish();

    expect(handle.active()).toBe(false);
  });

  it("plays a step tree that names no target at all", () => {
    const mock = createMockAnim();
    const animation = defineAnimation("marks.only", {
      slots: {},
      build: () => sequence(wait(10), mark("a"), sfx("ui.click"), mark("b"))
    });

    mock.start();

    const handle = mock.api.play(animation, {});

    mock.frame(20);

    expect(handle.marks()).toEqual(["a", "b"]);
    expect(handle.active()).toBe(false);
    expect(mock.dispatched).toHaveLength(1);
    expect(play(animation, {}).payload.slots).toEqual({});
  });
});
