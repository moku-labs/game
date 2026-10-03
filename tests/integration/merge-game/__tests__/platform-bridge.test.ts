/**
 * @file The bridge from `@moku-labs/system` to the engine's `PlatformProvider`, with a fake system:
 * pause and resume go to `lifecycle`, the Back press to `back.onPress`, the seven haptic kinds to
 * `impact`, `notify` and `selection`, keep-awake to `keepAwake.set` and `exit` to `back.exit`. The
 * last block runs the game on Home with the bridge over the fake, as the native shell does.
 */
import type { HapticKind } from "@moku-labs/game";
import { HAPTIC_KINDS } from "@moku-labs/game";
import type { SystemResult } from "@moku-labs/system";
import { describe, expect, it, vi } from "vitest";
import { frames, player, startOnHome, tap, tick } from "../../timber-helpers";
import type { SystemSlice } from "../platform-bridge";
import { fromSystem } from "../platform-bridge";

/** What every fake capability answers: done, by the web provider. */
const done: SystemResult<void> = { ok: true, value: undefined, provider: "web" };

/** The fake system and the handlers the game handed it. */
type FakeSystem = {
  system: SystemSlice;
  /** The removers the fake handed out, by capability. */
  removers: { pause: () => void; resume: () => void; back: () => void };
  /** Plays the shell going to the background. */
  pause: () => void;
  /** Plays the shell coming back. */
  resume: () => void;
  /** Plays one press of the system Back button; what the handler answered. */
  press: () => boolean | undefined;
};

/**
 * Creates the fake system: the four capabilities the bridge reads, each a spy that answers
 * `done`, and the handlers it was handed, so a test plays the shell.
 *
 * @returns The fake and the controls of the shell.
 */
function fakeSystem(): FakeSystem {
  const handlers: { pause?: () => void; resume?: () => void; back?: () => boolean } = {};
  const removers = { pause: vi.fn(), resume: vi.fn(), back: vi.fn() };
  const system: SystemSlice = {
    lifecycle: {
      onPause: vi.fn((fn: () => void) => {
        handlers.pause = fn;

        return removers.pause;
      }),
      onResume: vi.fn((fn: () => void) => {
        handlers.resume = fn;

        return removers.resume;
      })
    },
    back: {
      onPress: vi.fn((fn: () => boolean) => {
        handlers.back = fn;

        return removers.back;
      }),
      exit: vi.fn(async () => done)
    },
    haptics: {
      impact: vi.fn(async () => done),
      notify: vi.fn(async () => done),
      selection: vi.fn(async () => done)
    },
    keepAwake: { set: vi.fn(async () => done) }
  };

  return {
    system,
    removers,
    pause: () => handlers.pause?.(),
    resume: () => handlers.resume?.(),
    press: () => handlers.back?.()
  };
}

describe("fromSystem — the provider over the four capabilities", () => {
  it("hands pause and resume to lifecycle and returns its removers", () => {
    const fake = fakeSystem();
    const provider = fromSystem(fake.system);
    const paused = vi.fn();
    const resumed = vi.fn();

    expect(provider.onPause(paused)).toBe(fake.removers.pause);
    expect(provider.onResume(resumed)).toBe(fake.removers.resume);

    fake.pause();
    fake.resume();

    expect(paused).toHaveBeenCalledTimes(1);
    expect(resumed).toHaveBeenCalledTimes(1);
  });

  it("hands the Back press to back.onPress and passes the answer through", () => {
    const fake = fakeSystem();
    const provider = fromSystem(fake.system);

    expect(provider.onBack(() => true)).toBe(fake.removers.back);
    expect(fake.press()).toBe(true);

    provider.onBack(() => false);

    expect(fake.press()).toBe(false);
  });

  it.each([
    ["light", "impact"],
    ["medium", "impact"],
    ["heavy", "impact"],
    ["success", "notify"],
    ["warning", "notify"],
    ["error", "notify"]
  ] as const)("plays %s with haptics.%s of the same kind", (kind, method) => {
    const fake = fakeSystem();

    fromSystem(fake.system).haptic(kind);

    expect(fake.system.haptics[method]).toHaveBeenCalledExactlyOnceWith(kind);
  });

  it("plays selection with haptics.selection", () => {
    const fake = fakeSystem();

    fromSystem(fake.system).haptic("selection");

    expect(fake.system.haptics.selection).toHaveBeenCalledOnce();
    expect(fake.system.haptics.impact).not.toHaveBeenCalled();
    expect(fake.system.haptics.notify).not.toHaveBeenCalled();
  });

  it("plays every kind of the engine with exactly one capability call", () => {
    const fake = fakeSystem();
    const provider = fromSystem(fake.system);

    for (const kind of HAPTIC_KINDS) provider.haptic(kind);

    const { impact, notify, selection } = fake.system.haptics;
    const calls = [impact, notify, selection].map(spy => vi.mocked(spy).mock.calls.length);

    expect(calls).toEqual([3, 3, 1]);
  });

  it("keeps the screen on and lets it sleep through keepAwake.set", () => {
    const fake = fakeSystem();
    const provider = fromSystem(fake.system);

    provider.keepAwake(true);
    provider.keepAwake(false);

    expect(vi.mocked(fake.system.keepAwake.set).mock.calls).toEqual([[true], [false]]);
  });

  it("leaves the app through back.exit", () => {
    const fake = fakeSystem();

    fromSystem(fake.system).exit();

    expect(fake.system.back.exit).toHaveBeenCalledOnce();
  });

  it("returns at once while a capability is still answering", () => {
    const fake = fakeSystem();
    const never = new Promise<SystemResult<void>>(() => undefined);

    vi.mocked(fake.system.haptics.notify).mockReturnValue(never);
    vi.mocked(fake.system.keepAwake.set).mockReturnValue(never);

    const provider = fromSystem(fake.system);
    const kind: HapticKind = "success";

    expect(provider.haptic(kind)).toBeUndefined();
    expect(provider.keepAwake(true)).toBeUndefined();
  });
});

describe("fromSystem — the game on Home over the bridge", () => {
  it("pauses on background and resumes on foreground", async () => {
    const fake = fakeSystem();
    const game = await startOnHome(player, { platform: fromSystem(fake.system) });

    fake.pause();

    expect(game.app.lifecycle.reasons()).toContain("background");

    fake.resume();

    expect(game.app.lifecycle.reasons()).not.toContain("background");

    await game.app.stop();

    expect(fake.removers.pause).toHaveBeenCalledOnce();
    expect(fake.removers.resume).toHaveBeenCalledOnce();
    expect(fake.removers.back).toHaveBeenCalledOnce();
  });

  it("plays a haptic effect of the game through haptics.notify", async () => {
    const fake = fakeSystem();
    const game = await startOnHome(player, { platform: fromSystem(fake.system) });

    game.app.flow.fx.dispatch({ kind: "haptic", payload: { kind: "success" } });

    expect(fake.system.haptics.notify).toHaveBeenCalledExactlyOnceWith("success");

    await game.app.stop();
  });

  it("opens the Leave popup on the shell's Back and leaves through back.exit", async () => {
    const fake = fakeSystem();
    const game = await startOnHome(player, { platform: fromSystem(fake.system) });

    expect(fake.press()).toBe(true);

    await tick();
    await frames(game, 30);

    expect(game.app.flow.state().path).toBe("leaveGame");

    await tap(game, "leaveExit");
    await frames(game, 30);

    expect(fake.system.back.exit).toHaveBeenCalledOnce();

    await game.app.stop();
  });
});
