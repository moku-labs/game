import { describe, expect, it } from "vitest";
import type { Hint } from "../../../flow/types";
import { commitItems, mountBoard } from "./board";
import { createMockWorld } from "./mock-world";

const merged = (from: string, into: string, projection?: string): Hint => ({
  kind: "merged",
  payload: projection === undefined ? { from, into } : { from, into, projection },
  hint: true
});

describe("projection hints", () => {
  it("routes a hint to the entry whose key is a value of its payload", () => {
    const world = createMockWorld();
    const seen: Array<{ hook: string; kind: string | undefined }> = [];

    mountBoard(
      world,
      [
        { id: "a", level: 1, x: 0, y: 0 },
        { id: "b", level: 1, x: 50, y: 0 }
      ],
      {
        exit: (_view, _item, hint) => {
          seen.push({ hook: "exit", kind: hint?.kind });
        },
        change: {
          Level: (_view, _previous, _next, hint) => {
            seen.push({ hook: "change", kind: hint?.kind });
          }
        }
      }
    );

    world.release(merged("a", "b"));
    commitItems(world, [{ id: "b", level: 2, x: 50, y: 0 }]);
    world.frame();

    expect(seen).toEqual([
      { hook: "change", kind: "merged" },
      { hook: "exit", kind: "merged" }
    ]);
  });

  it("narrows a hint to one projection with payload.projection", () => {
    const world = createMockWorld();
    const seen: Array<string | undefined> = [];

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      exit: (_view, _item, hint) => {
        seen.push(hint?.kind);
      }
    });

    world.release(merged("a", "b", "other.projection"));
    commitItems(world, []);
    world.frame();

    expect(seen).toEqual([undefined]);
  });

  it("empties the buffer every frame, reconcile or not", () => {
    const world = createMockWorld();
    const seen: Array<string | undefined> = [];

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      exit: (_view, _item, hint) => {
        seen.push(hint?.kind);
      }
    });

    world.release(merged("a", "b"));
    world.frame();

    expect(world.ctx.state.projection.hints).toEqual([]);

    commitItems(world, []);
    world.frame();

    expect(seen).toEqual([undefined]);
  });

  it("drops a hint that matches no entry", () => {
    const world = createMockWorld({ reconciledEvent: true });

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    world.emitted.length = 0;

    world.release(merged("ghost", "phantom"));
    commitItems(world, [{ id: "a", level: 2, x: 0, y: 0 }]);
    world.frame();

    expect(world.emitted[0]?.payload).toMatchObject({ hintsRouted: 0, hintsDropped: 1 });
  });
});
