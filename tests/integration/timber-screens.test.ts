/**
 * @file The screens of Timber Town, headless: the splash fills its loading bar from the asset
 * events, rides the saw blade on the head of the fill and moves on to Home by itself, Home lays out
 * as the design (the bar, the centre group, the gift), Play on Home opens the board, the board slot hosts every
 * cell, the sawmill and every item, before and after a drag merges two of them, the three order
 * cards enable only the Deliver the rules accept, and the HUD shows the energy of the save. Plain
 * Bun: the renderer is inert and Yoga lays out the same rects as in the browser.
 */

import { readFile } from "node:fs/promises";
import type { Assets, Ui } from "@moku-labs/game";
import { Parent, Shape, Sprite, Tappable, Text, Touchable, Transform } from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import { GIFT_WOBBLE_MS } from "./merge-game/features/home/motions";
import { fillHead, fillWidth, track } from "./merge-game/features/splash/view";
import { createScreenGame, startMoment } from "./merge-game/game";
import type { Player, Session } from "./merge-game/state";
import { startingPlayer } from "./merge-game/state";
import { generatorId } from "./merge-game/tables";

/**
 * A board that already carries the level-3 item the first order asks for, and 7 of 10 energy
 * counted at the start moment, so `boot` has no time to catch up and the HUD shows 7.
 */
const readyPlayer: Player = {
  ...startingPlayer,
  merge: {
    ...startingPlayer.merge,
    board: {
      ...startingPlayer.merge.board,
      items: [
        { id: "i1", chain: "wood", level: 3, cell: "c1_0" },
        { id: "i2", chain: "wood", level: 1, cell: "c2_1" }
      ]
    },
    energy: { ...startingPlayer.merge.energy, value: 7, countedAt: startMoment },
    nextItemId: 3
  }
};

/** The game as this file drives it. */
type Game = ReturnType<typeof createScreenGame>;

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/** Yields the whole task queue once: a file read from disk settles in a later task. */
const yieldTask = (): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, 0);
  });

/**
 * Reads the committed manifest, the file the dev server hands the browser.
 *
 * @returns The parsed manifest.
 */
async function readManifest(): Promise<Assets.Manifest> {
  const text = await readFile(new URL("merge-game/manifest.json", import.meta.url), "utf8");

  return JSON.parse(text) as Assets.Manifest;
}

/** An `AssetsIo` over the files of the fixture, and a latch on the files of one bundle. */
type DiskIo = {
  io: Assets.AssetsIo;
  /** Lets the held files through. */
  release(): void;
};

/**
 * The file seam of `assets` over the disk: every file of the fixture is really read, the images
 * decode to a stand-in and the textures are stand-ins, because the renderer is inert. The files
 * under `held` wait until `release()`, so a test sees the splash halfway.
 *
 * @param held - The path prefix of the files to hold back.
 * @returns The seam and its latch.
 */
function diskIo(held: string): DiskIo {
  const latch: { open: () => void; opened: Promise<void> } = {
    open: () => undefined,
    opened: Promise.resolve()
  };

  latch.opened = new Promise<void>(resolve => {
    latch.open = resolve;
  });

  const io: Assets.AssetsIo = {
    fetch: async url => {
      const path = url.replace(/^\//, "");

      if (path.startsWith(held)) await latch.opened;

      const bytes = await readFile(new URL(`merge-game/${path}`, import.meta.url));

      return new Response(bytes);
    },
    decode: async () => ({ width: 1, height: 1 }) as unknown as ImageBitmap,
    createTexture: () =>
      ({ label: "stand-in" }) as unknown as ReturnType<Assets.AssetsIo["createTexture"]>,
    destroyTexture: () => undefined
  };

  return { io, release: () => latch.open() };
}

/**
 * Starts the game with its screen and its graph.
 *
 * @param game - The game, not started.
 * @returns The same game, started.
 */
async function start(game: Game): Promise<Game> {
  const loop: { failure?: unknown } = {};

  await game.app.start();
  game.app.flow.run().catch((error: unknown) => {
    loop.failure = error;
  });
  await tick();

  if (loop.failure !== undefined) throw loop.failure;

  return game;
}

/**
 * Runs frames until a condition holds, each followed by its microtasks and one task, which is
 * what a file read needs. Fails the test when the condition never holds.
 *
 * @param game - The running game.
 * @param done - The condition to wait for.
 */
async function until(game: Game, done: () => boolean): Promise<void> {
  for (let frame = 0; frame < 200 && !done(); frame += 1) {
    game.app.time.step(16);
    await tick();
    await yieldTask();
  }

  expect(done()).toBe(true);
}

/**
 * Runs a few frames, so the layout and the labels of what just arrived are written.
 *
 * @param game - The running game.
 * @param frames - How many frames.
 */
async function frames(game: Game, frames = 4): Promise<void> {
  for (let frame = 0; frame < frames; frame += 1) {
    game.app.time.step(16);
    await tick();
  }
}

/**
 * The session the graph committed.
 *
 * @param game - The running game.
 * @returns The session tree.
 */
function sessionOf(game: Game): Session {
  return game.app.model.store.snapshot().session as unknown as Session;
}

/**
 * Finds the element that has the keyboard focus.
 *
 * @param node - The node to search from.
 * @returns The focused node, or `undefined` when nothing has the focus.
 */
function focusedIn(node: Ui.UiNode): Ui.UiNode | undefined {
  if (node.state.focus) return node;

  for (const child of node.children) {
    const found = focusedIn(child);

    if (found !== undefined) return found;
  }

  return undefined;
}

/**
 * Finds a keyed node in the snapshot of the screen.
 *
 * @param node - The snapshot to search.
 * @param key - The key of the node.
 * @returns The node, or `undefined`.
 */
function nodeOf(node: Ui.UiNode, key: string): Ui.UiNode | undefined {
  if (node.key === key) return node;

  for (const child of node.children) {
    const found = nodeOf(child, key);

    if (found !== undefined) return found;
  }

  return undefined;
}

/**
 * The entity of one keyed element, failing the test when it is not there.
 *
 * @param game - The running game.
 * @param key - The key the markup wrote.
 * @returns The entity.
 */
function elementOf(game: Game, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = game.app.ui.find(key);

  expect(entity, key).toBeDefined();

  return entity ?? 0;
}

/**
 * The natural rect of a keyed node of the screen, in root units.
 *
 * @param game - The running game.
 * @param key - The key of the node.
 * @returns Its rect; a zero rect when it is not on the screen.
 */
function rectOf(game: Game, key: string): Ui.UiNode["rect"] {
  return nodeOf(game.app.ui.tree(), key)?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
}

/**
 * The keys of the children of one keyed node, in draw order.
 *
 * @param game - The running game.
 * @param key - The key of the node.
 * @returns The keys of its children.
 */
function childKeysOf(game: Game, key: string): string[] {
  return (nodeOf(game.app.ui.tree(), key)?.children ?? []).map(child => child.key ?? "");
}

/**
 * Starts the headless game and walks it onto the board through the screens: the splash lets it
 * through (every bundle counts as loaded without a file seam), and the Play plank of Home is
 * tapped.
 *
 * @param player - The player a new save starts from.
 * @returns The game, resting on `board/awaitIntent` with the board screen laid out.
 */
async function startOnBoard(player: Player): Promise<Game> {
  const game = await start(createScreenGame({ player, manifest: await readManifest() }));

  await frames(game);

  expect(game.app.flow.state().path).toBe("home");
  expect(game.app.input.tap(elementOf(game, "play"))).toBe(true);

  await until(game, () => game.app.flow.state().path === "board/awaitIntent");
  await frames(game);

  return game;
}

describe("timber-screens — the splash", () => {
  it("fills the loading bar from the asset events and moves on to Home when all three are in", async () => {
    const disk = diskIo("features/board/");
    const game = await start(createScreenGame({ manifest: await readManifest(), io: disk.io }));

    // Home and the orders are core bundles and come in; the board waits behind the latch.
    await until(game, () => sessionOf(game).loading > 0.5);

    expect(game.app.flow.state().path).toBe("splash");
    expect(game.app.scenes.current()).toBe("splash");

    const halfway = sessionOf(game).loading;

    expect(halfway).toBeLessThan(1);

    await frames(game);

    expect(nodeOf(game.app.ui.tree(), "loadingFill")?.rect.w).toBe(fillWidth(halfway));
    expect(game.app.world.ecs.get(elementOf(game, "loadingLabel"), Text)?.resolved).toBe(
      "Загрузка…"
    );

    disk.release();
    await until(game, () => game.app.flow.state().path === "home");

    expect(sessionOf(game).loading).toBe(1);
    expect(game.app.scenes.current()).toBe("home");
    expect(game.app.assets.isLoaded("board")).toBe(true);

    await game.app.stop();
  });

  it("hangs the logo at 24 % of the safe height and the loader 305 units above the bottom", async () => {
    const disk = diskIo("features/board/");
    const game = await start(createScreenGame({ manifest: await readManifest(), io: disk.io }));

    await until(game, () => sessionOf(game).loading > 0.5);
    await frames(game);

    const screen = rectOf(game, "splashScreen");
    const loader = rectOf(game, "loader");

    expect(Math.abs(rectOf(game, "splashLogo").y - 0.24 * screen.h)).toBeLessThanOrEqual(1);
    expect(rectOf(game, "splashLogo").w).toBe(900);
    expect(loader.y + loader.h).toBe(screen.h - 305);
    expect(rectOf(game, "loadingTrack")).toMatchObject({ w: track.width, h: track.height });

    disk.release();
    await until(game, () => game.app.flow.state().path === "home");
    await game.app.stop();
  });

  it("rides the spinning saw blade on the head of the fill", async () => {
    const disk = diskIo("features/board/");
    const game = await start(createScreenGame({ manifest: await readManifest(), io: disk.io }));

    await until(game, () => sessionOf(game).loading > 0.5);
    await frames(game);

    const ecs = game.app.world.ecs;
    const blade = elementOf(game, "loadingBlade");
    const rect = rectOf(game, "loadingBlade");
    const trackRect = rectOf(game, "loadingTrack");
    const first = ecs.get(blade, Transform)?.rotation ?? 0;

    // The middle of the blade stands on the head of the fill, on the middle line of the track.
    expect(rect.x + rect.w / 2 - trackRect.x).toBe(fillHead(sessionOf(game).loading));
    expect(rect.y + rect.h / 2 - trackRect.y).toBe(track.height / 2);
    expect(ecs.get(blade, Sprite)).toMatchObject({ texture: "ui.icon-gear", tint: 0xb8_c4_cc });

    await frames(game, 3);

    expect(ecs.get(blade, Transform)?.rotation).not.toBe(first);

    // Under reduced motion the blade stands on its rest pose.
    game.app.anim.setReducedMotion(true);
    await frames(game, 2);

    const held = ecs.get(blade, Transform)?.rotation;

    await frames(game, 5);

    expect(held).toBe(0);
    expect(ecs.get(blade, Transform)?.rotation).toBe(held);

    disk.release();
    await until(game, () => game.app.flow.state().path === "home");
    await game.app.stop();
  });

  it("lets a game without the file seam through to Home at once", async () => {
    const game = await start(createScreenGame({ manifest: await readManifest() }));

    await frames(game);

    expect(game.app.flow.state().path).toBe("home");
    expect(sessionOf(game).loading).toBe(1);
    // The daily gift waits, so its button carries the red "1".
    expect(game.app.world.ecs.get(elementOf(game, "giftBadgeCount"), Text)?.resolved).toBe("1");

    await game.app.stop();
  });
});

describe("timber-screens — Home", () => {
  it("lays Home out as the design: the bar, the centre group between the bar and the gift, the gift at the bottom", async () => {
    const game = await start(createScreenGame({ manifest: await readManifest() }));

    await frames(game);

    const screen = rectOf(game, "homeScreen");
    const bar = rectOf(game, "homeBar");
    const middle = rectOf(game, "homeMiddle");
    const centre = rectOf(game, "homeCentre");
    const label = rectOf(game, "giftLabel");

    expect(game.app.world.ecs.get(elementOf(game, "homeBackground"), Sprite)?.texture).toBe(
      "board.bg-forest-meadow"
    );
    expect(bar).toMatchObject({ y: 50, h: 144, w: screen.w });
    // The centre group is centred in the room between the bar and the gift row.
    expect(middle.y).toBe(bar.y + bar.h);
    expect(middle.y + middle.h).toBe(rectOf(game, "homeBottom").y);
    expect(centre.y + centre.h / 2).toBeCloseTo(middle.y + middle.h / 2, 5);
    expect(
      ["homeLogo", "homeYard", "play", "gift"].map(key => [
        rectOf(game, key).w,
        rectOf(game, key).h
      ])
    ).toEqual([
      [900, 440],
      [960, 924],
      [880, 220],
      [260, 260]
    ]);
    expect(Math.abs(screen.h - 44 - (label.y + label.h))).toBeLessThanOrEqual(1);

    await game.app.stop();
  });

  it("scales the centre group down as one when the room between the bar and the gift is short", async () => {
    const game = await start(createScreenGame({ manifest: await readManifest() }));

    await frames(game);

    const middle = rectOf(game, "homeMiddle");
    const centre = nodeOf(game.app.ui.tree(), "homeCentre");

    // Headless the screen is 1080 × 1440, the shortest shape: the group of 1644 units shrinks.
    expect(centre?.fitScale).toBeCloseTo(middle.h / (centre?.rect.h ?? 1), 5);
    expect(centre?.fitScale).toBeLessThan(1);

    await game.app.stop();
  });

  it("hangs the logo on ropes from above, stands the Play plank on its posts, and draws the bar last", async () => {
    const game = await start(createScreenGame({ manifest: await readManifest() }));

    await frames(game);

    const logo = rectOf(game, "homeLogo");
    const rope = rectOf(game, "homeLogoRopeLeft");

    // The rope ends on the top rim of the sign and reaches 900 units above it.
    expect(logo.y - rope.y).toBe(900);
    expect(rope.y + rope.h - logo.y).toBe(16);
    expect(childKeysOf(game, "playSign")).toEqual([
      "playPostLeft",
      "playPostRight",
      "play",
      "playSprigLeft",
      "playSprigRight"
    ]);
    expect(rectOf(game, "playPostLeft").y + rectOf(game, "playPostLeft").h).toBe(
      rectOf(game, "play").y + 220 + 150
    );
    expect(childKeysOf(game, "homeScreen").at(-1)).toBe("homeTop");
    expect(game.app.world.ecs.has(elementOf(game, "homeLogo"), Touchable)).toBe(false);

    await game.app.stop();
  });
});

/**
 * Runs frames and records the rotation of the gift wobble in each of them.
 *
 * @param game - The running game.
 * @param count - How many frames.
 * @returns The rotation in each frame.
 */
async function wobbleOf(game: Game, count: number): Promise<number[]> {
  const wobble = elementOf(game, "giftWobble");
  const tilts: number[] = [];

  for (let frame = 0; frame < count; frame += 1) {
    await frames(game, 1);
    tilts.push(game.app.world.ecs.get(wobble, Transform)?.rotation ?? 0);
  }

  return tilts;
}

describe("timber-screens — the daily gift wobble (B6)", () => {
  it("wobbles the gift button on its middle while the gift waits, again and again", async () => {
    const game = await start(createScreenGame({ manifest: await readManifest() }));

    await frames(game);

    const tilts = await wobbleOf(game, Math.ceil((2 * GIFT_WOBBLE_MS) / 16));
    const second = tilts.slice(Math.ceil(GIFT_WOBBLE_MS / 16));

    expect(Math.max(...second)).toBeGreaterThan(0.1);
    expect(Math.min(...second)).toBeLessThan(-0.1);
    // The wobble turns the button, never moves it: the wrapper is the button's own rect.
    expect(rectOf(game, "giftWobble")).toEqual(rectOf(game, "gift"));
    expect(game.app.world.ecs.get(elementOf(game, "giftWobble"), Transform)?.pivot).toEqual({
      x: 130,
      y: 130
    });

    await game.app.stop();
  });

  it("stands the gift button still once the gift is claimed", async () => {
    const claimed: Player = { ...startingPlayer, giftClaimed: true };
    const game = await start(createScreenGame({ player: claimed, manifest: await readManifest() }));

    await frames(game);

    const tilts = await wobbleOf(game, Math.ceil(GIFT_WOBBLE_MS / 16));

    expect(tilts.every(tilt => tilt === 0)).toBe(true);

    await game.app.stop();
  });
});

describe("timber-screens — the keyboard focus ring (design §4)", () => {
  it("draws the dashed ink ring 25 units outside the focused control, over a cream halo", async () => {
    const game = await start(createScreenGame({ manifest: await readManifest() }));

    await frames(game);
    expect(game.app.input.pressKey("Tab")).toBe(true);
    await frames(game);

    const focused = focusedIn(game.app.ui.tree());
    const rect = nodeOf(game.app.ui.tree(), focused?.key ?? "")?.rect;
    const ecs = game.app.world.ecs;
    const parts = [...ecs.query(Shape)].filter(([, shape]) => shape.alpha === 1 && shape.dash > 0);
    const [ring] = parts;

    expect(focused).toBeDefined();
    expect(parts).toHaveLength(1);
    expect(ring?.[1]).toMatchObject({
      stroke: 0x3a_22_12,
      strokeWidth: 4,
      dash: 10,
      w: (rect?.w ?? 0) + 50,
      h: (rect?.h ?? 0) + 50
    });
    expect(ecs.get(ring?.[0] ?? 0, Transform)).toMatchObject({
      x: (rect?.x ?? 0) - 25,
      y: (rect?.y ?? 0) - 25
    });

    await game.app.stop();
  });
});

describe("timber-screens — the board screen", () => {
  it("hosts every cell, the sawmill and every item in the board slot", async () => {
    const game = await startOnBoard(readyPlayer);
    const slot = elementOf(game, "boardSlot");
    const projection = game.app.world.projection;
    const hosted = [
      ...projection.entitiesOf("board.cells"),
      ...projection.entitiesOf("board.generators"),
      ...projection.entitiesOf("board.items")
    ];

    expect(hosted).toHaveLength(9 + 1 + 2);
    expect(hosted.map(entity => game.app.world.ecs.get(entity, Parent)?.entity)).toEqual(
      hosted.map(() => slot)
    );
    // The slot is the tray at its natural 970 units; the viewport fits the whole column.
    expect(nodeOf(game.app.ui.tree(), "boardSlot")).toMatchObject({
      rect: { w: 970, h: 970 },
      style: { nineSlice: "board.board-tray" }
    });

    await game.app.stop();
  });

  it("draws the coin counter inside the coin pill of the HUD", async () => {
    const game = await startOnBoard(readyPlayer);
    const counter = game.app.world.projection.entityOf("hud.coins", "coins") ?? 0;

    expect(game.app.world.ecs.get(counter, Parent)?.entity).toBe(elementOf(game, "coinPill"));

    await game.app.stop();
  });

  it("shows three order cards and enables only the Deliver the rules accept", async () => {
    const game = await startOnBoard(readyPlayer);
    const ecs = game.app.world.ecs;

    expect(["card0", "card1", "card2"].map(key => elementOf(game, key) > 0)).toEqual([
      true,
      true,
      true
    ]);
    // The plank on the board fills the first order; nothing fills the log or the crate.
    expect(ecs.has(elementOf(game, "deliver0"), Tappable)).toBe(true);
    expect(ecs.has(elementOf(game, "deliver1"), Tappable)).toBe(false);
    expect(ecs.has(elementOf(game, "deliver1"), Touchable)).toBe(true);
    expect(ecs.has(elementOf(game, "deliver2"), Tappable)).toBe(false);
    expect(nodeOf(game.app.ui.tree(), "deliver1")?.state.disabled).toBe(true);
    expect(nodeOf(game.app.ui.tree(), "card0")?.state.selected).toBe(true);
    expect(game.app.input.tap(elementOf(game, "deliver1"))).toBe(false);
    expect(ecs.get(elementOf(game, "card1Name"), Text)?.resolved).toBe("Бревно");
    expect(ecs.get(elementOf(game, "card2Coins"), Text)?.resolved).toBe("60");

    await game.app.stop();
  });

  it("shows the energy and the sawmill charges of the save", async () => {
    const game = await startOnBoard(readyPlayer);
    const ecs = game.app.world.ecs;

    expect(ecs.get(elementOf(game, "energyPillText"), Text)?.resolved).toBe("7/10");
    expect(ecs.get(elementOf(game, "infoCharges"), Text)?.resolved).toBe("4/4");
    expect(ecs.get(elementOf(game, "infoName"), Text)?.resolved).toBe("Лесопилка");

    const generator = game.app.world.projection.entityOf("board.generators", generatorId) ?? 0;

    expect(game.app.input.tap(generator)).toBe(true);
    await until(game, () => ecs.get(elementOf(game, "infoCharges"), Text)?.resolved === "3/4");

    expect(ecs.get(elementOf(game, "energyPillText"), Text)?.resolved).toBe("6/10");

    await game.app.stop();
  });

  it("keeps the plain-string labels of the HUD when the board screen is patched", async () => {
    const game = await startOnBoard(readyPlayer);
    const ecs = game.app.world.ecs;

    expect(ecs.get(elementOf(game, "card2Coins"), Text)?.resolved).toBe("60");

    // Selecting an item changes only the info bar; the rest of the board screen is patched as is.
    expect(game.app.input.tap({ projection: "board.items", key: "i2" })).toBe(true);
    await tick();
    await frames(game, 6);

    expect(ecs.get(elementOf(game, "card2Coins"), Text)?.resolved).toBe("60");
    expect(ecs.get(elementOf(game, "energyPillText"), Text)?.resolved).toBe("7/10");

    await game.app.stop();
  });

  it("keeps every board entity in the slot after a drag merges two items", async () => {
    const twigs: Player = {
      ...readyPlayer,
      merge: {
        ...readyPlayer.merge,
        board: {
          ...readyPlayer.merge.board,
          items: [
            { id: "i1", chain: "wood", level: 1, cell: "c1_0" },
            { id: "i2", chain: "wood", level: 1, cell: "c2_0" }
          ]
        }
      }
    };
    const game = await startOnBoard(twigs);
    const slot = elementOf(game, "boardSlot");
    const projection = game.app.world.projection;

    expect(
      game.app.input.drag(
        { projection: "board.items", key: "i1" },
        { projection: "board.items", key: "i2" }
      )
    ).toBe(true);
    await tick();
    await frames(game, 30);

    expect((game.app.model.store.snapshot().player as unknown as Player).merge.board.items).toEqual(
      [{ id: "i2", chain: "wood", level: 2, cell: "c2_0" }]
    );

    const hosted = [
      ...projection.entitiesOf("board.cells"),
      ...projection.entitiesOf("board.generators"),
      ...projection.entitiesOf("board.items")
    ];

    expect(hosted).toHaveLength(9 + 1 + 1);
    expect(hosted.map(entity => game.app.world.ecs.get(entity, Parent)?.entity)).toEqual(
      hosted.map(() => slot)
    );

    await game.app.stop();
  });

  it("goes back to Home from the home button of the HUD", async () => {
    const game = await startOnBoard(readyPlayer);

    expect(game.app.input.tap(elementOf(game, "home"))).toBe(true);
    await until(game, () => game.app.flow.state().path === "home");

    expect(game.app.scenes.current()).toBe("home");

    await game.app.stop();
  });
});
