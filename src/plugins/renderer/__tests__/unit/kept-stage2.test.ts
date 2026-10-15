import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Shape, Transform } from "../../components";
import type { FilterSlot, FilterSlotInputs, PixiContainer } from "../../types";
import { type Drawn, startDrawn } from "../demand-harness";
import type { RenderCall } from "../stage-pixi";

// ---------------------------------------------------------------------------
// Stage 2 of a kept picture (spec 23 P3.2, P3.4; spec 24 B3.9): the pre-pass of
// the first filter with inputs runs once over the picture into engine targets,
// through the record's own keeper stand-in, keyed by (version(), picture).
// A fake seam records what the cache asks of it.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) {
    drawn.oracle.expectNoMissedFrame();
    drawn.oracle.expectPicturesCurrent();
    drawn.mock.stop();
  }

  vi.restoreAllMocks();
});

/** A fake seam of a filter with one input, and what the cache asked of it. */
type FakeInputs = {
  inputs: FilterSlotInputs;
  /** `hold` calls, in order: the count of results, or "none". */
  holds: string[];
  /** The scale `scaleOf` answers; `undefined` for an empty chain. */
  scale: { value: number | undefined };
  /** Changes what the stages draw. */
  bump(): void;
};

/**
 * Makes the fake seam.
 *
 * @param scale - The scale its chain draws at; `"empty"` for an empty chain.
 * @returns The seam and its records.
 */
function fakeInputs(scale: number | "empty" = 0.5): FakeInputs {
  const holds: string[] = [];
  const state = { version: 1, scale: { value: scale === "empty" ? undefined : scale } };
  const inputs: FilterSlotInputs = {
    stages: [],
    count: 1,
    version: () => state.version,
    scaleOf: () => state.scale.value,
    draw: vi.fn(),
    hold: results => {
      holds.push(results === undefined ? "none" : String(results.length));
    }
  };

  return {
    inputs,
    holds,
    scale: state.scale,
    bump: () => {
      state.version += 1;
    }
  };
}

/**
 * Starts the renderer, every frame drawn, and keeps a 40 x 40 shape with these slots: taken in the third frame.
 * The slots are made once the page is up: a Pixi filter asks the page for its precision.
 *
 * @param slots - Makes its filter slots.
 * @returns The renderer and the entity.
 */
async function keptWith(slots: () => FilterSlot[]): Promise<{ drawn: Drawn; entity: Entity }> {
  const drawn = await startDrawn({ onDemand: false });
  const entity = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

  running.push(drawn);
  drawn.mock.api.sync.filters.set(entity, slots());
  drawn.frames(3);

  return { drawn, entity };
}

/**
 * The renders of a frame of the log, from a point.
 *
 * @param drawn - The running renderer.
 * @param from - The log length to count from.
 * @returns The labels of the containers rendered, in order.
 */
function rendered(drawn: Drawn, from: number): string[] {
  return drawn.stage
    .targets()
    .slice(from)
    .map(call => call.container.label);
}

/**
 * The slot of a filter with the fake seam: the frost-like filter of the stack.
 *
 * @param fake - The fake seam.
 * @returns The slot.
 */
function withInputs(fake: FakeInputs): FilterSlot {
  const filter = new pixi.AlphaFilter();

  filter.padding = 4;

  return { filter, passes: 2, cache: "local", inputs: fake.inputs };
}

/**
 * The keeper's render of the last take: its stand-in's call in the log.
 *
 * @param drawn - The running renderer.
 * @returns The call.
 */
function keeperCall(drawn: Drawn): RenderCall | undefined {
  return drawn.stage
    .targets()
    .findLast(
      call => call.container.label.startsWith("kept:") && call.container.label.endsWith("#2")
    );
}

describe("stage 2 of a kept picture", () => {
  it("the pre-pass result is kept while the chain's version and the picture stay", async () => {
    const fake = fakeInputs();
    const made: { filter: pixi.AlphaFilter | undefined } = { filter: undefined };
    const { drawn, entity } = await keptWith(() => {
      made.filter = new pixi.AlphaFilter();

      return [withInputs(fake), { filter: made.filter, passes: 1, cache: "local" }];
    });
    const from = drawn.stage.targets().length;
    const label = `Shape#${entity}`;

    expect(fake.holds).toEqual(["none", "1"]);

    drawn.mock.api.invalidate(entity);
    if (made.filter !== undefined) made.filter.alpha = 0.5;
    drawn.frame();

    expect(rendered(drawn, from)).toEqual([`kept:${label}#3`]);
    expect(fake.holds).toEqual(["none", "1"]);
  });

  it("a new chain version redoes stages 2 and 3, not 1; a new picture redoes 1, 2 and 3", async () => {
    const fake = fakeInputs();
    const { drawn, entity } = await keptWith(() => [withInputs(fake)]);
    const label = `Shape#${entity}`;
    let from = drawn.stage.targets().length;

    fake.bump();
    drawn.mock.api.invalidate(entity);
    drawn.frame();

    expect(rendered(drawn, from)).toEqual([`kept:${label}#2`, `kept:${label}#3`]);

    from = drawn.stage.targets().length;
    drawn.mock.world.ecs.set(entity, Shape, { fill: 0xff_00_00 });
    drawn.frame();

    expect(rendered(drawn, from)).toEqual([label, `kept:${label}#2`, `kept:${label}#3`]);
  });

  it("draw gets engine targets sized from scaleOf, and a scale change after draw resizes them and draws again", async () => {
    const fake = fakeInputs(0.5);
    const drawn = await startDrawn({ onDemand: false });
    const entity = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

    running.push(drawn);
    // A resolution change evaluated inside the chain's draw: the scale of its last step changes there.
    drawn.stage.last().renderer.watchers.push(call => {
      if (call.target !== undefined && call.container.label.endsWith("#2")) fake.scale.value = 0.25;
    });
    drawn.mock.api.sync.filters.set(entity, [withInputs(fake)]);
    drawn.frames(3);

    const keepers = drawn.stage
      .targets()
      .filter(
        call => call.container.label.startsWith("kept:") && call.container.label.endsWith("#2")
      );
    const target = drawn.mock.ctx.state.kept.byEntity.get(entity)?.s2[0];

    expect(keepers).toHaveLength(2);
    // The picture's padded frame (40 + 2 × 4 CSS px) at the stack resolution times the scale.
    expect(target?.source.width).toBe(48);
    expect(target?.source.resolution).toBe(0.25);
    expect(fake.holds.at(-1)).toBe("1");
  });

  it("an empty chain holds nothing", async () => {
    const fake = fakeInputs("empty");
    const { drawn } = await keptWith(() => [withInputs(fake)]);

    expect(keeperCall(drawn)).toBeUndefined();
    expect(fake.holds).toEqual(["none"]);
  });

  it("a filter with inputs that is not first in the stack runs its chain live", async () => {
    const fake = fakeInputs();
    const { drawn } = await keptWith(() => [
      { filter: new pixi.AlphaFilter(), passes: 1, cache: "local" },
      withInputs(fake)
    ]);

    expect(keeperCall(drawn)).toBeUndefined();
    expect(fake.holds).toEqual([]);
  });

  it("going live ends the loan before any target is destroyed", async () => {
    const fake = fakeInputs();
    const { drawn, entity } = await keptWith(() => [withInputs(fake)]);
    const order: string[] = [];
    const target = drawn.mock.ctx.state.kept.byEntity.get(entity)?.s2[0];

    fake.inputs.hold = results => {
      order.push(results === undefined ? "hold:none" : "hold");
    };
    if (target !== undefined) {
      const destroy = target.destroy.bind(target);

      target.destroy = (options?: boolean) => {
        order.push("destroy");
        destroy(options);
      };
    }

    drawn.mock.world.ecs.despawn(entity);
    drawn.frame();

    expect(order[0]).toBe("hold:none");
    expect(order).toContain("destroy");
  });

  it("stage 2 renders the keeper stand-in, whose only filter is the keeper, and the stand-in keeps the record's filters", async () => {
    const fake = fakeInputs();
    let slot: FilterSlot | undefined;
    const { drawn, entity } = await keptWith(() => {
      slot = withInputs(fake);

      return [slot];
    });
    const keeper = keeperCall(drawn);
    const standIn = drawn.stage
      .targets()
      .findLast(
        call =>
          call.target?.source.label === `kept:Shape#${entity}#3` &&
          !call.container.label.endsWith("#2")
      );

    expect(keeper?.container.filters).toHaveLength(1);
    expect(keeper?.container.filters?.[0]).not.toBe(slot?.filter);
    expect(standIn?.container.filters).toEqual([slot?.filter]);

    // The keeper runs the chain into the record's targets, from the input Pixi hands its apply.
    const input = pixi.Texture.WHITE;
    const manager = {} as Parameters<pixi.Filter["apply"]>[0];

    keeper?.container.filters?.[0]?.apply(manager, input, input, true);

    expect(fake.inputs.draw).toHaveBeenCalledWith(
      manager,
      input,
      drawn.mock.ctx.state.kept.byEntity.get(entity)?.s2
    );

    const stand = keeper?.container as PixiContainer | undefined;

    drawn.mock.world.ecs.despawn(entity);
    drawn.frame();

    expect(stand?.destroyed).toBe(true);
    // Its filters are cleared before the destroy: Pixi answers no list of them.
    expect(stand?.filters ?? []).toEqual([]);
  });
});
