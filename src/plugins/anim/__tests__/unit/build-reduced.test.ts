import { describe, expect, it } from "vitest";
import { type } from "../../../flow/runner/define";
import { Shape, Transform } from "../../../renderer/components";
import { defineAnimation, sequence, tween, use, wait } from "../../timeline/steps";
import type { Target } from "../../types";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit test: F176. `build(slots, tools)` learns whether reduced motion was on when the play
// started, so a designed reduced variant can be chosen.
// ---------------------------------------------------------------------------

/**
 * An animation whose build records the `reduced` of its tools, one entry per build.
 *
 * @param seen - Where each build writes the flag it was given.
 * @returns The animation.
 */
function recorder(seen: Array<boolean | undefined>) {
  return defineAnimation("test.recorder", {
    slots: { thing: type<Target>() },
    build: (_slots, tools) => {
      seen.push(tools.reduced);

      return wait(500);
    }
  });
}

describe("anim build tools — reduced", () => {
  it("hands build the live switch of each play, not the config value", () => {
    // Catches: `reduced` read from the config, a constant, or never passed at all.
    const mock = createMockAnim({ reducedMotion: false });
    const seen: Array<boolean | undefined> = [];
    const animation = recorder(seen);

    mock.start();

    const thing = spawnTestEntity(mock, [Transform()]);

    mock.api.play(animation, { thing });
    mock.api.setReducedMotion(true);
    mock.api.play(animation, { thing });
    mock.api.setReducedMotion(false);
    mock.api.play(animation, { thing });

    expect(seen).toEqual([false, true, false]);
  });

  it("builds once per play: a switch while the timeline runs does not rebuild it", () => {
    // Catches: a build that is re-run, or re-read, when the switch changes mid-play.
    const mock = createMockAnim({ reducedMotion: true });
    const seen: Array<boolean | undefined> = [];
    const animation = recorder(seen);

    mock.start();

    const thing = spawnTestEntity(mock, [Transform()]);
    const handle = mock.api.play(animation, { thing });

    mock.api.setReducedMotion(false);
    mock.frame(100);
    mock.frame(100);

    expect(seen).toEqual([true]);
    expect(handle.active()).toBe(true);
  });

  it("plays the keep tween of a designed variant at its length, not at once", () => {
    // Catches: the designed variant still landing at once (reduced "keep" ignored on a timeline).
    const mock = createMockAnim({ reducedMotion: true });
    const fade = defineAnimation("test.fade", {
      slots: { thing: type<Target>() },
      build: ({ thing }, { reduced }) =>
        reduced
          ? tween(thing, Shape, { alpha: 0 }, { ms: 200, ease: "linear", reduced: "keep" })
          : tween(thing, Transform, { y: -300 }, { ms: 600 })
    });

    mock.start();

    const thing = spawnTestEntity(mock, [Shape(), Transform()]);

    mock.api.play(fade, { thing });
    mock.frame(100);

    const alpha = mock.world.ecs.get(thing, Shape)?.alpha ?? Number.NaN;

    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
    expect(mock.world.ecs.get(thing, Transform)?.y).toBe(0);

    mock.frame(100);
    mock.frame(16);

    expect(mock.world.ecs.get(thing, Shape)?.alpha).toBe(0);
  });

  it("carries reduced into a nested animation only with the outer tools", () => {
    // Catches: `use` building the nested tree without the flag although the outer passed its tools.
    const mock = createMockAnim({ reducedMotion: true });
    const inner: Array<boolean | undefined> = [];
    const nested = defineAnimation("test.inner", {
      slots: { x: type<Target>() },
      build: (_slots, tools) => {
        inner.push(tools.reduced);

        return wait(10);
      }
    });
    const withTools = defineAnimation("test.outer-with", {
      slots: { x: type<Target>() },
      build: ({ x }, tools) => use(nested, { x }, tools)
    });
    const withoutTools = defineAnimation("test.outer-without", {
      slots: { x: type<Target>() },
      build: ({ x }) => sequence(use(nested, { x }))
    });

    mock.start();

    const x = spawnTestEntity(mock, [Transform()]);

    mock.api.play(withTools, { x });
    mock.api.play(withoutTools, { x });

    expect(inner).toEqual([true, undefined]);
  });
});
