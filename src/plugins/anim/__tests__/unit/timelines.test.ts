import { describe, expect, it } from "vitest";
import { type } from "../../../flow/runner/define";
import { Sprite, Transform } from "../../../renderer/components";
import { createRuntime, stopAnim } from "../../lifecycle";
import { startTimeline } from "../../timeline/play";
import { snapshotOf } from "../../timeline/ring";
import {
  defineAnimation,
  mark,
  play as playDescriptor,
  sequence,
  spawn,
  tween,
  wait
} from "../../timeline/steps";
import type { Target } from "../../types";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

/** A flight of 100 ms that reaches one mark at its start and one at its end. */
const flight = defineAnimation("hud.coinsFly", {
  slots: { it: type<Target>() },
  build: ({ it }) =>
    sequence(
      mark("takeoff"),
      tween(it, Transform, { x: 100 }, { ms: 100, ease: "linear" }),
      mark("landed")
    )
});

/** An animation with no slot that ends the moment it is finished. */
const blink = defineAnimation("fx.blink", { slots: {}, build: () => wait(1000) });

/**
 * The events of one name the mock recorded.
 *
 * @param emitted - The recorded events.
 * @param name - The event name.
 * @returns The payloads, in order.
 */
function payloadsOf(emitted: Array<{ name: string; payload: unknown }>, name: string): unknown[] {
  return emitted.filter(entry => entry.name === name).map(entry => entry.payload);
}

describe("anim:started", () => {
  it("fires once per play with the timeline number that timelines() lists", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);

    mock.api.play(flight, { it: entity });

    expect(payloadsOf(mock.emitted, "anim:started")).toEqual([
      { animation: "hud.coinsFly", timeline: mock.api.timelines().running[0]?.timeline }
    ]);

    mock.api.play(blink, {});

    const numbers = mock.api.timelines().running.map(entry => entry.timeline);

    expect(payloadsOf(mock.emitted, "anim:started")).toHaveLength(2);
    expect(payloadsOf(mock.emitted, "anim:started")[1]).toEqual({
      animation: "fx.blink",
      timeline: numbers[1]
    });
    // Ids are shared with tracks, but two timelines never share one.
    expect(new Set(numbers).size).toBe(2);
  });

  it("is announced after the timeline is in the table, and not at all when the build throws", () => {
    const mock = createMockAnim();

    mock.start();

    const listed: boolean[] = [];
    const rt = createRuntime(mock.actx);
    const probing = {
      ...mock.actx,
      emit: (name: string): void => {
        if (name === "anim:started") {
          listed.push(
            mock.state.timelines.size === 1 && snapshotOf(mock.state).running.length === 1
          );
        }
      }
    };

    startTimeline(probing, rt, blink, {});

    expect(listed).toEqual([true]);

    const coin = [Sprite({ texture: "ui.icon-coin" }), Transform()];
    const twice = defineAnimation("hud.twice", {
      slots: {},
      build: () => sequence(spawn("coin1", coin), wait(10), spawn("coin1", coin))
    });

    expect(() => mock.api.play(twice, {})).toThrow('spawns "coin1" twice');
    expect(payloadsOf(mock.emitted, "anim:started")).toEqual([]);
    expect(mock.state.timelines.size).toBe(1);
  });
});

describe("anim:cancelled", () => {
  it("fires once on cancel(), never with anim:finished, and a second cancel says nothing", () => {
    const mock = createMockAnim();

    mock.start();

    const handle = mock.api.play(blink, {});
    const timeline = mock.api.timelines().running[0]?.timeline;

    handle.cancel();
    handle.cancel();

    expect(payloadsOf(mock.emitted, "anim:cancelled")).toEqual([
      { animation: "fx.blink", timeline }
    ]);
    expect(payloadsOf(mock.emitted, "anim:finished")).toEqual([]);
  });
});

describe("anim:finished reason", () => {
  it('is "ended" when the tree ran through', () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);

    mock.api.play(flight, { it: entity });

    const timeline = mock.api.timelines().running[0]?.timeline;

    mock.frame(50);
    mock.frame(50);

    expect(payloadsOf(mock.emitted, "anim:finished")).toEqual([
      { animation: "hud.coinsFly", timeline, reason: "ended" }
    ]);
  });

  it('is "finished" for handle.finish() and for finishAll()', () => {
    const mock = createMockAnim();

    mock.start();

    const first = mock.api.play(blink, {});
    const firstNumber = mock.api.timelines().running[0]?.timeline;

    mock.api.play(blink, {});

    const secondNumber = mock.api.timelines().running[1]?.timeline;

    first.finish();

    expect(payloadsOf(mock.emitted, "anim:finished")).toEqual([
      { animation: "fx.blink", timeline: firstNumber, reason: "finished" }
    ]);

    mock.api.finishAll();

    expect(payloadsOf(mock.emitted, "anim:finished")).toEqual([
      { animation: "fx.blink", timeline: firstNumber, reason: "finished" },
      { animation: "fx.blink", timeline: secondNumber, reason: "finished" }
    ]);
  });

  it('is "finished" for the timeline of a node that was aborted', async () => {
    const mock = createMockAnim();

    mock.features.push({ name: "hud", description: { animations: [blink] } });
    mock.start();

    const controller = new AbortController();
    const running = mock.handlers
      .get("play")
      ?.run(playDescriptor(blink, {}), { signal: controller.signal, mode: "live" });

    controller.abort();
    await running;

    expect(payloadsOf(mock.emitted, "anim:finished")).toMatchObject([
      { animation: "fx.blink", reason: "finished" }
    ]);
  });
});

describe("timelines()", () => {
  it("lists a running timeline with its slots, start frame, entities and the marks reached", () => {
    const mock = createMockAnim();

    mock.start();
    mock.frame(10);

    const entity = spawnTestEntity(mock, [Transform()]);
    const slots = { it: entity };

    mock.api.play(flight, slots);

    expect(mock.api.timelines().running).toEqual([
      expect.objectContaining({
        animation: "hud.coinsFly",
        startFrame: 1,
        entities: [entity],
        marks: []
      })
    ]);
    expect(mock.api.timelines().running[0]?.slots).toBe(slots);

    mock.frame(10);

    expect(mock.api.timelines().running[0]?.marks).toEqual(["takeoff"]);
  });

  it("drops a timeline from running on the frame it ends and records it as ended", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);

    mock.api.play(flight, { it: entity });

    const timeline = mock.api.timelines().running[0]?.timeline;

    mock.frame(50);

    expect(mock.api.timelines().running).toHaveLength(1);
    expect(mock.api.timelines().ended).toEqual([]);

    mock.frame(50);

    expect(mock.api.timelines().running).toEqual([]);
    expect(mock.api.timelines().ended).toEqual([
      { timeline, animation: "hud.coinsFly", startFrame: 0, endFrame: 2, reason: "ended" }
    ]);
  });

  it("keeps one record per end with its reason: ended, finished and cancelled", () => {
    const mock = createMockAnim();

    mock.start();

    mock.api.play(blink, {}).finish();
    mock.api.play(blink, {}).cancel();

    const entity = spawnTestEntity(mock, [Transform()]);

    mock.api.play(flight, { it: entity });
    mock.frame(100);

    expect(mock.api.timelines().ended.map(entry => [entry.animation, entry.reason])).toEqual([
      ["fx.blink", "finished"],
      ["fx.blink", "cancelled"],
      ["hud.coinsFly", "ended"]
    ]);
  });

  it("keeps the last 16 ends, oldest first: the 16th still fits and the 17th evicts the first", () => {
    const mock = createMockAnim();

    mock.start();

    const names = Array.from({ length: 17 }, (_unused, index) => `fx.n${index}`);

    for (const name of names.slice(0, 16)) {
      mock.api.play(defineAnimation(name, { slots: {}, build: () => wait(1000) }), {}).finish();
    }

    expect(mock.api.timelines().ended.map(entry => entry.animation)).toEqual(names.slice(0, 16));

    mock.api.play(defineAnimation("fx.n16", { slots: {}, build: () => wait(1000) }), {}).finish();

    expect(mock.api.timelines().ended.map(entry => entry.animation)).toEqual(names.slice(1));
  });

  it("writes the ring before anim:finished is announced", () => {
    const mock = createMockAnim();

    mock.start();

    const seen: string[][] = [];
    const rt = createRuntime(mock.actx);
    const probing = {
      ...mock.actx,
      emit: (name: string): void => {
        if (name === "anim:finished") {
          seen.push(snapshotOf(mock.state).ended.map(entry => entry.reason));
        }
      }
    };

    startTimeline(probing, rt, blink, {}).finish();

    expect(seen).toEqual([["finished"]]);
  });

  it("answers copies: changing what it returned changes no later answer", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [Transform()]);

    mock.api.play(flight, { it: entity });
    mock.api.play(blink, {}).finish();
    mock.frame(10);

    const first = mock.api.timelines();
    const running = first.running[0];

    (first.running as unknown[]).length = 0;
    ((running?.entities ?? []) as unknown[]).length = 0;
    ((running?.marks ?? []) as unknown[]).push("forged");
    (first.ended as unknown[]).length = 0;

    const second = mock.api.timelines();

    expect(second.running[0]?.entities).toEqual([entity]);
    expect(second.running[0]?.marks).toEqual(["takeoff"]);
    expect(second.ended).toHaveLength(1);
  });

  it("is empty after stop: the ring starts over and its 16 records stay allocated", () => {
    const mock = createMockAnim();

    mock.start();
    mock.api.play(blink, {}).finish();
    mock.api.play(blink, {});

    const records = [...mock.state.ended];

    expect(mock.api.timelines().ended).toHaveLength(1);

    stopAnim(mock.state);

    expect(mock.api.timelines()).toEqual({ running: [], ended: [] });
    expect(mock.state.endedCount).toBe(0);
    expect(mock.state.endedNext).toBe(0);
    expect(mock.state.ended).toHaveLength(16);
    expect(mock.state.ended.every((record, index) => record === records[index])).toBe(true);
  });
});
