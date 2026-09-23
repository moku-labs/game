import { describe, expect, it } from "vitest";
import { createApp } from "../../../../index";
import { read } from "../../../flow/doors/read";
import { modelSource } from "../../inspect";

// ---------------------------------------------------------------------------
// Unit test: the model source of the /inspect door over the real model plugin
// ---------------------------------------------------------------------------

describe("game.model", () => {
  it("is a commit source that reads the committed player and session", async () => {
    const app = createApp({
      pluginConfigs: { model: { initialPlayer: { coins: 120 }, initialSession: { taps: 0 } } }
    });

    await app.start();

    expect(modelSource.id).toBe("game.model");
    expect(modelSource.changes).toBe("commit");
    expect(read(app, modelSource)).toMatchObject({ player: { coins: 120 }, session: { taps: 0 } });

    await app.stop();
  });

  it("hands out the memoised snapshot, so reading changes nothing", async () => {
    const app = createApp();

    await app.start();

    const before = app.model.store.snapshot();

    expect(read(app, modelSource)).toBe(before);
    expect(app.model.store.snapshot()).toBe(before);

    await app.stop();
  });
});
