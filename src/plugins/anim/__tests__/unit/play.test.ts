import { describe, expect, it } from "vitest";
import { type } from "../../../flow/runner/define";
import { Transform } from "../../../renderer/components";
import { Animation } from "../../components";
import { defineAnimation, mark, sequence, tween } from "../../timeline/steps";
import type { Target } from "../../types";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

const flight = defineAnimation("hud.coinsFly", {
  slots: { it: type<Target>() },
  build: ({ it }) =>
    sequence(tween(it, Transform, { x: 100 }, { ms: 100, ease: "linear" }), mark("landed"))
});

describe("anim/timeline play", () => {
  it("counts tracks and timelines in Animation.playing and removes it at zero", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);

    mock.api.play(flight, { it: entity });

    expect(mock.world.ecs.get(entity, Animation)).toEqual({ playing: 1 });

    mock.frame(50);

    expect(mock.world.ecs.get(entity, Animation)).toEqual({ playing: 2 });

    mock.frame(50);

    expect(mock.world.ecs.has(entity, Animation)).toBe(false);
    expect(mock.api.active()).toBe(0);
  });

  it("resolves done when the timeline ends and lists the marks it reached", async () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = mock.api.play(flight, { it: entity });

    mock.frame(50);

    expect(handle.marks()).toEqual([]);

    mock.frame(50);
    await handle.done;

    expect(handle.marks()).toEqual(["landed"]);
    expect(handle.active()).toBe(false);
    expect(mock.emitted).toContainEqual({
      name: "anim:finished",
      payload: { animation: "hud.coinsFly" }
    });
  });

  it("resolves done and emits finished when the timeline is finished", async () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = mock.api.play(flight, { it: entity });

    handle.finish();
    await handle.done;

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(handle.marks()).toEqual(["landed"]);
    expect(mock.emitted).toContainEqual({
      name: "anim:finished",
      payload: { animation: "hud.coinsFly" }
    });
  });

  it("resolves done on cancel but emits no finished event and writes nothing", async () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = mock.api.play(flight, { it: entity });

    mock.frame(50);
    handle.cancel();
    await handle.done;

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(50);
    expect(mock.emitted.filter(entry => entry.name === "anim:finished")).toEqual([]);
    expect(mock.api.active()).toBe(0);
    expect(mock.world.ecs.has(entity, Animation)).toBe(false);
  });

  it("plays the same animation twice at once", () => {
    const mock = createMockAnim();

    mock.start();

    const first = spawnTestEntity(mock, [Transform()]);
    const second = spawnTestEntity(mock, [Transform({ x: 50 })]);
    const one = mock.api.play(flight, { it: first });
    const two = mock.api.play(flight, { it: second });

    mock.frame(50);

    expect(mock.world.ecs.get(first, Transform)?.x).toBe(50);
    expect(mock.world.ecs.get(second, Transform)?.x).toBe(75);

    one.finish();

    expect(two.active()).toBe(true);

    mock.frame(50);

    expect(two.active()).toBe(false);
  });

  it("reports every mark to the onMark listeners and drops them on remove", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const seen: string[] = [];
    const off = mock.api.onMark((animation, name) => seen.push(`${animation}:${name}`));

    mock.api.play(flight, { it: entity }).finish();

    expect(seen).toEqual(["hud.coinsFly:landed"]);

    off();
    mock.api.play(flight, { it: entity }).finish();

    expect(seen).toEqual(["hud.coinsFly:landed"]);
  });

  it("keeps the other listeners running when one throws", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const seen: string[] = [];

    mock.api.onMark(() => {
      throw new Error("boom");
    });
    mock.api.onMark((_animation, name) => seen.push(name));
    mock.api.play(flight, { it: entity }).finish();

    expect(seen).toEqual(["landed"]);
    expect(mock.log.error).toHaveBeenCalled();
  });

  it("finishAll ends every track and every timeline", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = mock.api.play(flight, { it: entity });

    mock.frame(50);

    expect(mock.api.active()).toBe(1);

    mock.api.finishAll();

    expect(mock.api.active()).toBe(0);
    expect(handle.active()).toBe(false);
    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
  });
});
