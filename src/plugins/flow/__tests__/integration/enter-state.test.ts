import type { AnyPluginInstance } from "@moku-labs/core";
import { describe, expect, it } from "vitest";
import {
  createApp,
  createPlugin,
  defineGame,
  flowPlugin,
  modelPlugin,
  type
} from "../../../../index";
import { fakeClock } from "../../../clock/fake";
import { memory } from "../../../model/store/providers/memory";
import type { Json } from "../../../model/types";

// ---------------------------------------------------------------------------
// Integration: the state the `onEnter` stages of a node read. The real time, lifecycle, model,
// clock and flow plugins; a test plugin records `model.store.snapshot().session` at every `load`
// stage, per path. Scenes and assets read the same snapshot in their stages.
// ---------------------------------------------------------------------------

type Seen = { path: string; session: Json };

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * A plugin that writes down the session every `load` stage reads, with the path of the node.
 *
 * @returns The plugin and what its stage saw.
 */
function stageLog(): { plugin: AnyPluginInstance; seen: Seen[] } {
  const seen: Seen[] = [];
  const plugin = createPlugin("stageLog", {
    depends: [flowPlugin, modelPlugin],
    onInit: ctx => {
      const model = ctx.require(modelPlugin);

      ctx.require(flowPlugin).onEnter("load", node => {
        seen.push({ path: node.path, session: structuredClone(model.store.snapshot().session) });
      });
    }
  });

  return { plugin, seen };
}

/**
 * The sessions the stages of one path read, in order.
 *
 * @param seen - What the stage log saw.
 * @param path - The path of the node.
 * @returns The sessions read at that path.
 */
const sessionsAt = (seen: readonly Seen[], path: string): Json[] =>
  seen.filter(entry => entry.path === path).map(entry => entry.session);

// ─── a game that counts the visits of its board ───────────────

const visits = defineGame<{
  player: { coins: number };
  session: { visits: number };
  assets: string;
  strings: Record<string, unknown>;
}>();

const home = visits.defineNode({ rest: true, checkpoint: true, outcomes: { play: type() } });

const count = visits.defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.visits += 1;

    return out.done();
  }
});

const board = visits.defineNode({ rest: true, checkpoint: true, outcomes: { leave: type() } });

const visitsFlow = visits.defineFlow("visits", {
  nodes: { home, count, board },
  start: "home",
  edges: { home: { play: "count" }, count: { done: "board" }, board: { leave: "home" } }
});

// ─── a game whose board transition fails on every attempt ─────

const match = defineGame<{
  player: { coins: number };
  session: { screen: "home" | "board"; marks: number };
  assets: string;
  strings: Record<string, unknown>;
}>();

const menu = match.defineNode({
  rest: true,
  checkpoint: true,
  outcomes: { play: type(), mark: type() },
  recover: ({ session }) => {
    session.screen = "home";
    session.marks = 0;
  }
});

const enterBoard = match.defineNode({
  outcomes: { entered: type() },
  run: ({ session, out }) => {
    session.screen = "board";
    session.marks = 1;

    return out.entered();
  }
});

const turn = match.defineNode({ rest: true, outcomes: { mark: type() } });

const placeMark = match.defineNode({
  outcomes: { placed: type() },
  run: () => {
    throw new Error("the board broke");
  }
});

const matchFlow = match.defineFlow("match", {
  nodes: { home: menu, enterBoard, turn, placeMark },
  start: "home",
  edges: {
    home: { play: "enterBoard", mark: "placeMark" },
    enterBoard: { entered: "turn" },
    turn: { mark: "placeMark" },
    placeMark: { placed: "turn" }
  }
});

describe("the state a stage reads", () => {
  it("the stages of a restored node read the bookmark's state", async () => {
    const log = stageLog();
    const app = createApp({
      plugins: [log.plugin],
      pluginConfigs: {
        model: {
          playerProvider: memory(),
          seed: 7,
          initialPlayer: { coins: 0 },
          initialSession: { visits: 0 }
        },
        clock: { source: fakeClock(1000) },
        flow: { mainFlow: visitsFlow }
      }
    });

    await app.start();
    app.flow.run().catch(() => undefined);
    await app.flow.walk([{ at: "home", intent: "play" }]);
    const atFirstVisit = app.flow.bookmark();
    await app.flow.walk([
      { at: "board", intent: "leave" },
      { at: "home", intent: "play" }
    ]);
    expect(app.model.store.snapshot().session).toEqual({ visits: 2 });
    log.seen.length = 0;

    await app.flow.restore(atFirstVisit);
    await app.flow.walk([]);

    expect(sessionsAt(log.seen, "board")).toEqual([{ visits: 1 }]);

    await app.stop();
  });

  it("the stages of the safe node read the state its recover committed", async () => {
    const log = stageLog();
    const app = createApp({
      plugins: [log.plugin],
      pluginConfigs: {
        model: {
          playerProvider: memory(),
          seed: 7,
          initialPlayer: { coins: 0 },
          initialSession: { screen: "home", marks: 0 }
        },
        clock: { source: fakeClock(1000) },
        flow: { mainFlow: matchFlow, safeNode: "home" }
      }
    });

    // The board rests with its own session, placeMark fails, is retried and fails again: the
    // loop gives up and enters the safe node home.
    await app.start();
    app.flow.run().catch(() => undefined);
    await tick();
    app.flow.gate.answer({ intent: "play" });
    await tick();
    app.flow.gate.answer({ intent: "mark" });
    await tick();
    app.flow.gate.answer({ intent: "mark" });
    await tick();

    expect(app.flow.state().path).toBe("home");
    // The rollback returned to the board's session, { screen: "board", marks: 1 }: recover put it right.
    expect(sessionsAt(log.seen, "home").at(-1)).toEqual({ screen: "home", marks: 0 });

    await app.stop();
  });
});
