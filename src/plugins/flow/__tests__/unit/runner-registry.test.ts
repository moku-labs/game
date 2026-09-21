import { describe, expect, it } from "vitest";
import type { Contribution, FeaturesApi } from "../../features/types";
import { collectFlows, describeGraph, findNode, framePath, graphHash } from "../../runner/registry";
import type {
  AnyFlow,
  AnyNode,
  AnyTypeTag,
  FlowEntry,
  FlowGraph,
  OutcomeTags,
  SlotNode,
  Target
} from "../../runner/types";

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
};

const node = (options: NodeOptions = {}): AnyNode => ({
  kind: "node",
  input: tag,
  outcomes: tags(options.outcomes ?? ["done"]),
  rest: options.rest ?? false,
  over: options.over ?? false,
  checkpoint: options.checkpoint ?? false,
  barrier: options.barrier ?? false,
  inbox: options.inbox ?? []
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

const noFeatures: FeaturesApi = {
  register: () => undefined,
  all: () => [],
  contributions: () => []
};

const awaitIntent = node({ rest: true, outcomes: ["merge", "quit"], inbox: ["merge"] });
const merge = node();
const boardFlow = flow(
  "board",
  { awaitIntent, merge },
  "awaitIntent",
  {
    awaitIntent: { merge: "merge", quit: { kind: "exit", outcome: "lose" } },
    merge: { done: "awaitIntent" }
  },
  ["win", "lose"]
);

const home = node({ rest: true, checkpoint: true, outcomes: ["play"] });
const result = node({ rest: true, outcomes: ["next"] });
const afterWin = slotNode("afterWin");
const rewardFlow = flow("reward", { give: node() }, "give", { give: { done: "give" } });

const mainFlow = flow("main", { home, board: boardFlow, afterWin, result }, "home", {
  home: { play: "board" },
  board: { win: "afterWin", lose: "home" },
  afterWin: { done: "result" },
  result: { next: { kind: "map", target: "home", map: () => undefined } }
});

const contribution: Contribution = { feature: "reward", flow: rewardFlow, order: 10 };

const features: FeaturesApi = {
  register: () => undefined,
  all: () => [{ name: "boardFeature", description: { flows: [boardFlow], nodes: [home] } }],
  contributions: (slotName: string): readonly Contribution[] =>
    slotName === "afterWin" ? [contribution] : []
};

describe("collectFlows", () => {
  it("collects the main flow first", () => {
    expect([...collectFlows(mainFlow, []).keys()]).toEqual(["main", "board"]);
  });

  it("collects a sub-flow reached by reference", () => {
    expect(collectFlows(mainFlow, []).get("board")).toBe(boardFlow);
  });

  it("collects a registered flow that is not reachable", () => {
    expect(collectFlows(mainFlow, [rewardFlow]).get("reward")).toBe(rewardFlow);
  });

  it("collects the sub-flows of a registered flow", () => {
    const outer = flow("outer", { inner: boardFlow }, "inner", { inner: { win: "inner" } });

    expect([...collectFlows(mainFlow, [outer]).keys()]).toEqual(["main", "board", "outer"]);
  });

  it("keeps one entry per flow when it is used twice", () => {
    const twice = flow("twice", { first: boardFlow, second: boardFlow }, "first", {
      first: { win: "second", lose: "second" },
      second: { win: "first", lose: "first" }
    });

    expect([...collectFlows(twice, []).keys()]).toEqual(["twice", "board"]);
  });

  it("walks past slots and plain nodes", () => {
    expect(collectFlows(mainFlow, []).size).toBe(2);
  });
});

describe("framePath", () => {
  it("joins the node of every frame", () => {
    const stack = [
      { flow: "main", node: "board", input: {} },
      { flow: "board", node: "awaitIntent", input: {} }
    ];

    expect(framePath(stack)).toBe("board/awaitIntent");
  });

  it("is the node name at the top level", () => {
    expect(framePath([{ flow: "main", node: "home", input: {} }])).toBe("home");
  });

  it("is empty without a position", () => {
    expect(framePath([])).toBe("");
  });
});

describe("findNode", () => {
  it("finds a node of the main flow", () => {
    expect(findNode(mainFlow, "home")?.entry).toBe(home);
  });

  it("names the flow that holds the node", () => {
    expect(findNode(mainFlow, "board/awaitIntent")?.flow).toBe(boardFlow);
  });

  it("finds a node inside a sub-flow", () => {
    expect(findNode(mainFlow, "board/awaitIntent")?.entry).toBe(awaitIntent);
  });

  it("reports one trail step per level", () => {
    expect(findNode(mainFlow, "board/awaitIntent")?.trail).toEqual([
      { flow: "main", node: "board" },
      { flow: "board", node: "awaitIntent" }
    ]);
  });

  it("finds the sub-flow itself", () => {
    expect(findNode(mainFlow, "board")?.entry).toBe(boardFlow);
  });

  it("finds nothing for an unknown node", () => {
    expect(findNode(mainFlow, "nowhere")).toBeUndefined();
  });

  it("does not descend into a plain node", () => {
    expect(findNode(mainFlow, "home/deeper")).toBeUndefined();
  });

  it("descends through a slot into the contribution that has the next node", () => {
    const location = findNode(mainFlow, "afterWin/give", features.contributions);

    expect(location?.flow).toBe(rewardFlow);
    expect(location?.trail).toEqual([
      { flow: "main", node: "afterWin" },
      { flow: "reward", node: "give" }
    ]);
  });

  it("takes the first contribution in order when two have the same node name", () => {
    const second = flow("bonus", { give: node() }, "give", { give: { done: "give" } });
    const both = (): readonly Contribution[] => [
      contribution,
      { feature: "bonus", flow: second, order: 20 }
    ];

    expect(findNode(mainFlow, "afterWin/give", both)?.flow).toBe(rewardFlow);
  });

  it("looks at own node names only: an inherited key such as constructor names no node", () => {
    expect(findNode(mainFlow, "afterWin/constructor", features.contributions)).toBeUndefined();
  });

  it("finds nothing behind a slot when no contribution has the node, or none was passed", () => {
    expect(findNode(mainFlow, "afterWin/missing", features.contributions)).toBeUndefined();
    expect(findNode(mainFlow, "afterWin/give")).toBeUndefined();
  });

  it("finds nothing for an empty path", () => {
    expect(findNode(mainFlow, "")).toBeUndefined();
  });
});

describe("describeGraph", () => {
  const graph = describeGraph(collectFlows(mainFlow, []), features);

  it("names the main flow", () => {
    expect(graph.main).toBe("main");
  });

  it("describes every collected flow with its start node", () => {
    expect(Object.keys(graph.flows)).toEqual(["main", "board"]);
    expect(graph.flows.main?.start).toBe("home");
  });

  it("renders the flags of a node and no path: a static description has no runtime position", () => {
    expect(graph.flows.main?.nodes.home).not.toHaveProperty("path");
    expect(graph.flows.main?.nodes.home).toMatchObject({
      flow: "main",
      node: "home",
      rest: true,
      over: false,
      checkpoint: true,
      barrier: false
    });
  });

  it("lists the outcomes of a node", () => {
    expect(graph.flows.board?.nodes.awaitIntent?.outcomes).toEqual(["merge", "quit"]);
  });

  it("names the sub-flow of a flow node", () => {
    expect(graph.flows.main?.nodes.board?.subFlow).toBe("board");
  });

  it("names the slot of a slot node", () => {
    expect(graph.flows.main?.nodes.afterWin?.slot).toBe("afterWin");
  });

  it("renders a plain edge as the node name", () => {
    expect(graph.flows.main?.edges.home?.play).toBe("board");
  });

  it("renders an exit edge as exit:outcome", () => {
    expect(graph.flows.board?.edges.awaitIntent?.quit).toBe("exit:lose");
  });

  it("renders a mapped edge as map:node", () => {
    expect(graph.flows.main?.edges.result?.next).toBe("map:home");
  });

  it("names the feature that owns a flow", () => {
    expect(graph.flows.main?.nodes.board?.owner).toBe("boardFeature");
  });

  it("names the feature that owns a node", () => {
    expect(graph.flows.main?.nodes.home?.owner).toBe("boardFeature");
  });

  it("leaves the owner out for a node no feature brought", () => {
    expect(graph.flows.main?.nodes.result?.owner).toBeUndefined();
  });

  it("lists the contributions of every slot", () => {
    expect(graph.slots.afterWin).toEqual([{ feature: "reward", flow: "reward", order: 10 }]);
  });

  it("builds the description without running the game", () => {
    expect(describeGraph(collectFlows(mainFlow, []), noFeatures).slots).toEqual({ afterWin: [] });
  });
});

describe("graphHash", () => {
  it("is the same for the same graph", () => {
    const graph = describeGraph(collectFlows(mainFlow, []), features);

    expect(graphHash(graph)).toBe(graphHash(describeGraph(collectFlows(mainFlow, []), features)));
  });

  it("does not depend on the order the keys were written in", () => {
    const first: FlowGraph = { main: "main", flows: {}, slots: {} };
    const second: FlowGraph = { slots: {}, flows: {}, main: "main" };

    expect(graphHash(first)).toBe(graphHash(second));
  });

  it("changes when an edge changes", () => {
    const before = describeGraph(collectFlows(mainFlow, []), features);
    const edited = flow("main", { home, result }, "home", {
      home: { play: "result" },
      result: { next: "home" }
    });

    expect(graphHash(before)).not.toBe(
      graphHash(describeGraph(collectFlows(edited, []), features))
    );
  });

  it("returns a short hexadecimal string", () => {
    expect(graphHash({ main: "main", flows: {}, slots: {} })).toMatch(/^[\da-f]+$/);
  });
});
