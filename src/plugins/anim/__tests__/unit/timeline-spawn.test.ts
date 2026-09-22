import { describe, expect, it } from "vitest";
import { type } from "../../../flow/runner/define";
import { Sprite, Transform } from "../../../renderer/components";
import { Text } from "../../../text/components";
import { Layer, Order } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import {
  defineAnimation,
  mark,
  parallel,
  play,
  sequence,
  spawn,
  spawned,
  tween,
  use,
  wait
} from "../../timeline/steps";
import type { Target } from "../../types";
import type { MockAnim } from "./mock-anim";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

/** The coin a flight spawns: a picture at the start of the flight. */
const coin = [
  Sprite({ texture: "ui.icon-coin", width: 64, height: 64, fit: "contain" }),
  Transform({ x: 100, y: 800 })
];

/** One coin spawned at the picture flies to the counter, then the timeline ends. */
const coinsFly = defineAnimation("hud.coinsFly", {
  slots: { to: type<Target>() },
  build: ({ to }, { at }) =>
    sequence(
      spawn("coin1", coin, { order: 50 }),
      tween(
        spawned("coin1"),
        Transform,
        { x: at(to).x, y: at(to).y },
        {
          ms: 100,
          ease: "linear"
        }
      ),
      mark("landed")
    )
});

/**
 * The entities `anim` spawned and that are still alive. In these tests nothing else carries a
 * `Layer`: the counter the coins fly to is a plain test entity.
 *
 * @param mock - The mock anim world.
 * @returns The live entities with a `Layer`.
 */
function animOwned(mock: MockAnim): Entity[] {
  return [...mock.world.ecs.query(Layer)].map(([entity]) => entity);
}

/**
 * Starts the mock world with a counter to fly to.
 *
 * @returns The started mock world and the counter entity.
 */
function withCounter(): { mock: MockAnim; counter: Entity } {
  const mock = createMockAnim();

  mock.start();

  const counter = spawnTestEntity(mock, [Transform({ x: 40, y: 120 })]);

  return { mock, counter };
}

describe("anim/timeline spawn builders", () => {
  it("builds a frozen spawn step with the ui layer and order 0 by default", () => {
    const step = spawn("coin1", coin);

    expect(step).toEqual({ kind: "spawn", id: "coin1", components: coin, layer: "ui", order: 0 });
    expect(Object.isFrozen(step)).toBe(true);
    expect(step.kind === "spawn" && Object.isFrozen(step.components)).toBe(true);
    expect(step.kind === "spawn" && step.components.every(entry => Object.isFrozen(entry))).toBe(
      true
    );
  });

  it("keeps the layer and the order a spawn was given", () => {
    expect(spawn("sign", coin, { layer: "fx", order: 7 })).toMatchObject({
      layer: "fx",
      order: 7
    });
  });

  it("builds a frozen spawned target", () => {
    expect(spawned("coin1")).toEqual({ spawned: "coin1" });
    expect(Object.isFrozen(spawned("coin1"))).toBe(true);
  });
});

describe("anim/timeline spawn", () => {
  it("spawns the entity when the step is reached, with Layer and Order, owned by anim", () => {
    const { mock, counter } = withCounter();

    mock.api.play(coinsFly, { to: counter });

    expect(animOwned(mock)).toEqual([]);

    mock.frame(16);

    const [entity] = animOwned(mock);

    expect(entity).toBeDefined();
    expect(mock.world.ecs.get(entity ?? 0, Layer)).toEqual({ name: "ui" });
    expect(mock.world.ecs.get(entity ?? 0, Order)).toEqual({ value: 50 });
    expect(mock.world.ecs.get(entity ?? 0, Sprite)?.texture).toBe("ui.icon-coin");

    mock.world.ecs.despawnOwnedBy({ kind: "plugin", name: "anim" });

    expect(animOwned(mock)).toEqual([]);
  });

  it("tweens the spawned target in later steps", () => {
    const { mock, counter } = withCounter();

    mock.api.play(coinsFly, { to: counter });
    mock.frame(50);

    const [entity] = animOwned(mock);
    const pose = mock.world.ecs.get(entity ?? 0, Transform);

    expect(pose?.x).toBeCloseTo(70);
    expect(pose?.y).toBeCloseTo(460);
  });

  it("despawns what it spawned when the timeline ends", async () => {
    const { mock, counter } = withCounter();
    const handle = mock.api.play(coinsFly, { to: counter });

    mock.frame(50);

    const [entity] = animOwned(mock);

    mock.frame(50);
    await handle.done;

    expect(handle.marks()).toEqual(["landed"]);
    expect(animOwned(mock)).toEqual([]);
    expect(mock.world.ecs.has(entity ?? 0, Transform)).toBe(false);
    expect(mock.api.active()).toBe(0);
  });

  it("despawns what it spawned on finishAll", async () => {
    const { mock, counter } = withCounter();
    const handle = mock.api.play(coinsFly, { to: counter });

    mock.frame(16);

    expect(animOwned(mock)).toHaveLength(1);

    mock.api.finishAll();
    await handle.done;

    expect(animOwned(mock)).toEqual([]);
    expect(handle.marks()).toEqual(["landed"]);
  });

  it("despawns what it spawned when the handle is finished", () => {
    const { mock, counter } = withCounter();
    const handle = mock.api.play(coinsFly, { to: counter });

    mock.frame(16);
    handle.finish();

    expect(animOwned(mock)).toEqual([]);
  });

  it("despawns what it spawned on cancel and writes nothing more", async () => {
    const { mock, counter } = withCounter();
    const handle = mock.api.play(coinsFly, { to: counter });

    mock.frame(16);
    handle.cancel();
    await handle.done;

    expect(animOwned(mock)).toEqual([]);
    expect(handle.marks()).toEqual([]);
    expect(mock.api.active()).toBe(0);
  });

  it("despawns what it spawned when the node that played it is aborted", async () => {
    const mock = createMockAnim();
    const abort = new AbortController();

    mock.features.push({ name: "hud", description: { animations: [coinsFly] } });
    mock.start();

    const counter = spawnTestEntity(mock, [Transform({ x: 40, y: 120 })]);
    const run = mock.handlers.get("play")?.run;
    const done = run?.(
      { kind: "play", payload: { animation: "hud.coinsFly", slots: { to: counter } } },
      { signal: abort.signal, mode: "live" }
    );

    mock.frame(16);

    expect(animOwned(mock)).toHaveLength(1);

    abort.abort();
    await done;

    expect(animOwned(mock)).toEqual([]);
  });

  it("spawns nothing when the timeline is finished before the step is reached", () => {
    const { mock } = withCounter();
    const late = defineAnimation("hud.late", {
      slots: {},
      build: () =>
        sequence(
          wait(100),
          spawn("coin1", coin),
          tween(spawned("coin1"), Transform, { x: 5 }, { ms: 10 })
        )
    });
    const handle = mock.api.play(late, {});

    mock.frame(16);
    handle.finish();

    expect(animOwned(mock)).toEqual([]);
    expect(handle.active()).toBe(false);
  });

  it("throws at build time when one timeline spawns the same id twice", () => {
    const { mock } = withCounter();
    const twice = defineAnimation("hud.coinsFly", {
      slots: {},
      build: () => sequence(spawn("coin1", coin), wait(10), spawn("coin1", coin))
    });

    expect(() => mock.api.play(twice, {})).toThrow(
      '[game] Animation "hud.coinsFly" spawns "coin1" twice.\n' +
        "  Give every spawned entity its own id."
    );
    expect(mock.state.timelines.size).toBe(0);
  });

  it("checks the spawn ids of a nested animation too", () => {
    const { mock } = withCounter();
    const inner = defineAnimation("hud.coin", {
      slots: {},
      build: () => spawn("coin1", coin)
    });
    const outer = defineAnimation("hud.coinsFly", {
      slots: {},
      build: () => parallel(spawn("coin1", coin), use(inner, {}))
    });

    expect(() => mock.api.play(outer, {})).toThrow('spawns "coin1" twice');
  });

  it("carries a spawned target through the play descriptor and its handler", async () => {
    const mock = createMockAnim();
    const pop = defineAnimation("fx.pop", {
      slots: { it: type<Target>() },
      build: ({ it }) =>
        sequence(spawn("coin1", coin), tween(it, Transform, { x: 0 }, { ms: 100, ease: "linear" }))
    });
    const descriptor = play(pop, { it: spawned("coin1") });

    expect(descriptor.payload.slots).toEqual({ it: { spawned: "coin1" } });

    mock.features.push({ name: "fx", description: { animations: [pop] } });
    mock.start();
    const run = mock.handlers.get("play")?.run;
    const done = run?.(descriptor, { signal: new AbortController().signal, mode: "live" });

    mock.frame(50);

    const [entity] = animOwned(mock);

    expect(mock.world.ecs.get(entity ?? 0, Transform)?.x).toBeCloseTo(50);

    mock.frame(50);
    await done;

    expect(animOwned(mock)).toEqual([]);
  });

  it("gives two plays of the same animation their own spawned entities", () => {
    const { mock, counter } = withCounter();

    mock.api.play(coinsFly, { to: counter });
    mock.api.play(coinsFly, { to: counter });
    mock.frame(16);

    expect(animOwned(mock)).toHaveLength(2);

    mock.frame(100);

    expect(animOwned(mock)).toEqual([]);
  });

  it("keeps a spawned Text entity alive while the timeline runs", () => {
    const { mock } = withCounter();
    const toast = defineAnimation("board.toastBoardFull", {
      slots: {},
      build: () =>
        sequence(
          spawn("sign", [
            Text({ content: "Board is full", style: "title" }),
            Transform({ x: 540, y: 300 })
          ]),
          wait(1600),
          mark("gone")
        )
    });
    const handle = mock.api.play(toast, {});

    mock.frame(16);

    const [sign] = animOwned(mock);

    expect(mock.world.ecs.get(sign ?? 0, Text)?.content).toBe("Board is full");

    mock.frame(1000);

    expect(mock.world.ecs.has(sign ?? 0, Text)).toBe(true);

    mock.frame(600);

    expect(handle.marks()).toEqual(["gone"]);
    expect(mock.world.ecs.has(sign ?? 0, Text)).toBe(false);
  });
});
