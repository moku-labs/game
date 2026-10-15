/**
 * @file Root integration — overlays without a screen (spec 22 O4.7): the same walk through every sheet, once on an
 * inert renderer and once on a page, gives the same flow, the same levels and landings in every frame, and the same
 * frames an overlay is gone in. The fade of an overlay adds no wait to the flow.
 */
import { describe, expect, it } from "vitest";
import { fakeClock } from "../../src/plugins/clock/fake";
import { OverlayLevel } from "../../src/plugins/renderer/components";
import sheetsGame from "../fixtures/sheets-game/index";
import { diskIo } from "./drawn-helpers";
import {
  findKey,
  openSheets,
  readSheetsManifest,
  type SheetsApp,
  sheetsFolder
} from "./sheets-helpers";

/** The walk: at these frames, these buttons. */
const WALK: ReadonlyArray<readonly [number, string]> = [
  [5, "shopButton"],
  [40, "buy"],
  [60, "openSettings"],
  [100, "settingsClose"],
  [130, "shopDim"],
  [170, "wardCase"],
  [220, "caseClose"],
  [260, "wardObject"],
  [300, "openPage"],
  [320, "inspectBack"]
];

/** How many frames the walk runs. */
const FRAMES = 400;

/**
 * What one frame of the walk shows: the flow's path and every overlay's level and landing.
 *
 * @param app - The running game.
 * @returns The line of the frame.
 */
function lineOf(app: SheetsApp): string {
  const levels = [...app.world.ecs.query(OverlayLevel)]
    .map(([entity, value]) => `${entity}:${value.level.toFixed(6)}:${value.landed}`)
    .join(",");

  return `${app.flow.state().path} ${levels}`;
}

/**
 * Walks the game: a tap at the frames of the walk, a line per frame.
 *
 * @param app - The running game, resting on the ward.
 * @param frame - Runs one frame.
 * @returns The lines.
 */
async function walk(app: SheetsApp, frame: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];

  for (let index = 0; index < FRAMES; index += 1) {
    for (const [at, key] of WALK) {
      const entity = findKey(app, key);

      if (at === index && entity !== undefined) app.input.tap(entity);
    }

    await frame();
    lines.push(lineOf(app));
  }

  return lines;
}

describe("overlays without a screen", () => {
  it("a headless walk opens and closes every sheet with the same flow and the same levels as on a screen", async () => {
    const manifest = await readSheetsManifest();
    const clock = fakeClock(1_000_000);
    const { app } = sheetsGame.screen({ manifest, io: diskIo(sheetsFolder, manifest), clock });

    await app.start();
    app.flow.run().catch(() => undefined);

    const step = async (): Promise<void> => {
      await new Promise(resolve => setTimeout(resolve, 0));
      clock.advance(16);
      app.time.step(16);
    };

    for (let index = 0; index < 300 && app.flow.state().path !== "ward"; index += 1) await step();
    for (let index = 0; index < 30; index += 1) await step();

    expect(app.renderer.host.ready()).toBe(false);

    const inert = await walk(app, step);

    await app.stop();

    const sheets = await openSheets();
    const drawn = await walk(sheets.app, () => sheets.frame());

    await sheets.app.stop();

    expect(drawn).toEqual(inert);
    expect(inert.some(line => line.includes(":1.000000:true"))).toBe(true);
    expect(inert.at(-1)).toBe("ward ");
  }, 180_000);
});
