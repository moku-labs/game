import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../../index";
import { run } from "../../../flow/doors/run";
import { pauseCommand, resumeCommand } from "../../../lifecycle/control";
import { stepCommand } from "../../../time/control";
import { clockCommand } from "../../control";
import { fakeClock } from "../../fake";
import type { Elapsed } from "../../types";

// ---------------------------------------------------------------------------
// Integration test: the clock stands while the game is paused for devtools (F169)
// ---------------------------------------------------------------------------

const createTestApp = (start = 1000) => {
  const clock = fakeClock(start);
  const app = createApp({ pluginConfigs: { clock: { source: clock } } });

  return { app, clock };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the clock under the devtools pause", () => {
  it("stands over a real wait while the game is paused for devtools", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, clock } = createTestApp();

    await run(app, pauseCommand);
    clock.advance(2000);

    expect(app.clock.now()).toBe(1000);
  });

  it("moves by deltaMs × frames on game.step, together with the frame time", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, clock } = createTestApp();

    await run(app, pauseCommand);
    const ran = await run(app, stepCommand, { frames: 3, deltaMs: 20 });
    clock.advance(5000);

    expect(app.clock.now()).toBe(1060);
    expect(ran.value.elapsed).toBe(60);
  });

  it("moves by advanceMs on game.clock while frozen", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, clock } = createTestApp();

    await run(app, pauseCommand);
    const moved = await run(app, clockCommand, { advanceMs: 460 });
    clock.advance(5000);

    expect(moved.value).toEqual({ now: 1460 });
    expect(app.clock.now()).toBe(1460);
  });

  it("goes on from the frozen value plus the advances after resume, behind wall time", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, clock } = createTestApp();

    await run(app, pauseCommand);
    clock.advance(2000);
    await run(app, stepCommand, { frames: 1, deltaMs: 16 });
    await run(app, clockCommand, { advanceMs: 100 });
    await run(app, resumeCommand);

    expect(app.clock.now()).toBe(1116);

    clock.advance(500);

    expect(app.clock.now()).toBe(1616);
  });

  it("follows wall time while paused for another reason, and step leaves it alone", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, clock } = createTestApp();

    app.lifecycle.push("background");
    clock.advance(2000);
    await run(app, stepCommand, { frames: 2, deltaMs: 50 });

    expect(app.clock.now()).toBe(3000);
  });

  it("follows wall time again when devtools leaves and another reason still holds", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, clock } = createTestApp();

    app.lifecycle.push("background");
    await run(app, pauseCommand);
    clock.advance(2000);
    await run(app, resumeCommand);
    clock.advance(300);

    expect(app.lifecycle.isPaused()).toBe(true);
    expect(app.clock.now()).toBe(1300);
  });

  it("fires a scheduled moment on the step that reaches it, not on wall time", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, clock } = createTestApp();
    const received: Elapsed[] = [];

    app.clock.onElapsed(input => received.push(input));
    await run(app, pauseCommand);
    app.clock.scheduleAt(1050);
    clock.advance(10_000);

    expect(received).toEqual([]);

    await run(app, stepCommand, { frames: 2, deltaMs: 20 });

    expect(received).toEqual([]);

    await run(app, stepCommand, { frames: 1, deltaMs: 20 });

    expect(received).toEqual([{ now: 1060 }]);
    expect(app.clock.dueAt()).toBeUndefined();
  });

  it("arms a moment still ahead again on resume, for the rest of its wait", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, clock } = createTestApp();
    const received: Elapsed[] = [];

    app.clock.onElapsed(input => received.push(input));
    app.clock.scheduleAt(1500);
    await run(app, pauseCommand);
    clock.advance(10_000);
    await run(app, resumeCommand);
    received.length = 0;

    clock.advance(499);
    expect(received).toEqual([]);

    clock.advance(1);
    expect(received).toEqual([{ now: 1500 }]);
  });
});
