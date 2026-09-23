import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../../index";
import { run } from "../../../flow/doors/run";
import { pauseCommand, resumeCommand } from "../../control";

// ---------------------------------------------------------------------------
// Unit test: the lifecycle commands of the /control door over the real
// lifecycle and time plugins
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("game.pause and game.resume", () => {
  it("are cosmetic commands with no input", () => {
    expect(pauseCommand.id).toBe("game.pause");
    expect(resumeCommand.id).toBe("game.resume");
    expect(pauseCommand.effect).toBe("cosmetic");
    expect(resumeCommand.effect).toBe("cosmetic");
    expect(pauseCommand.input).toEqual({});
    expect(resumeCommand.input).toEqual({});
  });

  it("pause and resume through the devtools reason and answer whether the game is paused", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = createApp();
    const reasons: string[][] = [];
    const paused = await run(app, pauseCommand);

    reasons.push([...app.lifecycle.reasons()]);

    const resumed = await run(app, resumeCommand);

    expect(paused.value).toBe(true);
    expect(resumed.value).toBe(false);
    expect(reasons).toEqual([["devtools"]]);
    expect(app.lifecycle.reasons()).toEqual([]);
    expect(app.time.isPaused()).toBe(false);
    expect(resumed.state.tainted).toBe(false);
  });

  it("keep the game paused while another reason still holds", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = createApp();

    app.lifecycle.push("background");
    await run(app, pauseCommand);

    const resumed = await run(app, resumeCommand);

    expect(resumed.value).toBe(true);
    expect(app.lifecycle.reasons()).toEqual(["background"]);
  });

  it("refuse outside a dev build and leave a moku:dev entry inside one", async () => {
    const app = createApp();

    expect(() => pauseCommand.run(app, {})).toThrow("dev builds only");
    expect(() => resumeCommand.run(app, {})).toThrow("dev builds only");
    expect(app.time.isPaused()).toBe(false);

    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    await run(app, pauseCommand);
    await run(app, resumeCommand);

    expect(app.log.trace().slice(-2)).toMatchObject([
      { level: "debug", event: "moku:dev", data: { command: "game.pause" } },
      { level: "debug", event: "moku:dev", data: { command: "game.resume" } }
    ]);
  });
});
