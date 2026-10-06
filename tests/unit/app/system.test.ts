/**
 * @file The system shell over fakes of `@moku-labs/system`. `fromSystem` maps the engine's
 * platform provider onto the four capabilities, today's bridge of merge-game ported as is, and is
 * inert where the slice has no capability. `createSystemApp` loads one module per name and
 * composes the plugins in a fixed order. `systemShell` adds the store for a store save. A missing
 * package throws the install message.
 */
import type { SystemResult } from "@moku-labs/system";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { resolveConfig } from "../../../src/app/config";
import type { SystemSlice } from "../../../src/app/system";
import { createSystemApp, fromSystem, systemShell } from "../../../src/app/system";
import type { SystemShellFactory } from "../../../src/app/types";
import type { HapticKind } from "../../../src/index";
import { HAPTIC_KINDS } from "../../../src/index";

/**
 * The fake `@moku-labs/system`: a `createApp` that records its options and gives an app whose
 * capabilities are spies, one set per plugin it was handed.
 */
const systemModule = vi.hoisted(() => {
  const done = { ok: true, value: undefined, provider: "web" } as const;
  const absent = { ok: true, value: undefined, provider: "web" } as const;
  const capabilities = {
    lifecycle: () => ({ onPause: vi.fn(() => vi.fn()), onResume: vi.fn(() => vi.fn()) }),
    back: () => ({ onPress: vi.fn(() => vi.fn()), exit: vi.fn(async () => done) }),
    haptics: () => ({
      impact: vi.fn(async () => done),
      notify: vi.fn(async () => done),
      selection: vi.fn(async () => done)
    }),
    keepAwake: () => ({ set: vi.fn(async () => done) }),
    store: () => ({ get: vi.fn(async () => absent), set: vi.fn(async () => done) })
  };
  const createApp = vi.fn(
    (options: {
      plugins: readonly { name: keyof typeof capabilities }[];
      pluginConfigs?: object;
    }) => ({
      ...Object.fromEntries(
        options.plugins.map(plugin => [plugin.name, capabilities[plugin.name]()])
      ),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined)
    })
  );

  return { createApp };
});

vi.mock("@moku-labs/system", () => ({ createApp: systemModule.createApp }));
vi.mock("@moku-labs/system/lifecycle", () => ({ lifecyclePlugin: { name: "lifecycle" } }));
vi.mock("@moku-labs/system/back", () => ({ backPlugin: { name: "back" } }));
vi.mock("@moku-labs/system/haptics", () => ({ hapticsPlugin: { name: "haptics" } }));
vi.mock("@moku-labs/system/keep-awake", () => ({ keepAwakePlugin: { name: "keepAwake" } }));
vi.mock("@moku-labs/system/store", () => ({ storePlugin: { name: "store" } }));

/** What the last `createApp` call of the fake system was given. */
type SystemOptions = { plugins: readonly { name: string }[]; pluginConfigs?: object };

/**
 * Reads the options of the last `createApp` call of the fake system.
 *
 * @returns The options.
 */
function lastOptions(): SystemOptions {
  const call = systemModule.createApp.mock.lastCall;

  if (call === undefined) throw new Error("createApp of the system was not called");

  return call[0];
}

/**
 * Names the plugins of the last system app, in order.
 *
 * @returns The plugin names.
 */
function composed(): string[] {
  return lastOptions().plugins.map(plugin => plugin.name);
}

/** What every fake capability answers: done, by the web provider. */
const done: SystemResult<void> = { ok: true, value: undefined, provider: "web" };

/** The fake system of the bridge and the handlers the game handed it. */
type FakeSystem = {
  system: Required<SystemSlice>;
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
  const system: Required<SystemSlice> = {
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
  it("fromSystem subscribes pause, resume and back and returns their removers", () => {
    const fake = fakeSystem();
    const provider = fromSystem(fake.system);
    const paused = vi.fn();
    const resumed = vi.fn();

    expect(provider.onPause(paused)).toBe(fake.removers.pause);
    expect(provider.onResume(resumed)).toBe(fake.removers.resume);
    expect(provider.onBack(() => true)).toBe(fake.removers.back);

    fake.pause();
    fake.resume();

    expect(paused).toHaveBeenCalledTimes(1);
    expect(resumed).toHaveBeenCalledTimes(1);
  });

  it("hands the Back press to back.onPress and passes the answer through", () => {
    const fake = fakeSystem();
    const provider = fromSystem(fake.system);

    provider.onBack(() => true);

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

  it("fromSystem maps the seven haptic kinds to impact, notify and selection", () => {
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

  it("fromSystem exit asks back.exit and never waits", () => {
    const fake = fakeSystem();
    const never = new Promise<SystemResult<void>>(() => undefined);

    vi.mocked(fake.system.back.exit).mockReturnValue(never);

    expect(fromSystem(fake.system).exit()).toBeUndefined();
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

describe("fromSystem — a capability the game did not list", () => {
  it("fromSystem is inert for a capability the slice lacks", () => {
    const provider = fromSystem({});
    const offPause = provider.onPause(vi.fn());
    const offResume = provider.onResume(vi.fn());
    const offBack = provider.onBack(() => true);

    expect([offPause(), offResume(), offBack()]).toEqual([undefined, undefined, undefined]);
    expect(provider.haptic("success")).toBeUndefined();
    expect(provider.keepAwake(true)).toBeUndefined();
    expect(provider.exit()).toBeUndefined();
  });

  it("plays the capabilities the slice has and skips the others", () => {
    const fake = fakeSystem();
    const provider = fromSystem({ haptics: fake.system.haptics });

    provider.haptic("heavy");
    provider.keepAwake(true);
    provider.exit();

    expect(fake.system.haptics.impact).toHaveBeenCalledExactlyOnceWith("heavy");
    expect(fake.system.keepAwake.set).not.toHaveBeenCalled();
    expect(fake.system.back.exit).not.toHaveBeenCalled();
    expect(provider.onBack(() => true)()).toBeUndefined();
  });
});

describe("createSystemApp — the system app of the named plugins", () => {
  it("createSystemApp composes the named plugins in the fixed order", async () => {
    await createSystemApp(["store", "haptics", "lifecycle", "keepAwake", "back", "haptics"], "g");

    expect(composed()).toEqual(["lifecycle", "back", "haptics", "keepAwake", "store"]);
  });

  it("createSystemApp names the store after the identifier", async () => {
    await createSystemApp(["store"], "com.mokulabs.timber");

    expect(lastOptions().pluginConfigs).toEqual({ store: { name: "com.mokulabs.timber" } });
  });

  it("gives no plugin config to a system app without the store", async () => {
    await createSystemApp(["lifecycle", "back"], "com.mokulabs.timber");

    expect(composed()).toEqual(["lifecycle", "back"]);
    expect(lastOptions().pluginConfigs).toBeUndefined();
  });

  it("returns the app with a capability per named plugin", async () => {
    const app = await createSystemApp(["haptics"], "moku-game");

    expect(app.haptics).toBeDefined();
    expect(app.lifecycle).toBeUndefined();
    expect(app.store).toBeUndefined();
  });
});

describe("systemShell — the shell the page starts", () => {
  it("is the SystemShellFactory the page takes in its options", () => {
    expectTypeOf(systemShell).toEqualTypeOf<SystemShellFactory>();
  });

  it('systemShell adds store when save is "store"', async () => {
    const config = resolveConfig({ page: { title: "T" }, system: ["haptics"], save: "store" });
    const shell = await systemShell(config, vi.fn());

    expect(composed()).toEqual(["haptics", "store"]);
    expect(lastOptions().pluginConfigs).toEqual({ store: { name: "moku-game" } });
    expect(shell.save).toBeDefined();
  });

  it("names the store after the native identifier", async () => {
    const config = resolveConfig({
      page: { title: "T" },
      native: { name: "Timber", identifier: "com.mokulabs.timber" },
      save: "store"
    });

    await systemShell(config, vi.fn());

    expect(composed()).toEqual(["store"]);
    expect(lastOptions().pluginConfigs).toEqual({ store: { name: "com.mokulabs.timber" } });
  });

  it("composes config.system in the fixed order and has no save without the store", async () => {
    const config = resolveConfig({
      page: { title: "T" },
      system: ["keepAwake", "back", "lifecycle"],
      save: "local"
    });
    const shell = await systemShell(config, vi.fn());

    expect(composed()).toEqual(["lifecycle", "back", "keepAwake"]);
    expect(shell.save).toBeUndefined();
  });

  it("composes the store once when config.system names it and save is store", async () => {
    const config = resolveConfig({ page: { title: "T" }, system: ["store"], save: "store" });

    await systemShell(config, vi.fn());

    expect(composed()).toEqual(["store"]);
  });

  it("hands the platform over the system app and starts and stops it", async () => {
    const config = resolveConfig({ page: { title: "T" }, system: ["haptics", "keepAwake"] });
    const shell = await systemShell(config, vi.fn());
    const app = vi.mocked(systemModule.createApp).mock.results.at(-1)?.value as {
      haptics: { notify: () => Promise<SystemResult<void>> };
      start: () => Promise<void>;
      stop: () => Promise<void>;
    };

    expect(shell.handle).toBe(app);

    shell.platform.haptic("success");

    expect(app.haptics.notify).toHaveBeenCalledExactlyOnceWith("success");
    expect(app.start).not.toHaveBeenCalled();

    await shell.start();
    await shell.stop();

    expect(app.start).toHaveBeenCalledOnce();
    expect(app.stop).toHaveBeenCalledOnce();
  });

  it("reads the save of a store save from the store under the key save", async () => {
    const config = resolveConfig({ page: { title: "T" }, save: "store" });
    const shell = await systemShell(config, vi.fn());
    const app = vi.mocked(systemModule.createApp).mock.results.at(-1)?.value as {
      store: { get: (key: string) => Promise<SystemResult<unknown>> };
    };

    await expect(shell.save?.load()).resolves.toBeNull();
    expect(app.store.get).toHaveBeenCalledExactlyOnceWith("save");
  });
});

describe("a missing @moku-labs/system", () => {
  it("a missing @moku-labs/system throws the install message", async () => {
    vi.resetModules();
    vi.doMock("@moku-labs/system", () => {
      throw new Error("Cannot find package '@moku-labs/system'");
    });

    const { createSystemApp: create } = await import("../../../src/app/system");

    await expect(create(["haptics"], "moku-game")).rejects.toMatchObject({
      message:
        "[game] config.system needs @moku-labs/system.\n  Install it: bun add @moku-labs/system@^0.3.1."
    });

    vi.doUnmock("@moku-labs/system");
    vi.resetModules();
  });
});
