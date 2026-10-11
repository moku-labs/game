import type { Log } from "@moku-labs/common/browser";
import type { Flow, Model } from "@moku-labs/game";
import { defineGame, guide, hint, sfx, type } from "@moku-labs/game";
import { fakeFx } from "@moku-labs/game/testing";
import { describe, expect, it, vi } from "vitest";
import { nodeFx } from "../../../src/plugins/flow/runner/node";
import type { Modules } from "../../../src/plugins/flow/runner/types";

// ---------------------------------------------------------------------------
// Unit test: `fakeFx`, the `fx` of a node context for a test that calls `node.run(context)`
// itself. No app is started: the fake records, and answers what the test tells it to.
// ---------------------------------------------------------------------------

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Model.Json = null;

const tick = async (times = 20): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

type Player = { coins: number };
type Session = { marks: string[]; pick: string };

const { defineNode } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, never>;
}>();

// The "place" node of a board game: a tap sound nobody waits for, then the mark.
const place = defineNode({
  input: type<{ cell: string }>(),
  outcomes: { placed: type() },
  run: ({ fx, session, input, out }) => {
    fx.start(sfx("ui.tap"));
    session.marks.push(input.cell);

    return out.placed();
  }
});

// The "retry" node: it waits for the player's pick, then sparkles.
const retry = defineNode({
  input: type<{ cell: string }>(),
  outcomes: { placed: type() },
  run: async ({ fx, session, input, out }) => {
    const pick = await fx({
      kind: "popup",
      payload: { name: "Retry" },
      answers: ["again", "home"]
    });

    session.pick = JSON.stringify(pick);
    fx.emit(hint("sparkle", { cell: input.cell }));

    return out.placed();
  }
});

type PlaceContext = Parameters<NonNullable<typeof place.run>>[0];

/** The node context of one direct call, without its `fx`: the test brings that. */
const contextOf = (session: Session): Omit<PlaceContext, "fx"> => ({
  input: { cell: "c3" },
  player: { coins: 0 },
  session,
  rng: {
    stream: () => {
      throw new Error("The test draws no random number.");
    }
  },
  out: { placed: () => ({ outcome: "placed", payload: noPayload }) },
  signal: new AbortController().signal,
  now: 1_790_000_000_000
});

const popup: Flow.Descriptor = { kind: "popup", payload: { name: "Retry" }, answers: ["again"] };

/** The message of what a call threw, or `undefined` when it threw nothing. */
const messageOf = (call: () => void): string | undefined => {
  try {
    call();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  return undefined;
};

/**
 * The `fx` of a node context as the runner builds it, for the node at `path`. A refused
 * `fx.start` throws before it reaches a module, so the modules are never read.
 */
const realFx = (path: string): Flow.NodeFx => {
  const log: Log.LogApi = {
    addSink: vi.fn(),
    clearSinks: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    expect: vi.fn(),
    info: vi.fn(),
    reset: vi.fn(),
    trace: vi.fn(() => []),
    warn: vi.fn()
  };

  return nodeFx({} as Modules, {
    signal: new AbortController().signal,
    gateOpened: () => undefined,
    path,
    log
  });
};

describe("fakeFx", () => {
  it("starts with three empty lists", () => {
    const fx = fakeFx();

    expect(fx.awaited).toEqual([]);
    expect(fx.started).toEqual([]);
    expect(fx.emitted).toEqual([]);
  });

  it("is the fx of a node a test runs itself: the started sound is in started", async () => {
    const fx = fakeFx();
    const session: Session = { marks: [], pick: "" };

    const result = await place.run?.({ ...contextOf(session), fx: fx.fx });

    expect(result).toEqual({ outcome: "placed", payload: noPayload });
    expect(session.marks).toEqual(["c3"]);
    expect(fx.started).toEqual([
      { kind: "sfx", payload: { key: "ui.tap", bus: "sfx" }, cosmetic: true }
    ]);
    expect(fx.awaited).toEqual([]);
    expect(fx.emitted).toEqual([]);
  });

  it("answers an awaited effect with what answer returns for its descriptor", async () => {
    const fx = fakeFx({
      answer: descriptor => (descriptor.kind === "popup" ? { intent: "again" } : undefined)
    });
    const session: Session = { marks: [], pick: "" };

    await retry.run?.({ ...contextOf(session), fx: fx.fx });

    expect(session.pick).toBe('{"intent":"again"}');
    expect(fx.awaited).toEqual([
      { kind: "popup", payload: { name: "Retry" }, answers: ["again", "home"] }
    ]);
    expect(fx.emitted).toEqual([{ kind: "sparkle", payload: { cell: "c3" }, hint: true }]);
    expect(fx.started).toEqual([]);
  });
});

describe("fakeFx: an awaited effect", () => {
  it("resolves undefined when no answer is given", async () => {
    const fx = fakeFx();

    await expect(fx.fx({ kind: "drop" })).resolves.toBeUndefined();
    expect(fx.awaited).toEqual([{ kind: "drop" }]);
  });

  it("resolves with the value answer returns", async () => {
    const fx = fakeFx({ answer: () => ({ intent: "home" }) });

    await expect(fx.fx(popup)).resolves.toEqual({ intent: "home" });
  });

  it("resolves with what a promise from answer resolves with", async () => {
    const fx = fakeFx({ answer: async () => "later" });

    await expect(fx.fx({ kind: "load" })).resolves.toBe("later");
  });

  it("hands the descriptor itself to answer, once per call", async () => {
    const seen: Flow.Descriptor[] = [];
    const fx = fakeFx({
      answer: descriptor => {
        seen.push(descriptor);
      }
    });
    const drop: Flow.Descriptor = { kind: "drop" };

    await fx.fx(drop);
    await fx.fx(popup);

    expect(seen).toEqual([drop, popup]);
    expect(seen[0]).toBe(drop);
  });

  it("records the call at once, before the effect is answered", () => {
    const fx = fakeFx({ answer: () => new Promise<never>(() => undefined) });

    fx.fx(popup);

    expect(fx.awaited).toEqual([popup]);
  });

  it("holds the awaiting body while the answer never settles, as a real effect can", async () => {
    const fx = fakeFx({ answer: () => new Promise<never>(() => undefined) });
    const session: Session = { marks: [], pick: "" };
    const done = vi.fn();

    Promise.resolve(retry.run?.({ ...contextOf(session), fx: fx.fx })).then(done);
    await tick();

    expect(fx.awaited).toHaveLength(1);
    // The body stands at its `await`: nothing after it ran.
    expect(session.pick).toBe("");
    expect(fx.emitted).toEqual([]);
    expect(done).not.toHaveBeenCalled();
  });

  it("rejects when answer throws or rejects: a failed effect is the node's error", async () => {
    const thrown = fakeFx({
      answer: () => {
        throw new Error("no renderer");
      }
    });
    const rejected = fakeFx({ answer: () => Promise.reject(new Error("no network")) });

    await expect(thrown.fx(popup)).rejects.toThrow("no renderer");
    await expect(rejected.fx(popup)).rejects.toThrow("no network");
    // The call is recorded all the same: the node did ask for the effect.
    expect(thrown.awaited).toEqual([popup]);
  });
});

describe("fakeFx: a started effect", () => {
  it("records the descriptor and returns nothing", () => {
    const fx = fakeFx();
    const tap = sfx("ui.tap");

    expect(fx.fx.start(tap)).toBeUndefined();
    expect(fx.started).toEqual([tap]);
    expect(fx.started[0]).toBe(tap);
    expect(fx.awaited).toEqual([]);
  });

  it("never asks answer: nothing waits for a started effect", () => {
    const answer = vi.fn();
    const fx = fakeFx({ answer });

    fx.fx.start(sfx("ui.tap"));

    expect(answer).not.toHaveBeenCalled();
  });

  it("refuses a descriptor with answers and a guide with the message of the real fx", () => {
    const path = "board/place";
    const real = realFx(path);
    const fx = fakeFx({ path });
    const tutorial = guide({ allow: { intent: "merge" } });

    expect(messageOf(() => fx.fx.start(popup))).toBe(
      '[game] fx.start() got the effect "popup" in the node "board/place", and its answer has to be awaited.\n  Write await fx(...) for a descriptor with answers and for a guide.'
    );
    expect(messageOf(() => fx.fx.start(popup))).toBe(messageOf(() => real.start(popup)));
    expect(messageOf(() => fx.fx.start(tutorial))).toBe(messageOf(() => real.start(tutorial)));
    expect(messageOf(() => real.start(tutorial))).toContain('got the effect "guide"');
  });

  it('names the node "test" when no path is given', () => {
    const fx = fakeFx();

    expect(messageOf(() => fx.fx.start(popup))).toBe(messageOf(() => realFx("test").start(popup)));
    expect(messageOf(() => fx.fx.start(popup))).toContain('in the node "test"');
  });

  it("records nothing for a refused start: nothing was started", () => {
    const fx = fakeFx();

    expect(() => fx.fx.start(popup)).toThrow(/^\[game] /);
    expect(() => fx.fx.start(guide({ allow: { intent: "merge" } }))).toThrow(/^\[game] /);
    expect(fx.started).toEqual([]);
  });

  it("awaits what it refuses to start: a popup and a guide are recorded in awaited", async () => {
    const fx = fakeFx();
    const tutorial = guide({ allow: { intent: "merge" } });

    await fx.fx(popup);
    await fx.fx(tutorial);

    expect(fx.awaited).toEqual([popup, tutorial]);
  });
});

describe("fakeFx: the lists", () => {
  it("records every call in order, each kind in its own list", async () => {
    const fx = fakeFx();

    fx.fx.start({ kind: "sfx", payload: { key: "a" } });
    await fx.fx({ kind: "drop", payload: { cell: "c1" } });
    fx.fx.emit(hint("sparkle", { cell: "c1" }));
    fx.fx.start({ kind: "sfx", payload: { key: "b" } });
    await fx.fx({ kind: "drop", payload: { cell: "c2" } });
    fx.fx.emit(hint("placed"));

    expect(fx.started).toEqual([
      { kind: "sfx", payload: { key: "a" } },
      { kind: "sfx", payload: { key: "b" } }
    ]);
    expect(fx.awaited).toEqual([
      { kind: "drop", payload: { cell: "c1" } },
      { kind: "drop", payload: { cell: "c2" } }
    ]);
    expect(fx.emitted).toEqual([
      { kind: "sparkle", payload: { cell: "c1" }, hint: true },
      { kind: "placed", hint: true }
    ]);
  });

  it("keeps the same three arrays for its whole life: a list read early sees later calls", async () => {
    const fx = fakeFx();
    const { awaited, started, emitted } = fx;

    fx.fx.start(sfx("ui.tap"));
    await fx.fx({ kind: "drop" });
    fx.fx.emit(hint("sparkle"));

    expect(fx.awaited).toBe(awaited);
    expect(fx.started).toBe(started);
    expect(fx.emitted).toBe(emitted);
    expect(started).toHaveLength(1);
    expect(awaited).toHaveLength(1);
    expect(emitted).toHaveLength(1);
  });

  it("starts over when a test empties a list between two phases", () => {
    const fx = fakeFx();

    fx.fx.start(sfx("ui.tap"));
    fx.started.length = 0;
    fx.fx.start(sfx("ui.back"));

    expect(fx.started).toEqual([sfx("ui.back")]);
  });

  it("does not let a test replace a list by another array the fake would not write to", () => {
    const fx = fakeFx();
    const { started } = fx;

    expect(Object.isFrozen(fx)).toBe(true);
    expect(() => {
      Object.assign(fx, { started: [] });
    }).toThrow(TypeError);
    expect(fx.started).toBe(started);
    // Frozen is the holder, not the lists: the fake still records.
    fx.fx.start(sfx("ui.tap"));
    expect(started).toHaveLength(1);
  });

  it("shares nothing between two fakes", () => {
    const first = fakeFx();
    const second = fakeFx();

    first.fx.start(sfx("ui.tap"));
    first.fx.emit(hint("sparkle"));

    expect(second.started).toEqual([]);
    expect(second.emitted).toEqual([]);
    expect(second.fx).not.toBe(first.fx);
  });
});
