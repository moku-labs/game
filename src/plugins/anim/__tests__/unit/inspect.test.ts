import { describe, expect, it } from "vitest";
import { createApp } from "../../../../index";
import { read } from "../../../flow/doors/read";
import { sources } from "../../../flow/doors/sources";
import { timelinesSource } from "../../inspect";
import { defineAnimation, wait } from "../../timeline/steps";
import { createMockAnim } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit test: the game.timelines source of the /inspect door reads anim.timelines()
// ---------------------------------------------------------------------------

const blink = defineAnimation("fx.blink", { slots: {}, build: () => wait(1000) });

describe("game.timelines", () => {
  it("is a frame source with no input, listed in the catalogue, that reads timelines()", () => {
    const mock = createMockAnim();

    mock.start();
    mock.api.play(blink, {}).finish();
    mock.api.play(blink, {});

    const app = { ...createApp(), anim: mock.api };

    expect(timelinesSource.id).toBe("game.timelines");
    expect(timelinesSource.changes).toBe("frame");
    expect(timelinesSource.input).toEqual({});
    expect(sources.timelines).toBe(timelinesSource);
    expect(read(app, timelinesSource, {})).toEqual(mock.api.timelines());
    expect(read(app, timelinesSource, {}).running).toHaveLength(1);
    expect(read(app, timelinesSource, {}).ended).toHaveLength(1);
  });

  it("answers plain JSON", () => {
    const mock = createMockAnim();

    mock.start();
    mock.api.play(blink, {});

    const app = { ...createApp(), anim: mock.api };
    const value = read(app, timelinesSource, {});

    const text = JSON.stringify(value);

    expect(JSON.parse(text)).toEqual(value);
  });

  it("throws a clear error when the app has no animPlugin", () => {
    expect(() => read(createApp(), timelinesSource, {})).toThrow(
      "[game] The source game.timelines needs animPlugin.\n  Add animPlugin to createApp({ plugins })."
    );
  });
});
