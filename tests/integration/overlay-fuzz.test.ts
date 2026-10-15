/**
 * @file Root integration — the overlay fuzz (spec 22 T, K3): the sheets game, seeded, 400 frames per seed: random
 * opens and closes of the sheets, purchases, scene switches, resizes, and views spawned and reordered under the dim.
 * The tree oracle, the picture oracle and the atomicity checker read every frame; a seed fails at the first frame that
 * shows a range neither live nor as a current picture, or a HUD part at another factor than the levels give.
 */
import { afterEach, describe, it, vi } from "vitest";
import { Shape, Transform } from "../../src/plugins/renderer/components";
import { Layer, Order } from "../../src/plugins/world/ecs/define";
import { closeSheets, findKey, openSheets, type Sheets } from "./sheets-helpers";

const running: Sheets[] = [];

afterEach(async () => {
  for (const sheets of running.splice(0)) await closeSheets(sheets);
  vi.unstubAllGlobals();
});

/** Every button the fuzz may press; one that is not on the screen is skipped. */
const BUTTONS = [
  "shopButton",
  "buy",
  "openSettings",
  "settingsClose",
  "shopDim",
  "wardCase",
  "caseClose",
  "wardObject",
  "openPage",
  "inspectBack",
  "wardBoard",
  "boardWard"
] as const;

/** The owner of the views the fuzz spawns under the dim. */
const FUZZ = { kind: "plugin", name: "fuzz" } as const;

/**
 * A small seeded generator (mulberry32): the same seed walks the same frames.
 *
 * @param seed - The seed.
 * @returns The next number in [0, 1) at every call.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;

    let value = state;

    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** What one fuzzed frame works with. */
type Fuzz = { sheets: Sheets; random: () => number; spawned: number[]; frame: number };

/**
 * Presses a random button that is on the screen.
 *
 * @param fuzz - The fuzzed frame.
 */
function pressSome(fuzz: Fuzz): void {
  const key = BUTTONS[Math.floor(fuzz.random() * BUTTONS.length)] ?? "shopButton";

  if (findKey(fuzz.sheets.app, key) !== undefined) fuzz.sheets.press(key);
}

/**
 * Spawns a view under the dim, or changes one, or lets one go.
 *
 * @param fuzz - The fuzzed frame.
 * @param roll - The roll of the frame, which picks what.
 */
function stirScene(fuzz: Fuzz, roll: number): void {
  const { sheets, random, spawned } = fuzz;
  const ecs = sheets.app.world.ecs;

  if (roll < 0.17) {
    spawned.push(
      ecs.spawn(FUZZ, [
        Layer({ name: "scene" }),
        Transform({ x: random() * 900, y: random() * 1600 }),
        Shape({ w: 80, h: 80, fill: 0xff_88_00 })
      ])
    );

    return;
  }

  const entity = spawned[Math.floor(random() * spawned.length)];

  if (entity === undefined) return;

  if (roll < 0.18) {
    ecs.despawn(entity);
    spawned.splice(spawned.indexOf(entity), 1);
  } else if (roll < 0.19) {
    ecs.set(entity, Shape, { fill: Math.floor(random() * 0xff_ff_ff) });
  } else if (ecs.has(entity, Order)) {
    ecs.set(entity, Order, { value: fuzz.frame });
  } else {
    ecs.add(entity, Order({ value: fuzz.frame }));
  }
}

/**
 * One fuzzed frame's action: a button, a resize, or a change under the dim; most frames do nothing.
 *
 * @param fuzz - The fuzzed frame.
 */
function act(fuzz: Fuzz): void {
  const roll = fuzz.random();

  if (roll < 0.12) pressSome(fuzz);
  else if (roll < 0.14) {
    fuzz.sheets.page.resize(
      360 + Math.floor(fuzz.random() * 120),
      760 + Math.floor(fuzz.random() * 160)
    );
  } else if (roll < 0.2) stirScene(fuzz, roll);
}

describe("overlay fuzz", () => {
  it.each([1, 2, 3, 4, 5])("seed %i: 400 frames keep every frame atomic", async seed => {
    const sheets = await openSheets();

    running.push(sheets);

    const random = seeded(seed);
    const spawned: number[] = [];

    for (let frame = 0; frame < 400; frame += 1) {
      act({ sheets, random, spawned, frame });
      await sheets.frame();
    }
  }, 180_000);
});
