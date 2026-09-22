import { describe, expect, it } from "vitest";
import { type } from "../../../flow/runner/define";
import { Transform } from "../../../renderer/components";
import { defineAnimation, mark, sequence, tween } from "../../timeline/steps";
import type { Target } from "../../types";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

const flight = defineAnimation("hud.coinsFly", {
  slots: { it: type<Target>() },
  build: ({ it }) =>
    sequence(tween(it, Transform, { x: 100 }, { ms: 100, ease: "linear" }), mark("landed"))
});

describe("anim api", () => {
  it("exposes play, finishAll, active and onMark", () => {
    const mock = createMockAnim();

    expect(Object.keys(mock.api).toSorted()).toEqual(["active", "finishAll", "onMark", "play"]);
  });

  it("counts the running tracks in active and ends them all with finishAll", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);

    mock.api.play(flight, { it: entity });
    mock.frame(16);

    expect(mock.api.active()).toBe(1);

    mock.api.finishAll();

    expect(mock.api.active()).toBe(0);
    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
  });

  it("calls onMark listeners in order and stops after the remover", () => {
    const mock = createMockAnim();
    const seen: string[] = [];

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const off = mock.api.onMark((animation, name) => seen.push(`${animation}:${name}`));

    mock.api.play(flight, { it: entity });
    mock.frame(100);
    mock.frame(16);

    expect(seen).toEqual(["hud.coinsFly:landed"]);

    off();
    mock.api.play(flight, { it: entity });
    mock.frame(100);
    mock.frame(16);

    expect(seen).toEqual(["hud.coinsFly:landed"]);
  });
});
