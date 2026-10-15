/**
 * @file Root integration — the sheets game on a page, for the overlay tests (spec 22). Not a test. The engine's
 * renderer runs over Pixi's own objects (`stagePixi`), drawing on demand on a fake clock; the tree oracle, the picture
 * oracle and the atomicity checker read every frame. A test taps keyed buttons and steps frames.
 */
import { readFile } from "node:fs/promises";
import * as pixi from "pixi.js";
import { vi } from "vitest";
import type { Assets, Renderer } from "../../src";
import { commands, run } from "../../src/control";
import { fakeClock } from "../../src/plugins/clock/fake";
import {
  type OverlayOracle,
  watchOverlays
} from "../../src/plugins/renderer/__tests__/overlay-oracle";
import type { RenderCall } from "../../src/plugins/renderer/__tests__/stage-pixi";
import sheetsGame from "../fixtures/sheets-game/index";
import type { Player, Session } from "../fixtures/sheets-game/state";
import { startingPlayer, startingSession } from "../fixtures/sheets-game/state";
import { type DrawnPage, diskIo, openPage, type Watched, watch } from "./drawn-helpers";

/** The folder of the sheets game: the dev manifest and every asset path are relative to it. */
export const sheetsFolder = new URL("../fixtures/sheets-game/", import.meta.url);

/** The sheets game as `screen()` builds it. */
export type SheetsApp = ReturnType<typeof sheetsGame.screen>["app"];

/** A running sheets game on a page, with its drivers. */
export type Sheets = Watched & {
  app: SheetsApp;
  page: DrawnPage;
  atomic: OverlayOracle;
  /** One frame of 16 ms; true when it was drawn. */
  frame(): Promise<boolean>;
  /** Taps a keyed element and runs the frames until the flow has moved and the screen followed. */
  tap(key: string): Promise<void>;
  /** Taps a keyed element and runs no frame. */
  press(key: string): void;
  /** The top Pixi object of a keyed element's view (its wrapper, or its object); `undefined` while it has none. */
  topOf(key: string): pixi.Container | undefined;
  /** The Pixi object of a keyed element's view. */
  objectOf(key: string): pixi.Container | undefined;
  /** The range pictures in the tree: the sprites the overlay step's pictures are shown by. */
  pictures(): pixi.Container[];
  /** Runs frames until the flow rests on a path. */
  until(path: string, max?: number): Promise<void>;
  /** The overlays' reports. */
  reports(): readonly Renderer.OverlayReport[];
  /** The renders of the stage root into a texture (range pictures) since a point of the log. */
  rootRenders(from?: number): RenderCall[];
  /** The length of the render log now. */
  mark(): number;
};

/**
 * The entity of a keyed element of the screen.
 *
 * @param app - The running game.
 * @param key - The element's key.
 * @returns The entity, or `undefined` while no live element has the key.
 */
export function findKey(app: Pick<SheetsApp, "ui">, key: string): number | undefined {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  return app.ui.find(key);
}

/**
 * Reads the committed dev manifest of the sheets game.
 *
 * @returns The manifest.
 */
export async function readSheetsManifest(): Promise<Assets.Manifest> {
  return JSON.parse(
    await readFile(new URL("generated/manifest.json", sheetsFolder), "utf8")
  ) as Assets.Manifest;
}

/**
 * Starts the sheets game on a page and lets it rest on the ward (or restores a start), every frame checked.
 *
 * @param options - Where it starts.
 * @param options.player - The player of the start.
 * @param options.session - The session of the start.
 * @param options.checkpoint - Restores a repro at this checkpoint once the ward rests, and steps no frame after it.
 * @param options.width - The CSS width of the page.
 * @param options.height - The CSS height of the page.
 * @returns The running game.
 */
export async function openSheets(
  options: {
    player?: Player;
    session?: Session;
    checkpoint?: "ward" | "board";
    width?: number;
    height?: number;
  } = {}
): Promise<Sheets> {
  const page = openPage(options.width ?? 390, options.height ?? 844);
  const clock = fakeClock(1_000_000);
  const manifest = await readSheetsManifest();
  const { app } = sheetsGame.screen({
    manifest,
    io: diskIo(sheetsFolder, manifest),
    renderer: page.renderer,
    clock,
    player: options.player ?? startingPlayer,
    session: options.session ?? startingSession
  });

  await app.start();
  app.flow.run().catch(() => undefined);

  const watched = watch(app, page, clock);
  const atomic = watchOverlays(
    {
      stage: page.stage.last(),
      overlays: () => app.renderer.sync.debug.overlays(),
      ecs: app.world.ecs,
      displayOf: entity => app.renderer.sync.displayOf(entity),
      hudLayer: "hud"
    },
    pixi
  );
  const frame = async (): Promise<boolean> => {
    const [drawn] = await watched.each(1);

    atomic.check();

    return drawn === true;
  };
  const frames = async (count = 1): Promise<number> => {
    let drawn = 0;

    for (let index = 0; index < count; index += 1) drawn += (await frame()) ? 1 : 0;

    return drawn;
  };
  const objectOf = (key: string): pixi.Container | undefined => {
    const entity = findKey(app, key);

    return entity === undefined
      ? undefined
      : (app.renderer.sync.displayOf(entity) as pixi.Container | undefined);
  };
  const press = (key: string): void => {
    const entity = findKey(app, key);

    if (entity === undefined) throw new Error(`nothing is keyed ${key}`);

    app.input.tap(entity);
  };
  const until = async (path: string, max = 300): Promise<void> => {
    for (let index = 0; index < max && app.flow.state().path !== path; index += 1) await frame();

    if (app.flow.state().path !== path) {
      throw new Error(`the flow did not reach ${path}: it rests on ${app.flow.state().path}`);
    }
  };
  const sheets: Sheets = {
    ...watched,
    frames,
    app,
    page,
    atomic,
    frame,
    until,
    tap: async key => {
      const before = app.flow.state().path;

      press(key);

      for (let index = 0; index < 60 && app.flow.state().path === before; index += 1) await frame();

      await frames(2);
    },
    press,
    topOf: key => {
      const object = objectOf(key);
      const parent = object?.parent;

      return parent?.label.startsWith("parent#") === true ? parent : object;
    },
    objectOf,
    pictures: () => {
      const found: pixi.Container[] = [];

      for (const layer of page.stage.last().stage.children[0]?.children ?? []) {
        for (const child of layer.children)
          if (child.label.startsWith("freeze:")) found.push(child);
      }

      return found;
    },
    reports: () => app.renderer.sync.debug.overlays(),
    rootRenders: (from = 0) =>
      page.stage
        .targets()
        .slice(from)
        .filter(
          call =>
            call.container === app.renderer.sync.displayOf(0) ||
            call.container.label === "renderer.root"
        ),
    mark: () => page.stage.targets().length
  };

  await until("ward");

  if (options.checkpoint === undefined) {
    await frames(30);
  } else {
    // The restore is a door command: a dev build's. The test steps the frames of the restored screen itself.
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    await run(app, commands.restore, {
      repro: {
        player: options.player ?? startingPlayer,
        session: options.session ?? startingSession,
        checkpoint: options.checkpoint,
        route: []
      }
    });
  }

  return sheets;
}

/**
 * The checks every sheets test ends with: no missed frame, every picture current, K3 kept; then the game stops.
 *
 * @param sheets - The running game.
 */
export async function closeSheets(sheets: Sheets): Promise<void> {
  sheets.oracle.expectNoMissedFrame();
  sheets.oracle.expectPicturesCurrent();
  sheets.atomic.expectAtomic();
  await sheets.app.stop();
}
