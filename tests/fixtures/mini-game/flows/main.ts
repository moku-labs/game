/**
 * @file The main flow: the Home checkpoint, and the info popup as a node of it. Both outcomes of
 * the popup come back to Home.
 */
import { defineFlow } from "../kit";
import { home } from "../nodes/home";
import { infoFlow } from "./info";

export const mainFlow = defineFlow("main", {
  nodes: { home, info: infoFlow },
  start: "home",
  edges: {
    home: { info: "info" },
    info: { ok: "home", close: "home" }
  }
});
