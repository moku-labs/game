import { describe, expect, it } from "vitest";
import { createApp, defineGame, guide, type } from "../../../../index";
import { fakeClock } from "../../../clock/fake";
import { memory } from "../../../model/store/providers/memory";
import type { Descriptor, NodeFx } from "../../fx/types";
import type { AnyFlow } from "../../runner/types";

// ---------------------------------------------------------------------------
// Integration (F206): a node's return closes the popups it left open, and `fx.cancel` ends one
// awaited effect early. The real time, lifecycle, model, clock and flow plugins, in live mode:
// `flow.run()` calls the popup handler, a fast walk would not.
// ---------------------------------------------------------------------------

type Player = { coins: number };
type Session = { opened: number };

const { defineNode, defineFlow } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/** A popup the player closes with "ok". */
const notice: Descriptor = { kind: "popup", payload: { name: "Notice" }, answers: ["ok"] };

/** A second popup, with an intent of its own. */
const confirm: Descriptor = { kind: "popup", payload: { name: "Confirm" }, answers: ["yes"] };

/**
 * What the handlers were shown: the signal of each popup, how many abort events fired on them, and
 * the signal of each `deal`, an effect without answers that never ends on its own.
 */
type Shown = { signals: AbortSignal[]; aborts: number; deals: AbortSignal[] };

/**
 * Builds the game around one main flow.
 *
 * @param mainFlow - The graph of the game.
 * @param safe - The safe node and the retry count, for a game that recovers.
 * @param safe.safeNode - The checkpoint the loop recovers in.
 * @param safe.retries - How often a failed transition is retried before the loop gives up.
 * @returns The app.
 */
const createGame = (mainFlow: AnyFlow, safe?: { safeNode: string; retries: number }) =>
  createApp({
    pluginConfigs: {
      model: {
        playerProvider: memory(),
        seed: 7,
        initialPlayer: { coins: 0 },
        initialSession: { opened: 0 }
      },
      clock: { source: fakeClock(1000) },
      flow: { mainFlow, ...safe }
    }
  });

type Game = ReturnType<typeof createGame>;

/**
 * Starts the game in live mode with a popup handler that records every signal it gets.
 *
 * @param game - The app.
 * @returns What the handler was shown, and the failure `run()` rejected with, if any.
 */
const startLive = async (game: Game) => {
  const shown: Shown = { signals: [], aborts: 0, deals: [] };
  const fatal: { error: unknown } = { error: undefined };

  await game.start();
  game.flow.fx.handle("popup", (_descriptor, { signal }) => {
    shown.signals.push(signal);
    signal.addEventListener("abort", () => {
      shown.aborts += 1;
    });
  });
  game.flow.fx.handle("deal", (_descriptor, { signal }) => {
    shown.deals.push(signal);

    return new Promise<never>(() => undefined);
  });
  game.flow.run().catch((error: unknown) => {
    fatal.error = error;
  });
  await tick();

  return { shown, fatal };
};

/** The `flow:error` entries of the log. */
const flowErrors = (game: Game) => game.log.trace().filter(entry => entry.event === "flow:error");

// ─── A: the return of a body closes its popups ────────────────

describe("a rest body that returns while its popup is open", () => {
  it("closes the popup: the next rest's gate takes an answer, nothing fails", async () => {
    const ask = defineNode({
      rest: true,
      outcomes: { opened: type() },
      run: ({ fx, out }) => {
        // Shown, not awaited: the body ends at once. The deal is not a popup and plays on.
        void fx({ kind: "deal" });
        void fx(notice);

        return out.opened();
      }
    });
    const after = defineNode({ rest: true, outcomes: { again: type() } });
    const game = createGame(
      defineFlow("ask", {
        nodes: { ask, after },
        start: "ask",
        edges: { ask: { opened: "after" }, after: { again: "ask" } }
      })
    );
    const { shown, fatal } = await startLive(game);

    expect(fatal.error).toBeUndefined();
    expect(flowErrors(game)).toEqual([]);
    expect(game.flow.state()).toMatchObject({ path: "after", pending: { gate: ["again"] } });
    // The popup layer was told to take the popup down.
    expect(shown.signals).toHaveLength(1);
    expect(shown.signals[0]?.aborted).toBe(true);
    expect(shown.deals).toHaveLength(1);
    expect(shown.deals[0]?.aborted).toBe(false);
    expect(game.flow.gate.answer({ intent: "again" })).toBe(true);

    await game.stop();
  });

  it("leaves a popup answered before the return alone: it resolves with the answer", async () => {
    const seen: { pick: unknown } = { pick: undefined };
    const ask = defineNode({
      rest: true,
      outcomes: { picked: type() },
      run: async ({ fx, out }) => {
        seen.pick = await fx(notice);

        return out.picked();
      }
    });
    const after = defineNode({ rest: true, outcomes: { again: type() } });
    const game = createGame(
      defineFlow("ask", {
        nodes: { ask, after },
        start: "ask",
        edges: { ask: { picked: "after" }, after: { again: "ask" } }
      })
    );
    const { shown, fatal } = await startLive(game);

    expect(game.flow.gate.answer({ intent: "ok" })).toBe(true);
    await tick();

    expect(fatal.error).toBeUndefined();
    expect(seen.pick).toEqual({ intent: "ok", at: 1000 });
    expect(shown.aborts).toBe(1);
    expect(game.flow.state()).toMatchObject({ path: "after", pending: { gate: ["again"] } });

    await game.stop();
  });

  it("closes the popup a recover left open: the safe node's gate opens on time", async () => {
    const home = defineNode({
      rest: true,
      checkpoint: true,
      outcomes: { go: type(), again: type() },
      recover: ({ fx }) => {
        void fx(notice);
      }
    });
    const breaks = defineNode({
      outcomes: { done: type() },
      run: () => {
        throw new Error("the board broke");
      }
    });
    const game = createGame(
      defineFlow("match", {
        nodes: { home, breaks },
        start: "home",
        edges: { home: { go: "breaks", again: "home" }, breaks: { done: "home" } }
      }),
      { safeNode: "home", retries: 0 }
    );
    const { shown, fatal } = await startLive(game);

    // `breaks` fails, the loop gives up at once and recovers in `home`.
    game.flow.gate.answer({ intent: "go" });
    await tick();

    expect(fatal.error).toBeUndefined();
    expect(shown.signals).toHaveLength(1);
    expect(shown.signals[0]?.aborted).toBe(true);
    expect(game.flow.state()).toMatchObject({ path: "home", pending: { gate: ["go", "again"] } });
    expect(game.flow.gate.answer({ intent: "again" })).toBe(true);

    await game.stop();
  });

  it("closes nothing of the next node when a body left by the inbox returns late", async () => {
    const release = Promise.withResolvers<void>();
    const wait = defineNode({
      rest: true,
      inbox: ["left"],
      outcomes: { left: type(), stayed: type() },
      run: async ({ fx, out }) => {
        void fx(notice);
        // Still running after the inbox left the node: the loop no longer waits for it.
        await release.promise;

        return out.stayed();
      }
    });
    const next = defineNode({ rest: true, outcomes: { again: type() } });
    const game = createGame(
      defineFlow("wait", {
        nodes: { wait, next },
        start: "wait",
        edges: { wait: { left: "next", stayed: "next" }, next: { again: "wait" } }
      })
    );
    const { shown, fatal } = await startLive(game);

    game.flow.inbox.post({ type: "left" });
    await tick();

    expect(game.flow.state()).toMatchObject({ path: "next", pending: { gate: ["again"] } });
    expect(shown.signals[0]?.reason).toBe("inbox");

    release.resolve();
    await tick();

    expect(fatal.error).toBeUndefined();
    expect(game.flow.state()).toMatchObject({ path: "next", pending: { gate: ["again"] } });
    expect(game.flow.gate.answer({ intent: "again" })).toBe(true);

    await game.stop();
  });
});

// ─── B: fx.cancel ends one awaited effect early ───────────────

describe("fx.cancel", () => {
  it("closes an open popup while the node stays, and a second popup takes its answer", async () => {
    const hold = Promise.withResolvers<void>();
    const probe: { cancelled?: boolean; resumed: boolean; value?: unknown; second?: unknown } = {
      resumed: false
    };
    const ask = defineNode({
      rest: true,
      outcomes: { done: type() },
      run: async ({ fx, out }) => {
        const first = fx(notice);

        probe.cancelled = fx.cancel(first);
        probe.value = await first;
        probe.resumed = true;
        await hold.promise;
        probe.second = await fx(confirm);

        return out.done();
      }
    });
    const after = defineNode({ rest: true, outcomes: { again: type() } });
    const game = createGame(
      defineFlow("ask", {
        nodes: { ask, after },
        start: "ask",
        edges: { ask: { done: "after" }, after: { again: "ask" } }
      })
    );
    const { shown, fatal } = await startLive(game);

    expect(probe).toMatchObject({ cancelled: true, resumed: true, value: undefined });
    expect(shown.signals[0]?.aborted).toBe(true);
    expect(game.flow.state().path).toBe("ask");
    expect(game.flow.gate.state().open).toBe(false);
    expect(game.flow.gate.answer({ intent: "ok" })).toBe(false);

    hold.resolve();
    await tick();

    expect(game.flow.gate.state().allowed).toEqual(["yes"]);
    expect(shown.signals).toHaveLength(2);
    expect(shown.signals[1]?.aborted).toBe(false);
    expect(game.flow.gate.answer({ intent: "yes" })).toBe(true);
    await tick();

    expect(fatal.error).toBeUndefined();
    expect(probe.second).toEqual({ intent: "yes", at: 1000 });
    expect(game.flow.state()).toMatchObject({ path: "after", pending: { gate: ["again"] } });

    await game.stop();
  });

  it("closes a popup once when the body cancels it and then returns", async () => {
    const probe: { first?: boolean; fx?: NodeFx; popup?: Promise<unknown> } = {};
    const ask = defineNode({
      rest: true,
      outcomes: { done: type() },
      run: ({ fx, out }) => {
        const popup = fx(notice);

        probe.first = fx.cancel(popup);
        probe.fx = fx;
        probe.popup = popup;

        return out.done();
      }
    });
    const after = defineNode({ rest: true, outcomes: { again: type() } });
    const game = createGame(
      defineFlow("ask", {
        nodes: { ask, after },
        start: "ask",
        edges: { ask: { done: "after" }, after: { again: "ask" } }
      })
    );
    const { shown, fatal } = await startLive(game);

    expect(fatal.error).toBeUndefined();
    expect(probe.first).toBe(true);
    expect(shown.aborts).toBe(1);
    expect(probe.popup === undefined ? undefined : probe.fx?.cancel(probe.popup)).toBe(false);
    expect(game.flow.state()).toMatchObject({ path: "after", pending: { gate: ["again"] } });

    await game.stop();
  });

  it("ends an awaited effect without answers, and refuses a guide", async () => {
    const dealt: AbortSignal[] = [];
    const probe: { deal?: boolean; dealValue?: unknown; dealResumed: boolean; guide?: boolean } = {
      dealResumed: false
    };
    const ask = defineNode({
      rest: true,
      outcomes: { done: type() },
      run: async ({ fx, out }) => {
        const dealing = fx({ kind: "deal" });

        probe.deal = fx.cancel(dealing);
        probe.dealValue = await dealing;
        probe.dealResumed = true;

        const teaching = fx(guide({ allow: { intent: "done" } }));

        probe.guide = fx.cancel(teaching);
        await teaching;

        return out.done();
      }
    });
    const after = defineNode({ rest: true, outcomes: { again: type() } });
    const game = createGame(
      defineFlow("ask", {
        nodes: { ask, after },
        start: "ask",
        edges: { ask: { done: "after" }, after: { again: "ask" } }
      })
    );

    await game.start();
    // The deal never ends on its own: only the cancel lets the body go on.
    game.flow.fx.handle("deal", (_descriptor, { signal }) => {
      dealt.push(signal);

      return new Promise<never>(() => undefined);
    });
    game.flow.run().catch(() => undefined);
    await tick();

    expect(probe).toMatchObject({ deal: true, dealResumed: true, dealValue: undefined });
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.aborted).toBe(true);
    expect(probe.guide).toBe(false);
    expect(game.flow.state()).toMatchObject({ path: "after", pending: { gate: ["again"] } });

    await game.stop();
  });
});
