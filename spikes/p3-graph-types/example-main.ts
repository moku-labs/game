import { exit, slot, to, type } from "./graph";
import { defineFlow, defineNode, popup } from "./example-kit";
import { boardFlow } from "./example-board";

// ------------------------------------------------ level: a sub-flow used as a node

const prepare = defineNode({
  input: type<{ level: number }>(),
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.visits += 1;
    return out.done();
  },
});

const play = defineNode({
  rest: true,
  checkpoint: true,
  outcomes: { win: type<{ stars: number; moves: number }>(), lose: type(), quit: type(), openBoard: type() },
});

export const levelFlow = defineFlow("level", {
  input: type<{ level: number }>(),
  outcomes: { win: type<{ stars: number }>(), lose: type(), quit: type() },
  nodes: { prepare, play, board: boardFlow },
  start: "prepare",
  edges: {
    prepare: { done: "play" },
    play: { win: exit("win"), lose: exit("lose"), quit: exit("quit"), openBoard: "board" },
    board: { talk: "play", shop: "play" },
  },
});

// ------------------------------------------------ main flow nodes

const boot = defineNode({ outcomes: { done: type() }, run: ({ out }) => out.done() });

const splash = defineNode({
  rest: true,
  outcomes: { done: type() },
  run: async ({ fx, out }) => {
    await fx(popup("Splash", ["tap"]));
    return out.done();
  },
});

const loadCore = defineNode({
  outcomes: { done: type(), failed: type<{ reason: string }>() },
  run: ({ now, out }) => (now < 0 ? out.failed({ reason: "clock" }) : out.done()),
});

const home = defineNode({
  rest: true,
  checkpoint: true,
  outcomes: { play: type(), shop: type(), settings: type() },
});

const checkLives = defineNode({
  outcomes: { ok: type<{ level: number }>(), none: type<{ nextLifeAt: number }>() },
  run: ({ player, now, out }) =>
    player.lives > 0 ? out.ok({ level: player.level }) : out.none({ nextLifeAt: now + 60_000 }),
});

const noLives = defineNode({
  rest: true,
  over: true,
  input: type<{ nextLifeAt: number }>(),
  inbox: ["elapsed"],
  outcomes: { close: type(), shop: type(), elapsed: type<{ now: number }>() },
});

const afterWin = slot("afterWin");

const retry = defineNode({
  rest: true,
  over: true,
  input: type<{ why: string }>(),
  outcomes: { again: type(), home: type() },
  run: async ({ fx, out }) => ((await fx(popup("Retry", ["again", "home"]))) === "again" ? out.again() : out.home()),
});

const shop = defineNode({
  rest: true,
  outcomes: { close: type(), bought: type<{ sku: string }>() },
});

const settings = defineNode({ rest: true, outcomes: { close: type() } });

export const mainFlow = defineFlow("main", {
  nodes: { boot, splash, loadCore, home, checkLives, noLives, level: levelFlow, afterWin, retry, shop, settings },
  start: "boot",
  edges: {
    boot: { done: "splash" },
    splash: { done: "loadCore" },
    loadCore: { done: "home", failed: to("retry", (f: { reason: string }) => ({ why: f.reason })) },
    home: { play: "checkLives", shop: "shop", settings: "settings" },
    checkLives: { ok: "level", none: "noLives" },
    noLives: { close: "home", shop: "shop", elapsed: "checkLives" },
    level: { win: "afterWin", lose: to("retry", () => ({ why: "lose" })), quit: "home" },
    afterWin: { done: "home" },
    retry: { again: "checkLives", home: "home" },
    shop: { close: "home", bought: "home" },
    settings: { close: "home" },
  },
});

// A flow with input/outcomes is a node: a one-node wrapper proves nesting composes.
export const appFlow = defineFlow("app", {
  nodes: { main: mainFlow },
  start: "main",
  edges: { main: {} },
});

