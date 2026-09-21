import * as engine from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import { defineFeature } from "../../src/plugins/flow/feature";
import { defineFlow, defineNode } from "../../src/plugins/flow/runner/define";

describe("root index", () => {
  it("resolves the package name to the source", () => {
    expect(engine.createApp).toBeTypeOf("function");
    expect(engine.createPlugin).toBeTypeOf("function");
  });

  it("defineGame returns the same functions the flow plugin exports", () => {
    const kit = engine.defineGame();

    expect(kit.defineNode).toBe(defineNode);
    expect(kit.defineFlow).toBe(defineFlow);
    expect(kit.defineFeature).toBe(defineFeature);
    expect(Object.keys(kit)).toEqual(["defineNode", "defineFlow", "defineFeature"]);
  });

  it("exports no genre rules", () => {
    expect(Object.keys(engine)).not.toContain("rules");
  });
});
