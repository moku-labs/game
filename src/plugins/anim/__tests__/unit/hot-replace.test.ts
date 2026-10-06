import { describe, expect, it } from "vitest";
import { type } from "../../../flow/runner/define";
import { Transform } from "../../../renderer/components";
import { defineAnimation, play as playDescriptor, tween } from "../../timeline/steps";
import type { Target } from "../../types";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit test: `anim.replace` swaps a registered animation for the dev hot swap.
// The next `play` effect builds the new definition; a running timeline keeps
// the tree it was built with.
// ---------------------------------------------------------------------------

const slide = defineAnimation("board.mergeBurst", {
  slots: { it: type<Target>() },
  build: ({ it }) => tween(it, Transform, { x: 100 }, { ms: 100, ease: "linear" })
});

const longer = defineAnimation("board.mergeBurst", {
  slots: { it: type<Target>() },
  build: ({ it }) => tween(it, Transform, { x: 300 }, { ms: 100, ease: "linear" })
});

/** The signal a node that is never aborted hands over. */
const live = (): { signal: AbortSignal; mode: "live" } => ({
  signal: new AbortController().signal,
  mode: "live"
});

describe("anim.replace", () => {
  it("writes the definition into the registry, so the next play effect builds it", async () => {
    const mock = createMockAnim();

    mock.features.push({ name: "board", description: { animations: [slide] } });
    mock.start();
    mock.api.replace(longer);

    expect(mock.state.registry.get("board.mergeBurst")).toBe(longer);

    const entity = spawnTestEntity(mock, [Transform()]);
    const running = mock.handlers.get("play")?.run(playDescriptor(slide, { it: entity }), live());

    mock.frame(100);
    await running;

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(300);
  });

  it("throws for an id no feature registered", () => {
    const mock = createMockAnim();

    mock.start();

    expect(() => mock.api.replace(longer)).toThrow(
      '[game] Animation "board.mergeBurst" is not registered.\n' +
        "  Register it before replacing it."
    );
    expect(mock.state.registry.size).toBe(0);
  });

  it("leaves a running timeline on the tree it was built with", async () => {
    const mock = createMockAnim();

    mock.features.push({ name: "board", description: { animations: [slide] } });
    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const running = mock.handlers.get("play")?.run(playDescriptor(slide, { it: entity }), live());

    mock.frame(50);
    mock.api.replace(longer);
    mock.frame(50);
    await running;

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(mock.api.active()).toBe(0);
  });

  it("leaves app.anim.play on the definition it is given", () => {
    const mock = createMockAnim();

    mock.features.push({ name: "board", description: { animations: [slide] } });
    mock.start();
    mock.api.replace(longer);

    const entity = spawnTestEntity(mock, [Transform()]);

    mock.api.play(slide, { it: entity });
    mock.frame(100);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
  });
});
