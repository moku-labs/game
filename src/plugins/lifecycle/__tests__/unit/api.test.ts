import type { Mock } from "vitest";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Require } from "../../../../config";
import { createLifecycleApi } from "../../api";
import { createLifecycleState } from "../../state";
import type { Api, Config, Events, LifecycleCtx, PauseReason } from "../../types";

const global = { orientation: "portrait", referenceSide: 1080 };

type EmitSpy = Mock<(name: "lifecycle:changed", payload: Events["lifecycle:changed"]) => void>;

type Harness = {
  api: Api;
  ctx: LifecycleCtx;
  emit: EmitSpy;
  time: { pause: Mock; resume: Mock };
};

function createHarness(): Harness {
  const config: Config = {};
  const time = { pause: vi.fn(), resume: vi.fn() };
  const emit: EmitSpy = vi.fn();
  const ctx: LifecycleCtx = {
    config,
    state: createLifecycleState({ global, config }),
    emit,
    // Partial mock of the kernel's generic `require`: the lifecycle api resolves `timePlugin` only.
    require: (() => time) as unknown as Require
  };

  return { api: createLifecycleApi(ctx), ctx, emit, time };
}

// `unicorn/prefer-single-call` reads two `api.push(...)` statements as `Array#push`, so a group
// of reasons goes on the stack through one helper.
function pushAll(api: Api, ...reasons: PauseReason[]): void {
  for (const reason of reasons) api.push(reason);
}

// ─── push ─────────────────────────────────────────────────────

describe("push", () => {
  it("puts the reason on the stack and pauses the game", () => {
    const { api } = createHarness();

    api.push("background");

    expect(api.reasons()).toEqual(["background"]);
    expect(api.isPaused()).toBe(true);
  });

  it("keeps the reasons in insertion order", () => {
    const { api } = createHarness();

    pushAll(api, "background", "devtools", "system-dialog");

    expect(api.reasons()).toEqual(["background", "devtools", "system-dialog"]);
  });

  it("accepts a reason of the game, not only the engine's own ones", () => {
    const { api } = createHarness();

    api.push("cutscene");

    expect(api.reasons()).toEqual(["cutscene"]);
  });

  it("pauses time with the first reason", () => {
    const { api, time } = createHarness();

    api.push("background");

    expect(time.pause).toHaveBeenCalledTimes(1);
    expect(time.resume).not.toHaveBeenCalled();
  });

  it("pauses time once, however many reasons follow", () => {
    const { api, time } = createHarness();

    pushAll(api, "background", "devtools", "device-lost");

    expect(time.pause).toHaveBeenCalledTimes(1);
  });

  it("emits lifecycle:changed with the reason, the action and the whole stack", () => {
    const { api, emit } = createHarness();

    pushAll(api, "background", "devtools");

    expect(emit).toHaveBeenNthCalledWith(1, "lifecycle:changed", {
      reason: "background",
      action: "push",
      reasons: ["background"],
      paused: true,
      resumed: false
    });
    expect(emit).toHaveBeenNthCalledWith(2, "lifecycle:changed", {
      reason: "devtools",
      action: "push",
      reasons: ["background", "devtools"],
      paused: true,
      resumed: false
    });
  });

  it("stays silent on a reason that is already on the stack", () => {
    const { api, ctx, emit, time } = createHarness();

    api.push("background");
    emit.mockClear();
    time.pause.mockClear();
    api.push("background");

    expect(ctx.state.reasons).toEqual(["background"]);
    expect(emit).not.toHaveBeenCalled();
    expect(time.pause).not.toHaveBeenCalled();
  });
});

// ─── pop ──────────────────────────────────────────────────────

describe("pop", () => {
  it("takes the reason off the stack", () => {
    const { api } = createHarness();

    pushAll(api, "background", "devtools");
    api.pop("background");

    expect(api.reasons()).toEqual(["devtools"]);
  });

  it("keeps the game paused while another reason remains", () => {
    const { api, time } = createHarness();

    pushAll(api, "background", "devtools");
    api.pop("background");

    expect(api.isPaused()).toBe(true);
    expect(time.resume).not.toHaveBeenCalled();
  });

  it("resumes time when the last reason leaves", () => {
    const { api, time } = createHarness();

    pushAll(api, "background", "devtools");
    api.pop("background");
    api.pop("devtools");

    expect(api.isPaused()).toBe(false);
    expect(time.pause).toHaveBeenCalledTimes(1);
    expect(time.resume).toHaveBeenCalledTimes(1);
  });

  it("emits resumed only on the change that empties the stack", () => {
    const { api, emit } = createHarness();

    pushAll(api, "background", "devtools");
    emit.mockClear();
    api.pop("devtools");
    api.pop("background");

    expect(emit).toHaveBeenNthCalledWith(1, "lifecycle:changed", {
      reason: "devtools",
      action: "pop",
      reasons: ["background"],
      paused: true,
      resumed: false
    });
    expect(emit).toHaveBeenNthCalledWith(2, "lifecycle:changed", {
      reason: "background",
      action: "pop",
      reasons: [],
      paused: false,
      resumed: true
    });
  });

  it("stays silent on a reason that is not on the stack", () => {
    const { api, emit, time } = createHarness();

    api.pop("background");

    expect(api.reasons()).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
    expect(time.resume).not.toHaveBeenCalled();
  });

  it("stays silent on an absent reason while the game is paused", () => {
    const { api, ctx, emit, time } = createHarness();

    api.push("background");
    emit.mockClear();
    api.pop("devtools");

    expect(ctx.state.reasons).toEqual(["background"]);
    expect(emit).not.toHaveBeenCalled();
    expect(time.resume).not.toHaveBeenCalled();
  });

  it("pauses time again when a reason returns after the stack was emptied", () => {
    const { api, time } = createHarness();

    api.push("background");
    api.pop("background");
    api.push("background");

    expect(time.pause).toHaveBeenCalledTimes(2);
    expect(time.resume).toHaveBeenCalledTimes(1);
  });
});

// ─── reasons ──────────────────────────────────────────────────

describe("reasons", () => {
  it("returns a frozen copy", () => {
    const { api } = createHarness();

    api.push("background");
    const list = api.reasons();

    expect(Object.isFrozen(list)).toBe(true);
  });

  it("returns a copy that does not follow a later change", () => {
    const { api } = createHarness();

    api.push("background");
    const before = api.reasons();
    api.push("devtools");

    expect(before).toEqual(["background"]);
  });

  it("hands out a copy the caller cannot write into the state through", () => {
    const { api, ctx } = createHarness();

    api.push("background");
    const list = api.reasons();
    ctx.state.reasons.push("devtools");

    expect(list).toEqual(["background"]);
  });

  it("is empty before the first push", () => {
    const { api } = createHarness();

    expect(api.reasons()).toEqual([]);
  });
});

// ─── isPaused ─────────────────────────────────────────────────

describe("isPaused", () => {
  it("follows the stack", () => {
    const { api } = createHarness();

    expect(api.isPaused()).toBe(false);

    api.push("background");

    expect(api.isPaused()).toBe(true);

    api.pop("background");

    expect(api.isPaused()).toBe(false);
  });
});

// ─── the event payload ────────────────────────────────────────

describe("the lifecycle:changed payload", () => {
  it("carries a frozen stack that does not follow later changes", () => {
    const { api, emit } = createHarness();

    api.push("background");

    const payload = emit.mock.calls[0]?.[1];
    api.push("devtools");

    expect(Object.isFrozen(payload?.reasons)).toBe(true);
    expect(payload?.reasons).toEqual(["background"]);
  });
});

// ─── types ────────────────────────────────────────────────────

describe("lifecycle api types", () => {
  it("takes a pause reason and returns a readonly stack", () => {
    const { api } = createHarness();

    expectTypeOf(api.push).parameter(0).toEqualTypeOf<PauseReason>();
    expectTypeOf(api.pop).parameter(0).toEqualTypeOf<PauseReason>();
    expectTypeOf(api.reasons).returns.toEqualTypeOf<readonly PauseReason[]>();
    expectTypeOf(api.isPaused).returns.toEqualTypeOf<boolean>();

    expect(api.isPaused()).toBe(false);
  });

  it("rejects an incomplete lifecycle:changed payload", () => {
    const { ctx } = createHarness();

    // @ts-expect-error — the payload misses every field of lifecycle:changed
    expectTypeOf(ctx.emit).toBeCallableWith("lifecycle:changed", {});
    // @ts-expect-error — "lifecycle:paused" is not an event of this plugin
    expectTypeOf(ctx.emit).toBeCallableWith("lifecycle:paused", {
      reason: "background",
      action: "push",
      reasons: [],
      paused: true,
      resumed: false
    });

    expect(ctx.state.reasons).toEqual([]);
  });
});
