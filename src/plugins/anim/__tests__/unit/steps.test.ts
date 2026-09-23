import { describe, expect, it } from "vitest";
import { type } from "../../../flow/runner/define";
import { Sprite, Transform } from "../../../renderer/components";
import { restPoseOf } from "../../timeline/play";
import {
  defineAnimation,
  external,
  frames,
  haptic,
  mark,
  parallel,
  play,
  sequence,
  set,
  sfx,
  stagger,
  tween,
  use,
  wait
} from "../../timeline/steps";
import type { Target } from "../../types";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

const card: Target = { projection: "hud", key: "order" };

describe("anim/timeline step builders", () => {
  it("builds frozen plain data for every leaf step", () => {
    expect(wait(120)).toEqual({ kind: "wait", ms: 120 });
    expect(Object.isFrozen(wait(120))).toBe(true);
    expect(mark("done")).toEqual({ kind: "mark", name: "done" });
    expect(Object.isFrozen(mark("done"))).toBe(true);
  });

  it("fills in the tween defaults and erases the component to its name", () => {
    const step = tween(card, Transform, { x: 10 }, { ms: 350 });

    expect(step.kind).toBe("tween");
    expect(step).toMatchObject({ ms: 350, ease: "out", delayMs: 0, additive: false });
    expect(step.kind === "tween" && step.component.componentName).toBe("Transform");
    expect(step.kind === "tween" && step.to).toEqual({ x: 10 });
    expect(Object.isFrozen(step)).toBe(true);
  });

  it("keeps the tween options a step was given", () => {
    const step = tween(
      card,
      Transform,
      { scale: 2 },
      { ms: 80, ease: "inBack", delayMs: 40, additive: true }
    );

    expect(step).toMatchObject({ ms: 80, ease: "inBack", delayMs: 40, additive: true });
  });

  it("carries the space of a tween: local by default, root when the step names it", () => {
    expect(tween(card, Transform, { x: 10 }, { ms: 80 })).toMatchObject({ space: "local" });
    expect(tween(card, Transform, { x: 10 }, { ms: 80, space: "root" })).toMatchObject({
      space: "root"
    });
  });

  it("builds a set step and a frames step with its loop default", () => {
    const patch = set(card, Sprite, { texture: "hud.card" });

    expect(patch.kind).toBe("set");
    expect(patch.kind === "set" && patch.patch).toEqual({ texture: "hud.card" });

    const sheet = frames(card, { keys: ["a", "b"], fps: 10 });

    expect(sheet).toEqual({ kind: "frames", target: card, keys: ["a", "b"], fps: 10, loop: false });
    expect(Object.isFrozen(sheet)).toBe(true);
  });

  it("freezes the children of sequence and parallel", () => {
    const tree = sequence(wait(10), parallel(mark("a"), mark("b")));

    expect(tree.kind).toBe("sequence");
    expect(Object.isFrozen(tree)).toBe(true);
    expect(tree.kind === "sequence" && Object.isFrozen(tree.steps)).toBe(true);
  });

  it("turns stagger into a parallel of waits and holds no function", () => {
    const staggered = stagger(["a", "b", "c"], 60, item => mark(item));

    expect(staggered).toEqual({
      kind: "parallel",
      steps: [
        {
          kind: "sequence",
          steps: [
            { kind: "wait", ms: 0 },
            { kind: "mark", name: "a" }
          ]
        },
        {
          kind: "sequence",
          steps: [
            { kind: "wait", ms: 60 },
            { kind: "mark", name: "b" }
          ]
        },
        {
          kind: "sequence",
          steps: [
            { kind: "wait", ms: 120 },
            { kind: "mark", name: "c" }
          ]
        }
      ]
    });
  });

  it("builds the sfx and haptic descriptors anim owns", () => {
    expect(sfx("board.merge")).toEqual({
      kind: "sfx",
      payload: { key: "board.merge", bus: "sfx" },
      cosmetic: true
    });
    expect(sfx("board.theme", { bus: "music" }).payload.bus).toBe("music");
    expect(haptic("light")).toEqual({
      kind: "haptic",
      payload: { kind: "light" },
      cosmetic: true
    });
  });

  it("throws the reserved message for an external player", () => {
    expect(() => external({ name: "spine", play: () => undefined }, "idle")).toThrow(
      "[game] External players arrive with Spine.\n  Use tween or frames."
    );
  });

  it("nests one animation under its own id", () => {
    const inner = defineAnimation("hud.pop", {
      slots: { card: type<Target>() },
      build: ({ card: target }) =>
        sequence(tween(target, Transform, { scale: 2 }, { ms: 50 }), mark("popped"))
    });
    const nested = use(inner, { card });

    expect(nested.kind).toBe("use");
    expect(nested.kind === "use" && nested.id).toBe("hud.pop");
    expect(nested.kind === "use" && nested.step.kind).toBe("sequence");
  });

  it("builds the play descriptor from the id and the slots", () => {
    const deliver = defineAnimation("orders.deliver", {
      slots: { card: type<Target>(), items: type<Target[]>() },
      build: () => mark("done")
    });

    expect(play(deliver, { card, items: [7] })).toEqual({
      kind: "play",
      payload: { animation: "orders.deliver", slots: { card, items: [7] } },
      cosmetic: true
    });
  });

  it("freezes what defineAnimation returns", () => {
    const animation = defineAnimation("hud.tick", { slots: {}, build: () => wait(1) });

    expect(animation.id).toBe("hud.tick");
    expect(Object.isFrozen(animation)).toBe(true);
  });
});

describe("anim/timeline at()", () => {
  it("reads the Transform of an entity target", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ x: 40, y: 120, scale: 2 })]);

    expect(restPoseOf(mock.actx, entity)).toEqual({ x: 40, y: 120, rotation: 0, scale: 2 });
  });

  it("reads the Transform behind a registered key", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ x: 5, y: 6 })]);

    mock.world.projection.registerKey("hud", "coins", entity);

    expect(restPoseOf(mock.actx, { projection: "hud", key: "coins" })).toEqual({
      x: 5,
      y: 6,
      rotation: 0,
      scale: 1
    });
  });

  it("warns once and answers the identity pose for a target that is not there", () => {
    const mock = createMockAnim();

    expect(restPoseOf(mock.actx, { projection: "hud", key: "ghost" })).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1
    });
    expect(mock.log.warn).toHaveBeenCalledWith(
      "anim:target-missing",
      expect.objectContaining({ projection: "hud", key: "ghost" })
    );
  });
});
