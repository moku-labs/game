import { describe, expect, it } from "vitest";
import { createApp } from "../../../../index";
import { read } from "../../doors/read";
import { logSource } from "../../inspect";

// ---------------------------------------------------------------------------
// Unit test: the log source of the /inspect door over the real log core plugin
// ---------------------------------------------------------------------------

/**
 * An app whose log holds one entry of each level, debug first. The console sink is removed, so
 * the test prints nothing; the trace keeps every entry.
 *
 * @returns The app.
 */
function logged() {
  const app = createApp();

  app.log.clearSinks();
  app.log.debug("board:tap", { cell: "c1" });
  app.log.info("board:merge");
  app.log.warn("assets:missing", { key: "ui.gear" });
  app.log.error("flow:failed");

  return app;
}

describe("game.log", () => {
  it("is a frame source with an optional level", () => {
    expect(logSource.id).toBe("game.log");
    expect(logSource.changes).toBe("frame");
    expect(logSource.input).toEqual({ level: "string?" });
  });

  it("reads the whole trace without a level", () => {
    const app = logged();
    const events = read(app, logSource).map(entry => entry.event);

    expect(events.slice(-4)).toEqual(["board:tap", "board:merge", "assets:missing", "flow:failed"]);
  });

  it("keeps the entries at the level and above", () => {
    const app = logged();

    expect(read(app, logSource, { level: "warn" }).map(entry => entry.event)).toEqual([
      "assets:missing",
      "flow:failed"
    ]);
    expect(read(app, logSource, { level: "error" }).map(entry => entry.level)).toEqual(["error"]);
    expect(read(app, logSource, { level: "debug" }).slice(-4)).toHaveLength(4);
  });

  it("refuses a level the log does not have", () => {
    const app = logged();

    expect(() => read(app, logSource, { level: "loud" })).toThrow(
      /^\[game] game\.log takes the level "debug", "info", "warn" or "error"\.\n {2}.*\.$/
    );
  });

  it("never writes to the log", () => {
    const app = logged();
    const count = app.log.trace().length;

    read(app, logSource, { level: "warn" });

    expect(app.log.trace()).toHaveLength(count);
  });
});
