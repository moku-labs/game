import { describe, expectTypeOf, it } from "vitest";
import { createApp } from "../../../../index";
import { flowFor } from "../../feature";
import { defineFlow, defineNode, exit, to, type } from "../../runner/define";

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
      player: {};
      session: {};
      scenes: "home" | "board";
    }>();

    const board = typedNode({ scene: "board", rest: true, outcomes: { play: type() } });

    expectTypeOf(board.scene).toEqualTypeOf<string | undefined>(); // the definition stays loose for the runner
    // @ts-expect-error — "shop" is not a scene of this game
    typedNode({ scene: "shop", rest: true, outcomes: { play: type() } });
  });

  it("accepts any string when the game declares no scenes", () => {
    const { defineNode: looseNode } = flowFor<{ player: {}; session: {} }>();

    expectTypeOf(looseNode({ scene: "anything", rest: true, outcomes: {} })).toHaveProperty(
      "scene"
    );
  });
});
