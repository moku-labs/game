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

/**
 * The volumes reader of a game whose player keeps a music setting.
 *
 * @param player - The committed player.
 * @param player.settings - The player's settings.
 * @param player.settings.music - The music volume the player chose.
 * @returns The music bus.
 */
function read(player: { settings: { music: number } }): { music: number } {
  return { music: player.settings.music };
}

describe("audioFor", () => {
  it("hands back the same music function, bound to the keys of one game", () => {
    const kit = audioFor<"board.theme">();

    expect(kit.music).toBe(music);
    expect(kit.music("board.theme").kind).toBe("music");
  });

  it("hands the plugin config the game's own volumes reader, so its buses apply", () => {
    expect(audioFor<"board.theme", { settings: { music: number } }>().volumes(read)).toBe(read);
  });
});
