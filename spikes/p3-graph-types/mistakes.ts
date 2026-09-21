// The five author mistakes, each under @ts-expect-error so the project compiles.
// Generated from mistakes-raw.ts (same code, no expect-error comments).
import { exit, to, type } from "./graph";
import { defineFlow, defineNode } from "./example-kit";
import { awaitIntent, catchUp, giveToOrder, merge, sell, tapGenerator } from "./example-board";
import { levelFlow } from "./example-main";

const home = defineNode({ rest: true, checkpoint: true, outcomes: { play: type<{ level: number }>() } });
const result = defineNode({
  rest: true,
  input: type<{ stars: number; moves: number }>(),
  outcomes: { next: type() },
});

// (1) an outcome with no edge: awaitIntent.sell is missing
export const m1 = defineFlow("m1", {
  outcomes: { talk: type(), shop: type() },
  nodes: { catchUp, awaitIntent, merge, tapGenerator, giveToOrder, sell },
  start: "catchUp",
  edges: {
    catchUp: { done: "awaitIntent" },
    // @ts-expect-error deliberate mistake, see mistakes-raw.ts for the real message
    awaitIntent: {
      merge: "merge", tapGenerator: "tapGenerator", giveToOrder: "giveToOrder",
      elapsed: "catchUp", talk: exit("talk"), shop: exit("shop"),
    },
    merge: { done: "awaitIntent", rejected: "awaitIntent" },
    tapGenerator: { done: "awaitIntent", noEnergy: "awaitIntent", boardFull: "awaitIntent" },
    giveToOrder: { done: "awaitIntent", orderComplete: "awaitIntent" },
    sell: { done: "awaitIntent" },
  },
});

// (2) a target node name with a typo: "awaitIntnet"
export const m2 = defineFlow("m2", {
  outcomes: { talk: type(), shop: type() },
  nodes: { catchUp, awaitIntent, merge, tapGenerator, giveToOrder, sell },
  start: "catchUp",
  edges: {
    catchUp: { done: "awaitIntent" },
    awaitIntent: {
      merge: "merge", tapGenerator: "tapGenerator", giveToOrder: "giveToOrder", sell: "sell",
      elapsed: "catchUp", talk: exit("talk"), shop: exit("shop"),
    },
    // @ts-expect-error deliberate mistake, see mistakes-raw.ts for the real message
    merge: { done: "awaitIntnet", rejected: "awaitIntent" },
    tapGenerator: { done: "awaitIntent", noEnergy: "awaitIntent", boardFull: "awaitIntent" },
    giveToOrder: { done: "awaitIntent", orderComplete: "awaitIntent" },
    sell: { done: "awaitIntent" },
  },
});

// (3) payload mismatch: level.win carries { stars }, result wants { stars, moves }
export const m3 = defineFlow("m3", {
  nodes: { home, level: levelFlow, result },
  start: "home",
  edges: {
    home: { play: "level" },
    // @ts-expect-error deliberate mistake, see mistakes-raw.ts for the real message
    level: { win: "result", lose: "home", quit: "home" },
    result: { next: "home" },
  },
});

// (4) out.won() where `won` is not declared
export const m4 = defineNode({
  outcomes: { win: type(), lose: type() },
  // @ts-expect-error deliberate mistake, see mistakes-raw.ts for the real message
  run: ({ player, out }) => (player.lives > 0 ? out.won() : out.lose()),
});

// (5) a sub-flow used as a node whose declared outcome `quit` has no edge in the parent
export const m5 = defineFlow("m5", {
  nodes: { home, level: levelFlow, result },
  start: "home",
  edges: {
    home: { play: "level" },
    // @ts-expect-error deliberate mistake, see mistakes-raw.ts for the real message
    level: { win: to("result", (w: { stars: number }) => ({ ...w, moves: 0 })), lose: "home" },
    result: { next: "home" },
  },
});
