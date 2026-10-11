import { describe, expectTypeOf, it } from "vitest";
import { createApp, defineGame } from "../../../../index";
import type { Json } from "../../../model/types";
import { flowFor } from "../../feature";
import { defineFlow, defineNode, exit, to, type } from "../../runner/define";
import type { Bookmark, RecoverContext } from "../../runner/types";

type Empty = Record<string, never>;

// The five author mistakes of the design context, proven in spikes/p3-graph-types/mistakes.ts.
// Each `@ts-expect-error` fails the build in both directions: the mistake must error, and a
// correct line under one of them would be reported as an unused directive.

const home = defineNode({
  rest: true,
  checkpoint: true,
  outcomes: { play: type<{ level: number }>() }
});

const result = defineNode({
  rest: true,
  input: type<{ stars: number; moves: number }>(),
  outcomes: { next: type() }
});

const play = defineNode({
  rest: true,
  input: type<{ level: number }>(),
  outcomes: { win: type<{ stars: number }>(), lose: type(), quit: type() }
});

const levelFlow = defineFlow("level", {
  input: type<{ level: number }>(),
  outcomes: { win: type<{ stars: number }>(), lose: type(), quit: type() },
  nodes: { play },
  start: "play",
  edges: { play: { win: exit("win"), lose: exit("lose"), quit: exit("quit") } }
});

const awaitIntent = defineNode({ rest: true, outcomes: { merge: type(), sell: type() } });
const merge = defineNode({ outcomes: { done: type() }, run: ({ out }) => out.done() });

// (1) an outcome with no edge: awaitIntent.sell is missing.
const missingEdge = defineFlow("missingEdge", {
  nodes: { awaitIntent, merge },
  start: "awaitIntent",
  edges: {
    // @ts-expect-error — outcome "sell" of node "awaitIntent" has no edge
    awaitIntent: { merge: "merge" },
    merge: { done: "awaitIntent" }
  }
});

// (2) a target node name with a typo.
const unknownTarget = defineFlow("unknownTarget", {
  nodes: { awaitIntent, merge },
  start: "awaitIntent",
  edges: {
    awaitIntent: { merge: "merge", sell: "merge" },
    // @ts-expect-error — no node "awaitIntnet" in this flow
    merge: { done: "awaitIntnet" }
  }
});

// (3) a payload that does not fit: level.win carries { stars }, result wants { stars, moves }.
const wrongPayload = defineFlow("wrongPayload", {
  nodes: { home, level: levelFlow, result },
  start: "home",
  edges: {
    home: { play: "level" },
    // @ts-expect-error — payload of outcome "win" does not fit the input of node "result"
    level: { win: "result", lose: "home", quit: "home" },
    result: { next: "home" }
  }
});

// (4) out.won() where `won` was never declared.
const unknownOutcome = defineNode({
  outcomes: { win: type(), lose: type() },
  // @ts-expect-error — property "won" does not exist on out
  run: ({ out }) => out.won()
});

// (5) a sub-flow used as a node whose declared outcome `quit` has no edge in the parent.
const missingSubFlowEdge = defineFlow("missingSubFlowEdge", {
  nodes: { home, level: levelFlow, result },
  start: "home",
  edges: {
    home: { play: "level" },
    // @ts-expect-error — outcome "quit" of the sub-flow "level" has no edge
    level: { win: to("result", (won: { stars: number }) => ({ ...won, moves: 0 })), lose: "home" },
    result: { next: "home" }
  }
});

// A correct graph of the same shape: the checks above reject mistakes, not the pattern.
const correct = defineFlow("correct", {
  nodes: { home, level: levelFlow, result },
  start: "home",
  edges: {
    home: { play: "level" },
    level: {
      win: to("result", (won: { stars: number }) => ({ ...won, moves: 0 })),
      lose: "home",
      quit: "home"
    },
    result: { next: "home" }
  }
});

describe("flow graph types", () => {
  it("gives a node one out method per declared outcome", () => {
    expectTypeOf(play.outcomes).toHaveProperty("win");
    expectTypeOf(unknownOutcome.kind).toEqualTypeOf<"node">();
    expectTypeOf(merge.kind).toEqualTypeOf<"node">();
  });

  it("keeps the helpers pure data", () => {
    expectTypeOf(exit("win")).toEqualTypeOf<{ readonly kind: "exit"; readonly outcome: "win" }>();
    expectTypeOf(correct.kind).toEqualTypeOf<"flow">();
  });

  it("gives the consumer onStart callback the flow API of the app", () => {
    createApp({
      onStart: context => {
        expectTypeOf(context.flow.run).toEqualTypeOf<() => Promise<void>>();
        expectTypeOf(context.flow.walk).toBeFunction();
        expectTypeOf(context.flow.gate.answer).toBeFunction();
        context.flow.run().catch(() => undefined);
      }
    });
  });

  it("checks every edge table of the five author mistakes", () => {
    expectTypeOf(missingEdge.id).toBeString();
    expectTypeOf(unknownTarget.id).toBeString();
    expectTypeOf(wrongPayload.id).toBeString();
    expectTypeOf(missingSubFlowEdge.id).toBeString();
  });
});

// A game that names its scene ids gets them checked on every node; a game that names none keeps `string`.
describe("scene ids per game", () => {
  it("refuses a scene id the game did not declare", () => {
    const { defineNode: typedNode } = flowFor<{
      player: Empty;
      session: Empty;
      scenes: "home" | "board";
    }>();

    const board = typedNode({ scene: "board", rest: true, outcomes: { play: type() } });

    expectTypeOf(board.scene).toEqualTypeOf<string | undefined>(); // the definition stays loose for the runner
    // @ts-expect-error — "shop" is not a scene of this game
    typedNode({ scene: "shop", rest: true, outcomes: { play: type() } });
  });

  it("accepts any string when the game declares no scenes", () => {
    const { defineNode: looseNode } = flowFor<{ player: Empty; session: Empty }>();

    expectTypeOf(looseNode({ scene: "anything", rest: true, outcomes: {} })).toHaveProperty(
      "scene"
    );
  });
});

// A bookmark of a transit node carries the rest point before it; a bookmark of a rest node has none.
describe("the rest point of a bookmark", () => {
  const atRest: Bookmark = {
    path: "home",
    input: {},
    player: { count: 0 },
    session: { opened: 0 },
    rng: { seed: 42, streams: {} },
    graph: "0e0d2aa8"
  };

  it("is optional on the bookmark flow.bookmark() returns", () => {
    const app = createApp();

    expectTypeOf(app.flow.bookmark().rest).toEqualTypeOf<
      { path: string; input: Json } | undefined
    >();
    expectTypeOf(app.flow.restore).parameter(0).toEqualTypeOf<Bookmark>();
  });

  it("needs a path and an input when present", () => {
    const atPopup: Bookmark = { ...atRest, path: "info/show", rest: { path: "home", input: {} } };

    expectTypeOf(atPopup.rest).toEqualTypeOf<{ path: string; input: Json } | undefined>();
    // @ts-expect-error — a rest point without its input is not one
    const broken: Bookmark = { ...atRest, rest: { path: "home" } };

    expectTypeOf(broken).toEqualTypeOf<Bookmark>();
  });
});

// `recover` belongs to a rest node: the safe node puts the state right before its gate opens.
describe("recover of a rest node", () => {
  type Match = { screen: "home" | "board"; marks: number };
  type Player = { wins: number };

  const { defineNode: gameNode } = defineGame<{
    player: Player;
    session: Match;
    assets: string;
    strings: Record<string, unknown>;
  }>();

  it("types the context with the game's session and player", () => {
    const menu = gameNode({
      rest: true,
      checkpoint: true,
      outcomes: { play: type() },
      recover: context => {
        expectTypeOf(context).toExtend<RecoverContext<{ player: Player; session: Match }>>();
        expectTypeOf(context.session).toEqualTypeOf<Match>();
        expectTypeOf(context.player).toEqualTypeOf<Player>();
        expectTypeOf(context.now).toBeNumber();
        expectTypeOf(context.signal).toEqualTypeOf<AbortSignal>();
        context.session.screen = "home";
      }
    });

    expectTypeOf(menu.recover).not.toBeUndefined();
    expectTypeOf(menu.kind).toEqualTypeOf<"node">();
  });

  it("gives the context no input and no out: a recovery has neither", () => {
    gameNode({
      rest: true,
      input: type<{ level: number }>(),
      outcomes: { play: type() },
      recover: context => {
        expectTypeOf<keyof typeof context>().toEqualTypeOf<
          "player" | "session" | "rng" | "fx" | "signal" | "now"
        >();
        expectTypeOf(context).not.toHaveProperty("input");
        expectTypeOf(context).not.toHaveProperty("out");
        // @ts-expect-error — a recovery has no input
        expectTypeOf(context.input).toBeNever();
        // @ts-expect-error — a recovery ends with no outcome
        expectTypeOf(context.out).toBeNever();
      }
    });
  });

  it("accepts an async recover, next to the body of the rest node", () => {
    const menu = gameNode({
      rest: true,
      outcomes: { play: type() },
      run: ({ out }) => out.play(),
      recover: async ({ fx, session }) => {
        await fx({ kind: "fade" });
        session.marks = 0;
      }
    });

    expectTypeOf(menu.rest).toBeBoolean();
  });

  it("is refused on a transit node", () => {
    // The compiler reports it on the whole spec: `rest: true` is missing for a spec with recover.
    // @ts-expect-error — recover belongs to a rest node
    gameNode({
      outcomes: { done: type() },
      run: ({ out }) => out.done(),
      recover: ({ session }: RecoverContext<{ player: Player; session: Match }>) => {
        session.marks = 0;
      }
    });
    // @ts-expect-error — recover belongs to a rest node, also with rest: false written out
    gameNode({
      rest: false,
      outcomes: { done: type() },
      run: ({ out }) => out.done(),
      recover: ({ session }: RecoverContext<{ player: Player; session: Match }>) => {
        session.marks = 0;
      }
    });
    // The helper without a game refuses it the same way.
    // @ts-expect-error — recover belongs to a rest node
    defineNode({
      outcomes: { done: type() },
      run: ({ out }) => out.done(),
      recover: () => undefined
    });
    // Without recover the same transit node is fine: the refusal above is about recover alone.
    expectTypeOf(
      gameNode({ outcomes: { done: type() }, run: ({ out }) => out.done() }).rest
    ).toBeBoolean();
  });
});
