/**
 * @file The stress bench as a feature: a graph of one rest node and five transit nodes, each a commit a real game
 * makes in its heaviest moments (a peek, a turn, a popup open, a popup close, a merge), one scene, and its screens.
 */
import { Frost, type } from "../../../../src/index.ts";
import {
  defineEmitter,
  defineFeature,
  defineFlow,
  defineNode,
  defineScene,
  defineTextStyles
} from "../../kit";
import { uiAssets } from "../ui/assets";
import { boardCells, boardMarks, boardPictures, boardRings, boardShadows } from "./board";
import { albumSheet, hud, popups } from "./views";

/** The rest node the bench stands on: the driver answers its gate. */
const stage = defineNode({
  scene: "stress",
  outcomes: { peek: type(), turn: type(), open: type(), close: type(), merge: type() },
  rest: true,
  checkpoint: true
});

/** A peek: the next set comes into the strip beside the one on show, as the first frame of a drag asks. */
const peek = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.beside = (session.on + 1) % session.sets;
    session.side = 1;

    return out.done();
  }
});

/** A turn: the set beside comes on show, the one left stays in the strip on the left. */
const turn = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    const left = session.on;

    session.on = (session.on + 1) % session.sets;
    session.beside = left;
    session.side = -1;

    return out.done();
  }
});

/** A popup opens, over the one that stands when there is one. */
const open = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.popups = Math.min(2, session.popups + 1);

    return out.done();
  }
});

/** The top popup closes. */
const close = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.popups = Math.max(0, session.popups - 1);

    return out.done();
  }
});

/** A merge: two items leave the board and one comes. */
const merge = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.merges += 1;

    return out.done();
  }
});

export const stressFlow = defineFlow("main", {
  nodes: { stage, peek, turn, open, close, merge },
  start: "stage",
  edges: {
    stage: { peek: "peek", turn: "turn", open: "open", close: "close", merge: "merge" },
    peek: { done: "stage" },
    turn: { done: "stage" },
    open: { done: "stage" },
    close: { done: "stage" },
    merge: { done: "stage" }
  }
});

/** The sparkle of a board mark, as the game's producers carry: 6 a second, at most 10 alive. */
const sparkle = defineEmitter("fx.sparkle", {
  textures: ["ui.fx-spark"],
  rate: 6,
  lifeMs: [1200, 1500],
  speed: [10, 30],
  scale: { from: 0.25, to: 0.1 },
  alpha: { from: 1, to: 0 },
  maxParticles: 10
});

const scene = defineScene("stress", {
  bundle: "ui",
  layers: { board: { sort: "none" } },
  projections: [
    boardCells,
    boardShadows,
    boardPictures,
    boardRings,
    boardMarks,
    hud,
    albumSheet,
    popups
  ]
});

export const stressFeature = defineFeature("stressScreens", {
  scenes: [scene],
  projections: [
    boardCells,
    boardShadows,
    boardPictures,
    boardRings,
    boardMarks,
    hud,
    albumSheet,
    popups
  ],
  emitters: [sparkle],
  filters: [Frost],
  textStyles: defineTextStyles({
    "s.title": {
      font: "ui.font-body",
      size: 20,
      fill: 0x33_22_2a,
      letterSpacing: -0.3,
      wrap: "box"
    },
    "s.name": { font: "ui.font-body", size: 11, fill: 0x55_44_4a, wrap: "box" },
    "s.pill": { font: "ui.font-body", size: 13, fill: 0xff_ff_ff, digits: true }
  }),
  assets: uiAssets
});
