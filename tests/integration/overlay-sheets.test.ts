/**
 * @file Root integration — overlays across the engine (spec 22 T, K1–K4): ports of A Memory Missing's frozen
 * backdrop, kept pictures and still screens, on the sheets game. The renderer draws on demand over Pixi's own objects
 * on a fake clock; the tree oracle, the picture oracle and the atomicity checker (K3) read every frame, and every test
 * ends with all three.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Blur, Overlay, Transform } from "../../src";
import { startingPlayer, startingSession } from "../fixtures/sheets-game/state";
import { closeSheets, findKey, openSheets, type Sheets } from "./sheets-helpers";

const running: Sheets[] = [];

afterEach(async () => {
  for (const sheets of running.splice(0)) await closeSheets(sheets);
  vi.unstubAllGlobals();
});

/**
 * Opens the game, closed by `afterEach`.
 *
 * @param options - Where it starts.
 * @returns The running game.
 */
async function open(options: Parameters<typeof openSheets>[0] = {}): Promise<Sheets> {
  const sheets = await openSheets(options);

  running.push(sheets);

  return sheets;
}

/**
 * Presses a button and steps frames until an overlay is reported (or one more is).
 *
 * @param sheets - The running game.
 * @param key - The button.
 * @returns How many frames it took.
 */
async function openBy(sheets: Sheets, key: string): Promise<number> {
  const before = sheets.reports().length;

  sheets.press(key);

  for (let frames = 1; frames <= 60; frames += 1) {
    await sheets.frame();
    if (sheets.reports().length > before) return frames;
  }

  throw new Error(`no overlay came after ${key}`);
}

/**
 * Steps frames until every overlay has landed.
 *
 * @param sheets - The running game.
 */
async function landAll(sheets: Sheets): Promise<void> {
  for (let frames = 0; frames < 120; frames += 1) {
    if (sheets.reports().every(report => report.phase === "shown")) return;
    await sheets.frame();
  }

  throw new Error("an overlay never landed");
}

/**
 * The words a keyed text of the screen draws now, as `ui` resolved them.
 *
 * @param sheets - The running game.
 * @param key - The text's key.
 * @returns Its words.
 */
function textOf(sheets: Sheets, key: string): string | undefined {
  const walk = (node: ReturnType<Sheets["app"]["ui"]["tree"]>): string | undefined => {
    if (node.key === key) return node.content;

    for (const child of node.children) {
      const found = walk(child);

      if (found !== undefined) return found;
    }

    return undefined;
  };

  return walk(sheets.app.ui.tree());
}

/** Frames of four whole turns of a glint's twinkle (900 ms) at 16 ms a frame: 3600 ms. */
const FOUR_TWINKLES = 225;

/** What changes under the shop in a few frames in a row, the frame's number given. */
const bursts: ReadonlyArray<{ cause: string; burst: (sheets: Sheets, frame: number) => void }> = [
  {
    cause: "the frost under it moves",
    burst: (sheets, frame) =>
      sheets.app.world.ecs.set(findKey(sheets.app, "wardFrost") ?? 0, Blur, { strength: 4 + frame })
  },
  {
    // The same aspect, so the frost still covers the canvas and the range stays blurred.
    cause: "the window is resized and back",
    burst: (sheets, frame) => {
      const scale = [1.5, 2, 1.5][frame - 1] ?? 1;

      sheets.page.resize(390 * scale, 844 * scale);
    }
  }
];

/**
 * Whether the scene layer is drawn live: no overlay keeps or covers it.
 *
 * @param sheets - The running game.
 * @returns True when the stage pass draws it.
 */
function sceneLive(sheets: Sheets): boolean {
  const layer = sheets.topOf("wardRoot")?.parent ?? sheets.topOf("boardRoot")?.parent;

  return layer?.renderable === true;
}

describe("overlays across the engine", () => {
  it("takes one picture of everything under the shop in the frame the shop comes, with the shop itself left out", async () => {
    const sheets = await open();
    const during: Array<boolean | undefined> = [];

    sheets.page.stage.last().renderer.watchers.push(call => {
      if (call.target !== undefined && call.container.label === "renderer.root") {
        during.push(sheets.topOf("shopDimLayer")?.renderable);
      }
    });

    const from = sheets.mark();

    await openBy(sheets, "shopButton");

    expect(sheets.reports()).toMatchObject([{ mode: "freeze", kept: true }]);
    expect(sheets.rootRenders(from)).toHaveLength(1);
    expect(during).toEqual([false]);
    expect(sceneLive(sheets)).toBe(false);
    expect(sheets.topOf("shopDimLayer")?.renderable).toBe(true);
  });

  it("draws every frame of a moving sheet over the same picture and takes no new one for its motion", async () => {
    const sheets = await open();

    await openBy(sheets, "shopButton");
    await sheets.frames(5);

    const from = sheets.mark();
    const drawn = await sheets.each(10);

    expect(drawn.every(Boolean)).toBe(true);
    expect(sheets.rootRenders(from)).toHaveLength(0);
  });

  it("draws no frame of the shop at rest", async () => {
    const sheets = await open();

    await openBy(sheets, "shopButton");
    await landAll(sheets);
    await sheets.frames(40);

    // Two seconds at rest.
    expect(await sheets.frames(125)).toBe(0);
  });

  it("buying energy draws the new count in the HUD and the new label under the dim in the same frame", async () => {
    const sheets = await open();

    await openBy(sheets, "shopButton");
    await landAll(sheets);
    await sheets.frames(40);

    sheets.press("buy");

    let from = sheets.mark();
    let drawn = false;

    for (let frames = 0; frames < 30 && textOf(sheets, "hudEnergyCount") === "5"; frames += 1) {
      from = sheets.mark();
      drawn = await sheets.frame();
    }

    // The frame the HUD shows 6 draws, and takes the picture again with the label under the dim at 6 (the picture
    // oracle checks it is current).
    expect(textOf(sheets, "hudEnergyCount")).toBe("6");
    expect(textOf(sheets, "wardEnergy")).toBe("6");
    expect(drawn).toBe(true);
    expect(sheets.rootRenders(from).length).toBeGreaterThan(0);
  });

  it("draws the counters in every frame while the shop closes", async () => {
    const sheets = await open();

    await openBy(sheets, "shopButton");
    await landAll(sheets);
    await sheets.frames(20);
    sheets.press("shopDim");

    const shown: boolean[] = [];

    for (let frames = 0; frames < 40 && sheets.reports().length > 0; frames += 1) {
      const drawn = await sheets.frame();
      const counter = sheets.topOf("hudEnergy");

      shown.push(drawn && counter?.renderable === true && counter.visible && counter.alpha === 1);
    }

    expect(sheets.reports()).toEqual([]);
    expect(shown.length).toBeGreaterThan(10);
    expect(shown.every(Boolean)).toBe(true);
  });

  it("draws no frame of the case file over a ward whose glints loop under it", async () => {
    const sheets = await open();

    await openBy(sheets, "wardCase");
    await landAll(sheets);
    await sheets.frames(20);

    expect(sheets.reports()).toMatchObject([{ mode: "cover" }]);
    expect(await sheets.frames(60)).toBe(0);
  });

  it("draws the ward live again from the frame the case file starts to leave", async () => {
    const sheets = await open();

    await openBy(sheets, "wardCase");
    await landAll(sheets);
    await sheets.frames(10);
    sheets.press("caseClose");

    for (let frames = 0; frames < 30 && sheets.reports()[0]?.phase !== "exiting"; frames += 1) {
      await sheets.frame();
    }

    expect(sheets.reports()).toMatchObject([{ phase: "exiting", mode: "live" }]);
    expect(sceneLive(sheets)).toBe(true);
  });

  it("keeps the ward as one picture until the inspection window has gone back, and draws it live in the next frame", async () => {
    const sheets = await open();

    await openBy(sheets, "wardObject");
    await landAll(sheets);
    await sheets.frames(10);
    sheets.press("inspectBack");

    let frames = 0;

    for (; frames < 60 && sheets.reports().length > 0; frames += 1) {
      await sheets.frame();
      if (sheets.reports().length > 0) expect(sceneLive(sheets)).toBe(false);
    }

    expect(sheets.reports()).toEqual([]);
    expect(sceneLive(sheets)).toBe(true);
    // The window flies back for 340 ms: past the 270 ms of the dim's fade.
    expect(frames * 16).toBeGreaterThan(340);
  });

  it("opens a page of the inspection without retaking the ward", async () => {
    const sheets = await open();

    await openBy(sheets, "wardObject");
    await landAll(sheets);
    await sheets.frames(40);

    const from = sheets.mark();

    sheets.press("openPage");

    for (let frames = 0; frames < 30 && sheets.topOf("inspectViewer") === undefined; frames += 1) {
      await sheets.frame();
    }

    await sheets.frames(3);

    expect(sheets.topOf("inspectViewer")).toBeDefined();
    expect(sheets.rootRenders(from)).toHaveLength(0);
  });

  it("takes a picture of everything under a second sheet, the first one in it, and one without it when the second is gone", async () => {
    const sheets = await open();

    await openBy(sheets, "shopButton");
    await landAll(sheets);
    await openBy(sheets, "openSettings");

    const shop = sheets.reports()[0]?.entity ?? 0;
    const settings = sheets.reports()[1]?.entity ?? 0;

    expect(sheets.reports()).toMatchObject([
      { mode: "live", kept: false },
      { mode: "freeze", kept: true }
    ]);
    expect(sheets.topOf("shopDimLayer")?.renderable).toBe(false);

    await landAll(sheets);
    sheets.press("settingsClose");

    for (let frames = 0; frames < 60 && sheets.reports().length > 1; frames += 1)
      await sheets.frame();

    expect(sheets.reports()).toMatchObject([{ entity: shop, mode: "freeze", kept: true }]);
    expect(sheets.reports().some(report => report.entity === settings)).toBe(false);
    expect(sheets.topOf("shopDimLayer")?.renderable).toBe(true);
  });

  it("takes the picture again at the new size in the frame the window got another size", async () => {
    const sheets = await open();

    await openBy(sheets, "shopButton");
    await landAll(sheets);
    await sheets.frames(20);

    const from = sheets.mark();

    sheets.page.resize(500, 900);
    await sheets.frame();

    const renders = sheets.rootRenders(from);

    expect(renders.length).toBeGreaterThan(0);
    expect(renders.at(-1)?.target?.source.width).toBe(500);
  });

  // Bug: a burst of retakes under the shop sends the ward live (three in a row), and live the glints that loop under
  // the frosted sheet write in every frame: the ward never stays calm for eight frames and is drawn live, at full cost,
  // until the shop is gone.
  it.each(
    bursts
  )("keeps the ward as a picture again eight calm frames after $cause, the glints running on", async ({
    burst
  }) => {
    const sheets = await open();
    const glint = findKey(sheets.app, "glintA") ?? 0;
    const turn = (): number | undefined => sheets.app.world.ecs.get(glint, Transform)?.rotation;
    let frames = 0;
    const step = async (): Promise<void> => {
      frames += 1;
      await sheets.frame();
    };
    const sampled = turn();

    sheets.press("shopButton");

    while (frames < 60 && sheets.reports()[0]?.phase !== "shown") await step();
    for (let index = 0; index < 10; index += 1) await step();

    expect(sheets.reports()).toMatchObject([{ phase: "shown", mode: "freeze", kept: true }]);

    // Retaken in three frames in a row: the ward is drawn live.
    for (let index = 1; index <= 6 && sheets.reports()[0]?.kept === true; index += 1) {
      burst(sheets, index);
      await step();
    }

    expect(sheets.reports()).toMatchObject([{ mode: "live", kept: false }]);

    const live = frames;

    while (frames - live < 30 && sheets.reports()[0]?.kept !== true) await step();

    expect(frames - live).toBeLessThanOrEqual(12);
    expect(sheets.reports()).toMatchObject([{ mode: "freeze", kept: true }]);
    expect(sceneLive(sheets)).toBe(false);

    sheets.press("shopDim");

    while (frames < FOUR_TWINKLES) await step();

    // The glint stands where its loop is at this time: the turn it had four whole twinkles ago.
    expect(sheets.reports()).toEqual([]);
    expect(turn()).toBeCloseTo(sampled ?? Number.NaN, 6);
  });

  // Bug (A Memory Missing): whether the frost under the shop covers the screen was judged against the canvas, not the
  // viewport frame. In a window wider than the frame the frost spans only the frame, the range no longer counted as
  // blurred, and the glints under the still sheet wrote in every frame: the ward was drawn live under a resting shop.
  it("holds the glints under the frosted shop in a window wider than the frame, as on the phone", async () => {
    const sheets = await open();
    const glint = findKey(sheets.app, "glintA") ?? 0;

    await openBy(sheets, "shopButton");
    await landAll(sheets);
    await sheets.frames(20);
    sheets.page.resize(1600, 844);
    await sheets.frames(30);

    expect(sheets.reports()).toMatchObject([{ phase: "shown", mode: "freeze", kept: true }]);
    expect(sheets.app.renderer.sync.loopsHeld(glint)).toBe(true);
    expect(await sheets.frames(60)).toBe(0);
  });

  // Bug (A Memory Missing, 125 of 125 frames drawn under a story card): blurred was measured only when the picture was
  // taken. A range whose glints keep it moving is drawn live and never taken again, so a frost that came on after the
  // take was never seen, the glints were never held, and the ward never rested under the sheet.
  it("finds the frost that comes on under a shop whose glints keep the ward live, holds them, and lets the ward rest", async () => {
    const sheets = await open();
    const ecs = sheets.app.world.ecs;
    const frost = findKey(sheets.app, "wardFrost") ?? 0;
    const glint = findKey(sheets.app, "glintA") ?? 0;

    ecs.set(frost, Blur, { enabled: false });
    await sheets.frames(2);
    await openBy(sheets, "shopButton");
    await landAll(sheets);
    await sheets.frames(10);

    // A sharp ward whose glints move in every frame is drawn live (O8.4), its loops running.
    expect(sheets.reports()).toMatchObject([{ phase: "shown", mode: "live", kept: false }]);
    expect(sheets.app.renderer.sync.loopsHeld(glint)).toBe(false);

    ecs.set(frost, Blur, { enabled: true });

    let frames = 0;

    for (; frames < 40 && sheets.reports()[0]?.kept !== true; frames += 1) await sheets.frame();

    // Found blurred within a frame, then eight calm frames with the glints held, then the picture.
    expect(frames).toBeLessThanOrEqual(12);
    expect(sheets.app.renderer.sync.loopsHeld(glint)).toBe(true);
    expect(await sheets.frames(60)).toBe(0);
  });

  // Bug (A Memory Missing, F41): with its frost baked into a picture the ward under the shop is sharp, so the range is
  // not blurred, the glints write in every frame and the ward is drawn under a resting shop (94 of 125 frames in the
  // game). A shop that holds its loops, from the live fallback on, lets the ward rest; one without hold changes nothing.
  it("draws frames of a resting shop over a sharp ward, and none once the shop holds its loops", async () => {
    const sheets = await open();
    const ecs = sheets.app.world.ecs;

    ecs.set(findKey(sheets.app, "wardFrost") ?? 0, Blur, { enabled: false });
    await sheets.frames(2);
    await openBy(sheets, "shopButton");
    await landAll(sheets);
    await sheets.frames(40);

    expect(await sheets.frames(125)).toBeGreaterThan(0);

    ecs.set(findKey(sheets.app, "shopDimLayer") ?? 0, Overlay, { hold: true });
    await sheets.frames(40);

    expect(sheets.reports()).toMatchObject([{ phase: "shown", mode: "freeze", kept: true }]);
    expect(await sheets.frames(125)).toBe(0);
  });

  // Bug: the glints held under a shop with hold do not write again once it is gone, or their clock stood still while
  // they were held: the ward shows them where the shop came, not where time puts them.
  it("draws no frame of a shop with hold over a sharp ward at rest, and the glints stand where time puts them once it is gone", async () => {
    const sheets = await open();
    const ecs = sheets.app.world.ecs;
    const glint = findKey(sheets.app, "glintA") ?? 0;
    const turn = (): number | undefined => ecs.get(glint, Transform)?.rotation;
    let frames = 0;
    let drawn = 0;
    const step = async (): Promise<void> => {
      frames += 1;
      drawn += (await sheets.frame()) ? 1 : 0;
    };

    ecs.set(findKey(sheets.app, "wardFrost") ?? 0, Blur, { enabled: false });

    const sampled = turn();

    sheets.press("shopButton");

    while (frames < 60 && findKey(sheets.app, "shopDimLayer") === undefined) await step();

    ecs.set(findKey(sheets.app, "shopDimLayer") ?? 0, Overlay, { hold: true });

    while (frames < 60 && sheets.reports()[0]?.phase !== "shown") await step();
    for (let index = 0; index < 20; index += 1) await step();

    expect(sheets.reports()).toMatchObject([{ phase: "shown", mode: "freeze", kept: true }]);

    // Two seconds at rest.
    drawn = 0;
    for (let index = 0; index < 125; index += 1) await step();
    expect(drawn).toBe(0);

    sheets.press("shopDim");

    while (frames < FOUR_TWINKLES) await step();

    // The glint stands where its loop is at this time: the turn it had four whole twinkles ago.
    expect(sheets.reports()).toEqual([]);
    expect(turn()).toBeCloseTo(sampled ?? Number.NaN, 6);
  });

  it("goes back to the live views when the sheet is gone, and the picture is freed", async () => {
    const sheets = await open();

    await openBy(sheets, "shopButton");
    await landAll(sheets);
    expect(sheets.pictures()).toHaveLength(1);

    sheets.press("shopDim");

    for (let frames = 0; frames < 60 && sheets.reports().length > 0; frames += 1)
      await sheets.frame();

    expect(sceneLive(sheets)).toBe(true);
    expect(sheets.pictures()).toEqual([]);
  });

  it("switches from the ward to the board with the HUD shown in every frame and no picture left over", async () => {
    const sheets = await open();
    const shown: boolean[] = [];

    sheets.press("wardBoard");

    for (let frames = 0; frames < 60 && sheets.app.flow.state().path !== "board"; frames += 1) {
      await sheets.frame();
      shown.push(
        sheets.topOf("hudBar")?.renderable === true && sheets.topOf("hudBar")?.visible === true
      );
    }

    await sheets.frames(5);

    expect(sheets.app.flow.state().path).toBe("board");
    expect(shown.every(Boolean)).toBe(true);
    expect(sheets.pictures()).toEqual([]);
    expect(sheets.reports()).toEqual([]);
  });

  it("a restored save at the open shop shows the shop over a kept board from the first frame", async () => {
    const sheets = await open({
      player: startingPlayer,
      session: { ...startingSession, at: "board", sheet: "shop" },
      checkpoint: "board"
    });

    let frames = 0;

    for (
      ;
      frames < 120 && (sheets.reports().length === 0 || sheets.topOf("boardRoot") === undefined);
      frames += 1
    ) {
      await sheets.frame();
    }

    // The first frame the board and the shop are both there, the board under the shop is a kept picture.
    expect(sheets.app.flow.state().path).toBe("board");
    expect(sheets.reports()).toMatchObject([{ mode: "freeze", kept: true }]);
    expect(sheets.topOf("boardRoot")?.parent?.renderable).toBe(false);
    expect(sheets.pictures()).toHaveLength(1);
    await sheets.frames(10);
  });
});
