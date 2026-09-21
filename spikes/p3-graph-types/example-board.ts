import { exit, to, type } from "./graph";
import { defineFlow, defineNode, popup, type CellId, type ItemId } from "./example-kit";

export const catchUp = defineNode({
  outcomes: { done: type() },
  run: ({ player, now, out }) => {
    player.wallet.energy = Math.min(100, player.wallet.energy + (now % 5));
    return out.done();
  },
});

/** Rest node without `run`: a gate answer whose intent names an outcome becomes that outcome. */
export const awaitIntent = defineNode({
  rest: true,
  checkpoint: true,
  inbox: ["elapsed"],
  outcomes: {
    merge: type<{ from: CellId; to: CellId }>(),
    tapGenerator: type<{ id: CellId }>(),
    giveToOrder: type<{ item: ItemId; order: number }>(),
    sell: type<{ item: ItemId }>(),
    elapsed: type<{ now: number }>(),
    talk: type(),
    shop: type(),
  },
});

export const merge = defineNode({
  input: type<{ from: CellId; to: CellId }>(),
  outcomes: { done: type(), rejected: type() },
  run: ({ player, input, out }) => {
    if (player.board[input.from] !== player.board[input.to]) return out.rejected();
    delete player.board[input.from];
    return out.done();
  },
});

export const tapGenerator = defineNode({
  input: type<{ id: CellId }>(),
  outcomes: { done: type(), noEnergy: type<{ missing: number }>(), boardFull: type() },
  run: ({ player, input, rng, out }) => {
    if (player.wallet.energy < 1) return out.noEnergy({ missing: 1 });
    if (Object.keys(player.board).length >= 63) return out.boardFull();
    player.board[`c${rng.stream(`gen:${input.id}`).int(0, 62)}`] = "seed";
    return out.done();
  },
});

export const giveToOrder = defineNode({
  input: type<{ item: ItemId; order: number }>(),
  outcomes: { done: type(), orderComplete: type<{ rewardId: string }>() },
  run: ({ player, input, fx, out }) => {
    fx.emit({ kind: "gave", data: input });
    if (input.order % 2 === 0) return out.done();
    player.unseen.push(`reward:${input.order}`);
    return out.orderComplete({ rewardId: `reward:${input.order}` });
  },
});

export const sell = defineNode({
  input: type<{ item: ItemId }>(),
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.wallet.coins += 1;
    return out.done();
  },
});

export const orderReward = defineNode({
  rest: true,
  over: true,
  input: type<{ rewardId: string; doubled: boolean }>(),
  outcomes: { claim: type(), double: type<{ rewardId: string }>() },
  run: async ({ fx, input, out }) => {
    const pick = await fx(popup("RewardPopup", ["claim", "double"]));
    return pick === "claim" ? out.claim() : out.double({ rewardId: input.rewardId });
  },
});

export const noEnergy = defineNode({
  rest: true,
  over: true,
  input: type<{ missing: number }>(),
  outcomes: { close: type(), shop: type() },
  run: async ({ fx, out }) => ((await fx(popup("NoEnergy", ["close", "shop"]))) === "shop" ? out.shop() : out.close()),
});

export const boardFlow = defineFlow("board", {
  outcomes: { talk: type(), shop: type() },
  nodes: { catchUp, awaitIntent, merge, tapGenerator, giveToOrder, sell, orderReward, noEnergy },
  start: "catchUp",
  edges: {
    catchUp: { done: "awaitIntent" },
    awaitIntent: {
      merge: "merge", tapGenerator: "tapGenerator", giveToOrder: "giveToOrder", sell: "sell",
      elapsed: "catchUp", talk: exit("talk"), shop: exit("shop"),
    },
    merge: { done: "awaitIntent", rejected: "awaitIntent" },
    tapGenerator: { done: "awaitIntent", noEnergy: "noEnergy", boardFull: "awaitIntent" },
    giveToOrder: { done: "awaitIntent", orderComplete: to("orderReward", (r: { rewardId: string }) => ({ rewardId: r.rewardId, doubled: false })) },
    sell: { done: "awaitIntent" },
    orderReward: { claim: "awaitIntent", double: to("orderReward", (r: { rewardId: string }) => ({ ...r, doubled: true })) },
    noEnergy: { close: "awaitIntent", shop: exit("shop") },
  },
});
