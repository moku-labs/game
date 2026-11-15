import * as pixi from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { createHostApi } from "../../host/api";
import { createHostState } from "../../host/state";
import type { HostModule, PixiModule, RendererCtx } from "../../types";

// ---------------------------------------------------------------------------
// Unit, real `pixi.js` (no GPU): the pins of the pool trim (spec 25 M1.1, M1.6).
// The engine trims with Pixi's public `TexturePool.clear(true)`; these tests fail
// when Pixi changes what that call destroys, or when the engine's trim reaches a
// texture it keeps outside the pool (a kept picture, spec 23).
// ---------------------------------------------------------------------------

/**
 * The pass counting the test host installs: none, so nothing to swap back.
 *
 * @returns The remover, which does nothing.
 */
function installNothing(): () => void {
  return uninstallNothing;
}

/**
 * Swaps nothing back.
 */
function uninstallNothing(): void {
  // Nothing was installed.
}

/**
 * A ready host over the real Pixi module, whose application lists the texture sources the test hands it.
 *
 * @returns The host module and the list Pixi's texture system would keep.
 */
function realHost(): { host: HostModule; managed: unknown[] } {
  const state = createHostState();
  const managed: unknown[] = [];

  state.pixi = pixi as unknown as PixiModule;
  state.app = { renderer: { texture: { managedTextures: managed } } } as never;
  state.ready = true;

  const ctx = {
    config: { poolTrim: { restMs: 1000, aboveMb: 16 } },
    state: { host: state },
    deps: { clock: { now: () => 0 } },
    log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
  } as unknown as RendererCtx;

  return {
    host: createHostApi(ctx, { installCounting: undefined, installPasses: installNothing }),
    managed
  };
}

/**
 * Takes a 64 x 64 render target from Pixi's pool, as a filter pass does.
 *
 * @returns The pooled texture.
 */
function take(): pixi.Texture {
  return pixi.TexturePool.getOptimalTexture({ width: 64, height: 64, resolution: 1 });
}

describe("Pixi's TexturePool.clear(true), the call the trim makes", () => {
  it("destroys an idle pooled texture", () => {
    const texture = take();
    // A destroyed texture lets go of its source: the source is read first.
    const { source } = texture;

    pixi.TexturePool.returnTexture(texture);
    pixi.TexturePool.clear(true);

    expect(source.destroyed).toBe(true);
  });

  it("leaves a pooled texture still in use alive, and destroys it when it comes back", () => {
    const { host } = realHost();
    const texture = take();
    const { source } = texture;

    host.trimPool("rest");

    expect(source.destroyed).toBe(false);

    pixi.TexturePool.returnTexture(texture);

    expect(source.destroyed).toBe(true);
  });
});

describe("a pooled target a shader still binds and the trim (F187)", () => {
  it("keeps an idle target a bind group holds, so Pixi never warns that a bound texture was destroyed", () => {
    const { host } = realHost();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const texture = take();
    const { source } = texture;
    // A filter pass leaves its last input bound, as Pixi's filter system and an effect's input do.
    const group = new pixi.BindGroup({ 0: source });

    pixi.TexturePool.returnTexture(texture);
    host.trimPool("scene");

    expect(source.destroyed).toBe(false);
    expect(group.getResource(0)).toBe(source);
    expect(warn).not.toHaveBeenCalled();
    group.destroy();
    warn.mockRestore();
  });

  it("frees the target after the frame in which nothing binds it any more, and never hands it out again", () => {
    const { host } = realHost();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const texture = take();
    const { source } = texture;
    const group = new pixi.BindGroup({ 0: source });

    pixi.TexturePool.returnTexture(texture);
    host.trimPool("scene");
    host.afterFrame(true);

    expect(source.destroyed).toBe(false);

    group.setResource(pixi.Texture.EMPTY.source, 0);
    host.afterFrame(true);

    expect(source.destroyed).toBe(true);
    expect(take().source).not.toBe(source);
    expect(warn).not.toHaveBeenCalled();
    group.destroy();
    warn.mockRestore();
  });

  it("destroys the unbound idle target beside it at once", () => {
    const { host } = realHost();
    const bound = take();
    const free = take();
    const freeSource = free.source;
    const boundSource = bound.source;
    const group = new pixi.BindGroup({ 0: bound.source });

    pixi.TexturePool.returnTexture(bound);
    pixi.TexturePool.returnTexture(free);
    host.trimPool("pause");

    expect(freeSource.destroyed).toBe(true);
    expect(boundSource.destroyed).toBe(false);
    group.destroy();
    host.afterFrame(false);
    expect(boundSource.destroyed).toBe(true);
  });
});

describe("the engine's own textures and the trim", () => {
  it("a texture the engine keeps outside the pool survives a trim; the idle pooled one beside it goes", () => {
    const { host, managed } = realHost();
    const kept = pixi.RenderTexture.create({ width: 64, height: 64 });
    const idle = take();
    const idleSource = idle.source;

    host.keep(kept.source, true);
    managed.push(kept.source, idleSource);
    pixi.TexturePool.returnTexture(idle);

    host.trimPool("pause");

    expect(kept.source.destroyed).toBe(false);
    expect(idleSource.destroyed).toBe(true);
    expect(host.textures().kept).toBe(64 * 64 * 4);
  });
});
