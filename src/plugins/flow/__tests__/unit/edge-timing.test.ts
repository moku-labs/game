import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApp,
  createPlugin,
  defineGame,
  flowPlugin,
  schedule,
  slot,
  type
} from "../../../../index";
import { fakeClock } from "../../../clock/fake";
import { memory } from "../../../model/store/providers/memory";
import type { EdgeTiming } from "../../runner/types";

// ---------------------------------------------------------------------------
// Unit: the edge timer of an agent build (hot-path item 8). The page clock is the stubbed
// `performance.now()` that `time.agentClock()` reads: it moves 1 ms a read, and the game below
// moves it by its own amounts, so every field of an edge comes out as a number of its own.
// ---------------------------------------------------------------------------

type Player = { merges: number };
type Session = { tries: number };

const { defineNode, defineFlow } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** Every `begin` stage of a node entry. */
const STAGES_MS = 16;

/** A body before its first `await`. */
const SLICE_MS = 8;

/** A body after its first `await`: not part of `bodyMs`. */
const AFTER_AWAIT_MS = 32;

/** The `flow:edge` listener of the stopwatch plugin. */
const HOOK_MS = 4;

/** The page clock the stub hands out. */
const page = { now: 0 };

/**
 * Moves the page clock, as work on the page would.
 *
 * @param ms - The time the work took.
 */
const spend = (ms: number): void => {
  page.now += ms;
};

/** Never settles: a rest body that waits until the inbox aborts it. */
const never = (): void => undefined;

const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

const home = defineNode({
  outcomes: { play: type(), wait: type(), fail: type() },
  rest: true,
  checkpoint: true,
  recover: ({ session }) => {
    session.tries = 0;
  }
});

const work = defineNode({
  outcomes: { done: type() },
  run: async ({ fx, player, now, out }) => {
    spend(SLICE_MS);
    player.merges += 1;
    await fx(schedule(now + 1000));
    spend(AFTER_AWAIT_MS);
    return out.done();
  }
});

const broken = defineNode({
  outcomes: { done: type() },
  run: () => {
    spend(SLICE_MS);
    throw new Error("the board broke");
  }
});

const lobby = defineNode({
  outcomes: { elapsed: type() },
  rest: true,
  inbox: ["elapsed"],
  run: async ({ out }) => {
    spend(SLICE_MS);
    await new Promise<void>(never);
    return out.elapsed();
  }
});

const main = defineFlow("main", {
  nodes: { home, work, extras: slot("extras"), broken, lobby },
  start: "home",
  edges: {
    home: { play: "work", wait: "lobby", fail: "broken" },
    work: { done: "extras" },
    extras: { done: "home" },
    broken: { done: "home" },
    lobby: { elapsed: "home" }
  }
});

/**
 * Builds the game: the real logic plugins, a stopwatch plugin as the one `flow:edge` listener and
 * a `begin` stage that spends `STAGES_MS`. Call after the flag and the clock are stubbed: flow
 * starts its timer in `onInit`.
 *
 * @param retries - Retries before the loop gives up and enters the safe node.
 * @returns The app.
 */
const createTimedGame = (retries = 1) => {
  const stopwatch = createPlugin("stopwatch", {
    depends: [flowPlugin],
    hooks: () => ({
      "flow:edge": () => {
        spend(HOOK_MS);
      }
    })
  });
  const app = createApp({
    plugins: [stopwatch],
    pluginConfigs: {
      model: {
        playerProvider: memory(),
        seed: 7,
        initialPlayer: { merges: 0 },
        initialSession: { tries: 0 }
      },
      clock: { source: fakeClock(1000) },
      flow: { mainFlow: main, safeNode: "home", retries }
    }
  });

  app.flow.onEnter("begin", () => {
    spend(STAGES_MS);
  });

  return app;
};

/**
 * Stubs an agent build whose page clock moves 1 ms at every read.
 */
const stubAgentPage = (): void => {
  page.now = 5000;
  vi.stubGlobal("__MOKU_GAME_AGENT__", true);
  vi.spyOn(globalThis.performance, "now").mockImplementation(() => {
    page.now += 1;

    return page.now;
  });
};

/**
 * Starts the app and its graph and waits until it rests at `home`.
 *
 * @param app - The app.
 * @returns How the graph ended, once it ends: `"rejected"` for a fatal error.
 */
const startGame = async (app: ReturnType<typeof createTimedGame>) => {
  const ended = { value: "running" };

  await app.start();
  app.flow.run().then(
    () => {
      ended.value = "resolved";
    },
    () => {
      ended.value = "rejected";
    }
  );
  await tick();

  return ended;
};

/**
 * Reads one slot of the ring as plain data.
 *
 * @param ring - The ring.
 * @param slot - Index of the slot.
 * @returns The fields of that slot.
 */
const slotOf = (ring: Readonly<EdgeTiming>, slot: number) => ({
  node: ring.node[slot],
  outcome: ring.outcome[slot],
  next: ring.next[slot],
  ms: ring.ms[slot],
  commitMs: ring.commitMs[slot],
  hooksMs: ring.hooksMs[slot],
  bodyMs: ring.bodyMs[slot],
  wallMs: ring.wallMs[slot]
});

/**
 * Reads the ring of the app, failing the test when there is none.
 *
 * @param app - The app.
 * @returns The ring.
 */
const ringOf = (app: ReturnType<typeof createTimedGame>): Readonly<EdgeTiming> => {
  const ring = app.flow.edgeTimes();

  if (ring === undefined) throw new Error("The app has no edge timer.");

  return ring;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("flow.edgeTimes in an agent build", () => {
  // Bug caught: a field swapped with another, a clock read missed or moved, bodyMs measured to the body's end.
  it("times one transit edge: commit, hooks, the body's first slice and the node's stay", async () => {
    stubAgentPage();
    const app = createTimedGame();

    await startGame(app);
    app.flow.gate.answer({ intent: "play" });
    await tick();

    const ring = ringOf(app);

    // home --play--> work, work --done--> extras, the slot's done edge back home.
    expect(ring.written).toBe(3);
    // Reads: entry; stages 16; body start; slice 8; body end; after-await 32; edge start; after the
    // commit; before the emit; hook 4; after the emit. One ms a read.
    expect(slotOf(ring, 1)).toEqual({
      node: "work",
      outcome: "done",
      next: "extras",
      ms: 3 + HOOK_MS,
      commitMs: 1,
      hooksMs: 1 + HOOK_MS,
      bodyMs: 1 + SLICE_MS,
      wallMs: STAGES_MS + 1 + SLICE_MS + 1 + AFTER_AWAIT_MS + 1
    });
    expect(ring.at[1]).toBeLessThan(ring.at[2] ?? 0);
    expect(ring.at[1]).toBeGreaterThan(ring.at[0] ?? Number.POSITIVE_INFINITY);

    await app.stop();
  });

  // Bug caught: an edge no body produced carries the body or the entry of a node before it.
  it("leaves bodyMs NaN for a node without run, a slot's edge and an inbox event", async () => {
    stubAgentPage();
    const app = createTimedGame();

    await startGame(app);
    app.flow.gate.answer({ intent: "play" });
    await tick();
    app.flow.gate.answer({ intent: "wait" });
    await tick();
    app.flow.inbox.post({ type: "elapsed" });
    await tick();

    const ring = ringOf(app);
    const rested = slotOf(ring, 0);
    const slotted = slotOf(ring, 2);
    const event = slotOf(ring, 4);

    expect(ring.written).toBe(5);
    // home rests without a body: its stay is the stages and the wait.
    expect(rested).toMatchObject({ node: "home", outcome: "play", next: "work" });
    expect(rested.bodyMs).toBeNaN();
    expect(rested.wallMs).toBe(STAGES_MS + 1);
    // The slot is no node entry: neither a body nor a stay.
    expect(slotted).toMatchObject({ node: "extras", outcome: "done", next: "home" });
    expect(slotted.bodyMs).toBeNaN();
    expect(slotted.wallMs).toBeNaN();
    // The rest body ran, but the event ended the node: no body for its edge.
    expect(event).toMatchObject({ node: "lobby", outcome: "elapsed", next: "home" });
    expect(event.bodyMs).toBeNaN();
    // Reads after the entry: body start, body end, edge start.
    expect(event.wallMs).toBe(STAGES_MS + 1 + SLICE_MS + 1 + 1);

    await app.stop();
  });

  // Bug caught: the timed call of the body sits outside the try, so a synchronous throw ends the
  // graph instead of failing the node; or the recovery edge after it reads the failed node's numbers.
  it("fails a node whose body throws synchronously, and its recovery edge has neither body nor stay", async () => {
    stubAgentPage();
    const app = createTimedGame(0);
    const ended = await startGame(app);

    app.flow.gate.answer({ intent: "fail" });
    await tick();

    const ring = ringOf(app);
    const recovery = slotOf(ring, 1);

    expect(ended.value).toBe("running");
    expect(app.log.trace().filter(entry => entry.event === "flow:error")).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ path: "broken", retry: false }) })
    ]);
    expect(app.flow.state().path).toBe("home");
    expect(ring.written).toBe(2);
    expect(recovery).toMatchObject({ node: "home", outcome: "recover", next: "home" });
    expect(recovery.bodyMs).toBeNaN();
    expect(recovery.wallMs).toBeNaN();

    await app.stop();
  });

  // Bug caught: the ring does not wrap (a slot past 255 is dropped or the string columns grow), or wraps at the wrong length.
  it("keeps the last 256 of 300 edges: the newest in slot 299 % 256", async () => {
    stubAgentPage();
    const app = createTimedGame();

    await startGame(app);

    // Three edges an answer: home --play--> work --done--> extras --done--> home.
    for (let answer = 0; answer < 100; answer += 1) {
      app.flow.gate.answer({ intent: "play" });
      await tick();
    }

    const ring = ringOf(app);
    const newest = 299 % 256;

    expect(ring.written).toBe(300);
    expect(ring.node).toHaveLength(256);
    expect(slotOf(ring, newest)).toMatchObject({ node: "extras", outcome: "done", next: "home" });
    expect(slotOf(ring, newest - 1)).toMatchObject({ node: "work", outcome: "done" });
    expect(ring.at[newest]).toBe(Math.max(...ring.at));

    await app.stop();
  });
});

describe("flow.edgeTimes without the agent flag", () => {
  // Bug caught: a release build answers a ring, or an edge without a timer throws.
  it("answers undefined and takes the edge untimed", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", false);
    const app = createTimedGame();

    await startGame(app);
    app.flow.gate.answer({ intent: "play" });
    await tick();

    expect(app.flow.edgeTimes()).toBeUndefined();
    // The edge of work committed its merge, and the graph is back home.
    expect(app.model.store.snapshot().player).toEqual({ merges: 1 });
    expect(app.flow.state().path).toBe("home");

    await app.stop();
  });
});
