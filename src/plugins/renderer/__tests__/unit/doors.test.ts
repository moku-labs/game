import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../../index";
import { read } from "../../../flow/doors/read";
import { run } from "../../../flow/doors/run";
import { captureCommand, debugCommand } from "../../control";
import { renderSource } from "../../inspect";
import { FAKE_PNG } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit test: the renderer source and commands of the doors over the real
// renderer modules of the mock plugin
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Builds the app the doors reach the mock renderer through.
 *
 * @param mock - The mock renderer.
 * @returns The app.
 */
function appOf(mock: MockRenderer) {
  return { ...createApp(), renderer: mock.api };
}

describe("game.render", () => {
  it("is a frame source that reads the renderer counters", () => {
    const mock = createMockRenderer({ dom: false });

    expect(renderSource.id).toBe("game.render");
    expect(renderSource.changes).toBe("frame");
    expect(read(appOf(mock), renderSource)).toEqual({
      fps: 0,
      frameMs: 0,
      textures: 0,
      textureMb: 0,
      views: 0,
      pooled: 0
    });
  });
});

describe("game.capture", () => {
  it("is a read command", () => {
    expect(captureCommand.id).toBe("game.capture");
    expect(captureCommand.effect).toBe("read");
  });

  it("resolves the PNG of the canvas taken at the end of the next frame", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockRenderer();

    await mock.start();

    const pending = run(appOf(mock), captureCommand);

    mock.setNow(0);
    mock.runPhase("input");
    mock.setNow(2);
    mock.runPhase("render");

    const ran = await pending;

    expect(ran.value).toBe(FAKE_PNG);
    expect(ran.state.tainted).toBe(false);
  });

  it("resolves undefined headless", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockRenderer({ dom: false });

    const ran = await run(appOf(mock), captureCommand);

    expect(ran.value).toBeUndefined();
  });
});

describe("game.debug", () => {
  it("is a cosmetic command with the nine-slice switch", () => {
    expect(debugCommand.id).toBe("game.debug");
    expect(debugCommand.effect).toBe("cosmetic");
    expect(debugCommand.input).toEqual({ nineSlice: "boolean" });
  });

  it("switches the nine-slice outlines and answers the switches", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockRenderer({ dom: false });

    const on = await run(appOf(mock), debugCommand, { nineSlice: true });

    expect(on.value).toEqual({ nineSlice: true });
    expect(mock.api.sync.debug.state()).toEqual({ nineSlice: true });

    const off = await run(appOf(mock), debugCommand, { nineSlice: false });

    expect(off.value).toEqual({ nineSlice: false });
  });
});

describe("the renderer commands", () => {
  it("refuse outside a dev build and leave a moku:dev entry inside one", async () => {
    const mock = createMockRenderer({ dom: false });
    const app = appOf(mock);

    expect(() => captureCommand.run(app, {})).toThrow("dev builds only");
    expect(() => debugCommand.run(app, { nineSlice: true })).toThrow("dev builds only");
    expect(mock.api.sync.debug.state()).toEqual({ nineSlice: false });

    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    await run(app, debugCommand, { nineSlice: true });
    await run(app, captureCommand);

    expect(app.log.trace().slice(-2)).toMatchObject([
      { event: "moku:dev", data: { command: "game.debug", nineSlice: true } },
      { event: "moku:dev", data: { command: "game.capture" } }
    ]);
  });
});
