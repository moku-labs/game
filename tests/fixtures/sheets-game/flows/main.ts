/**
 * @file The main flow: the ward and the board, the shop as a sub-flow, the case file and the inspection opened by a
 * transit node and waited on by a rest node, and `closeSheet`, which goes back to the scene the player is in.
 */
import { defineFlow } from "../kit";
import { board, toBoard, toWard, ward } from "../nodes/scenes";
import { casefile, closeSheet, inspect, openCase, openInspect, page } from "../nodes/sheets";
import { shoppingFlow } from "./shopping";

export const mainFlow = defineFlow("main", {
  nodes: {
    ward,
    board,
    toBoard,
    toWard,
    shopping: shoppingFlow,
    openCase,
    casefile,
    openInspect,
    inspect,
    page,
    closeSheet
  },
  start: "ward",
  edges: {
    ward: { shop: "shopping", casefile: "openCase", inspect: "openInspect", board: "toBoard" },
    board: { shop: "shopping", ward: "toWard" },
    toBoard: { done: "board" },
    toWard: { done: "ward" },
    shopping: { close: "closeSheet" },
    openCase: { done: "casefile" },
    casefile: { close: "closeSheet" },
    openInspect: { done: "inspect" },
    inspect: { page: "page", close: "closeSheet" },
    page: { done: "inspect" },
    closeSheet: { ward: "ward", board: "board" }
  }
});
