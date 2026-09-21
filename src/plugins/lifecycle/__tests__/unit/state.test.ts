import { describe, expect, it } from "vitest";
import { createLifecycleState } from "../../state";
import type { Config } from "../../types";

const config: Config = {};
const global = { orientation: "portrait", referenceSide: 1080 };

// ─── createLifecycleState ─────────────────────────────────────

describe("createLifecycleState", () => {
  it("starts with an empty stack of pause reasons", () => {
    const state = createLifecycleState({ global, config });

    expect(state).toEqual({ reasons: [] });
  });

  it("hands out a writable stack, so the api can push onto it", () => {
    const state = createLifecycleState({ global, config });

    state.reasons.push("devtools");

    expect(state.reasons).toEqual(["devtools"]);
  });

  it("gives every app its own stack", () => {
    const first = createLifecycleState({ global, config });
    const second = createLifecycleState({ global, config });

    first.reasons.push("background");

    expect(second.reasons).toEqual([]);
  });
});
