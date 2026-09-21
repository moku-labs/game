import { describe, expect, it } from "vitest";
import { createOut, defineFlow, defineNode, exit, slot, to, type } from "../../runner/define";
import type { GameState, NodeRun, TypeTag } from "../../runner/types";

const done: NodeRun<GameState, void, { done: TypeTag<void> }> = ({ out }) => out.done();

const why = (failure: { reason: string }) => ({ why: failure.reason });

describe("type", () => {
  it("returns a tag that carries no value", () => {
    expect(type()).toEqual({ kind: "type" });
  });

  it("returns a fresh tag every call", () => {
    expect(type()).not.toBe(type());
  });
});

describe("defineNode", () => {
  it("returns plain data with the node kind", () => {
    const node = defineNode({ outcomes: { done: type() }, run: ({ out }) => out.done() });

    expect(node.kind).toBe("node");
    expect(Object.keys(node.outcomes)).toEqual(["done"]);
  });

  it("defaults every flag to false and the inbox to empty", () => {
    const node = defineNode({ outcomes: { done: type() }, run: ({ out }) => out.done() });

    expect(node.rest).toBe(false);
    expect(node.over).toBe(false);
    expect(node.checkpoint).toBe(false);
    expect(node.barrier).toBe(false);
    expect(node.inbox).toEqual([]);
  });

  it("keeps the flags the author set", () => {
    const node = defineNode({
      rest: true,
      over: true,
      checkpoint: true,
      barrier: true,
      inbox: ["elapsed"],
      outcomes: { elapsed: type(), play: type() }
    });

    expect(node.rest).toBe(true);
    expect(node.over).toBe(true);
    expect(node.checkpoint).toBe(true);
    expect(node.barrier).toBe(true);
    expect(node.inbox).toEqual(["elapsed"]);
  });

  it("gives a node without an input tag a tag of its own", () => {
    const node = defineNode({ rest: true, outcomes: { play: type() } });

    expect(node.input).toEqual({ kind: "type" });
  });

  it("keeps the input tag the author wrote", () => {
    const input = type<{ level: number }>();
    const node = defineNode({ input, rest: true, outcomes: { play: type() } });

    expect(node.input).toBe(input);
  });

  it("keeps the body", () => {
    const node = defineNode({ outcomes: { done: type() }, run: done });

    expect(node.run).toBe(done);
  });

  it("leaves out the body of a pure wait", () => {
    const node = defineNode({ rest: true, outcomes: { play: type() } });

    expect("run" in node).toBe(false);
  });

  it("does not share state between two nodes", () => {
    const first = defineNode({ rest: true, outcomes: { play: type() } });
    const second = defineNode({ rest: true, outcomes: { play: type() } });

    expect(first).not.toBe(second);
    expect(first.inbox).not.toBe(second.inbox);
  });
});

describe("defineFlow", () => {
  const boot = defineNode({ outcomes: { done: type() }, run: ({ out }) => out.done() });
  const home = defineNode({ rest: true, checkpoint: true, outcomes: { play: type() } });

  it("returns plain data with the flow kind and the id", () => {
    const flow = defineFlow("main", {
      nodes: { boot, home },
      start: "boot",
      edges: { boot: { done: "home" }, home: { play: "boot" } }
    });

    expect(flow.kind).toBe("flow");
    expect(flow.id).toBe("main");
    expect(flow.start).toBe("boot");
  });

  it("stores the nodes and the edge table as written", () => {
    const flow = defineFlow("main", {
      nodes: { boot, home },
      start: "boot",
      edges: { boot: { done: "home" }, home: { play: "boot" } }
    });

    expect(flow.nodes.boot).toBe(boot);
    expect(flow.edges).toEqual({ boot: { done: "home" }, home: { play: "boot" } });
  });

  it("gives a flow without outcomes an empty outcome table", () => {
    const flow = defineFlow("main", {
      nodes: { boot, home },
      start: "boot",
      edges: { boot: { done: "home" }, home: { play: "boot" } }
    });

    expect(flow.outcomes).toEqual({});
    expect(flow.input).toEqual({ kind: "type" });
  });

  it("keeps the input and outcomes of a sub-flow", () => {
    const input = type<{ level: number }>();
    const outcomes = { win: type(), lose: type() };
    const play = defineNode({ rest: true, outcomes: { win: type(), lose: type() } });
    const flow = defineFlow("level", {
      input,
      outcomes,
      nodes: { play },
      start: "play",
      edges: { play: { win: exit("win"), lose: exit("lose") } }
    });

    expect(flow.input).toBe(input);
    expect(flow.outcomes).toBe(outcomes);
  });
});

describe("exit", () => {
  it("returns the outcome as plain data", () => {
    expect(exit("win")).toEqual({ kind: "exit", outcome: "win" });
  });
});

describe("to", () => {
  it("returns the target and the mapper as plain data", () => {
    const target = to("retry", why);

    expect(target.kind).toBe("map");
    expect(target.target).toBe("retry");
    expect(target.map).toBe(why);
  });

  it("keeps the mapper callable", () => {
    const target = to("retry", why);

    expect(target.map({ reason: "clock" })).toEqual({ why: "clock" });
  });
});

describe("slot", () => {
  it("returns a slot node with the single outcome done", () => {
    const point = slot("afterWin");

    expect(point.kind).toBe("slot");
    expect(point.name).toBe("afterWin");
    expect(Object.keys(point.outcomes)).toEqual(["done"]);
  });
});

describe("createOut", () => {
  it("builds one method per declared outcome", () => {
    const out = createOut({ done: type(), won: type<{ stars: number }>() });

    expect(Object.keys(out)).toEqual(["done", "won"]);
  });

  it("returns the outcome name and a null payload without data", () => {
    const out = createOut({ done: type() });
    const result = out.done?.();

    expect(result?.outcome).toBe("done");
    expect(result?.payload).toBeNull();
  });

  it("returns the payload the body passed", () => {
    const out = createOut({ won: type<{ stars: number }>() });

    expect(out.won?.({ stars: 3 })).toEqual({ outcome: "won", payload: { stars: 3 } });
  });

  it("builds no method for an outcome that was not declared", () => {
    const out = createOut({ done: type() });

    expect(out.won).toBeUndefined();
  });

  it("builds a result that is plain data", () => {
    const out = createOut({ won: type<{ stars: number }>() });
    const payload = { stars: 3 };

    expect(out.won?.(payload)?.payload).toBe(payload);
  });
});
