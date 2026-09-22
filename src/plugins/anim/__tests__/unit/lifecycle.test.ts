import { describe, expect, it } from "vitest";
import { type } from "../../../flow/runner/define";
import { Transform } from "../../../renderer/components";
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

describe("anim lifecycle", () => {
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
});
