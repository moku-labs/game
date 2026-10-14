import type { Log } from "@moku-labs/common/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOverlay } from "../../overlay";

// ---------------------------------------------------------------------------
// Unit test: app.debug.overlay — the agent's channel read at call time, the
// 0.10 editor overlay as the fallback, false without the agent
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Creates the plugin log as spies.
 *
 * @returns A log whose every method is a spy.
 */
function mockLog(): Log.LogApi {
  return {
    addSink: vi.fn(),
    clearSinks: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    expect: vi.fn(),
    info: vi.fn(),
    reset: vi.fn(),
    trace: vi.fn(() => []),
    warn: vi.fn()
  };
}

/**
 * Creates a channel as the editor's page agent sets it: a hidden overlay that remembers its mode.
 *
 * @returns The channel's spies and its open state.
 */
function fakeChannel() {
  const state = { shown: false };

  return {
    state,
    open: vi.fn(() => {
      state.shown = true;
    }),
    close: vi.fn(() => {
      state.shown = false;
    }),
    toggle: vi.fn(() => {
      state.shown = !state.shown;
    }),
    isOpen: vi.fn(() => state.shown)
  };
}

/**
 * Creates the overlay of the editor 0.10: its members read `this`, as the released one does.
 *
 * @returns The overlay and the `this` each call saw.
 */
function legacyOverlay() {
  const seen: unknown[] = [];
  const overlay = {
    shown: false,
    open(this: { shown: boolean }) {
      seen.push(this);
      this.shown = true;
    },
    close(this: { shown: boolean }) {
      seen.push(this);
      this.shown = false;
    },
    isOpen(this: { shown: boolean }) {
      return this.shown;
    }
  };

  return { overlay, seen };
}

describe("app.debug.overlay", () => {
  it("without the agent flag every member answers false and reads no global", () => {
    const channel = fakeChannel();
    const overlay = createOverlay({ log: mockLog() });

    vi.stubGlobal("__MOKU_GAME_OVERLAY__", channel);
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    expect([overlay.open(), overlay.close(), overlay.toggle(), overlay.isOpen()]).toEqual([
      false,
      false,
      false,
      false
    ]);
    expect(channel.open).not.toHaveBeenCalled();
    expect(channel.isOpen).not.toHaveBeenCalled();
  });

  it('open() opens the card, open({ mode: "pill" }) the pill; close, toggle and isOpen go to the channel', () => {
    const channel = fakeChannel();
    const overlay = createOverlay({ log: mockLog() });

    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    vi.stubGlobal("__MOKU_GAME_OVERLAY__", channel);

    expect(overlay.open()).toBe(true);
    expect(overlay.open({ mode: "pill" })).toBe(true);
    expect(channel.open.mock.calls).toEqual([[{ mode: "card" }], [{ mode: "pill" }]]);
    expect(overlay.isOpen()).toBe(true);
    expect(overlay.close()).toBe(true);
    expect(overlay.isOpen()).toBe(false);
    expect(overlay.toggle()).toBe(true);
    expect([channel.close, channel.toggle].map(spy => spy.mock.calls.length)).toEqual([1, 1]);
    expect(overlay.isOpen()).toBe(true);
  });

  it("a channel set after start is found at the next call", () => {
    const overlay = createOverlay({ log: mockLog() });
    const channel = fakeChannel();

    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    expect(overlay.open()).toBe(false);

    vi.stubGlobal("__MOKU_GAME_OVERLAY__", channel);
    expect(overlay.open()).toBe(true);
    expect(channel.open).toHaveBeenCalledTimes(1);
  });

  it("without the channel, open and close call editor.overlay of 0.10 with the overlay as this; toggle closes an open overlay and opens a closed one", () => {
    const { overlay: legacy, seen } = legacyOverlay();
    const overlay = createOverlay({ log: mockLog() });

    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    vi.stubGlobal("editor", { overlay: legacy });

    expect(overlay.open({ mode: "pill" })).toBe(true);
    expect(overlay.isOpen()).toBe(true);
    expect(overlay.toggle()).toBe(true);
    expect(legacy.shown).toBe(false);
    expect(overlay.toggle()).toBe(true);
    expect(legacy.shown).toBe(true);
    expect(overlay.close()).toBe(true);
    expect(overlay.isOpen()).toBe(false);
    expect(seen.length).toBe(4);
    expect(seen.every(self => self === legacy)).toBe(true);
  });

  it("with neither, every member answers false", () => {
    const overlay = createOverlay({ log: mockLog() });

    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    vi.stubGlobal("editor", { overlay: { open: () => undefined } });

    expect([overlay.open(), overlay.close(), overlay.toggle(), overlay.isOpen()]).toEqual([
      false,
      false,
      false,
      false
    ]);
  });

  it("a channel member that throws is logged as debug:overlay-failed and answers false", () => {
    const log = mockLog();
    const overlay = createOverlay({ log });
    const channel = fakeChannel();

    channel.open.mockImplementation(() => {
      throw new Error("the card is not mounted");
    });
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    vi.stubGlobal("__MOKU_GAME_OVERLAY__", channel);

    expect(overlay.open()).toBe(false);
    expect(log.error).toHaveBeenCalledWith(
      "debug:overlay-failed",
      { call: "open" },
      expect.any(Error)
    );
  });
});
