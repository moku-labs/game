import { describe, expect, it } from "vitest";
import { type } from "../../../flow/runner/define";
import { Transform } from "../../../renderer/components";
import { defineAnimation, sequence, use, wait } from "../../timeline/steps";
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
      seen.push(tools.reducedMotion);

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

  it("carries reduced into a nested animation only with the outer tools", () => {
    // Catches: `use` building the nested tree without the flag although the outer passed its tools.
    const mock = createMockAnim({ reducedMotion: true });
    const inner: Array<boolean | undefined> = [];
    const nested = defineAnimation("test.inner", {
      slots: { x: type<Target>() },
      build: (_slots, tools) => {
        inner.push(tools.reducedMotion);

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
