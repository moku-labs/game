/**
 * @file The fixture game as its visual tests play it: the app of the headless leg and the save
 * every test starts from. The headless app reads its art from the fixture folder, so `text`
 * measures with the real fonts and `describe.json` holds the layout the page draws. Nothing here
 * imports a test runner: `bun tests/visual/run.ts` loads it as well as vitest does.
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Assets } from "@moku-labs/game";
import type { VisualSetup, VisualStart } from "@moku-labs/game/visual";
import { createScreenGame, startMoment } from "../integration/merge-game/game";
import type { Item } from "../integration/merge-game/rules";
import type { Player } from "../integration/merge-game/state";
import { startingPlayer, startingSession } from "../integration/merge-game/state";

/** The folder of the fixture game: the dev manifest's paths are relative to it. */
const gameFolder = new URL("../integration/merge-game/", import.meta.url);

/** The dev manifest, the file the dev server hands the page. */
const manifest = JSON.parse(
  readFileSync(new URL("manifest.json", gameFolder), "utf8")
) as Assets.Manifest;

/**
 * The file seam of `assets` over the fixture folder: every file is really read, so the fonts
 * measure with their tables. An image decodes to a stand-in: the renderer is inert and draws
 * nothing.
 *
 * @returns The seam.
 */
function diskIo(): Assets.AssetsIo {
  return {
    fetch: async url => {
      const bytes = await readFile(new URL(url.replace(/^\//u, ""), gameFolder));

      return {
        ok: true,
        status: 200,
        // eslint-disable-next-line unicorn/no-null -- a `Response` answers a missing header with null.
        headers: { get: () => null },
        json: () => Promise.resolve(JSON.parse(bytes.toString("utf8")) as unknown),
        blob: () => Promise.resolve(new Blob([bytes])),
        text: () => Promise.resolve(bytes.toString("utf8")),
        arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer)
      };
    },
    decode: () => Promise.resolve({} as unknown as Assets.DecodedImage),
    createTexture: image => image as unknown as Assets.Texture,
    sliceTexture: page => page,
    destroyTexture: () => undefined
  };
}

/**
 * A fresh fixture game with its screen, not started: the setup of every visual test. Headless
 * the renderer is inert; the page of the pixel leg builds the same plugins in `web/main.ts`.
 *
 * @returns The app.
 */
export const fixtureApp: VisualSetup["app"] = () =>
  createScreenGame({ manifest, io: diskIo() }).app;

/**
 * An item of the wood chain on one cell.
 *
 * @param id - Item id.
 * @param level - Level in the chain.
 * @param cell - Cell id, `c<col>_<row>`.
 * @returns The item.
 */
function wood(id: string, level: number, cell: string): Item {
  return { id, chain: "wood", level, cell };
}

/**
 * The save of every visual test: a Plank for the first order, two Twigs to merge and a Log, 125
 * coins, the daily gift not taken. The energy bar and the sawmill are full, so no clock runs: the
 * page and the headless game reach the same state on their own clocks.
 */
export const ready: Player = {
  ...startingPlayer,
  merge: {
    ...startingPlayer.merge,
    board: {
      ...startingPlayer.merge.board,
      items: [
        wood("i1", 3, "c1_0"),
        wood("i2", 1, "c2_1"),
        wood("i3", 1, "c0_2"),
        wood("i4", 2, "c2_2")
      ]
    },
    energy: { ...startingPlayer.merge.energy, countedAt: startMoment },
    wallet: { coins: 125 },
    nextItemId: 5
  }
};

/** Where every visual test starts: the save above at Home, the splash done. */
export const atHome: VisualStart = {
  player: ready,
  session: { ...startingSession, loading: 1 },
  checkpoint: "home"
};
