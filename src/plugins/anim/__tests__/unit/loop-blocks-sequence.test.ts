import { afterEach, describe, expect, it, vi } from "vitest";
import { type } from "../../../flow/runner/define";
import { Sprite, Transform } from "../../../renderer/components";
import { loopBlocksSequence } from "../../timeline/checks";
import { defineAnimation, frames, mark, parallel, sequence, tween } from "../../timeline/steps";
import type { Target } from "../../types";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

// A looping `frames` step before another step of a `sequence` keeps the rest from ever playing.
// The owner chose a dev warning for it while the games are fixed (an error later), so a game
// that builds it today keeps running.

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A frame list that loops for ever: the sparks around a ready chest. */
const sparks = (it: Target): ReturnType<typeof frames> =>
  frames(it, { keys: ["fx.spark-1", "fx.spark-2"], fps: 12, loop: true });

const blocked = defineAnimation("board.sparksThenLand", {
  slots: { it: type<Target>() },
  build: ({ it }) => sequence(sparks(it), mark("landed"))
});

describe("anim/timeline — a looping frames step before another step of a sequence", () => {
  it("is found anywhere in the tree, and only before another step", () => {
    // Bug caught: the rest of a sequence silently never plays, and nobody is told.
    const it = 1_048_576;

    expect(loopBlocksSequence(sequence(sparks(it), mark("landed")))).toBe(true);
    expect(loopBlocksSequence(parallel(sequence(parallel(sparks(it)), mark("x"))))).toBe(true);
    expect(loopBlocksSequence(sequence(sequence(mark("a"), sparks(it)), mark("b")))).toBe(true);
    expect(loopBlocksSequence(sequence(mark("a"), sparks(it)))).toBe(false);
    expect(loopBlocksSequence(parallel(sparks(it), mark("x")))).toBe(false);
    expect(
      loopBlocksSequence(sequence(frames(it, { keys: ["fx.spark-1"], fps: 12 }), mark("landed")))
    ).toBe(false);
  });

  it("warns once per animation in a dev build, and the play still runs", () => {
    // Bug caught: the warning floods every play, throws, or is missing in dev.
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform(), Sprite()]);
    const first = mock.api.play(blocked, { it: entity });

    mock.api.play(blocked, { it: entity });

    expect(mock.log.warn).toHaveBeenCalledWith("anim:loop-blocks-sequence", {
      animation: "board.sparksThenLand"
    });
    expect(
      vi.mocked(mock.log.warn).mock.calls.filter(call => call[0] === "anim:loop-blocks-sequence")
    ).toHaveLength(1);
    expect(first.active()).toBe(true);
  });

  it("says nothing outside a dev build or for a sequence that ends", () => {
    // Bug caught: a release build pays for the walk and logs, or a plain sequence is warned.
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform(), Sprite()]);

    mock.api.play(blocked, { it: entity });
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    mock.api.play(
      defineAnimation("board.hop", {
        slots: { it: type<Target>() },
        build: ({ it }) => sequence(tween(it, Transform, { y: 10 }, { ms: 100 }), mark("up"))
      }),
      { it: entity }
    );

    expect(mock.log.warn).not.toHaveBeenCalledWith("anim:loop-blocks-sequence", expect.anything());
  });
});
