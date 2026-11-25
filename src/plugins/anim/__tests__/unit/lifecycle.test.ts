import { describe, expect, it } from "vitest";
import { type } from "../../../flow/runner/define";
import { Transform } from "../../../renderer/components";
import { AnimPlayer } from "../../components";
import { stopAnim } from "../../lifecycle";
import {
  defineAnimation,
  play as playDescriptor,
  sequence,
  tween,
  wait
} from "../../timeline/steps";
import type { Target } from "../../types";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

const flight = defineAnimation("hud.coinsFly", {
  slots: { it: type<Target>() },
  build: ({ it }) =>
    sequence(wait(50), tween(it, Transform, { x: 100 }, { ms: 100, ease: "linear" }))
});

/** The sentence a system gets when it plays before `anim` started. */
const NOT_READY =
  "[game] AnimPlayer is not ready: anim has not started.\n" +
  "  Add animPlugin to the app before a system plays an animation.";

/** The same id as `flight`, landing farther: what a hot swap of `hud/animations.ts` brings. */
const fartherFlight = defineAnimation("hud.coinsFly", {
  slots: { it: type<Target>() },
  build: ({ it }) =>
    sequence(wait(50), tween(it, Transform, { x: 300 }, { ms: 100, ease: "linear" }))
});

/**
 * Starts the mock with a sync system that starts an additive walk (a jump to 300, home over 600 ms) in its first
 * run, as an enter hook of `ui.enter` does, and steps one frame in the given mode.
 *
 * @param mode - The world mode of the frame.
 * @returns The walked entity's `y` after the frame.
 */
function drawnAt(mode: "live" | "paused"): number | undefined {
  const mock = createMockAnim();

  mock.start();

  const entity = spawnTestEntity(mock, [Transform()]);
  let started = false;

  mock.world.ecs.system({
    name: "test.enter",
    phase: "sync",
    query: [],
    run: () => {
      if (started) return;

      started = true;
      mock.world.projection.viewOf(entity, { kind: "plugin", name: "test" })?.tween(
        Transform,
        { y: 0 },
        {
          ms: 600,
          additive: true,
          segments: [
            { at: 0.0005, ease: () => 1, to: { y: 300 } },
            { at: 1, ease: t => t, to: { y: 0 } }
          ]
        }
      );
    }
  });
  mock.world.ecs.setMode(mode);
  mock.frame(16);

  return mock.world.ecs.get(entity, Transform)?.y;
}

describe("anim lifecycle", () => {
  it("hands the start value of reduced motion to the renderer's leave", () => {
    const off = createMockAnim();
    const on = createMockAnim({ reducedMotion: true });

    off.start();
    on.start();

    expect(off.reducedCalls).toEqual([false]);
    expect(on.reducedCalls).toEqual([true]);
  });

  it("hands every later setReducedMotion to the renderer's leave, as it is", () => {
    const mock = createMockAnim();

    mock.start();
    mock.api.setReducedMotion(true);
    mock.api.setReducedMotion(false);

    expect(mock.reducedCalls).toEqual([false, true, false]);
  });

  it("installs the tween driver of world in onStart and takes it back in onStop", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const view = mock.world.projection.viewOf(entity, { kind: "plugin", name: "test" });

    view?.tween(Transform, { x: 100 }, { ms: 100 });

    expect(mock.api.active()).toBe(1);

    stopAnim(mock.state);

    const after = spawnTestEntity(mock, [Transform()]);

    mock.world.projection
      .viewOf(after, { kind: "plugin", name: "test" })
      ?.tween(Transform, { x: 100 }, { ms: 100 });

    expect(mock.api.active()).toBe(0);
    expect(mock.world.ecs.get(after, Transform)?.x).toBe(100);
  });

  it("registers the play handler so a fast walk never runs it", () => {
    const mock = createMockAnim();

    mock.start();

    expect(mock.handlers.get("play")?.runInFast).toBe(false);
  });

  it("reads the animations of every feature into the registry", () => {
    const mock = createMockAnim();

    mock.features.push({ name: "hud", description: { animations: [flight] } });
    mock.start();

    expect(mock.state.registry.get("hud.coinsFly")).toBe(flight);
  });

  it("throws when two features register the same animation id", () => {
    const mock = createMockAnim();
    const twin = defineAnimation("hud.coinsFly", { slots: {}, build: () => wait(1) });

    mock.features.push(
      { name: "hud", description: { animations: [flight] } },
      { name: "orders", description: { animations: [twin] } }
    );

    expect(() => mock.start()).toThrow(
      '[game] Animation "hud.coinsFly" is registered twice.\n  Keep one defineAnimation per id.'
    );
  });

  it("plays the animation the play descriptor names and resolves when it ends", async () => {
    const mock = createMockAnim();

    mock.features.push({ name: "hud", description: { animations: [flight] } });
    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handler = mock.handlers.get("play");
    const controller = new AbortController();
    const running = handler?.run(playDescriptor(flight, { it: entity }), {
      signal: controller.signal,
      mode: "live"
    });

    mock.frame(50);
    mock.frame(100);
    await running;

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
  });

  it("finishes the timeline when the node is aborted", async () => {
    const mock = createMockAnim();

    mock.features.push({ name: "hud", description: { animations: [flight] } });
    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handler = mock.handlers.get("play");
    const controller = new AbortController();
    const running = handler?.run(playDescriptor(flight, { it: entity }), {
      signal: controller.signal,
      mode: "live"
    });

    controller.abort();
    await running;

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(mock.api.active()).toBe(0);
  });

  it("throws for a play descriptor whose animation nobody registered", () => {
    const mock = createMockAnim();

    mock.start();

    const handler = mock.handlers.get("play");

    expect(() =>
      handler?.run(playDescriptor(flight, { it: 1 }), {
        signal: new AbortController().signal,
        mode: "live"
      })
    ).toThrow(
      '[game] Animation "hud.coinsFly" is not registered.\n' +
        "  Add it to the animations key of a feature."
    );
  });

  it("freezes the timelines while the world is paused and finishes them in fast mode", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = mock.api.play(flight, { it: entity });

    mock.world.ecs.setMode("paused");
    mock.frame(50);
    mock.frame(100);

    expect(handle.active()).toBe(true);
    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(0);

    mock.world.ecs.setMode("fast");
    mock.frame(16);

    expect(handle.active()).toBe(false);
    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(mock.api.active()).toBe(0);
  });

  // Bug (F241): a walk an enter hook starts in phase sync stands at rest in the frame it is drawn; or a paused world,
  // which moves nothing, has it written all the same.
  it("draws a walk started in phase sync at its start in that frame, and not while the world is paused", () => {
    expect(drawnAt("live")).toBe(300);
    expect(drawnAt("paused")).toBe(0);
  });

  it("leaves a loop standing through a fast frame, lets it run on, and ends it on finishAll", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = mock.api.play(flight, { it: entity });
    // A sway of 400 ms, as `defineMotion` builds a loop: additive, repeated forever.
    const loop = mock.world.projection.viewOf(entity, { kind: "plugin", name: "test" })?.tween(
      Transform,
      { rotation: 0 },
      {
        ms: 400,
        ease: "linear",
        additive: true,
        repeat: "forever",
        segments: [
          { at: 0.5, to: { rotation: 0.1 } },
          { at: 1, to: { rotation: 0 } }
        ]
      }
    );

    mock.frame(100);

    expect(mock.world.ecs.get(entity, Transform)?.rotation).toBeCloseTo(0.05, 6);

    // The entity is no projection view, so the flush of the world leaves its tracks alone: only
    // the fast frames of `anim` touch them, and they end what has an end.
    mock.world.ecs.setMode("fast");
    mock.frame(16);
    mock.frame(16);

    expect(handle.active()).toBe(false);
    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
    // The loop has no end: it stands where it is.
    expect(loop?.active()).toBe(true);
    expect(mock.world.ecs.get(entity, Transform)?.rotation).toBeCloseTo(0.05, 6);
    expect(mock.api.active()).toBe(1);

    mock.world.ecs.setMode("live");
    mock.frame(100);

    expect(mock.world.ecs.get(entity, Transform)?.rotation).toBeCloseTo(0.1, 6);

    mock.api.finishAll();

    expect(loop?.active()).toBe(false);
    expect(mock.api.active()).toBe(0);
  });

  it("resolves every pending done when the plugin stops", async () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = mock.api.play(flight, { it: entity });

    stopAnim(mock.state);
    await handle.done;

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(mock.state.tracks.size).toBe(0);
    expect(mock.state.timelines.size).toBe(0);
    expect(mock.state.registry.size).toBe(0);
  });

  it("runs the animate step before the sweep of world", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);

    mock.api.play(flight, { it: entity });
    mock.frame(50);

    // The track was born in the anim step of this frame, so the sweep of world saw it active.
    expect(mock.api.active()).toBe(1);
  });

  it("leaves the AnimPlayer default in place before onStart: its play throws the sentence", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform()]);

    expect(() => mock.world.ecs.resource(AnimPlayer).play(flight, { it: entity })).toThrow(
      NOT_READY
    );
    expect(mock.api.active()).toBe(0);
  });

  it("writes play onto the AnimPlayer resource of the world in onStart", () => {
    const mock = createMockAnim();
    const before = mock.world.ecs.resource(AnimPlayer);

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);
    const handle = mock.world.ecs.resource(AnimPlayer).play(flight, { it: entity });

    expect(mock.world.ecs.resource(AnimPlayer)).toBe(before);
    expect(handle.active()).toBe(true);

    mock.frame(50);
    mock.frame(100);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(handle.active()).toBe(false);
  });

  it("plays the registered animation of the id, so a hot swap reaches a system", () => {
    const mock = createMockAnim();

    mock.features.push({ name: "hud", description: { animations: [flight] } });
    mock.start();
    mock.api.replace(fartherFlight);

    const entity = spawnTestEntity(mock, [Transform()]);

    mock.world.ecs.resource(AnimPlayer).play(flight, { it: entity });
    mock.frame(50);
    mock.frame(100);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(300);
  });

  it("plays the animation it is given when no feature registered its id", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);

    mock.world.ecs.resource(AnimPlayer).play(fartherFlight, { it: entity });
    mock.frame(50);
    mock.frame(100);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(300);
  });
});
