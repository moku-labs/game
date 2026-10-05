import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../../index";
import { run } from "../../../flow/doors/run";
import { muteCommand } from "../../control";
import { createMockAudio } from "./mock-audio";

// ---------------------------------------------------------------------------
// Unit test: the audio command of the /control door over the real audio API of
// the mock plugin
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("game.mute", () => {
  it("is a cosmetic command with one flag", () => {
    expect(muteCommand.id).toBe("game.mute");
    expect(muteCommand.title).toBe("Mute");
    expect(muteCommand.effect).toBe("cosmetic");
    expect(muteCommand.input).toEqual({ muted: "boolean" });
  });

  it("mutes and unmutes the master bus and answers the flag", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockAudio();
    const app = { ...createApp(), audio: mock.api };

    const on = await run(app, muteCommand, { muted: true });

    expect(on.value).toBe(true);
    expect(mock.api.muted("master")).toBe(true);
    expect(mock.api.volume("master")).toBe(1);
    expect(on.state.tainted).toBe(false);

    const off = await run(app, muteCommand, { muted: false });

    expect(off.value).toBe(false);
    expect(mock.api.muted("master")).toBe(false);
  });

  it("refuses outside a dev build and leaves a moku:dev entry inside one", async () => {
    const mock = createMockAudio();
    const app = { ...createApp(), audio: mock.api };

    expect(() => muteCommand.run(app, { muted: true })).toThrow("dev builds only");
    expect(mock.api.muted("master")).toBe(false);

    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    await run(app, muteCommand, { muted: true });

    expect(app.log.trace().at(-1)).toMatchObject({
      level: "debug",
      event: "moku:dev",
      data: { command: "game.mute", muted: true }
    });
  });

  it("throws a clear error when the app has no audioPlugin", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    await expect(run(createApp(), muteCommand, { muted: true })).rejects.toThrow(
      "[game] The command game.mute needs audioPlugin.\n  Add audioPlugin to createApp({ plugins })."
    );
  });
});
