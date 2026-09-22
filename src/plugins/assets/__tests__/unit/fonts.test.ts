import { describe, expect, it } from "vitest";
import { releaseAll } from "../../lifecycle";
import { loadBundle } from "../../tiers";
import type { Manifest } from "../../types";
import { createMockAssets, type FakeTexture } from "./mock-assets";

const FNT = 'info face="body" size=32\npage id=0 file="body_0.png"\npage id=1 file="body_1.png"\n';

const manifest: Manifest = {
  version: 1,
  bundles: {
    ui: {
      feature: "ui",
      tier: "scene",
      mb: 0.334,
      files: [
        {
          key: "ui.body",
          path: "features/ui/assets/body.fnt",
          kind: "font",
          width: 0,
          height: 0,
          mb: 0.25,
          pages: [
            { path: "features/ui/assets/body_0.png", width: 256, height: 128, mb: 0.125 },
            { path: "features/ui/assets/body_1.png", width: 256, height: 128, mb: 0.125 }
          ]
        },
        {
          key: "ui.click",
          path: "features/ui/assets/click.mp3",
          kind: "audio",
          width: 0,
          height: 0,
          mb: 0.021
        },
        {
          key: "ui.panel",
          path: "features/ui/assets/panel.png",
          width: 128,
          height: 128,
          mb: 0.063
        }
      ]
    }
  }
};

/**
 * Starts the plugin over the font manifest with a scripted `.fnt` file and scripted audio bytes.
 *
 * @returns The started mock.
 */
async function startUi(): Promise<ReturnType<typeof createMockAssets>> {
  const mock = createMockAssets({ manifest });

  mock.io.texts.set("/features/ui/assets/body.fnt", FNT);
  mock.io.bodies.set("/features/ui/assets/click.mp3", new Uint8Array([1, 2, 3, 4]).buffer);
  await mock.start();

  return mock;
}

describe("font", () => {
  it("loads a .fnt and its two pages as one asset", async () => {
    const mock = await startUi();

    await mock.api.load("ui");

    expect(mock.io.fetched).toContain("/features/ui/assets/body.fnt");
    expect(mock.io.fetched).toContain("/features/ui/assets/body_0.png");
    expect(mock.io.fetched).toContain("/features/ui/assets/body_1.png");
    // Two pages plus the one texture of the bundle: a page is never a texture key of its own.
    expect(mock.io.created).toHaveLength(3);
    expect(mock.api.texture("ui.body")).toBeUndefined();
  });

  it("answers the file text and the first page texture", async () => {
    const mock = await startUi();

    await mock.api.load("ui");

    const font = mock.api.font("ui.body");
    const page = font?.texture as unknown as FakeTexture | undefined;

    expect(font?.fnt).toBe(FNT);
    expect(page?.from).toBe("/features/ui/assets/body_0.png");
  });

  it("touches the use counter of its bundle", async () => {
    const mock = await startUi();

    await mock.api.load("ui");

    const before = mock.ctx.state.useCounter;

    mock.api.font("ui.body");

    expect(mock.ctx.state.useCounter).toBe(before + 1);
  });

  it("is undefined before the bundle is loaded and while headless", async () => {
    const mock = await startUi();

    expect(mock.api.font("ui.body")).toBeUndefined();

    const headless = createMockAssets({ manifest, io: undefined });

    await headless.start();

    expect(headless.api.font("ui.body")).toBeUndefined();
  });

  it("fails the bundle when the manifest lists no page for the font", async () => {
    const noPages: Manifest = {
      version: 1,
      bundles: {
        ui: {
          feature: "ui",
          tier: "scene",
          mb: 0,
          files: [
            {
              key: "ui.body",
              path: "features/ui/assets/body.fnt",
              kind: "font",
              width: 0,
              height: 0,
              mb: 0
            }
          ]
        }
      }
    };
    const mock = createMockAssets({ manifest: noPages });

    await mock.start();

    await expect(mock.api.load("ui")).rejects.toThrow(
      '[game] assets: font "features/ui/assets/body.fnt" of bundle "ui" has no page.'
    );
    expect(mock.ctx.state.records.get("ui")?.status).toBe("idle");
  });
});

describe("audio", () => {
  it("keeps the bytes of an .mp3 undecoded until the bundle is unloaded", async () => {
    const mock = await startUi();

    await mock.api.load("ui");

    const bytes = mock.api.audio("ui.click");

    expect(bytes).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(bytes ?? new ArrayBuffer(0))]).toEqual([1, 2, 3, 4]);

    mock.api.unload("ui");

    expect(mock.api.audio("ui.click")).toBeUndefined();
  });

  it("is undefined for a texture key, an unknown key, before the load and while headless", async () => {
    const mock = await startUi();

    expect(mock.api.audio("ui.click")).toBeUndefined();
    expect(mock.api.audio("nowhere.key")).toBeUndefined();
    expect(mock.api.font("nowhere.key")).toBeUndefined();

    await mock.api.load("ui");

    expect(mock.api.audio("ui.panel")).toBeUndefined();

    const headless = createMockAssets({ manifest, io: undefined });

    await headless.start();

    expect(headless.api.audio("ui.click")).toBeUndefined();
  });
});

describe("unload with fonts and audio", () => {
  it("destroys every page texture and names the keys of the bundle in the event", async () => {
    const mock = await startUi();

    await mock.api.load("ui");
    mock.api.unload("ui");

    expect(mock.io.destroyed).toHaveLength(3);
    expect(mock.api.font("ui.body")).toBeUndefined();
    expect(mock.emitted.at(-1)).toEqual({
      name: "assets:bundle-unloaded",
      payload: {
        bundle: "ui",
        tier: "scene",
        mb: 0.334,
        reason: "request",
        keys: ["ui.body", "ui.click", "ui.panel"]
      }
    });
  });

  it("destroys every page texture on release", async () => {
    const mock = await startUi();

    await mock.api.load("ui");
    releaseAll(mock.ctx.state);

    expect(mock.io.destroyed).toHaveLength(3);
  });
});

describe("wake", () => {
  it("wakes the frame loop when a load settles", async () => {
    const mock = await startUi();

    expect(mock.time.wake).not.toHaveBeenCalled();

    await loadBundle(mock.assetsCtx, "ui", undefined, "request");

    expect(mock.time.wake).toHaveBeenCalledTimes(1);
  });

  it("does not wake the loop for a load that failed", async () => {
    const mock = await startUi();

    mock.io.status.set("/features/ui/assets/panel.png", 404);

    await expect(mock.api.load("ui")).rejects.toThrow("failed at");
    expect(mock.time.wake).not.toHaveBeenCalled();
  });
});
