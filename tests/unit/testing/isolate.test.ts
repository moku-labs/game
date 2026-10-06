import type { Flow, Model } from "@moku-labs/game";
import { defineGame, exit, type } from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import { harnessOf, isolate, stub, withStubs } from "../../../src/testing/isolate";

// ---------------------------------------------------------------------------
// Unit test: the pieces of `isolate` over hand-written flows. A stub is data, the stubbed flow and
// the harness main flow are data too, so nothing here starts an app.
// ---------------------------------------------------------------------------

type Player = { energy: number; coins: number };
type Session = { visits: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, never>;
}>();

// The settings popup of another feature, held by the board as a node.
const open = defineNode({ rest: true, outcomes: { close: type() } });
const settingsFlow = defineFlow("settingsPopup", {
  nodes: { open },
  start: "open",
  outcomes: { closed: type() },
  edges: { open: { close: exit("closed") } }
});

const awaitIntent = defineNode({
  rest: true,
  checkpoint: true,
  outcomes: { give: type<{ orderId: string }>(), openSettings: type(), leave: type() }
});
// A rest node of another feature: a popup that waits for the player.
const energy = defineNode({ rest: true, over: true, outcomes: { watch: type(), later: type() } });
const giveToOrder = defineNode({
  input: type<{ orderId: string }>(),
  outcomes: { done: type(), orderComplete: type<{ rewardId: string }>() },
  run: ({ out }) => out.orderComplete({ rewardId: "real" })
});
const boardFlow = defineFlow("board", {
  nodes: { awaitIntent, energy, giveToOrder, settings: settingsFlow },
  start: "awaitIntent",
  outcomes: { orderComplete: type<{ rewardId: string }>(), left: type() },
  edges: {
    awaitIntent: { give: "giveToOrder", openSettings: "settings", leave: exit("left") },
    energy: { watch: "awaitIntent", later: "awaitIntent" },
    giveToOrder: { done: "awaitIntent", orderComplete: exit("orderComplete") },
    settings: { closed: "awaitIntent" }
  }
});

// A flow without outcomes, as a main-like flow is.
const home = defineNode({ rest: true, outcomes: { stay: type() } });
const homeFlow = defineFlow("home", {
  nodes: { home },
  start: "home",
  edges: { home: { stay: "home" } }
});

/** The board flow widened: every key and outcome compiles, so the runtime checks are reached. */
const wideBoard: Flow.AnyFlow = boardFlow;

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Model.Json = null;

/** The context a stub's node ignores. */
const anyContext = {} as Flow.AnyNodeContext;

/**
 * Reads one entry of a flow as a sub-flow, failing the test when it is not one.
 *
 * @param flow - The flow that holds the entry.
 * @param name - The node name.
 * @returns The sub-flow.
 */
function subFlowAt(flow: Flow.AnyFlow, name: string): Flow.AnyFlow {
  const entry = flow.nodes[name];

  if (entry?.kind !== "flow") throw new Error(`"${name}" is not a sub-flow`);

  return entry;
}

/**
 * Reads one entry of a flow as a node, failing the test when it is not one.
 *
 * @param flow - The flow that holds the entry.
 * @param name - The node name.
 * @returns The node.
 */
function nodeAt(flow: Flow.AnyFlow, name: string): Flow.AnyNode {
  const entry = flow.nodes[name];

  if (entry?.kind !== "node") throw new Error(`"${name}" is not a node`);

  return entry;
}

describe("stub", () => {
  it("is plain data: the outcome, and no payload key without a payload", () => {
    const closed = stub("closed");

    expect(closed).toEqual({ kind: "stub", outcome: "closed" });
    expect(Object.hasOwn(closed, "payload")).toBe(false);
  });

  it("carries the payload of an outcome with data", () => {
    expect(stub("orderComplete", { rewardId: "r1" })).toEqual({
      kind: "stub",
      outcome: "orderComplete",
      payload: { rewardId: "r1" }
    });
  });
});

describe("withStubs", () => {
  it("replaces a node by key with the sub-flow stub:<key>: one transit node end", () => {
    const stubbed = subFlowAt(withStubs(boardFlow, { energy: stub("later") }), "energy");
    const end = nodeAt(stubbed, "end");

    expect(stubbed.id).toBe("stub:energy");
    expect(stubbed.start).toBe("end");
    expect(Object.keys(stubbed.nodes)).toEqual(["end"]);
    expect(end.rest).toBe(false);
    expect(end.checkpoint).toBe(false);
  });

  it("ends with the stub's outcome, and null for a stub without payload", async () => {
    const plain = nodeAt(
      subFlowAt(withStubs(boardFlow, { energy: stub("later") }), "energy"),
      "end"
    );
    const paid = nodeAt(
      subFlowAt(
        withStubs(boardFlow, { giveToOrder: stub("orderComplete", { rewardId: "r1" }) }),
        "giveToOrder"
      ),
      "end"
    );

    expect(await plain.run?.(anyContext)).toEqual({ outcome: "later", payload: noPayload });
    expect(await paid.run?.(anyContext)).toEqual({
      outcome: "orderComplete",
      payload: { rewardId: "r1" }
    });
  });

  it("copies input and outcomes of the replaced node, and leaves through every outcome", () => {
    const stubbed = subFlowAt(withStubs(boardFlow, { giveToOrder: stub("done") }), "giveToOrder");

    expect(stubbed.input).toBe(giveToOrder.input);
    expect(stubbed.outcomes).toBe(giveToOrder.outcomes);
    expect(nodeAt(stubbed, "end").input).toBe(giveToOrder.input);
    expect(stubbed.edges).toEqual({
      end: { done: exit("done"), orderComplete: exit("orderComplete") }
    });
  });

  it("copies input and outcomes of a replaced sub-flow", () => {
    const stubbed = subFlowAt(withStubs(boardFlow, { settings: stub("closed") }), "settings");

    expect(stubbed.id).toBe("stub:settings");
    expect(stubbed.input).toBe(settingsFlow.input);
    expect(stubbed.outcomes).toBe(settingsFlow.outcomes);
    expect(stubbed.edges).toEqual({ end: { closed: exit("closed") } });
  });

  it("keeps every other entry and leaves the original flow untouched", () => {
    const stubbed = withStubs(boardFlow, { energy: stub("later"), settings: stub("closed") });

    expect(stubbed).not.toBe(boardFlow);
    expect(stubbed.id).toBe("board");
    expect(stubbed.start).toBe("awaitIntent");
    expect(stubbed.edges).toBe(boardFlow.edges);
    expect(stubbed.nodes.awaitIntent).toBe(awaitIntent);
    expect(stubbed.nodes.giveToOrder).toBe(giveToOrder);
    expect(boardFlow.nodes.energy).toBe(energy);
    expect(boardFlow.nodes.settings).toBe(settingsFlow);
  });

  it("returns the flow itself when nothing is stubbed", () => {
    expect(withStubs(boardFlow, {})).toBe(boardFlow);
  });

  it("stubs nothing for a key whose stub is undefined", () => {
    expect(withStubs(boardFlow, { energy: undefined })).toBe(boardFlow);
    expect(withStubs(boardFlow, { energy: undefined, settings: stub("closed") }).nodes.energy).toBe(
      energy
    );
  });

  it("refuses a key that is not a node of the flow, and names the nodes", () => {
    expect(() => withStubs(wideBoard, { enrgy: stub("later") })).toThrow(
      '[game] isolate: no node "enrgy" in flow "board".\n  Stub keys are node names of the flow: awaitIntent, energy, giveToOrder, settings.'
    );
  });

  it("refuses an inherited name such as constructor", () => {
    expect(() => withStubs(wideBoard, { constructor: stub("later") })).toThrow(
      '[game] isolate: no node "constructor" in flow "board".'
    );
  });

  it("refuses an outcome the replaced entry does not declare, and names its outcomes", () => {
    expect(() => withStubs(wideBoard, { energy: stub("done") })).toThrow(
      '[game] stub at "energy" ends with "done", which "energy" does not declare.\n  Use one of: watch, later.'
    );
  });
});

describe("harnessOf", () => {
  it("holds a flow with outcomes under its id and sends every exit to the rest node exited", () => {
    const harness = harnessOf(boardFlow);

    expect(harness.id).toBe("isolated");
    expect(harness.outcomes).toEqual({});
    expect(harness.start).toBe("board");
    expect(harness.nodes.board).toBe(boardFlow);
    expect(harness.edges).toEqual({
      board: { orderComplete: "exited", left: "exited" },
      exited: { again: "board" }
    });
    expect(nodeAt(harness, "exited")).toMatchObject({
      kind: "node",
      rest: true,
      checkpoint: false,
      outcomes: { again: { kind: "type" } }
    });
    expect(nodeAt(harness, "exited").run).toBeUndefined();
  });

  it("names the node by the given key, the one the game's main flow holds the flow under", () => {
    const harness = harnessOf(settingsFlow, "settings");

    expect(harness.start).toBe("settings");
    expect(harness.nodes.settings).toBe(settingsFlow);
    expect(harness.edges).toEqual({
      settings: { closed: "exited" },
      exited: { again: "settings" }
    });
  });

  it("has no exited node for a flow without outcomes", () => {
    const harness = harnessOf(homeFlow);

    expect(Object.keys(harness.nodes)).toEqual(["home"]);
    expect(harness.edges).toEqual({ home: {} });
  });

  it("refuses the key exited for a flow with outcomes: the harness's own rest node has it", () => {
    expect(() => harnessOf(boardFlow, "exited")).toThrow(
      '[game] isolate: "exited" is the rest node of the harness.\n  Pass another name in as.'
    );
  });
});

describe("isolate", () => {
  const boardFeature = defineFeature("boardScreen", { flows: [boardFlow] });
  const fresh: Player = { energy: 1, coins: 0 };

  it("refuses a wrong stub when it is called, before any app exists", () => {
    expect(() =>
      isolate(boardFeature, { flow: wideBoard, stubs: { enrgy: stub("later") }, player: fresh })
    ).toThrow('[game] isolate: no node "enrgy" in flow "board".');
    expect(() =>
      isolate(boardFeature, { flow: wideBoard, stubs: { energy: stub("done") }, player: fresh })
    ).toThrow('[game] stub at "energy" ends with "done", which "energy" does not declare.');
  });

  it("returns a factory of apps that are not started", () => {
    const boardOnly = isolate(boardFeature, { flow: boardFlow, player: fresh });
    const app = boardOnly();

    expect(app.flow.state().running).toBe(false);
    expect(boardOnly()).not.toBe(app);
  });
});
