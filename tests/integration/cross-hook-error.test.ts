import { createApp, createPlugin, lifecyclePlugin } from "@moku-labs/game";
import { describe, expect, it, vi } from "vitest";
import { tick } from "./helpers";

// ---------------------------------------------------------------------------
// Framework-level scenario: a hook of a game plugin throws. The engine reports it
// through the log of @moku-labs/common (core 1.7: the framework onError gets the
// core plugin APIs) and never through the console.
// ---------------------------------------------------------------------------

describe("a throwing hook", () => {
  it("lands in the log as an error entry and the game goes on", async () => {
    const failure = new Error("hud exploded");
    const hudPlugin = createPlugin("hud", {
      depends: [lifecyclePlugin],
      hooks: () => ({
        "lifecycle:changed": () => {
          throw failure;
        }
      })
    });
    const print = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createApp({ plugins: [hudPlugin] });

    app.lifecycle.push("ad");
    await tick();

    const entry = app.log.trace().find(item => item.event === "game: a hook failed");

    expect(entry).toMatchObject({ level: "error" });
    expect(print).not.toHaveBeenCalledWith("[game] A hook failed.", failure);
    expect(app.lifecycle.isPaused()).toBe(true);
    print.mockRestore();
  });
});
