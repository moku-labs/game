import { describe, expect, it } from "vitest";
import { createFlowState } from "../../state";
import { createTestConfig } from "./mock-kernel";

// ---------------------------------------------------------------------------
// Unit test: createFlowState (the five module states composed into one)
// ---------------------------------------------------------------------------

const build = (): ReturnType<typeof createFlowState> =>
  createFlowState({ config: createTestConfig() });

describe("createFlowState", () => {
  it("composes one branch per module", () => {
    const state = build();

    expect(Object.keys(state).toSorted()).toEqual(["features", "fx", "gate", "inbox", "runner"]);
  });

  it("starts the features registry empty and unsealed", () => {
    const state = build();

    expect(state.features.byName.size).toBe(0);
    expect(state.features.sealed).toBe(false);
  });

  it("starts fx in live mode with nothing registered or buffered", () => {
    const state = build();

    expect(state.fx.mode).toBe("live");
    expect(state.fx.handlers.size).toBe(0);
    expect(state.fx.buffered).toEqual([]);
    expect(state.fx.settled).toEqual([]);
  });

  it("starts with a closed gate and an empty inbox", () => {
    const state = build();

    expect(state.gate.open).toBeUndefined();
    expect(state.gate.held).toBeUndefined();
    expect(state.gate.pointerActive).toBe(false);
    expect(state.inbox.queue).toEqual([]);
  });

  it("starts the runner outside any position", () => {
    const state = build();

    expect(state.runner.running).toBeUndefined();
    expect(state.runner.stack).toEqual([]);
    expect(state.runner.journal).toEqual([]);
    expect(state.runner.failures).toBe(0);
    expect(state.runner.enterCallbacks).toEqual({ load: [], scene: [] });
  });

  it("gives every app its own collections", () => {
    const first = build();
    const second = build();

    first.features.byName.set("board", {});
    first.inbox.queue.push({ type: "elapsed" });
    first.runner.journal.push({
      index: 0,
      path: "home",
      outcome: "play",
      payload: {},
      next: "board",
      now: 1000,
      hash: "h"
    });

    expect(second.features.byName.size).toBe(0);
    expect(second.inbox.queue).toEqual([]);
    expect(second.runner.journal).toEqual([]);
  });
});
