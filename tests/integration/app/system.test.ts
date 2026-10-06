/**
 * @file The system shell end to end. First the mini game runs on Home over `fromSystem` of a fake
 * system, as the native shell runs a game: the shell's pause, resume and Back reach the game, and
 * a haptic effect of the game reaches the shell. Then `systemShell` over the real
 * `@moku-labs/system` outside Tauri: the web providers answer, and a store that cannot be read
 * rejects the load instead of starting a new player.
 */
import type { SystemResult } from "@moku-labs/system";
import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../../src/app/config";
import type { SystemSlice } from "../../../src/app/system";
import { fromSystem, systemShell } from "../../../src/app/system";
import game from "../../fixtures/mini-game/index";
import { folderIo, frames, readManifest, startOnHome } from "../mini-helpers";

/** What every fake capability answers: done, by the web provider. */
const done: SystemResult<void> = { ok: true, value: undefined, provider: "web" };

/** The fake system and the controls of the shell. */
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
 * Creates the fake system: the four capabilities the bridge reads, each a spy, and the handlers
 * the game handed it, so a test plays the shell.
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

/**
 * Starts the mini game's screen app on Home over the bridge of a fake system.
 *
 * @param fake - The fake system.
 * @param keepAwake - Whether the screen stays on.
 * @returns The running app.
 */
async function homeOver(fake: FakeSystem, keepAwake = false) {
  const { app } = game.screen({
    manifest: await readManifest(),
    io: folderIo().io,
    platform: fromSystem(fake.system),
    keepAwake
  });

  await startOnHome(app);

  return app;
}

describe("fromSystem — the mini game on Home over the bridge", () => {
  it("pauses on background, resumes on foreground and lets go of the shell on stop", async () => {
    const fake = fakeSystem();
    const app = await homeOver(fake);

    fake.pause();

    expect(app.lifecycle.reasons()).toContain("background");

    fake.resume();

    expect(app.lifecycle.reasons()).not.toContain("background");

    await app.stop();

    expect(fake.removers.pause).toHaveBeenCalledOnce();
    expect(fake.removers.resume).toHaveBeenCalledOnce();
    expect(fake.removers.back).toHaveBeenCalledOnce();
  });

  it("plays a haptic effect of the game through haptics.notify", async () => {
    const fake = fakeSystem();
    const app = await homeOver(fake);

    app.flow.fx.dispatch({ kind: "haptic", payload: { kind: "success" } });

    expect(fake.system.haptics.notify).toHaveBeenCalledExactlyOnceWith("success");

    await app.stop();
  });

  it("leaves through back.exit on the shell's Back on Home, which does not list back", async () => {
    const fake = fakeSystem();
    const app = await homeOver(fake);

    expect(fake.press()).toBe(true);

    await frames(app, 2);

    expect(fake.system.back.exit).toHaveBeenCalledOnce();

    await app.stop();
  });

  it("keeps the screen on through keepAwake.set and lets it sleep on stop", async () => {
    const fake = fakeSystem();
    const app = await homeOver(fake, true);

    expect(vi.mocked(fake.system.keepAwake.set).mock.calls).toEqual([[true]]);

    await app.stop();

    expect(vi.mocked(fake.system.keepAwake.set).mock.calls).toEqual([[true], [false]]);
  });
});

describe("systemShell — over the real @moku-labs/system, outside Tauri", () => {
  it("composes the named capabilities, starts and stops, and the web answers unsupported", async () => {
    const config = resolveConfig({
      page: { title: "T" },
      system: ["lifecycle", "back", "haptics", "keepAwake"]
    });
    const shell = await systemShell(config, vi.fn());
    const handle = shell.handle as SystemSlice;

    expect(Object.keys(handle)).toEqual(
      expect.arrayContaining(["lifecycle", "back", "haptics", "keepAwake"])
    );
    expect(shell.save).toBeUndefined();

    await shell.start();

    expect(shell.platform.onBack(() => true)).toBeTypeOf("function");
    expect(shell.platform.haptic("selection")).toBeUndefined();
    await expect(handle.back?.exit()).resolves.toMatchObject({
      ok: false,
      reason: "unsupported"
    });

    await shell.stop();
  });

  it("rejects the load of a store save the page cannot read", async () => {
    const config = resolveConfig({ page: { title: "T" }, save: "store" });
    const shell = await systemShell(config, vi.fn());

    await shell.start();

    // Bun has no indexedDB: the web store answers "unavailable", and the game must not start over.
    await expect(shell.save?.load()).rejects.toThrow(
      "[game] The save could not be read from the system store: unavailable"
    );

    await shell.stop();
  });
});
