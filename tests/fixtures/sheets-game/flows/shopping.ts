/**
 * @file The shop as a sub-flow: it opens, waits for a purchase, the settings over it or its close, and leaves with
 * `close`. The id is not "shop": that is the name of the feature, and a feature and a flow share one namespace.
 */
import { exit, type } from "@moku-labs/game";
import { defineFlow } from "../kit";
import { buy, closeSettings, openSettings, openShop, settings, shop } from "../nodes/sheets";

export const shoppingFlow = defineFlow("shopping", {
  nodes: { openShop, shop, buy, openSettings, settings, closeSettings },
  start: "openShop",
  outcomes: { close: type() },
  edges: {
    openShop: { done: "shop" },
    shop: { buy: "buy", close: exit("close"), settings: "openSettings" },
    buy: { done: "shop" },
    openSettings: { done: "settings" },
    settings: { close: "closeSettings" },
    closeSettings: { done: "shop" }
  }
});
