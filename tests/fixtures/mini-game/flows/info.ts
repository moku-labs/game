/**
 * @file The info popup as a sub-flow: `show` opens the popup, OK goes through `count`, and the
 * flow leaves with `ok` or `close`. The id is not "info": that is the name of the feature, and a
 * feature and a flow share one namespace. The node that holds the sub-flow in the main flow is
 * called `info`.
 */
import { exit, type } from "@moku-labs/game";
import { defineFlow } from "../kit";
import { count } from "../nodes/count";
import { show } from "../nodes/show";

export const infoFlow = defineFlow("infoPopup", {
  nodes: { show, count },
  start: "show",
  outcomes: { ok: type(), close: type() },
  edges: {
    show: { ok: "count", close: exit("close") },
    count: { done: exit("ok") }
  }
});
