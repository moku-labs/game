import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit: the render phase tells `time` which frames Pixi drew (spec 21 G7.1), so
// the adaptive frame rate never takes a still screen for a slow one and never
// counts a frame an inert host could not draw.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A started renderer.
 *
 * @param onDemand - `config.onDemand`.
 * @returns The mock.
 */
async function started(onDemand: boolean): Promise<MockRenderer> {
  const mock = createMockRenderer({ config: { onDemand } });

  await mock.start();

  return mock;
}

describe("the drawn report of the render phase", () => {
  it("a frame the demand decision skipped does not report a drawn frame", async () => {
    const mock = await started(true);

    // The first frame after the host came up is drawn; a still tree draws nothing after it.
    mock.runPhase("render");
    mock.runPhase("render");
    mock.runPhase("render");

    expect(mock.drawnCount()).toBe(1);
  });

  it("a frame Pixi drew reports exactly one", async () => {
    const mock = await started(false);

    mock.runPhase("render");
    mock.runPhase("render");
    mock.runPhase("render");

    expect(mock.drawnCount()).toBe(3);
  });

  it("an inert host never reports one", async () => {
    const mock = await started(false);

    // The application is gone while the decision still says draw: Pixi draws nothing.
    mock.ctx.state.host.app = undefined;
    mock.runPhase("render");

    expect(mock.drawnCount()).toBe(0);
  });
});
