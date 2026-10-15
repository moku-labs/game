/**
 * @file The sheets: a transit node writes which sheet lies over the scene, a rest node waits for its buttons, and
 * `closeSheet` takes it away and goes back to the scene the player is in.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";

/** Opens the shop. */
export const openShop = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.sheet = "shop";

    return out.done();
  }
});

/** The shop: buy, close, or the settings over it. */
export const shop = defineNode({
  rest: true,
  outcomes: { buy: type(), close: type(), settings: type() }
});

/** One energy for one gem. */
export const buy = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.energy += 1;
    player.gems -= 1;

    return out.done();
  }
});

/** Opens the settings over the shop. */
export const openSettings = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.over = "settings";

    return out.done();
  }
});

/** The settings: close only. */
export const settings = defineNode({ rest: true, outcomes: { close: type() } });

/** Closes the settings, back to the shop. */
export const closeSettings = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.over = "none";

    return out.done();
  }
});

/** Opens the case file. */
export const openCase = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.sheet = "casefile";

    return out.done();
  }
});

/** The case file: close only. */
export const casefile = defineNode({ rest: true, outcomes: { close: type() } });

/** Opens the inspection, on its window. */
export const openInspect = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.sheet = "inspect";
    session.page = false;

    return out.done();
  }
});

/** The inspection: its page, or close. */
export const inspect = defineNode({ rest: true, outcomes: { page: type(), close: type() } });

/** Opens the page of the inspection. */
export const page = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.page = true;

    return out.done();
  }
});

/** Takes the sheet away, back to the scene the player is in. */
export const closeSheet = defineNode({
  outcomes: { ward: type(), board: type() },
  run: ({ session, out }) => {
    session.sheet = "none";
    session.page = false;

    return session.at === "board" ? out.board() : out.ward();
  }
});
