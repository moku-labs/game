import { describe, expectTypeOf, it } from "vitest";
import type { World } from "../../../../index";
import { defineFeature } from "../../../../index";

// What a game that comes from 0.15.3 can get wrong. Each `@ts-expect-error` fails the build in
// both directions: the mistake must error, and a correct line under one would be an unused
// directive.

// @ts-expect-error — systemsRun is gone: a system runs while its query has an entity
defineFeature("board", { systemsRun: "active" });

// @ts-expect-error — "always" is gone too: delete the key
defineFeature("shop", { systemsRun: "always" });

describe("after systemsRun", () => {
  it("keeps resumed for the system and drops hold and isActive from the world", () => {
    expectTypeOf<World.SystemContext["resumed"]>().toEqualTypeOf<boolean>();
    expectTypeOf<World.EcsApi>().not.toHaveProperty("hold");
    expectTypeOf<World.EcsApi>().not.toHaveProperty("isActive");

    const write = (context: World.SystemContext): void => {
      // @ts-expect-error — resumed is the runner's to write, a system only reads it
      context.resumed = true;
    };

    expectTypeOf(write).toBeFunction();
  });
});
