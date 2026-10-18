import { describe, expectTypeOf, it } from "vitest";
import type { Flow, World } from "../../../../index";
import { defineFeature } from "../../../../index";

// What a game can get wrong with `systemsRun` (spec 28 F1). Each `@ts-expect-error` fails the
// build in both directions: the mistake must error, and a correct line under one would be an
// unused directive.

// @ts-expect-error — "scene" is not a way to run systems: only "always" and "active"
defineFeature("board", { systemsRun: "scene" });

describe("systemsRun", () => {
  it("accepts always and active, and the game reads the union as Flow.SystemsRun", () => {
    defineFeature("board", { systemsRun: "always" });
    defineFeature("shop", { systemsRun: "active" });

    expectTypeOf<Flow.SystemsRun>().toEqualTypeOf<"always" | "active">();
  });

  it("hands a system a readonly resumed flag, and hold a release", () => {
    expectTypeOf<World.SystemContext["resumed"]>().toEqualTypeOf<boolean>();
    expectTypeOf<World.EcsApi["hold"]>().returns.toEqualTypeOf<() => void>();

    const write = (context: World.SystemContext): void => {
      // @ts-expect-error — resumed is the runner's to write, a system only reads it
      context.resumed = true;
    };

    expectTypeOf(write).toBeFunction();
  });
});
