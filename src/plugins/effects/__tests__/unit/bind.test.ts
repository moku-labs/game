import { describe, expect, it } from "vitest";
import { effectsFor } from "../../bind";
import { Displacement } from "../../filters/builtins";
import { Emitter } from "../../particles/component";
import { defineEmitter } from "../../particles/define";

// ---------------------------------------------------------------------------
// Unit test: the binder defineGame spreads is type-only — the same objects
// ---------------------------------------------------------------------------

describe("effectsFor", () => {
  it("hands out the same functions and component objects", () => {
    const kit = effectsFor<"fx.star", "fx.stars">();

    expect(kit.defineEmitter).toBe(defineEmitter);
    expect(kit.Emitter).toBe(Emitter);
    expect(kit.Displacement).toBe(Displacement);
    expect(Object.keys(kit).toSorted()).toEqual(["Displacement", "Emitter", "defineEmitter"]);
    expect(kit.defineEmitter("fx.stars", { textures: ["fx.star"], burst: 4 }).config.burst).toBe(4);
  });
});
