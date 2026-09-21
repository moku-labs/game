import { describe, expect, expectTypeOf, it } from "vitest";
import { coreConfig, createCore, createPlugin } from "../../../../config";
import { timePlugin } from "../../../time";
import { lifecyclePlugin } from "../../index";
import type { Events, PauseReason } from "../../types";

type Changed = Events["lifecycle:changed"];

// The engine's default plugins are not all built yet, so the test app is a bare framework
// carrying time, lifecycle and one listener.
const bare = createCore(coreConfig, { plugins: [] });

// A plugin above lifecycle, the way `flow` and `audio` will listen.
const listenerPlugin = createPlugin("listener", {
  depends: [lifecyclePlugin],
  createState: (): { seen: Changed[] } => ({ seen: [] }),
  api: ctx => ({ seen: (): readonly Changed[] => [...ctx.state.seen] }),
  hooks: ctx => ({
    "lifecycle:changed": payload => {
      expectTypeOf(payload).toEqualTypeOf<Changed>();
      ctx.state.seen.push(payload);
    }
  })
});

function createTestApp() {
  return bare.createApp({ plugins: [timePlugin, lifecyclePlugin, listenerPlugin] });
}

// `unicorn/prefer-single-call` reads two `lifecycle.push(...)` statements as `Array#push`, so a
// group of reasons goes on the stack through one helper.
function pushAll(app: ReturnType<typeof createTestApp>, ...reasons: PauseReason[]): void {
  for (const reason of reasons) app.lifecycle.push(reason);
}

// The kernel dispatches a hook from an async function it does not await.
const flushHooks = () => Promise.resolve();

// ─── the stack drives the clock ───────────────────────────────

describe("lifecycle plugin with time", () => {
  it("pauses the clock while the stack is not empty", async () => {
    const app = createTestApp();
    await app.start();

    expect(app.lifecycle.isPaused()).toBe(false);
    expect(app.time.isPaused()).toBe(false);

    app.lifecycle.push("background");

    expect(app.lifecycle.isPaused()).toBe(true);
    expect(app.time.isPaused()).toBe(true);

    app.lifecycle.push("devtools");
    app.lifecycle.pop("background");

    expect(app.lifecycle.reasons()).toEqual(["devtools"]);
    expect(app.time.isPaused()).toBe(true);

    app.lifecycle.pop("devtools");

    expect(app.lifecycle.isPaused()).toBe(false);
    expect(app.time.isPaused()).toBe(false);

    await app.stop();
  });

  it("leaves a duplicate push and an absent pop without effect", async () => {
    const app = createTestApp();
    await app.start();

    pushAll(app, "background", "background");
    app.lifecycle.pop("device-lost");
    await flushHooks();

    expect(app.lifecycle.reasons()).toEqual(["background"]);
    expect(app.listener.seen()).toHaveLength(1);

    await app.stop();
  });
});

// ─── the event reaches a plugin above ─────────────────────────

describe("lifecycle:changed", () => {
  it("reaches a plugin that depends on lifecycle, with the full payload", async () => {
    const app = createTestApp();
    await app.start();

    app.lifecycle.push("background");
    app.lifecycle.pop("background");
    await flushHooks();

    expect(app.listener.seen()).toEqual([
      {
        reason: "background",
        action: "push",
        reasons: ["background"],
        paused: true,
        resumed: false
      },
      { reason: "background", action: "pop", reasons: [], paused: false, resumed: true }
    ]);

    await app.stop();
  });

  it("marks resumed only on the change that empties the stack", async () => {
    const app = createTestApp();
    await app.start();

    pushAll(app, "background", "system-dialog");
    app.lifecycle.pop("background");
    app.lifecycle.pop("system-dialog");
    await flushHooks();

    expect(app.listener.seen().map(payload => payload.resumed)).toEqual([
      false,
      false,
      false,
      true
    ]);

    await app.stop();
  });
});

// ─── types ────────────────────────────────────────────────────

describe("lifecycle plugin types", () => {
  it("exposes a typed api on the app", async () => {
    const app = createTestApp();
    await app.start();

    expectTypeOf(app.lifecycle.push).parameter(0).toEqualTypeOf<PauseReason>();
    expectTypeOf(app.lifecycle.reasons).returns.toEqualTypeOf<readonly PauseReason[]>();
    expectTypeOf(app.lifecycle.isPaused).returns.toEqualTypeOf<boolean>();
    // @ts-expect-error — push takes a reason, not a number
    expectTypeOf(app.lifecycle.push).toBeCallableWith(1);

    expect(app.lifecycle.isPaused()).toBe(false);

    await app.stop();
  });

  it("rejects an incomplete lifecycle:changed payload", async () => {
    const app = createTestApp();
    await app.start();

    // @ts-expect-error — the payload misses every field of lifecycle:changed
    expectTypeOf(app.emit).toBeCallableWith("lifecycle:changed", {});

    expect(app.lifecycle.reasons()).toEqual([]);

    await app.stop();
  });
});
