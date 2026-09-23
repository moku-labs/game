import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../../index";
import { run } from "../../../flow/doors/run";
import { reducedMotionCommand } from "../../control";
import { createMockAnim } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit test: the anim command of the /control door over the real anim API of
// the mock plugin
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("game.reducedMotion", () => {
  it("is a cosmetic command with one switch", () => {
    expect(reducedMotionCommand.id).toBe("game.reducedMotion");
    expect(reducedMotionCommand.effect).toBe("cosmetic");
    expect(reducedMotionCommand.input).toEqual({ on: "boolean" });
  });

  it("switches reduced motion on and off and answers the switch", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockAnim();
    const app = { ...createApp(), anim: mock.api };

    const on = await run(app, reducedMotionCommand, { on: true });

    expect(on.value).toBe(true);
    expect(mock.api.reducedMotion()).toBe(true);
    const off = await run(app, reducedMotionCommand, { on: false });

    expect(off.value).toBe(false);
    expect(on.state.tainted).toBe(false);
  });

  it("refuses outside a dev build and leaves a moku:dev entry inside one", async () => {
    const mock = createMockAnim();
    const app = { ...createApp(), anim: mock.api };

    expect(() => reducedMotionCommand.run(app, { on: true })).toThrow("dev builds only");
    expect(mock.api.reducedMotion()).toBe(false);

    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    await run(app, reducedMotionCommand, { on: true });

    expect(app.log.trace().at(-1)).toMatchObject({
      event: "moku:dev",
      data: { command: "game.reducedMotion", on: true }
    });
  });
});
