import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemandState } from "../../demand/state";
import { differingPixels } from "../../demand/verify";
import { box, demandAlone } from "../demand-harness";
import { createMockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// The pixel oracle of `debug.verifyFrames` (spec 14 D6.3): every frame the
// renderer skips is read live and compared with the last drawn one; a
// difference is a missed frame, logged with the views marked since, and drawn
// at once. With onDemand off it runs in shadow. It is dev and debug only.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Four pixels of one grey.
 *
 * @param grey - The value of every channel but alpha.
 * @returns The RGBA bytes.
 */
function picture(grey: number): Uint8ClampedArray {
  return new Uint8ClampedArray([
    grey,
    grey,
    grey,
    255,
    grey,
    grey,
    grey,
    255,
    grey,
    grey,
    grey,
    255,
    grey,
    grey,
    grey,
    255
  ]);
}

/**
 * The demand module of a dev build with the oracle on, its first frame drawn over a picture.
 *
 * @param onDemand - `config.onDemand`.
 * @returns The module and its handles.
 */
function verifying(onDemand = true): ReturnType<typeof demandAlone> {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);

  const alone = demandAlone({ onDemand });

  alone.demand.verifyFrames(true);
  alone.host.picture = picture(10);
  alone.demand.settle(alone.demand.decide(false));

  return alone;
}

describe("the pixel oracle", () => {
  it("counts a pixel that differs by more than 24 in one channel", () => {
    expect(differingPixels(picture(10), picture(34))).toBe(0);
    expect(differingPixels(picture(10), picture(35))).toBe(4);
  });

  it("logs renderer:missed-frame for a skipped frame whose pixels differ, with the views marked since, and draws it", () => {
    const { demand, host, log, view } = verifying();
    const hidden = box(100, 100);

    view(3, hidden);
    hidden.visible = false;
    demand.mark(3);
    host.picture = picture(200);

    expect(demand.decide(false)).toBe(false);

    demand.settle(false);

    expect(log.warn).toHaveBeenCalledWith("renderer:missed-frame", {
      frame: 7,
      pixels: 4,
      marked: [3]
    });
    expect(host.renders).toBe(1);
    expect(demand.frame()).toMatchObject({ drawn: true, reason: "verify" });

    // The drawn picture is the reference now: the next skipped frame is equal.
    demand.settle(demand.decide(false));

    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("keeps quiet and skips the frame while the skipped picture equals the last drawn one", () => {
    const { demand, host, log } = verifying();

    expect(demand.decide(false)).toBe(false);

    demand.settle(false);

    expect(log.warn).not.toHaveBeenCalled();
    expect(host.renders).toBe(0);
    expect(demand.frame().reason).toBe("none");
  });

  it("in shadow mode (onDemand off) draws every frame and still compares a frame it would have skipped", () => {
    const { demand, host, log } = verifying(false);

    host.picture = picture(200);

    expect(demand.decide(false)).toBe(true);
    expect(demand.frame().reason).toBe("none");

    demand.settle(true);

    expect(log.warn).toHaveBeenCalledWith(
      "renderer:missed-frame",
      expect.objectContaining({ pixels: 4 })
    );
    expect(host.renders).toBe(0);
  });

  it("takes a picture of another size as the new reference, with no warning", () => {
    const { demand, host, log } = verifying();

    host.picture = new Uint8ClampedArray(8);
    demand.settle(demand.decide(false));
    host.picture = new Uint8ClampedArray(8).fill(200);
    demand.settle(demand.decide(false));

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      "renderer:missed-frame",
      expect.objectContaining({ pixels: 2 })
    );
  });

  it("stays off in a production build, also when the config asks for it", () => {
    const { demand } = demandAlone();

    demand.verifyFrames(true);

    expect(demand.verifying()).toBe(false);
    expect(createDemandState(true).verify.on).toBe(false);

    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    expect(createDemandState(true).verify.on).toBe(true);
  });

  it("reads the stage live through the host at half resolution, and logs a failed read once", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockRenderer({ config: { onDemand: true } });

    await mock.start();
    mock.api.sync.debug.verifyFrames(true);

    const app = mock.pixi.last();
    const frame = (): void => {
      mock.runPhase("input");
      mock.runPhase("render");
    };

    frame();
    app.renderer.extract.picture = new Uint8ClampedArray(16).fill(200);
    frame();

    expect(app.renderer.extract.pixelCalls[0]).toEqual({
      target: app.stage,
      frame: app.screen,
      clearColor: 0x00_00_00,
      resolution: 0.5
    });
    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer:missed-frame",
      expect.objectContaining({ pixels: 4 })
    );
    expect(app.renderer.renders).toBe(2);

    app.renderer.extract.pixels = () => {
      throw new Error("the context is lost");
    };
    frame();
    frame();

    expect(mock.log.error).toHaveBeenCalledTimes(1);
    expect(mock.log.error).toHaveBeenCalledWith("renderer: pixel read failed", {
      error: expect.any(Error)
    });
  });
});
