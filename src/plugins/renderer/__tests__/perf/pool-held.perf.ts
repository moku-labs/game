import * as pixi from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { createHostApi } from "../../host/api";
import { createHostState } from "../../host/state";
import type { HostModule, PixiModule, RendererCtx } from "../../types";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the frame after a pool trim that held a target a shader still binds (F187). `afterFrame` looks at each held
// target every frame until its bind group lets go; that look allocates nothing.
// ---------------------------------------------------------------------------

/**
 * Removes nothing: the test host installs no pass counting.
 */
function uninstallNothing(): void {
  // Nothing was installed.
}

/**
 * A ready host over the real Pixi module, its pool trim on.
 *
 * @returns The host module.
 */
function realHost(): HostModule {
  const state = createHostState();

  state.pixi = pixi as unknown as PixiModule;
  state.app = { renderer: { texture: { managedTextures: [] } } } as never;
  state.ready = true;

  const ctx = {
    config: { poolTrim: { restMs: 1000, aboveMb: 16 } },
    state: { host: state },
    deps: { clock: { now: () => 0 } },
    log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
  } as unknown as RendererCtx;

  return createHostApi(ctx, { installCounting: undefined, installPasses: () => uninstallNothing });
}

describe("the frame after a trim held a bound target (F187)", () => {
  it("allocates nothing while the target stays bound", () => {
    const host = realHost();
    const texture = pixi.TexturePool.getOptimalTexture({ width: 64, height: 64, resolution: 1 });
    const group = new pixi.BindGroup({ 0: texture.source });

    pixi.TexturePool.returnTexture(texture);
    host.trimPool("scene");

    expect(bytesPerCall(() => host.afterFrame(true))).toBeLessThanOrEqual(
      BUDGET.poolHeldFrame + NOISE
    );
    expect(texture.source.destroyed).toBe(false);
    group.destroy();
  });
});
