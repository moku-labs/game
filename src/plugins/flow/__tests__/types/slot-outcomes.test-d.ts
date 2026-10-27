import { describe, expectTypeOf, it } from "vitest";
import type { Flow } from "../../../../index";
import { contribution, defineFeature, exit, slot, to, type } from "../../../../index";
import { defineFlow, defineNode } from "../../runner/define";
import type { Fits, GraphError, SlotNode, TypeTag } from "../../runner/types";

// What a game can get wrong with the named outcomes of a slot. Each `@ts-expect-error` fails the
// build in both directions: the mistake must error, and a correct line under one would be an
// unused directive.

type ShopEntry = { tab: string; from: string };

const handBacks = { board: type(), shop: type<{ tab: string }>() };
const episodeStep = slot("episodeStep", handBacks);
const afterOrder = slot("afterOrder");

const home = defineNode({ rest: true, checkpoint: true, outcomes: { play: type() } });
const mergeBoard = defineNode({ rest: true, outcomes: { back: type() } });
const shopSheet = defineNode({
  rest: true,
  input: type<ShopEntry>(),
  outcomes: { close: type() }
});

// The host routes every outcome the slot declares; the payload of `shop` is typed into the mapper.
const mainFlow = defineFlow("main", {
  nodes: { home, episodeStep, mergeBoard, shopSheet },
  start: "home",
  edges: {
    home: { play: "episodeStep" },
    episodeStep: {
      done: "home",
      board: "mergeBoard",
      shop: to(
        "shopSheet",
        (payload: { tab: string }): ShopEntry => ({ ...payload, from: "memory" })
      )
    },
    mergeBoard: { back: "home" },
    shopSheet: { close: "home" }
  }
});

// A declared outcome without an edge.
defineFlow("missingShop", {
  nodes: { home, episodeStep, mergeBoard },
  start: "home",
  edges: {
    home: { play: "episodeStep" },
    // @ts-expect-error — outcome "shop" of the slot "episodeStep" has no edge
    episodeStep: { done: "home", board: "mergeBoard" },
    mergeBoard: { back: "home" }
  }
});

// A mapper that reads a payload the slot does not carry.
defineFlow("wrongMapper", {
  nodes: { home, episodeStep, mergeBoard, shopSheet },
  start: "home",
  edges: {
    home: { play: "episodeStep" },
    episodeStep: {
      done: "home",
      board: "mergeBoard",
      // @ts-expect-error — the payload of "shop" is { tab: string }, not { tab: number }
      shop: to(
        "shopSheet",
        (payload: { tab: number }): ShopEntry => ({ tab: "", from: String(payload.tab) })
      )
    },
    mergeBoard: { back: "home" },
    shopSheet: { close: "home" }
  }
});

// A declared payload into a node whose input it does not fit, without a mapper.
defineFlow("wrongTarget", {
  nodes: { home, episodeStep, mergeBoard, shopSheet },
  start: "home",
  edges: {
    home: { play: "episodeStep" },
    // @ts-expect-error — { tab } does not fit the input { tab, from } of node "shopSheet"
    episodeStep: { done: "home", board: "mergeBoard", shop: "shopSheet" },
    mergeBoard: { back: "home" },
    shopSheet: { close: "home" }
  }
});

// `done` is every slot's own outcome.
// @ts-expect-error — slot() refuses a declared done
slot("broken", { done: type() });

const panorama = defineNode({
  rest: true,
  outcomes: { next: type(), shop: type<{ tab: string }>() }
});
const storyFlow = defineFlow("story", {
  nodes: { panorama },
  start: "panorama",
  outcomes: { done: type(), shop: type<{ tab: string }>() },
  edges: { panorama: { next: exit("done"), shop: exit("shop") } }
});

const gift = defineNode({ rest: true, outcomes: { open: type() } });
const giftFlow = defineFlow("gift", {
  nodes: { gift },
  start: "gift",
  outcomes: { done: type(), gift: type() },
  edges: { gift: { open: exit("gift") } }
});

const tabByNumber = defineNode({ rest: true, outcomes: { shop: type<{ tab: number }>() } });
const numberFlow = defineFlow("number", {
  nodes: { tabByNumber },
  start: "tabByNumber",
  outcomes: { shop: type<{ tab: number }>() },
  edges: { tabByNumber: { shop: exit("shop") } }
});

const intro = defineNode({ rest: true, outcomes: { next: type() } });
const doneFlow = defineFlow("intro", {
  nodes: { intro },
  start: "intro",
  outcomes: { done: type() },
  edges: { intro: { next: exit("done") } }
});
const plainFlow = defineFlow("plain", {
  nodes: { intro },
  start: "intro",
  edges: { intro: { next: "intro" } }
});

// A flow that exits an outcome the slot does not declare.
contribution(episodeStep, {
  // @ts-expect-error — slot "episodeStep" declares no outcome "gift"
  flow: giftFlow,
  order: 10
});

// A flow whose payload does not fit the slot's outcome of the same name.
contribution(episodeStep, {
  // @ts-expect-error — the payload of "shop" does not fit slot "episodeStep"
  flow: numberFlow,
  order: 10
});

describe("slot outcomes", () => {
  it("keeps a slot assignable to SlotNode and FlowEntry, where the runner reads it", () => {
    const plain: SlotNode = afterOrder;
    const declared: SlotNode = episodeStep;
    const entries: readonly Flow.FlowEntry[] = [afterOrder, episodeStep];

    expectTypeOf(plain.name).toEqualTypeOf<string>();
    expectTypeOf(declared.outcomes.done).toEqualTypeOf<TypeTag<void>>();
    expectTypeOf(entries).toEqualTypeOf<readonly Flow.FlowEntry[]>();
  });

  it("types the declared outcomes and the name of the slot", () => {
    expectTypeOf(episodeStep.name).toEqualTypeOf<"episodeStep">();
    expectTypeOf(episodeStep.outcomes.shop).toEqualTypeOf<TypeTag<{ tab: string }>>();
    expectTypeOf(mainFlow.edges.episodeStep).toHaveProperty("shop");
  });

  it("accepts a flow whose outcomes the slot declares, done, or no outcome at all", () => {
    expectTypeOf(contribution(episodeStep, { flow: storyFlow, order: 10 })).toEqualTypeOf<
      Readonly<Record<"episodeStep", Flow.ContributionSpec>>
    >();
    contribution(episodeStep, { flow: doneFlow, order: 20, when: () => true });
    contribution(episodeStep, { flow: plainFlow, order: 30 });
  });

  it("reads Fits as unknown for a fitting flow and as the sentence for a misfit", () => {
    expectTypeOf<Fits<typeof storyFlow, typeof episodeStep>>().toEqualTypeOf<unknown>();
    expectTypeOf<Fits<typeof giftFlow, typeof episodeStep>>().toEqualTypeOf<
      GraphError<'Slot "episodeStep" declares no outcome "gift".'>
    >();
  });

  it("lets a slot that declares no outcome take any flow", () => {
    expectTypeOf(contribution(afterOrder, { flow: giftFlow, order: 10 })).toEqualTypeOf<
      Readonly<Record<"afterOrder", Flow.ContributionSpec>>
    >();
    expectTypeOf(contribution(afterOrder, { flow: numberFlow, order: 20 })).toEqualTypeOf<
      Readonly<Record<"afterOrder", Flow.ContributionSpec>>
    >();
  });

  it("spreads the typed entry into the contribute of a feature", () => {
    const storyFeature = defineFeature("story", {
      flows: [storyFlow],
      contribute: { ...contribution(episodeStep, { flow: storyFlow, order: 10 }) }
    });

    expectTypeOf(storyFeature).toEqualTypeOf<Flow.FeaturePlugin>();
  });
});
