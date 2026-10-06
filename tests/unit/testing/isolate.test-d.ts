import type { Clock, Flow } from "@moku-labs/game";
import { defineGame, exit, type } from "@moku-labs/game";
import type { HeadlessApp, IsolateSeams, Stub, StubsOf } from "@moku-labs/game/testing";
import { fakeClock, isolate, stub } from "@moku-labs/game/testing";
import { describe, expectTypeOf, it } from "vitest";

// `stubs` is typed against the node table of the isolated flow: a key that is not a node and an
// outcome the node does not declare are compile errors. Checked by `tsc`. Each `@ts-expect-error`
// fails the build in both directions: the mistake must error, and a correct line under one of
// them would be reported as an unused directive.

type Player = { n: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, never>;
}>();

const open = defineNode({ rest: true, outcomes: { close: type() } });
const settingsFlow = defineFlow("settingsPopup", {
  nodes: { open },
  start: "open",
  outcomes: { closed: type() },
  edges: { open: { close: exit("closed") } }
});
const awaitIntent = defineNode({ rest: true, outcomes: { tap: type(), openSettings: type() } });
const energy = defineNode({ rest: true, outcomes: { watch: type(), later: type() } });
const boardFlow = defineFlow("board", {
  nodes: { awaitIntent, energy, settings: settingsFlow },
  start: "awaitIntent",
  edges: {
    awaitIntent: { tap: "energy", openSettings: "settings" },
    energy: { watch: "awaitIntent", later: "awaitIntent" },
    settings: { closed: "awaitIntent" }
  }
});

const boardFeature = defineFeature("boardScreen", { flows: [boardFlow] });
const sharedLayer = defineFeature("shared", { nodes: [open] });

type BoardNodes = typeof boardFlow.nodes;

describe("stub", () => {
  it("keeps the outcome as a literal type", () => {
    expectTypeOf(stub("closed")).toEqualTypeOf<Stub<"closed">>();
    expectTypeOf(stub("orderComplete", { rewardId: "r1" })).toEqualTypeOf<Stub<"orderComplete">>();
  });

  it("takes a JSON payload only", () => {
    // @ts-expect-error a function is not JSON
    const counted = stub("done", () => 1);

    expectTypeOf(counted).toEqualTypeOf<Stub<"done">>();
  });
});

describe("StubsOf", () => {
  it("has one optional key per node of the flow", () => {
    expectTypeOf<keyof StubsOf<BoardNodes>>().toEqualTypeOf<
      "awaitIntent" | "energy" | "settings"
    >();
  });

  it("takes the outcomes the replaced entry declares, a sub-flow's own outcomes included", () => {
    expectTypeOf<NonNullable<StubsOf<BoardNodes>["energy"]>>().toEqualTypeOf<
      Stub<"watch" | "later">
    >();
    expectTypeOf<NonNullable<StubsOf<BoardNodes>["settings"]>>().toEqualTypeOf<Stub<"closed">>();
  });

  it("reads the node table through Flow.NodeTable and Flow.FlowEntry", () => {
    expectTypeOf<BoardNodes>().toExtend<Flow.NodeTable>();
    expectTypeOf(settingsFlow).toExtend<Flow.FlowEntry>();
  });
});

describe("isolate", () => {
  it("accepts stubs whose keys are nodes and whose outcomes belong to the node", () => {
    const boardOnly = isolate(boardFeature, {
      shared: sharedLayer,
      flow: boardFlow,
      as: "board",
      stubs: { settings: stub("closed"), energy: stub("later") },
      plugins: [],
      player: { n: 0 },
      session: {},
      seed: 7
    });

    expectTypeOf(boardOnly).parameter(0).toEqualTypeOf<IsolateSeams | undefined>();
    expectTypeOf(boardOnly).returns.toExtend<HeadlessApp>();
    expectTypeOf(boardOnly().flow.state().path).toEqualTypeOf<string>();
  });

  it("refuses an outcome the node does not declare", () => {
    const wrongOutcome = isolate(boardFeature, {
      flow: boardFlow,
      // @ts-expect-error "done" is not "watch" | "later"
      stubs: { energy: stub("done") },
      player: { n: 0 }
    });

    expectTypeOf(wrongOutcome).toBeFunction();
  });

  it("refuses the outcome of a node inside a stubbed sub-flow", () => {
    const innerOutcome = isolate(boardFeature, {
      flow: boardFlow,
      // @ts-expect-error "close" is the outcome of "open"; the sub-flow "settings" leaves with "closed"
      stubs: { settings: stub("close") },
      player: { n: 0 }
    });

    expectTypeOf(innerOutcome).toBeFunction();
  });

  it("refuses a key that is not a node of the flow", () => {
    const unknownKey = isolate(boardFeature, {
      flow: boardFlow,
      // @ts-expect-error "enrgy" is not a node of the flow
      stubs: { enrgy: stub("later") },
      player: { n: 0 }
    });

    expectTypeOf(unknownKey).toBeFunction();
  });

  it("needs a starting player", () => {
    // @ts-expect-error the model needs the player a new save starts from
    const withoutPlayer = isolate(boardFeature, { flow: boardFlow });

    expectTypeOf(withoutPlayer).toBeFunction();
  });

  it("takes every key and outcome for a flow widened to Flow.AnyFlow: no false error", () => {
    const wide: Flow.AnyFlow = boardFlow;

    expectTypeOf(
      isolate(boardFeature, { flow: wide, stubs: { anything: stub("x") }, player: { n: 0 } })
    ).returns.toExtend<HeadlessApp>();
  });

  it("types the seams of one app: the clock is a clock source", () => {
    const seams: IsolateSeams = { player: { n: 3 }, session: {}, seed: 2, clock: fakeClock(5) };

    expectTypeOf(seams.clock).toEqualTypeOf<Clock.ClockSource | undefined>();
    // @ts-expect-error the seed is a number
    const wrongSeed: IsolateSeams = { seed: "from-save" };

    expectTypeOf(wrongSeed).toEqualTypeOf<IsolateSeams>();
  });
});
