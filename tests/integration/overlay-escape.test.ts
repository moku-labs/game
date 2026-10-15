/**
 * @file Root integration — the Escape key and the phone's Back press with a HUD layer (spec 22 O2, ui focus): the
 * HUD layer `{ above: "overlays" }` draws after `ui`, and its roots never take the keyboard, so Escape and Back close
 * the top sheet under it. Ports of A Memory Missing's `back-press.test.ts` and the Escape case of its shop screen, on
 * the sheets game: the case sheet is the case file (an opaque overlay), the shop over the ward and over the board (a
 * dim overlay whose escape button is its full-screen backdrop; the board stands for the storage window, a sheet of the
 * board scene), the settings over the shop (a sheet over a sheet: only the top one closes) and the inspection (a dim
 * overlay with a window, as the story card). The HUD bar is mounted in every case.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakeProvider,
  type FakeProvider
} from "../../src/plugins/platform/__tests__/fake-provider";
import { closeSheets, findKey, openSheets, type Sheets } from "./sheets-helpers";

const running: Sheets[] = [];

afterEach(async () => {
  for (const sheets of running.splice(0)) await closeSheets(sheets);
  vi.unstubAllGlobals();
});

/** A running sheets game with the phone's provider, the Back chain's last step counted. */
type Phone = { sheets: Sheets; fake: FakeProvider };

/**
 * Opens the sheets game on the ward with a fake phone provider, closed by `afterEach`.
 *
 * @returns The running game and the provider.
 */
async function openPhone(): Promise<Phone> {
  const fake = createFakeProvider();
  const sheets = await openSheets({ platform: fake.provider });

  running.push(sheets);

  return { sheets, fake };
}

/**
 * Taps keyed buttons one after the other, each once the flow rests where the last one led.
 *
 * @param sheets - The running game.
 * @param steps - The key to tap and the path the flow rests on after it.
 */
async function walk(
  sheets: Sheets,
  steps: ReadonlyArray<{ tap: string; rests: string }>
): Promise<void> {
  for (const step of steps) {
    sheets.press(step.tap);
    await sheets.until(step.rests);
    // The sheet has risen: its escape button takes a press.
    await sheets.frames(40);
  }
}

/** Every sheet of the game: the taps that open it, where it rests, and where one press brings the game. */
const sheetsOfGame: ReadonlyArray<{
  name: string;
  open: ReadonlyArray<{ tap: string; rests: string }>;
  lands: string;
}> = [
  { name: "the case file", open: [{ tap: "wardCase", rests: "casefile" }], lands: "ward" },
  {
    name: "the shop over the ward",
    open: [{ tap: "shopButton", rests: "shopping/shop" }],
    lands: "ward"
  },
  {
    name: "the shop over the board",
    open: [
      { tap: "wardBoard", rests: "board" },
      { tap: "shopButton", rests: "shopping/shop" }
    ],
    lands: "board"
  },
  {
    name: "the settings over the shop, and the shop stays",
    open: [
      { tap: "shopButton", rests: "shopping/shop" },
      { tap: "openSettings", rests: "shopping/settings" }
    ],
    lands: "shopping/shop"
  },
  { name: "the inspection", open: [{ tap: "wardObject", rests: "inspect" }], lands: "ward" }
];

describe("Escape and Back with a HUD layer", () => {
  // Bug: the root of the HUD layer is the last root in layer order and takes the press: it has no escape button, so
  // nothing closes, and the Back chain falls through to the provider, which leaves the app.
  it.each(sheetsOfGame)("the Back press closes $name and stays in the app", async ({
    open,
    lands
  }) => {
    const { sheets, fake } = await openPhone();

    await walk(sheets, open);

    expect(findKey(sheets.app, "hudBar")).toBeDefined();
    expect(sheets.app.platform.back()).toBe("popup");

    await sheets.until(lands);
    await sheets.frames(40);

    expect(sheets.app.flow.state().path).toBe(lands);
    expect(fake.provider.exit).not.toHaveBeenCalled();
  });

  // Bug: the Escape key of a desktop player does nothing on the open shop while the HUD bar is mounted.
  it("the Escape key closes the shop with the HUD bar mounted", async () => {
    const { sheets } = await openPhone();

    await walk(sheets, [{ tap: "shopButton", rests: "shopping/shop" }]);

    expect(findKey(sheets.app, "hudEnergy")).toBeDefined();
    expect(sheets.app.input.pressKey("Escape")).toBe(true);

    await sheets.until("ward");
    await sheets.frames(40);

    expect(findKey(sheets.app, "shopDimLayer")).toBeUndefined();
    expect(sheets.reports()).toEqual([]);
  });
});
