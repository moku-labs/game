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
  over?: boolean;
  checkpoint?: boolean;
  barrier?: boolean;
  inbox?: readonly string[];
  scene?: string;
  run?: boolean;
  recover?: boolean;
};

const node = (options: NodeOptions = {}): AnyNode => ({
  kind: "node",
  input: tag,
  outcomes: tags(options.outcomes ?? ["done"]),
  rest: options.rest ?? false,
  over: options.over ?? false,
  checkpoint: options.checkpoint ?? false,
  barrier: options.barrier ?? false,
  inbox: options.inbox ?? [],
  ...(options.scene === undefined ? {} : { scene: options.scene }),
  ...(options.run === false ? {} : { run: () => ({ outcome: "done", payload: 0 }) }),
  ...(options.recover === true ? { recover: () => undefined } : {})
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

/** A feature that brings a `scenes` key, the way the `scenes` plugin will read it. */
const featuresWithScenes = (ids: readonly string[]): FeaturesApi => ({
  register: () => undefined,
  all: () => [{ name: "scenery", description: { scenes: ids.map(id => ({ id })) } }],
  contributions: () => []
});

const config = (overrides: Partial<Config> = {}): Config => ({
  mainFlow: overrides.mainFlow,
  safeNode: overrides.safeNode,
  retries: 1,
  settleTimeoutMs: 2000,
  journalLimit: 500,
  holdMs: 0
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

  it("reports one flow contributed twice to the same slot", () => {
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

    expect(report(board, features).problems).toContain(
      '[game] Slot "afterWin": flow "reward" is contributed twice.\n  Contribute a flow to one slot once.'
    );
  });

  it("accepts contributions with different orders", () => {
    const reward = flow("reward", { give: node({ rest: true, outcomes: ["go"] }) }, "give", {
      give: { go: "give" }
    });
    const bonus = flow("bonus", { give: node({ rest: true, outcomes: ["go"] }) }, "give", {
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
      { feature: "stars", flow: bonus, order: 20 }
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

  it("reports a recover on a node that is not a rest node", () => {
    const board = flow(
      "board",
      { catchUp: node({ recover: true }), awaitIntent: node({ rest: true, outcomes: ["merge"] }) },
      "catchUp",
      { catchUp: { done: "awaitIntent" }, awaitIntent: { merge: "catchUp" } }
    );

    expect(report(board).problems).toEqual([
      '[game] Flow "board": node "catchUp" has recover but is not a rest node.\n  Add rest: true, or remove recover.'
    ]);
  });

  it("accepts a recover on the configured safe node", () => {
    const main = flow(
      "main",
      {
        boot: node(),
        home: node({ rest: true, checkpoint: true, outcomes: ["go"], recover: true })
      },
      "boot",
      { boot: { done: "home" }, home: { go: "boot" } }
    );

    expect(report(main, featuresWith(), "home")).toEqual({ problems: [], warnings: [] });
  });

  it("accepts a recover on the start node when no safe node is configured", () => {
    const main = flow(
      "main",
      { home: node({ rest: true, checkpoint: true, outcomes: ["go"], recover: true }) },
      "home",
      { home: { go: "home" } }
    );

    expect(report(main)).toEqual({ problems: [], warnings: [] });
  });

  it("warns about a recover on a rest node that is not the safe node: it never runs there", () => {
    const main = flow(
      "main",
      {
        home: node({ rest: true, checkpoint: true, outcomes: ["go"] }),
        shop: node({ rest: true, outcomes: ["leave"], recover: true })
      },
      "home",
      { home: { go: "shop" }, shop: { leave: "home" } }
    );

    expect(report(main, featuresWith(), "home")).toEqual({
      problems: [],
      warnings: [
        '[game] Flow "main": node "shop" has recover but is not the safe node.\n  The engine runs recover only in the safe node "home". Move recover there or remove it.'
      ]
    });
  });

  it("names the start node in the warning when no safe node is configured", () => {
    const main = flow(
      "main",
      {
        home: node({ rest: true, checkpoint: true, outcomes: ["go"] }),
        shop: node({ rest: true, outcomes: ["leave"], recover: true })
      },
      "home",
      { home: { go: "shop" }, shop: { leave: "home" } }
    );

    expect(report(main).warnings).toEqual([
      '[game] Flow "main": node "shop" has recover but is not the safe node.\n  The engine runs recover only in the safe node "home". Move recover there or remove it.'
    ]);
  });

  it("tells the safe node from a node of the same name in another flow", () => {
    const sub = flow(
      "sub",
      { home: node({ rest: true, outcomes: ["quit"], recover: true }) },
      "home",
      { home: { quit: { kind: "exit", outcome: "done" } } },
      ["done"]
    );
    const main = flow(
      "main",
      { home: node({ rest: true, checkpoint: true, outcomes: ["go"], recover: true }), sub },
      "home",
      { home: { go: "sub" }, sub: { done: "home" } }
    );

    expect(report(main, featuresWith(), "home").warnings).toEqual([
      '[game] Flow "sub": node "home" has recover but is not the safe node.\n  The engine runs recover only in the safe node "home". Move recover there or remove it.'
    ]);
  });

  it("accepts a recover on a safe node inside a slot contribution", () => {
    const reward = flow(
      "reward",
      { give: node({ rest: true, checkpoint: true, outcomes: ["go"], recover: true }) },
      "give",
      { give: { go: "give" } }
    );
    const board = flow(
      "board",
      { afterWin: slotNode("afterWin"), home: node({ rest: true, outcomes: ["go"] }) },
      "afterWin",
      { afterWin: { done: "home" }, home: { go: "afterWin" } }
    );
    const features = featuresWith([{ feature: "coins", flow: reward, order: 10 }]);
    const flows = collectFlows(board, [reward]);

    expect(
      validateGraph(flows, features, config({ mainFlow: board, safeNode: "afterWin/give" }))
    ).toEqual({ problems: [], warnings: [] });
  });

  it("leaves the recover warning to the problem when the safe node is not a node of the graph", () => {
    const main = flow(
      "main",
      { home: node({ rest: true, checkpoint: true, outcomes: ["go"], recover: true }) },
      "home",
      { home: { go: "home" } }
    );

    expect(report(main, featuresWith(), "nowhere")).toEqual({
      problems: [
        '[game] The safe node "nowhere" is not a node of the graph.\n  Set flow.safeNode to the path of a checkpoint node.'
      ],
      warnings: []
    });
  });

  it("warns about no recover while the main flow starts with a sub-flow: its node is entered then", () => {
    const level = flow(
      "level",
      { play: node({ rest: true, outcomes: ["quit"], recover: true }) },
      "play",
      { play: { quit: { kind: "exit", outcome: "left" } } },
      ["left"]
    );
    const main = flow("main", { level, home: node({ rest: true, outcomes: ["go"] }) }, "level", {
      level: { left: "home" },
      home: { go: "level" }
    });

    expect(report(main)).toEqual({ problems: [], warnings: [] });
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

  it("accepts a safe node that is a checkpoint inside a slot contribution", () => {
    const reward = flow(
      "reward",
      { give: node({ rest: true, checkpoint: true, outcomes: ["go"] }) },
      "give",
      { give: { go: "give" } }
    );
    const board = flow(
      "board",
      { afterWin: slotNode("afterWin"), home: node({ rest: true, outcomes: ["go"] }) },
      "afterWin",
      { afterWin: { done: "home" }, home: { go: "afterWin" } }
    );
    const features = featuresWith([{ feature: "coins", flow: reward, order: 10 }]);

    expect(report(board, features, "afterWin/give").problems).toEqual([]);
  });

  it("warns when two contributions of one slot have a node with the same name", () => {
    const coins = flow("coins", { give: node({ rest: true, outcomes: ["go"] }) }, "give", {
      give: { go: "give" }
    });
    const stars = flow("stars", { give: node({ rest: true, outcomes: ["go"] }) }, "give", {
      give: { go: "give" }
    });
    const board = flow(
      "board",
      { afterWin: slotNode("afterWin"), home: node({ rest: true, outcomes: ["go"] }) },
      "afterWin",
      { afterWin: { done: "home" }, home: { go: "afterWin" } }
    );
    const features = featuresWith([
      { feature: "coins", flow: coins, order: 10 },
      { feature: "stars", flow: stars, order: 20 }
    ]);

    expect(report(board, features).warnings).toEqual([
      '[game] Slot "afterWin": the flows "coins" and "stars" both have a node "give".\n  A bookmark path keeps node names only, so restore enters "coins". Give the nodes different names.'
    ]);
  });

  it("reports a node that names a scene no feature registers", () => {
    const board = flow(
      "board",
      { home: node({ rest: true, outcomes: ["go"], scene: "bord" }) },
      "home",
      { home: { go: "home" } }
    );

    expect(report(board, featuresWithScenes(["board"])).problems).toContain(
      '[game] Flow "board": the scene "bord" of node "home" is not registered.\n  List it in the scenes of a feature.'
    );
  });

  it("accepts a scene a feature registers", () => {
    const board = flow(
      "board",
      { home: node({ rest: true, outcomes: ["go"], scene: "board" }) },
      "home",
      { home: { go: "home" } }
    );

    expect(report(board, featuresWithScenes(["board"])).problems).toEqual([]);
  });

  it("checks no scene id while no feature brings a scenes key", () => {
    const board = flow(
      "board",
      { home: node({ rest: true, outcomes: ["go"], scene: "bord" }) },
      "home",
      { home: { go: "home" } }
    );

    expect(report(board).problems).toEqual([]);
  });

  it("reports an over node that names a scene", () => {
    const main = flow(
      "main",
      {
        home: node({ rest: true, outcomes: ["go"] }),
        popup: node({ rest: true, over: true, outcomes: ["close"], scene: "board" })
      },
      "home",
      { home: { go: "popup" }, popup: { close: "home" } }
    );

    expect(report(main, featuresWithScenes(["board"])).problems).toEqual([
      '[game] Flow "main": the over node "popup" names the scene "board".\n  Remove scene from node "popup": an over node keeps the scene under it.'
    ]);
  });

  it("reports an over node with a scene even while no feature brings a scenes key", () => {
    const main = flow(
      "main",
      {
        home: node({ rest: true, outcomes: ["go"] }),
        popup: node({ rest: true, over: true, outcomes: ["close"], scene: "board" })
      },
      "home",
      { home: { go: "popup" }, popup: { close: "home" } }
    );

    expect(report(main).problems).toHaveLength(1);
  });

  it("reports an unknown scene and an over node with a scene in one report", () => {
    const main = flow(
      "main",
      {
        home: node({ rest: true, outcomes: ["go"], scene: "bord" }),
        popup: node({ rest: true, over: true, outcomes: ["close"], scene: "board" })
      },
      "home",
      { home: { go: "popup" }, popup: { close: "home" } }
    );

    expect(report(main, featuresWithScenes(["board"])).problems).toHaveLength(2);
  });

  it("reads the scene ids of every feature that brings some", () => {
    const features: FeaturesApi = {
      register: () => undefined,
      all: () => [
        { name: "menu", description: { scenes: [{ id: "home" }] } },
        { name: "board", description: { scenes: [{ id: "board" }] } },
        { name: "scoring", description: {} }
      ],
      contributions: () => []
    };
    const main = flow(
      "main",
      { home: node({ rest: true, outcomes: ["go"], scene: "board" }) },
      "home",
      { home: { go: "home" } }
    );

    expect(report(main, features).problems).toEqual([]);
  });

  it("ignores a scenes entry that is not an object with an id", () => {
    const features: FeaturesApi = {
      register: () => undefined,
      all: () => [{ name: "scenery", description: { scenes: ["board", { name: "board" }, 7] } }],
      contributions: () => []
    };
    const main = flow(
      "main",
      { home: node({ rest: true, outcomes: ["go"], scene: "board" }) },
      "home",
      { home: { go: "home" } }
    );

    expect(report(main, features).problems).toHaveLength(1);
  });

  it("treats a scenes key that is no list as a declaration with no id", () => {
    const features: FeaturesApi = {
      register: () => undefined,
      all: () => [{ name: "scenery", description: { scenes: { board: {} } } }],
      contributions: () => []
    };
    const main = flow(
      "main",
      { home: node({ rest: true, outcomes: ["go"], scene: "board" }) },
      "home",
      { home: { go: "home" } }
    );

    expect(report(main, features).problems).toHaveLength(1);
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

describe("validateGraph: own keys", () => {
  // Bug: `in` reads the prototype, so exit("constructor") passes for every flow and leaves nowhere.
  it("reports an exit named like an Object method that the flow does not declare", () => {
    const board = flow(
      "board",
      { awaitIntent: node({ rest: true, outcomes: ["leave"] }) },
      "awaitIntent",
      { awaitIntent: { leave: { kind: "exit", outcome: "constructor" } } },
      ["left"]
    );

    expect(report(board).problems).toContain(
      '[game] Flow "board": exit("constructor") of node "awaitIntent" names no outcome of the flow.\n  Declare outcomes.constructor on flow "board".'
    );
  });

  // Bug: `in` reads the prototype, so an inbox type "constructor" passes and the event is never an outcome.
  it("reports an inbox type named like an Object method that is no outcome", () => {
    const board = flow(
      "board",
      { awaitIntent: node({ rest: true, outcomes: ["merge"], inbox: ["constructor"] }) },
      "awaitIntent",
      { awaitIntent: { merge: "awaitIntent" } }
    );

    expect(report(board).problems).toContain(
      '[game] Flow "board": inbox type "constructor" of node "awaitIntent" is not an outcome.\n  Add outcomes.constructor to node "awaitIntent".'
    );
  });
});

/** A slot that declares `declared` besides its own `done`. */
const declaredSlot = (name: string, declared: readonly string[]): SlotNode => ({
  kind: "slot",
  name,
  input: tag,
  outcomes: { done: tag, ...tags(declared) }
});

/** A contributed flow whose rest node leaves it on each of `exits`; node names differ per flow. */
const leaving = (id: string, exits: readonly string[]): AnyFlow =>
  flow(
    id,
    { [`${id}Show`]: node({ rest: true, outcomes: exits }) },
    `${id}Show`,
    {
      [`${id}Show`]: Object.fromEntries(exits.map(name => [name, { kind: "exit", outcome: name }]))
    },
    exits
  );

/** A main flow that routes every outcome of `episode` from its rest node "home". */
const mainWith = (episode: SlotNode, extra: Record<string, FlowEntry> = {}): AnyFlow => {
  const routes = Object.fromEntries(Object.keys(episode.outcomes).map(name => [name, "home"]));

  return flow(
    "main",
    { home: node({ rest: true, outcomes: ["play", ...Object.keys(extra)] }), episode, ...extra },
    "home",
    {
      home: { play: "episode", ...Object.fromEntries(Object.keys(extra).map(key => [key, key])) },
      episode: routes,
      ...Object.fromEntries(Object.keys(extra).map(key => [key, { done: "home" }]))
    }
  );
};

const contributed = (flowValue: AnyFlow, order: number, when?: () => boolean): Contribution =>
  when === undefined
    ? { feature: `${flowValue.id}Feature`, flow: flowValue, order }
    : { feature: `${flowValue.id}Feature`, flow: flowValue, order, when };

describe("validateGraph: slot outcomes", () => {
  // Bug: a check fires on a correct declared slot: `done` taken for undeclared, or one slot used
  // in two flows taken for two declarations, and run() refuses a game that is right.
  it("reports nothing for a declared slot used in two flows, whose contributions fit and have when", () => {
    const episodeStep = declaredSlot("episodeStep", ["shop", "board"]);
    const hub = flow(
      "hub",
      {
        gate: node({ rest: true, outcomes: ["enter"] }),
        step: declaredSlot("episodeStep", ["board", "shop"])
      },
      "gate",
      {
        gate: { enter: "step" },
        step: {
          done: { kind: "exit", outcome: "done" },
          shop: { kind: "exit", outcome: "done" },
          board: { kind: "exit", outcome: "done" }
        }
      },
      ["done"]
    );
    const features = featuresWith([
      contributed(leaving("story", ["done", "shop"]), 10, () => true),
      contributed(leaving("ward", ["board"]), 20)
    ]);

    expect(report(mainWith(episodeStep, { hub }), features)).toEqual({
      problems: [],
      warnings: []
    });
  });

  // Bug: a contribution exits a name the slot never routes, and the hand-back is lost at run time.
  it("reports a contribution that exits an outcome the slot does not declare", () => {
    const features = featuresWith([contributed(leaving("story", ["done", "gift"]), 10)]);

    expect(report(mainWith(declaredSlot("episodeStep", ["shop"])), features).problems).toEqual([
      '[game] Slot "episodeStep": flow "story" of feature "storyFeature" exits "gift", which the slot does not declare.\n  Declare slot("episodeStep", { gift: type() }) or exit "done".'
    ]);
  });

  // Bug: two flows declare one slot name differently, and a contribution fits one of them only.
  it("reports two slot nodes of one name that declare different outcomes", () => {
    const hub = flow(
      "hub",
      {
        gate: node({ rest: true, outcomes: ["enter"] }),
        step: declaredSlot("episodeStep", ["board"])
      },
      "gate",
      {
        gate: { enter: "step" },
        step: { done: { kind: "exit", outcome: "done" }, board: { kind: "exit", outcome: "done" } }
      },
      ["done"]
    );

    expect(report(mainWith(declaredSlot("episodeStep", ["shop"]), { hub })).problems).toEqual([
      '[game] Slot "episodeStep" declares different outcomes in flow "main" and flow "hub".\n  Declare the slot once and use it in both flows.'
    ]);
  });

  // Bug: a slot that declares nothing silently drops a named exit of its contribution.
  it("warns about a contribution whose named exit a slot that declares none ignores", () => {
    const features = featuresWith([contributed(leaving("story", ["done", "shop"]), 10)]);
    const result = report(mainWith(slotNode("episodeStep")), features);

    expect(result.problems).toEqual([]);
    expect(result.warnings).toEqual([
      '[game] Slot "episodeStep": flow "story" exits "shop", which the slot ignores.\n  Declare slot("episodeStep", { shop: type() }) to route it, or exit "done".'
    ]);
  });

  // Bug: a later contribution without when never runs once an earlier one leaves on a named exit.
  it("warns about two contributions without when in a slot that declares outcomes", () => {
    const features = featuresWith([
      contributed(leaving("story", ["done", "shop"]), 10),
      contributed(leaving("quest", ["done"]), 20)
    ]);

    expect(report(mainWith(declaredSlot("episodeStep", ["shop"])), features).warnings).toEqual([
      '[game] Slot "episodeStep": the flows "story" and "quest" have no when.\n  A named exit leaves the slot, so "quest" runs only when "story" exits done; give them when.'
    ]);
  });

  // Bug: the warning fires for a single contribution without when, which is the normal case.
  it("does not warn about one contribution without when beside one with when", () => {
    const features = featuresWith([
      contributed(leaving("story", ["done", "shop"]), 10),
      contributed(leaving("quest", ["done"]), 20, () => true)
    ]);

    expect(report(mainWith(declaredSlot("episodeStep", ["shop"])), features).warnings).toEqual([]);
  });
});
