import { describe, expect, it } from "vitest";
import {
  contribution,
  createOut,
  defineFlow,
  defineNode,
  exit,
  slot,
  to,
  type
} from "../../runner/define";
import type { GameState, NodeRecover, NodeRun, TypeTag } from "../../runner/types";

const done: NodeRun<GameState, void, { done: TypeTag<void> }> = ({ out }) => out.done();

const reset: NodeRecover<GameState> = () => undefined;

const wait: NodeRun<GameState, void, { play: TypeTag<void> }> = ({ out }) => out.play();

const why = (failure: { reason: string }) => ({ why: failure.reason });

/** Declares `done` past the type, as a cast in a game would. */
const declareDone = () => slot("episodeStep", { done: type() } as never);

/** A `when` that skips its contribution. */
const skipAlways = () => false;

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

  it("keeps the scene the author named", () => {
    const node = defineNode({ scene: "board", rest: true, outcomes: { play: type() } });

    expect(node.scene).toBe("board");
  });

  it("leaves the scene key out when the author named none", () => {
    const node = defineNode({ rest: true, outcomes: { play: type() } });

    expect("scene" in node).toBe(false);
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

  it("keeps the recover of a rest node", () => {
    const node = defineNode({ rest: true, outcomes: { play: type() }, recover: reset });

    expect(node.recover).toBe(reset);
  });

  it("keeps the recover next to the body of a rest node", () => {
    const node = defineNode({ rest: true, outcomes: { play: type() }, run: wait, recover: reset });

    expect(node.run).toBe(wait);
    expect(node.recover).toBe(reset);
  });

  it("leaves the recover key out when the author wrote none", () => {
    const node = defineNode({ rest: true, outcomes: { play: type() } });

    expect("recover" in node).toBe(false);
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

  // Bug: a declared outcome is dropped, or `done` is lost beside it: the host cannot route a hand-back.
  it("lists done first, then the outcomes it declares", () => {
    const point = slot("episodeStep", { shop: type<{ tab: string }>(), board: type() });

    expect(Object.keys(point.outcomes)).toEqual(["done", "shop", "board"]);
  });

  // Bug: a slot that declares nothing gains a key, and the graph hash of every existing game moves.
  it("returns the same plain data as before when it declares no outcome", () => {
    expect(slot("afterWin")).toEqual({
      kind: "slot",
      name: "afterWin",
      input: { kind: "type" },
      outcomes: { done: { kind: "type" } }
    });
  });

  // Bug: a cast lets `done` through; after the spread nothing tells it from the slot's own.
  it("throws a TypeError when the outcomes declare done", () => {
    expect(declareDone).toThrow(TypeError);
    expect(declareDone).toThrow(
      new TypeError(
        '[game] Slot "episodeStep" declares the outcome "done".\n  done is every slot\'s own outcome; remove it from slot("episodeStep", ...).'
      )
    );
  });
});

describe("contribution", () => {
  const show = defineNode({
    rest: true,
    outcomes: { next: type(), shop: type<{ tab: string }>() }
  });
  const storyFlow = defineFlow("story", {
    nodes: { show },
    start: "show",
    outcomes: { done: type(), shop: type<{ tab: string }>() },
    edges: { show: { next: exit("done"), shop: exit("shop") } }
  });
  const episodeStep = slot("episodeStep", { shop: type<{ tab: string }>() });

  // Bug: the entry lands under another key than the slot's name, so the slot never runs the flow.
  it("returns the spec under the slot's name, with no when key when none is given", () => {
    const entry = contribution(episodeStep, { flow: storyFlow, order: 10 });

    expect(entry).toEqual({ episodeStep: { flow: storyFlow, order: 10 } });
    expect(Object.keys(entry.episodeStep)).toEqual(["flow", "order"]);
  });

  // Bug: the when is dropped, and the contribution runs while the game says it must be skipped.
  it("keeps the when it is given", () => {
    const entry = contribution(episodeStep, { flow: storyFlow, order: 10, when: skipAlways });

    expect(entry.episodeStep.when).toBe(skipAlways);
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
