import type { Assets, Flow } from "@moku-labs/game";
import { defineGame, load, type } from "@moku-labs/game";
import type { FakeFx, FakeFxOptions } from "@moku-labs/game/testing";
import { fakeFx } from "@moku-labs/game/testing";
import { describe, expectTypeOf, it } from "vitest";

// `fakeFx().fx` stands in for the `fx` of a node context, so it has to fit the context of a node
// that `defineGame` bound to the types of one game. Checked by `tsc`. Each `@ts-expect-error`
// fails the build in both directions: the mistake must error, and a correct line under one of
// them would be reported as an unused directive.

type Player = { coins: number };
type Session = { marks: string[] };

const { defineNode } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, never>;
}>();

const place = defineNode({
  input: type<{ cell: string }>(),
  outcomes: { placed: type() },
  run: async ({ fx, session, input, out }) => {
    await fx({ kind: "drop", payload: { cell: input.cell } });
    session.marks.push(input.cell);

    return out.placed();
  }
});
const home = defineNode({
  rest: true,
  checkpoint: true,
  outcomes: { play: type() },
  recover: ({ fx, session }) => {
    fx.start({ kind: "sfx" });
    session.marks = [];
  }
});

type PlaceContext = Parameters<NonNullable<typeof place.run>>[0];
type HomeRecoverContext = Parameters<NonNullable<typeof home.recover>>[0];

describe("fakeFx", () => {
  it("returns the fx and the three lists", () => {
    expectTypeOf(fakeFx()).toEqualTypeOf<FakeFx>();
    expectTypeOf(fakeFx().fx).toEqualTypeOf<Flow.NodeFx>();
    expectTypeOf(fakeFx().awaited).toEqualTypeOf<Flow.Descriptor[]>();
    expectTypeOf(fakeFx().started).toEqualTypeOf<Flow.Descriptor[]>();
    expectTypeOf(fakeFx().emitted).toEqualTypeOf<Flow.Hint[]>();
  });

  it("fits the fx of a node context bound by defineGame", () => {
    expectTypeOf(fakeFx().fx).toExtend<PlaceContext["fx"]>();

    // The line a test writes: the fake goes where the context has its `fx`.
    const withFake: Pick<PlaceContext, "fx" | "input"> = {
      input: { cell: "c3" },
      fx: fakeFx().fx
    };

    expectTypeOf(withFake.fx).toEqualTypeOf<PlaceContext["fx"]>();
  });

  it("fits the fx of the context of recover too", () => {
    expectTypeOf(fakeFx().fx).toExtend<HomeRecoverContext["fx"]>();
  });

  it("takes an answer per descriptor, a value or a promise, and a path", () => {
    expectTypeOf(fakeFx).parameter(0).toEqualTypeOf<FakeFxOptions | undefined>();
    expectTypeOf<FakeFxOptions["answer"]>().toEqualTypeOf<
      ((descriptor: Flow.Descriptor) => unknown) | undefined
    >();
    expectTypeOf(
      fakeFx({ answer: descriptor => (descriptor.kind === "popup" ? { intent: "again" } : 7) })
    ).toEqualTypeOf<FakeFx>();
    expectTypeOf(
      fakeFx({ answer: async () => "later", path: "board/place" })
    ).toEqualTypeOf<FakeFx>();
  });

  it("refuses a path that is not a string and an answer that is not a function", () => {
    // @ts-expect-error the path is the node's path, a string
    const wrongPath = fakeFx({ path: 3 });
    // @ts-expect-error the answer is a function of the descriptor
    const wrongAnswer = fakeFx({ answer: { intent: "again" } });

    expectTypeOf(wrongPath).toEqualTypeOf<FakeFx>();
    expectTypeOf(wrongAnswer).toEqualTypeOf<FakeFx>();
  });

  it("keeps each list in place: a test empties one, it never replaces one", () => {
    const fx = fakeFx();

    // @ts-expect-error the fake writes to its own array, so another array would stay empty
    fx.started = [];
    fx.started.length = 0;

    expectTypeOf(fx.started).toEqualTypeOf<Flow.Descriptor[]>();
  });

  it("resolves what the descriptor declares, and records a typed descriptor as any other", () => {
    const fake = fakeFx();

    expectTypeOf(fake.fx(load("board"))).toEqualTypeOf<Promise<Assets.LoadResult | undefined>>();
    expectTypeOf(fake.fx({ kind: "drop" })).toEqualTypeOf<Promise<unknown>>();

    fake.awaited.push(load("board"));

    expectTypeOf(fake.awaited).toEqualTypeOf<Flow.Descriptor[]>();
  });

  it("starts and emits without a value: nothing waits for either", () => {
    expectTypeOf(fakeFx().fx.start).returns.toBeVoid();
    expectTypeOf(fakeFx().fx.emit).returns.toBeVoid();
    expectTypeOf(fakeFx().fx).returns.toEqualTypeOf<Promise<unknown>>();
  });
});
