import { describe, expect, it } from "vitest";
import { createApp } from "../../../../index";
import { read } from "../../../flow/doors/read";
import { effectsSource } from "../../inspect";
import { createMockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: the game.effects source of the /inspect door reads stats()
// ---------------------------------------------------------------------------

describe("game.effects", () => {
  it("is a frame source with no input that reads stats()", () => {
    const mock = createMockEffects();

    mock.renderer.passes = 0;
    mock.start();

    expect(effectsSource.id).toBe("game.effects");
    expect(effectsSource.changes).toBe("frame");
    expect(effectsSource.input).toEqual({});
    expect(read({ ...createApp(), effects: mock.api }, effectsSource, {})).toEqual({
      particles: 0,
      emitters: 0,
      filters: 0,
      renderPasses: 0
    });
  });
});
