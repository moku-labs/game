import { describe, expect, it } from "vitest";
import { createLifecycleState } from "../../state";
import type { Config } from "../../types";

const config: Config = {};

// ─── createLifecycleState ─────────────────────────────────────

describe("createLifecycleState", () => {
  it("starts with an empty stack of pause reasons", () => {
    const state = createLifecycleState({ config });

    expect(state).toEqual({ reasons: [] });
  });

  it("hands out a writable stack, so the api can push onto it", () => {
    const state = createLifecycleState({ config });

    state.reasons.push("devtools");

    expect(state.reasons).toEqual(["devtools"]);
  });

  it("gives every app its own stack", () => {
    const first = createLifecycleState({ config });
    const second = createLifecycleState({ config });

    first.reasons.push("background");

    expect(second.reasons).toEqual([]);
  });
});
