/**
 * @file The Back button of the phone in Timber Town, headless: the game runs with a fake platform
 * provider. Back on Home asks first with the Leave popup; Stay, the backdrop and a second Back go
 * back to Home, Leave reaches the provider's `exit`. Back over Settings closes Settings. Without a
 * provider, as on the web page, Back presses nothing. Plain Bun: the renderer is inert, Yoga lays
 * out the real rects, the flow runner and `anim` run for real.
 */
import type { PlatformProvider } from "@moku-labs/game";
import { describe, expect, it, vi } from "vitest";
import type { Game } from "./timber-helpers";
import { frames, player, resolvedOf, shows, startOnHome, tap, tick } from "./timber-helpers";

/** The fake phone: the Back press it was handed, and a spy on its `exit`. */
type FakePlatform = {
  provider: PlatformProvider;
  exit: ReturnType<typeof vi.fn>;
  /** Plays one press of the system Back button; what the engine answered the phone. */
  press: () => boolean | undefined;
};

/** What the fake does on a haptic tick, on keep-awake, and when a subscription is removed. */
const nothing = (): void => undefined;

/**
 * A subscription the fake never plays: the phone of these tests never pauses.
 *
 * @returns The remover, which removes nothing.
 */
const neverCalled = (): (() => void) => nothing;

/**
 * Creates the fake phone: no pause, no haptics, a Back button and an `exit` the test watches.
 *
 * @returns The provider, the `exit` spy and the Back press.
 */
function fakePlatform(): FakePlatform {
  const back: { listener?: () => boolean } = {};
  const exit = vi.fn();
  const provider: PlatformProvider = {
    onPause: neverCalled,
    onResume: neverCalled,
    onBack: listener => {
      back.listener = listener;

      return nothing;
    },
    haptic: nothing,
    keepAwake: nothing,
    exit
  };

  return { provider, exit, press: () => back.listener?.() };
}

/**
 * Presses Back once through `app.platform.back()` and lets the graph and the screen follow.
 *
 * @param game - The running game.
 * @returns What took the press.
 */
async function pressBack(game: Game): Promise<string> {
  const result = game.app.platform.back();

  await tick();
  await frames(game, 30);

  return result;
}

describe("timber-back — Back on Home asks first", () => {
  it("opens the Leave popup with its title and two planks", async () => {
    const phone = fakePlatform();
    const game = await startOnHome(player, { platform: phone.provider });

    expect(await pressBack(game)).toBe("intent");
    expect(game.app.flow.state().path).toBe("leaveGame");
    expect(shows(game, "leaveScreen")).toBe(true);
    expect(resolvedOf(game, "leaveBoardTitle")).toBe("Выйти из игры?");
    expect(resolvedOf(game, "leaveExitLabel")).toBe("Выйти");
    expect(resolvedOf(game, "leaveStayLabel")).toBe("Остаться");
    expect(phone.exit).not.toHaveBeenCalled();

    await game.app.stop();
  });

  it("goes back to Home on Stay and leaves nothing", async () => {
    const phone = fakePlatform();
    const game = await startOnHome(player, { platform: phone.provider });

    await pressBack(game);
    await tap(game, "leaveStay");
    await frames(game, 30);

    expect(game.app.flow.state().path).toBe("home");
    expect(shows(game, "leaveScreen")).toBe(false);
    expect(phone.exit).not.toHaveBeenCalled();

    await game.app.stop();
  });

  it("goes back to Home on the backdrop, which answers stay", async () => {
    const phone = fakePlatform();
    const game = await startOnHome(player, { platform: phone.provider });

    await pressBack(game);
    await tap(game, "leaveBackdrop");
    await frames(game, 30);

    expect(game.app.flow.state().path).toBe("home");
    expect(phone.exit).not.toHaveBeenCalled();

    await game.app.stop();
  });

  it("calls the provider's exit on Leave", async () => {
    const phone = fakePlatform();
    const game = await startOnHome(player, { platform: phone.provider });

    await pressBack(game);
    await tap(game, "leaveExit");
    await frames(game, 30);

    expect(phone.exit).toHaveBeenCalledTimes(1);
    // The phone closes the app; until it does, the graph rests on Home again.
    expect(game.app.flow.state().path).toBe("home");

    await game.app.stop();
  });

  it("closes the popup on a second Back, the same as Stay", async () => {
    const phone = fakePlatform();
    const game = await startOnHome(player, { platform: phone.provider });

    await pressBack(game);

    expect(await pressBack(game)).toBe("popup");
    expect(game.app.flow.state().path).toBe("home");
    expect(shows(game, "leaveScreen")).toBe(false);
    expect(phone.exit).not.toHaveBeenCalled();

    await game.app.stop();
  });

  it("takes the system press of the phone: the engine answers that it took it", async () => {
    const phone = fakePlatform();
    const game = await startOnHome(player, { platform: phone.provider });

    expect(phone.press()).toBe(true);
    await tick();
    await frames(game, 30);

    expect(game.app.flow.state().path).toBe("leaveGame");

    await game.app.stop();
  });
});

describe("timber-back — Back elsewhere", () => {
  it("closes Settings like Escape", async () => {
    const phone = fakePlatform();
    const game = await startOnHome(player, { platform: phone.provider });

    await tap(game, "homeSettings");
    expect(game.app.flow.state().path).toBe("settings/open");

    expect(await pressBack(game)).toBe("popup");
    expect(game.app.flow.state().path).toBe("home");
    expect(shows(game, "settingsScreen")).toBe(false);
    expect(phone.exit).not.toHaveBeenCalled();

    await game.app.stop();
  });

  it("presses nothing without a provider, as on the web page", async () => {
    const game = await startOnHome(player);

    expect(await pressBack(game)).toBe("none");
    expect(game.app.flow.state().path).toBe("home");
    expect(shows(game, "leaveScreen")).toBe(false);

    await game.app.stop();
  });
});
