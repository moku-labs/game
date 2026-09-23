import { describe, expect, it } from "vitest";
import { createApp } from "../../../../index";
import { read } from "../../../flow/doors/read";
import { assetsSource } from "../../inspect";
import { createMockAssets, manifestOf } from "./mock-assets";

// ---------------------------------------------------------------------------
// Unit test: the assets source of the /inspect door over the real assets API
// of the mock plugin
// ---------------------------------------------------------------------------

const manifest = manifestOf({
  ui: { feature: "ui", tier: "core", keys: ["ui.panel"] },
  board: { feature: "board", tier: "scene", keys: ["board.cell", "board.item"] }
});

describe("game.assets", () => {
  it("is a commit source", () => {
    expect(assetsSource.id).toBe("game.assets");
    expect(assetsSource.changes).toBe("commit");
    expect(assetsSource.input).toEqual({});
  });

  it("reads what the loaded bundles cost, the core bundle loaded at start included", async () => {
    const mock = createMockAssets({ manifest, textureBudgetMb: 64 });
    const app = { ...createApp(), assets: mock.api };

    await mock.start();
    await mock.api.load("board");

    expect(read(app, assetsSource)).toEqual(mock.api.usage());
    expect(read(app, assetsSource)).toMatchObject({
      budgetMb: 64,
      bundles: [
        { name: "board", tier: "scene", mb: 0.126 },
        { name: "ui", tier: "core", mb: 0.063 }
      ]
    });
  });

  it("reads nothing while headless", async () => {
    const mock = createMockAssets({ manifest, io: undefined });

    await mock.start();

    expect(read({ ...createApp(), assets: mock.api }, assetsSource)).toEqual({
      textureMb: 0,
      budgetMb: 192,
      bundles: []
    });
  });
});
