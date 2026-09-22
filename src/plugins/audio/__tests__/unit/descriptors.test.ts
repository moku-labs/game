import { describe, expect, it } from "vitest";
import { audioFor, music } from "../../descriptors";

describe("music", () => {
  it("builds a cosmetic descriptor of kind music with the key", () => {
    expect(music("board.theme")).toEqual({
      kind: "music",
      payload: { key: "board.theme" },
      cosmetic: true
    });
  });

  it("carries fadeMs only when the caller wrote one", () => {
    expect(music("board.theme", { fadeMs: 200 })).toEqual({
      kind: "music",
      payload: { key: "board.theme", fadeMs: 200 },
      cosmetic: true
    });
  });

  it("takes null for the key, which is how a node stops the track", () => {
    // eslint-disable-next-line unicorn/no-null -- `null` is the seam: it stops the music.
    expect(music(null).payload).toEqual({ key: null });
  });

  it("freezes the descriptor and its payload", () => {
    const descriptor = music("board.theme");

    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.payload)).toBe(true);
  });
});

describe("audioFor", () => {
  it("hands back the same music function, bound to the keys of one game", () => {
    const kit = audioFor<"board.theme">();

    expect(kit.music).toBe(music);
    expect(kit.music("board.theme").kind).toBe("music");
  });
});
