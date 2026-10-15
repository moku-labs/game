import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../../index";
import { read } from "../../../flow/doors/read";
import { run } from "../../../flow/doors/run";
import { filterCommand } from "../../control";
import { effectsSource, filtersSource } from "../../inspect";
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

  it("throws a clear error when the app has no effectsPlugin", () => {
    expect(() => read(createApp(), effectsSource, {})).toThrow(
      "[game] The source game.effects needs effectsPlugin.\n  Add effectsPlugin to createApp({ plugins })."
    );
  });
});

/**
 * A started mock and a real app that carries its effects API.
 *
 * @returns The app the doors read and run.
 */
function appWithEffects() {
  const mock = createMockEffects();

  mock.start();

  return { ...createApp(), effects: mock.api };
}

describe("game.filter and game.filters", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("game.filter turns a kind off and answers the off list; on turns it back", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const app = appWithEffects();

    const off = await run(app, filterCommand, { kind: "effects.glow", on: false });

    expect(filterCommand.effect).toBe("cosmetic");
    expect(off.value).toEqual(["effects.glow"]);
    expect(read(app, filtersSource).off).toEqual(["effects.glow"]);

    const on = await run(app, filterCommand, { kind: "effects.glow", on: true });

    expect(on.value).toEqual([]);
  });

  it("game.filter works under a DEV-only stub, as a game's test stubs it", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const app = appWithEffects();

    const ran = await run(app, filterCommand, { kind: "effects.blur", on: false });

    expect(ran.value).toEqual(["effects.blur"]);
  });

  it("game.filter of an unknown kind throws naming every known kind", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const app = appWithEffects();

    await expect(run(app, filterCommand, { kind: "fx.nope", on: false })).rejects.toThrow(
      '[game] No filter kind "fx.nope".\n  Known: effects.glow, effects.outline, effects.blur, effects.colorMatrix, effects.noise, effects.displacement, effects.alpha.'
    );
  });

  it("game.filter without effectsPlugin throws notInstalled", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    await expect(
      run(createApp(), filterCommand, { kind: "effects.glow", on: false })
    ).rejects.toThrow(
      "[game] The command game.filter needs effectsPlugin.\n  Add effectsPlugin to createApp({ plugins })."
    );
  });

  it("game.filters without effectsPlugin throws notInstalled", () => {
    expect(() => read(createApp(), filtersSource)).toThrow(
      "[game] The source game.filters needs effectsPlugin.\n  Add effectsPlugin to createApp({ plugins })."
    );
  });

  it("game.filters reads kinds and off, off empty without the agent flag", () => {
    const app = appWithEffects();

    app.effects.diagnostics.disable("effects.glow");

    expect(filtersSource.changes).toBe("frame");
    expect(read(app, filtersSource)).toEqual({
      kinds: [
        "effects.glow",
        "effects.outline",
        "effects.blur",
        "effects.colorMatrix",
        "effects.noise",
        "effects.displacement",
        "effects.alpha"
      ],
      off: []
    });
  });
});
