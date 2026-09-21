import { describe, expect, it } from "vitest";
import type { Contribution, FeaturesApi } from "../../features/types";
import { collectFlows } from "../../runner/registry";
import type {
  AnyFlow,
  AnyNode,
  AnyTypeTag,
  FlowEntry,
  OutcomeTags,
  SlotNode,
  Target
} from "../../runner/types";
import { validateGraph } from "../../runner/validate";
import type { Config } from "../../types";

const tag: AnyTypeTag = { kind: "type" };

const tags = (names: readonly string[]): OutcomeTags => {
  const table: Record<string, AnyTypeTag> = {};
  for (const name of names) table[name] = tag;
  return table;
};

type NodeOptions = {
  outcomes?: readonly string[];
  rest?: boolean;
  checkpoint?: boolean;
  barrier?: boolean;
  inbox?: readonly string[];
  run?: boolean;
};

const node = (options: NodeOptions = {}): AnyNode => ({
  kind: "node",
  input: tag,
  outcomes: tags(options.outcomes ?? ["done"]),
  rest: options.rest ?? false,
  over: false,
  checkpoint: options.checkpoint ?? false,
  barrier: options.barrier ?? false,
  inbox: options.inbox ?? [],
  ...(options.run === false ? {} : { run: () => ({ outcome: "done", payload: 0 }) })
});

const slotNode = (name: string): SlotNode => ({
  kind: "slot",
  name,
  input: tag,
  outcomes: { done: tag }
});

const flow = (
  id: string,
  nodes: Record<string, FlowEntry>,
  start: string,
  edges: Record<string, Record<string, Target>>,
  outcomes: readonly string[] = []
): AnyFlow => ({ kind: "flow", id, input: tag, outcomes: tags(outcomes), nodes, start, edges });

const featuresWith = (
  contributions: readonly Contribution[] = [],
  names: readonly string[] = []
): FeaturesApi => ({
  register: () => undefined,
  all: () => names.map(name => ({ name, description: {} })),
  contributions: () => contributions
});

const config = (overrides: Partial<Config> = {}): Config => ({
  mainFlow: overrides.mainFlow,
  safeNode: overrides.safeNode,
  retries: 1,
  settleTimeoutMs: 2000,
  journalLimit: 500
});

const report = (main: AnyFlow, features: FeaturesApi = featuresWith(), safeNode?: string) =>
  validateGraph(collectFlows(main, []), features, config({ mainFlow: main, safeNode }));

/** A correct two-node flow: one transit node and one rest node. */
const correct = () =>
  flow(
    "board",
    { catchUp: node(), awaitIntent: node({ rest: true, outcomes: ["merge"] }) },
    "catchUp",
    {
      catchUp: { done: "awaitIntent" },
      awaitIntent: { merge: "catchUp" }
    }
  );

describe("validateGraph", () => {
  it("reports nothing for a correct graph", () => {
    expect(report(correct())).toEqual({ problems: [], warnings: [] });
  });

  it("reports an outcome without an edge", () => {
    const board = flow(
      "board",
      { awaitIntent: node({ rest: true, outcomes: ["merge", "sell"] }), merge: node() },
      "awaitIntent",
      { awaitIntent: { merge: "merge" }, merge: { done: "awaitIntent" } }
    );

    expect(report(board).problems).toContain(
      '[game] Flow "board": outcome "sell" of node "awaitIntent" has no edge.\n  Add edges.awaitIntent.sell.'
    );
  });

  it("reports an edge target that does not exist", () => {
    const board = flow(
      "board",
      { awaitIntent: node({ rest: true, outcomes: ["merge"] }), merge: node() },
      "awaitIntent",
      { awaitIntent: { merge: "merge" }, merge: { done: "awaitIntnet" } }
    );

    expect(report(board).problems).toContain(
      '[game] Flow "board": the edge of outcome "done" of node "merge" names no node "awaitIntnet".\n  Point edges.merge.done at a node of "board".'
    );
  });

  it("reports a mapped target that does not exist", () => {
    const board = flow(
      "board",
      { awaitIntent: node({ rest: true, outcomes: ["merge"] }), merge: node() },
      "awaitIntent",
      {
        awaitIntent: { merge: "merge" },
        merge: { done: { kind: "map", target: "nowhere", map: () => undefined } }
      }
    );

    expect(report(board).problems).toContain(
      '[game] Flow "board": the edge of outcome "done" of node "merge" names no node "nowhere".\n  Point edges.merge.done at a node of "board".'
    );
  });

  it("reports an exit that names no outcome of the flow", () => {
    const board = flow(
      "board",
      { awaitIntent: node({ rest: true, outcomes: ["quit"] }) },
      "awaitIntent",
      { awaitIntent: { quit: { kind: "exit", outcome: "lose" } } },
      ["win"]
    );

    expect(report(board).problems).toContain(
      '[game] Flow "board": exit("lose") of node "awaitIntent" names no outcome of the flow.\n  Declare outcomes.lose on flow "board".'
    );
  });

  it("reports a barrier edge that does not reach a rest node", () => {
    const board = flow(
      "board",
      {
        buy: node({ barrier: true }),
        thanks: node(),
        home: node({ rest: true, outcomes: ["go"] })
      },
      "buy",
      { buy: { done: "thanks" }, thanks: { done: "home" }, home: { go: "buy" } }
    );

    expect(report(board).problems).toContain(
      '[game] Flow "board": the edge of outcome "done" of barrier node "buy" does not lead to a rest node of "board".\n  Point edges.buy.done at a rest node of the same flow.'
    );
  });

  it("reports a barrier edge that leaves the flow", () => {
    const board = flow(
      "board",
      { buy: node({ barrier: true }) },
      "buy",
      { buy: { done: { kind: "exit", outcome: "win" } } },
      ["win"]
    );

    expect(report(board).problems).toContain(
      '[game] Flow "board": the edge of outcome "done" of barrier node "buy" does not lead to a rest node of "board".\n  Point edges.buy.done at a rest node of the same flow.'
    );
  });

  it("accepts a barrier edge into a rest node of the same flow", () => {
    const board = flow(
      "board",
      { buy: node({ barrier: true }), home: node({ rest: true, outcomes: ["go"] }) },
      "buy",
      { buy: { done: "home" }, home: { go: "buy" } }
    );

    expect(report(board).problems).toEqual([]);
  });

  it("reports an unreachable node", () => {
    const board = flow(
      "board",
      {
        home: node({ rest: true, outcomes: ["go"] }),
        orphan: node({ rest: true, outcomes: ["go"] })
      },
      "home",
      { home: { go: "home" }, orphan: { go: "home" } }
    );

    expect(report(board).problems).toContain(
      '[game] Flow "board": node "orphan" cannot be reached from the start node "home".\n  Add an edge to it or remove it from nodes.'
    );
  });

  it("reports a start node that is not in nodes", () => {
    const board = flow("board", { home: node({ rest: true, outcomes: ["go"] }) }, "boot", {
      home: { go: "home" }
    });

    expect(report(board).problems).toContain(
      '[game] Flow "board": the start node "boot" is not in nodes.\n  Set start to a node of "board".'
    );
  });

  it("reports a cycle with no rest node", () => {
    const board = flow("board", { first: node(), second: node() }, "first", {
      first: { done: "second" },
      second: { done: "first" }
    });

    expect(report(board).problems).toContain(
      '[game] Flow "board": the nodes "first, second" form a cycle with no rest node.\n  Mark one of them rest: true.'
    );
  });

  it("accepts a cycle that passes a rest node", () => {
    expect(report(correct()).problems).toEqual([]);
  });

  it("reports a slot without a name", () => {
    const board = flow(
      "board",
      { afterWin: slotNode(""), home: node({ rest: true, outcomes: ["go"] }) },
      "afterWin",
      { afterWin: { done: "home" }, home: { go: "afterWin" } }
    );

    expect(report(board).problems).toContain(
      '[game] Flow "board": the slot node "afterWin" has no slot name.\n  Give it a name: slot("afterWin").'
    );
  });

  it("reports two contributions of one slot with equal order", () => {
    const reward = flow("reward", { give: node({ rest: true, outcomes: ["go"] }) }, "give", {
      give: { go: "give" }
    });
    const board = flow(
      "board",
      { afterWin: slotNode("afterWin"), home: node({ rest: true, outcomes: ["go"] }) },
      "afterWin",
      { afterWin: { done: "home" }, home: { go: "afterWin" } }
    );
    const features = featuresWith([
      { feature: "coins", flow: reward, order: 10 },
      { feature: "stars", flow: reward, order: 10 }
    ]);

    expect(report(board, features).problems).toContain(
      '[game] Slot "afterWin": the features "coins" and "stars" both contribute with order 10.\n  Give every contribution of a slot a different order.'
    );
  });

  it("accepts contributions with different orders", () => {
    const reward = flow("reward", { give: node({ rest: true, outcomes: ["go"] }) }, "give", {
      give: { go: "give" }
    });
    const board = flow(
      "board",
      { afterWin: slotNode("afterWin"), home: node({ rest: true, outcomes: ["go"] }) },
      "afterWin",
      { afterWin: { done: "home" }, home: { go: "afterWin" } }
    );
    const features = featuresWith([
      { feature: "coins", flow: reward, order: 10 },
      { feature: "stars", flow: reward, order: 20 }
    ]);

    expect(report(board, features).problems).toEqual([]);
  });

  it("reports an inbox type that is not an outcome", () => {
    const board = flow(
      "board",
      { awaitIntent: node({ rest: true, outcomes: ["merge"], inbox: ["elapsed"] }) },
      "awaitIntent",
      { awaitIntent: { merge: "awaitIntent" } }
    );

    expect(report(board).problems).toContain(
      '[game] Flow "board": inbox type "elapsed" of node "awaitIntent" is not an outcome.\n  Add outcomes.elapsed to node "awaitIntent".'
    );
  });

  it("reports a rest node with neither outcomes nor a body", () => {
    const board = flow("board", { wait: node({ rest: true, outcomes: [], run: false }) }, "wait", {
      wait: {}
    });

    expect(report(board).problems).toContain(
      '[game] Flow "board": rest node "wait" has neither outcomes nor a run body.\n  Declare outcomes or add a run body.'
    );
  });

  it("reports a safe node that is not a checkpoint", () => {
    const board = correct();

    expect(report(board, featuresWith(), "awaitIntent").problems).toContain(
      '[game] The safe node "awaitIntent" is not a checkpoint.\n  Mark it checkpoint: true or choose another rest node.'
    );
  });

  it("reports a safe node that is not a node of the graph", () => {
    expect(report(correct(), featuresWith(), "nowhere").problems).toContain(
      '[game] The safe node "nowhere" is not a node of the graph.\n  Set flow.safeNode to the path of a checkpoint node.'
    );
  });

  it("accepts a safe node that is a checkpoint", () => {
    const board = flow(
      "board",
      { home: node({ rest: true, checkpoint: true, outcomes: ["go"] }) },
      "home",
      { home: { go: "home" } }
    );

    expect(report(board, featuresWith(), "home").problems).toEqual([]);
  });

  it("reports two different flows that use one id", () => {
    const first = flow("sub", { wait: node({ rest: true, outcomes: ["go"] }) }, "wait", {
      wait: { go: "wait" }
    });
    const second = flow("sub", { hold: node({ rest: true, outcomes: ["go"] }) }, "hold", {
      hold: { go: "hold" }
    });
    const main = flow("main", { first, second }, "first", {
      first: { go: "second" },
      second: { go: "first" }
    });

    expect(report(main).problems).toContain(
      '[game] Two different flows use the id "sub".\n  Give every flow a unique id.'
    );
  });

  it("reports a feature that uses the id of a flow", () => {
    expect(report(correct(), featuresWith([], ["board"])).problems).toContain(
      '[game] Feature "board" uses the id of a flow.\n  Rename the feature or the flow.'
    );
  });

  it("warns about a flow above fifteen nodes", () => {
    const nodes: Record<string, FlowEntry> = {};
    const edges: Record<string, Record<string, Target>> = {};
    for (let index = 0; index < 16; index++) {
      nodes[`n${index}`] = node({ rest: true, outcomes: ["go"] });
      edges[`n${index}`] = { go: `n${(index + 1) % 16}` };
    }
    const big = flow("big", nodes, "n0", edges);

    expect(report(big)).toEqual({
      problems: [],
      warnings: ['[game] Flow "big" has 16 nodes.\n  Split it into sub-flows of 7 to 15 nodes.']
    });
  });

  it("reports every problem of the graph at once", () => {
    const board = flow(
      "board",
      {
        awaitIntent: node({ rest: true, outcomes: ["merge", "sell"], inbox: ["elapsed"] }),
        merge: node()
      },
      "awaitIntent",
      { awaitIntent: { merge: "merge" }, merge: { done: "awaitIntnet" } }
    );

    expect(report(board).problems).toHaveLength(3);
  });

  it("validates every collected flow, not only the main one", () => {
    const sub = flow(
      "sub",
      { wait: node({ rest: true, outcomes: ["go", "quit"] }) },
      "wait",
      { wait: { go: "wait" } },
      ["done"]
    );
    const main = flow("main", { sub, home: node({ rest: true, outcomes: ["go"] }) }, "home", {
      home: { go: "sub" },
      sub: { done: "home" }
    });

    expect(report(main).problems).toContain(
      '[game] Flow "sub": outcome "quit" of node "wait" has no edge.\n  Add edges.wait.quit.'
    );
  });
});
