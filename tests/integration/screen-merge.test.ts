/**
 * @file The headless half of the V2 exit criterion: the fixture merge game with its screen
 * composed. The board becomes entities in their layers, a scripted drag merges two items, and the
 * same game still plays to the end in plain Bun. The browser half is driven by the e2e station.
 *
 * The production build too (V5): the fixture is packed into a temp folder with `--pack`, the
 * same game plays to the end on the packed manifest, every bundle loads from the atlas pages, and
 * the dev server hands the page the packed build with `--packed`.
 */

import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Assets, Flow, Model } from "@moku-labs/game";
import { Transform } from "@moku-labs/game";
import { createHeadless } from "@moku-labs/game/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createScreenGame } from "./merge-game/game";
import { tr } from "./merge-game/kit";
import type { Player } from "./merge-game/state";
import { startingPlayer } from "./merge-game/state";
import { generatorId } from "./merge-game/tables";
import { Item } from "./merge-game/view/components";
import { cellBox } from "./merge-game/view/layout";
import { folderIo, until } from "./timber-helpers";

const runCommand = promisify(execFile);

/** The repository root, so the scanner is started with the cwd a game would use. */
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** The fixture game as the scanner walks it: the folder that holds `features/`. */
const gameRoot = "tests/integration/merge-game";

/** One entity of `world.ecs.snapshot()`, as far as this test reads it. */
type WorldEntity = {
  id: number;
  owner: { kind: string; name: string };
  components: Record<string, Model.Json>;
};

/** What `world.ecs.snapshot()` answers, as far as this test reads it. */
type WorldSnapshot = { mode: string; entities: WorldEntity[] };

/** One tap on the only generator of the game. */
const tap: Flow.RouteStep = { at: "board/awaitIntent", intent: "tap", payload: { generatorId } };

/** Drag the item on `from` onto the item on `to`. */
const mergeStep = (from: string, to: string): Flow.RouteStep => ({
  at: "board/awaitIntent",
  intent: "merge",
  payload: { from, to }
});

/** Open the board, spend the generator's four charges, merge them up to one level-3 item, give it. */
const untilOrder: Flow.RouteStep[] = [
  { at: "home", intent: "play" },
  tap,
  tap,
  tap,
  tap,
  // The four drops land on the ring around the generator (c0_0): c1_0, c0_1, c1_1, c2_0.
  mergeStep("c1_0", "c0_1"),
  mergeStep("c1_1", "c2_0"),
  mergeStep("c0_1", "c2_0"),
  { at: "board/awaitIntent", intent: "give", payload: { item: "i4", order: 0 } }
];

/** The reward popup the finished order opened. */
const claim: Flow.RouteStep = { at: "afterOrder/show", intent: "claim" };

/** Leaving the board, which is where the reward hands the player back to. */
const leave: Flow.RouteStep = { at: "board/awaitIntent", intent: "leave" };

/** A board that already carries two equal items and one of the next level. */
const preparedPlayer: Player = {
  ...startingPlayer,
  merge: {
    ...startingPlayer.merge,
    board: {
      ...startingPlayer.merge.board,
      items: [
        { id: "i1", chain: "wood", level: 1, cell: "c1_0" },
        { id: "i2", chain: "wood", level: 1, cell: "c2_0" },
        { id: "i3", chain: "wood", level: 2, cell: "c1_1" }
      ]
    },
    nextItemId: 4
  }
};

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 80): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Reads the committed manifest, the file the dev server hands the browser.
 *
 * @returns The parsed manifest.
 */
async function readManifest(): Promise<Assets.Manifest> {
  const text = await readFile(new URL("merge-game/manifest.json", import.meta.url), "utf8");

  return JSON.parse(text) as Assets.Manifest;
}

/**
 * Counts the entities of the world by the layer the projection put them in. The badges on the
 * board (the charges plate and the checks) are decorations of the things counted here, so they
 * are left out.
 *
 * @param snapshot - What `world.ecs.snapshot()` answered.
 * @returns How many entities each layer carries.
 */
function countByLayer(snapshot: Model.Json): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const entity of (snapshot as unknown as WorldSnapshot).entities) {
    if (entity.owner.name === "board.badges") continue;

    const layer = entity.components.Layer;

    if (typeof layer !== "object" || layer === null || Array.isArray(layer)) continue;

    const name = layer.name;

    if (typeof name === "string") counts[name] = (counts[name] ?? 0) + 1;
  }

  return counts;
}

/**
 * Starts the game live with the screen composed and walks it onto the board. Headless, every
 * bundle counts as loaded at once, so the loading plugin posts `loaded` at start and the splash
 * lets the graph through to Home; there the test answers `play`.
 *
 * @param player - The player a new save starts from.
 * @returns The started game, resting on `board/awaitIntent`.
 */
async function startBoard(player: Player) {
  const game = createScreenGame({ player, manifest: await readManifest() });
  const loop: { failure?: unknown } = {};

  await game.app.start();
  game.app.flow.run().catch((error: unknown) => {
    loop.failure = error;
  });
  await tick();

  if (loop.failure !== undefined) throw loop.failure;

  expect(game.app.flow.state().path).toBe("home");
  expect(game.app.flow.gate.answer({ intent: "play" })).toBe(true);
  await tick();
  game.app.time.step(16);

  return game;
}

describe("screen-merge — the board as entities", () => {
  it("mounts the scene of the resting node with one entity per cell and per item", async () => {
    const { app } = await startBoard(preparedPlayer);

    expect(app.scenes.current()).toBe("board");
    // The home node names its scene, so no rest node was ever entered without one.
    expect(
      app.log.trace().filter(item => item.event === "scenes: a rest node was entered with no scene")
    ).toEqual([]);
    // `ui` sits under `lifted`: the item in the hand leaves the board slot and draws over the screen.
    expect(app.world.projection.layers()).toEqual([
      { name: "cells", sort: "none" },
      { name: "glows", sort: "none" },
      { name: "items", sort: "y" },
      { name: "ui", sort: "order" },
      { name: "lifted", sort: "none" },
      { name: "fx", sort: "none" }
    ]);
    // Nine cells and the ring on the sawmill, selected while nothing else is; three items and the
    // generator, which is drawn in the items layer. The slot of the board screen hosts them, and
    // they keep their layer to fall back to.
    expect(countByLayer(app.world.ecs.snapshot())).toMatchObject({ cells: 9 + 1, items: 4 });
    expect(app.world.projection.entityOf("board.cells", "c1_0")).toBeDefined();
    expect(app.world.projection.entityOf("board.items", "i1")).toBeDefined();
    expect(app.world.projection.entityOf("board.generators", generatorId)).toBeDefined();

    await app.stop();
  });

  it("merges two equal items when one is dragged onto the other", async () => {
    const { app } = await startBoard(preparedPlayer);

    expect(
      app.input.drag(
        { projection: "board.items", key: "i1" },
        { projection: "board.items", key: "i2" }
      )
    ).toBe(true);

    await tick();
    app.time.step(16);

    expect(app.model.store.snapshot().player).toMatchObject({
      merge: {
        board: {
          items: [
            { id: "i2", level: 2, cell: "c2_0" },
            { id: "i3", level: 2, cell: "c1_1" }
          ]
        }
      }
    });
    expect(app.world.projection.entityOf("board.items", "i1")).toBeUndefined();

    const survivor = app.world.projection.entityOf("board.items", "i2") ?? 0;

    expect(app.world.ecs.get(survivor, Item)).toEqual({ chain: "wood", level: 2, cell: "c2_0" });
    expect(countByLayer(app.world.ecs.snapshot())).toMatchObject({ cells: 9 + 1 });

    await app.stop();
  });

  it("keeps both items when one is dropped on an item of another level", async () => {
    const { app } = await startBoard(preparedPlayer);
    const before = app.model.store.snapshot().player;

    expect(
      app.input.drag(
        { projection: "board.items", key: "i2" },
        { projection: "board.items", key: "i3" }
      )
    ).toBe(true);

    await tick();
    app.time.step(16);

    expect(app.model.store.snapshot().player).toEqual(before);
    expect(app.world.projection.entityOf("board.items", "i2")).toBeDefined();
    expect(app.world.projection.entityOf("board.items", "i3")).toBeDefined();
    expect(countByLayer(app.world.ecs.snapshot())).toMatchObject({ cells: 9 + 1, items: 4 });

    await app.stop();
  });

  it("spawns one more item entity when the generator is tapped", async () => {
    const { app } = await startBoard(startingPlayer);

    expect(countByLayer(app.world.ecs.snapshot())).toMatchObject({ cells: 9 + 1, items: 1 });

    const generator = app.world.projection.entityOf("board.generators", generatorId) ?? 0;

    expect(app.input.tap(generator)).toBe(true);

    await tick();
    app.time.step(16);

    expect(app.world.projection.entityOf("board.items", "i1")).toBeDefined();
    // The ring stays on the sawmill, which the tap selected: still one view of the cells layer.
    expect(app.world.projection.entitiesOf("board.selection")).toHaveLength(1);
    expect(countByLayer(app.world.ecs.snapshot())).toMatchObject({ cells: 9 + 1, items: 2 });

    await app.stop();
  });
});

describe("screen-merge — the fast walk", () => {
  it("plays the whole game to the end with the screen composed", async () => {
    const { app } = createScreenGame({ manifest: await readManifest() });
    const game = await createHeadless(app);

    expect(game.state().path).toBe("home");

    const board = await game.walk(untilOrder);

    expect(board.path).toBe("afterOrder/show");
    expect(app.scenes.current()).toBe("board");

    const home = await game.walk([claim, leave]);

    expect(home.path).toBe("home");
    expect(app.model.store.snapshot().player).toMatchObject({
      claimed: ["planks"],
      merge: { board: { items: [] }, wallet: { coins: 25 } }
    });

    await game.stop();
  });

  it("sets the picture with no motion while the world is fast", async () => {
    const { app } = createScreenGame({ manifest: await readManifest() });
    const game = await createHeadless(app);

    await game.walk([{ at: "home", intent: "play" }, tap]);

    expect(app.world.ecs.mode()).toBe("fast");

    const item = app.world.projection.entityOf("board.items", "i1") ?? 0;

    // The drop lands on c1_0, next to the generator, at the middle of that cell in the board
    // slot's own space. The enter motion would start the view small on the generator; fast mode
    // skips it.
    expect(cellBox("c1_0").middle).toEqual({ x: 485, y: 191 });
    expect(app.world.ecs.get(item, Transform)).toEqual({
      x: 485,
      y: 191,
      rotation: 0,
      scale: 1,
      pivot: { x: 0, y: 0 }
    });

    await game.stop();
  });
});

describe("screen-merge — the generated asset keys", () => {
  it("has a manifest, a key module and string modules, en-XA included, the scanner would write again", async () => {
    const { stdout } = await runCommand(
      "bun",
      [
        "src/assets.ts",
        "--root",
        gameRoot,
        "--manifest",
        `${gameRoot}/manifest.json`,
        "--keys",
        `${gameRoot}/generated/assets.ts`,
        "--check",
        "--pseudo"
      ],
      { cwd: repoRoot }
    );

    expect(stdout).toContain("up to date");
    expect(stdout).toContain("in 3 locales (en, en-XA, ru).");
  }, 60_000);
});

describe("screen-merge — the pseudo-locale", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers en-XA in a dev build and formats the refill bracketed, accented and with its duration", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app } = createScreenGame({ manifest: await readManifest() });

    await app.start();

    expect(app.i18n.locales()).toContain("en-XA");

    await app.i18n.setLocale("en-XA");

    // The literal words are accented and padded inside brackets; the duration is Intl's own,
    // and Intl reads "en-XA" as English.
    expect(app.i18n.plain(tr("energy.refill", { time: 95_000 }))).toBe(
      "[Ŕéƒíļļš íñ 1 min, 35 sec one two]"
    );

    await app.stop();
  });

  it("leaves en-XA out of a production build", async () => {
    const { app } = createScreenGame({ manifest: await readManifest() });

    await app.start();

    expect(app.i18n.locales()).not.toContain("en-XA");

    await app.stop();
  });
});

/** What the pack test keeps between its cases: the temp folder and the manifest written there. */
type PackRun = { folder: string; manifest: Assets.Manifest };

/** The packed build of the fixture, made once for the cases below. */
const packed: PackRun = { folder: "", manifest: { version: 1, bundles: {} } };

/** The textures that go to the `fx` page of the `ui` bundle: every key that starts with `fx-`. */
const fxKeys = ["ui.fx-leaf", "ui.fx-puff", "ui.fx-rays", "ui.fx-sparkle", "ui.fx-star"];

/**
 * Reads the asset keys the scanner wrote into a key module: the members of `AssetKey`.
 *
 * @param source - The text of the key module.
 * @returns The keys, in the order of the module.
 */
function assetKeysOf(source: string): string[] {
  const union = /export type AssetKey =([^;]*);/.exec(source)?.[1] ?? "";

  return [...union.matchAll(/"([^"]+)"/g)].map(match => match[1] ?? "");
}

/**
 * Every file of a manifest, with the bundle that lists it.
 *
 * @param manifest - The manifest.
 * @returns The files, bundle by bundle.
 */
function filesOf(manifest: Assets.Manifest): { bundle: string; file: Assets.ManifestFile }[] {
  return Object.entries(manifest.bundles).flatMap(([bundle, entry]) =>
    entry.files.map(file => ({ bundle, file }))
  );
}

/** A dev server of the fixture page started by a test, and everything it printed so far. */
type Server = { child: ChildProcess; printed: () => string };

/**
 * Starts the dev server of the fixture page from the fixture's folder, as a person does.
 *
 * @param args - The flags after the script.
 * @returns The process and what it printed.
 */
function launchServer(args: readonly string[]): Server {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- the Bun on PATH is the one the project scripts run.
  const child = spawn("bun", ["./web/serve.ts", ...args], {
    cwd: fileURLToPath(new URL("merge-game/", import.meta.url))
  });
  const chunks: string[] = [];
  const keep = (chunk: Buffer): void => {
    chunks.push(chunk.toString("utf8"));
  };

  child.stdout.on("data", keep);
  child.stderr.on("data", keep);

  return { child, printed: () => chunks.join("") };
}

/**
 * Waits for the line in which the server names its URL.
 *
 * @param server - The started server.
 * @returns The URL, ending in `/`.
 */
function urlOf(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.child.stdout?.on("data", () => {
      const url = /https?:\/\/\S+\//.exec(server.printed())?.[0];

      if (url !== undefined) resolve(url);
    });
    server.child.on("close", code => {
      reject(new Error(`serve.ts ended with ${code}: ${server.printed()}`));
    });
  });
}

/**
 * Waits for the server to end.
 *
 * @param server - The started server.
 * @returns The exit code.
 */
function exitOf(server: Server): Promise<number | null> {
  return new Promise(resolve => {
    server.child.on("close", resolve);
  });
}

describe("screen-merge — the packed build", () => {
  beforeAll(async () => {
    packed.folder = await mkdtemp(path.join(tmpdir(), "merge-game-pack-"));

    await runCommand(
      "bun",
      [
        "src/assets.ts",
        "--root",
        gameRoot,
        "--keys",
        path.join(packed.folder, "generated/assets.ts"),
        "--pack",
        path.join(packed.folder, "assets")
      ],
      { cwd: repoRoot }
    );

    const text = await readFile(path.join(packed.folder, "assets/manifest.json"), "utf8");

    packed.manifest = JSON.parse(text) as Assets.Manifest;
  }, 120_000);

  afterAll(async () => {
    await rm(packed.folder, { recursive: true, force: true });
  });

  it("packs every key of the game once, with the same key module as a dev run", async () => {
    const committed = await readFile(new URL("merge-game/generated/assets.ts", import.meta.url));
    const written = await readFile(path.join(packed.folder, "generated/assets.ts"));
    const keys = filesOf(packed.manifest).map(entry => entry.file.key);

    expect(packed.manifest.version).toBe(2);
    expect(written.equals(committed)).toBe(true);
    expect(keys.toSorted()).toEqual(assetKeysOf(committed.toString("utf8")).toSorted());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("puts the fx textures of the ui bundle on one page of their own", () => {
    const ui = packed.manifest.bundles.ui;
    const onFx = (ui?.files ?? []).filter(file => file.atlas?.page === "ui/fx-0");

    expect(ui?.pages?.map(page => page.id)).toEqual(["ui/fx-0", "ui/main-0"]);
    expect(onFx.map(file => file.key)).toEqual(fxKeys);
  });

  it("keeps the nine-slice borders of the dev manifest", async () => {
    const dev = filesOf(await readManifest());
    const nines = new Map(filesOf(packed.manifest).map(entry => [entry.file.key, entry.file.nine]));
    const sliced = dev.filter(entry => entry.file.nine !== undefined);

    expect(sliced.length).toBeGreaterThan(0);

    for (const { file } of sliced) expect(nines.get(file.key), file.key).toEqual(file.nine);
  });

  it("plays the whole game to the end on the packed manifest, every bundle loaded", async () => {
    const { app } = createScreenGame({ manifest: packed.manifest });
    const game = await createHeadless(app);

    for (const bundle of Object.keys(packed.manifest.bundles)) {
      expect(app.assets.isLoaded(bundle), bundle).toBe(true);
    }

    const board = await game.walk(untilOrder);

    expect(board.path).toBe("afterOrder/show");

    const home = await game.walk([claim, leave]);

    expect(home.path).toBe("home");
    expect(app.model.store.snapshot().player).toMatchObject({
      claimed: ["planks"],
      merge: { board: { items: [] }, wallet: { coins: 25 } }
    });

    await game.stop();
  });

  it("loads every bundle from the pack folder: each page fetched once, each packed texture sliced from it", async () => {
    const disk = folderIo(pathToFileURL(`${path.join(packed.folder, "assets")}/`));
    const game = createScreenGame({ manifest: packed.manifest, io: disk.io });
    const bundles = Object.keys(packed.manifest.bundles);

    await game.app.start();
    game.app.flow.run().catch(() => undefined);
    await until(game, () => game.app.flow.state().path === "home");
    await Promise.all(bundles.map(bundle => game.app.assets.load(bundle)));

    const pages = bundles.flatMap(bundle => packed.manifest.bundles[bundle]?.pages ?? []);
    const pagePath = new Map(pages.map(page => [page.id, page.path]));
    const packedFiles = filesOf(packed.manifest).flatMap(({ file }) =>
      file.atlas === undefined ? [] : [{ file, atlas: file.atlas }]
    );

    for (const page of pages) {
      expect(
        disk.fetched.filter(fetched => fetched === page.path),
        page.id
      ).toHaveLength(1);
    }

    expect(disk.slices).toHaveLength(packedFiles.length);

    for (const { file, atlas } of packedFiles) {
      const { page, ...frame } = atlas;
      const slice = disk.slices.find(
        entry =>
          entry.page === pagePath.get(page) &&
          entry.frame.x === frame.x &&
          entry.frame.y === frame.y
      );

      expect(slice?.frame, file.key).toEqual(frame);
      expect(slice?.nine, file.key).toEqual(
        file.nine === undefined
          ? undefined
          : [file.nine.left, file.nine.top, file.nine.right, file.nine.bottom]
      );
    }

    // A packed key answers its slice; a font answers the `.fnt` the packer rewrote.
    const coin = packed.manifest.bundles.ui?.files.find(file => file.key === "ui.icon-coin");

    expect(game.app.assets.texture("ui.icon-coin")).toEqual({
      path: `${pagePath.get("ui/main-0")}#${coin?.atlas?.x},${coin?.atlas?.y}`
    });
    expect(game.app.assets.font("ui.font-body")?.fnt).toMatch(
      /file="ui\.font-body-0-[0-9a-f]{10}\.png"/
    );

    await game.app.stop();
  });

  it("serves the packed build to the dev page with --packed", async () => {
    const server = launchServer(["--packed", path.join(packed.folder, "assets"), "--port", "0"]);

    try {
      const url = await urlOf(server);
      const served = await fetch(`${url}manifest.json`);
      const page = packed.manifest.bundles.ui?.pages?.[0]?.path ?? "";
      const atlas = await fetch(`${url}${page}`);
      const bytes = Buffer.from(await atlas.arrayBuffer());
      const loose = await fetch(`${url}features/ui/assets/font-body.fnt`);
      const html = await fetch(url);

      expect(await served.json()).toEqual(packed.manifest);
      expect(atlas.status).toBe(200);
      expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
      // The loose dev files are not part of the packed build.
      expect(loose.status).toBe(404);
      expect(await html.text()).toContain('<div id="game"></div>');
    } finally {
      server.child.kill();
    }
  }, 60_000);

  it("refuses --packed without a pack and names the script that makes one", async () => {
    const server = launchServer(["--packed", path.join(packed.folder, "missing"), "--port", "0"]);

    expect(await exitOf(server)).toBe(1);
    expect(server.printed()).toContain('Run "bun run fixture:pack"');
  }, 60_000);
});
