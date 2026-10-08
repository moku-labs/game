/**
 * @file What the tests on the mini game share: its folder, its dev manifest, the file seam of
 * `assets` over the folder, and the waits of a game that runs live in plain Bun. Nothing here
 * imports a test runner: `bun tests/visual/run.ts` loads it as well as vitest does.
 */
import { readFile } from "node:fs/promises";
import type { Assets } from "@moku-labs/game";
import type miniGame from "../fixtures/mini-game/index";

/** The mini game as `miniGame.screen()` builds it: the screen app, not started. */
export type MiniGame = ReturnType<typeof miniGame.screen>["app"];

/** The folder of the mini game: the dev manifest and every asset path are relative to it. */
export const miniFolder = new URL("../fixtures/mini-game/", import.meta.url);

/**
 * Reads the committed dev manifest `generated/manifest.json`, the file the dev server hands the
 * browser on `/manifest.json`.
 *
 * @returns The parsed manifest.
 */
export async function readManifest(): Promise<Assets.Manifest> {
  return JSON.parse(
    await readFile(new URL("generated/manifest.json", miniFolder), "utf8")
  ) as Assets.Manifest;
}

/** A texture of `folderIo`: the path of the file it was decoded from, nothing else. */
export type DiskTexture = { path: string };

/** One texture `folderIo` cut out of a page: the page's path, the frame and the nine borders. */
export type DiskSlice = {
  page: string;
  frame: { x: number; y: number; width: number; height: number };
  nine: readonly number[] | undefined;
};

/** The file seam over one folder, and what went through it. */
export type FolderIo = {
  io: Assets.AssetsIo;
  /** The path of every file fetched, in order, relative to the folder. */
  fetched: string[];
  /** Every slice cut out of a page, in order. */
  slices: DiskSlice[];
};

/**
 * The file seam of `assets` over one folder on disk: every file is really read, an image decodes
 * to a stand-in that remembers its path, and a slice remembers its page and frame. The renderer is
 * inert, so nothing reaches a GPU; the font is real, so `text` measures with its tables.
 *
 * @param folder - The folder the manifest's paths are relative to, ending in `/`.
 * @returns The seam, the fetched paths and the slices.
 */
export function folderIo(folder: URL = miniFolder): FolderIo {
  const fetched: string[] = [];
  const slices: DiskSlice[] = [];
  const paths = new WeakMap<Blob, string>();
  const io: Assets.AssetsIo = {
    fetch: async url => {
      const path = url.replace(/^\//, "");
      const bytes = await readFile(new URL(path, folder));
      const blob = new Blob([bytes]);

      fetched.push(path);
      paths.set(blob, path);

      return {
        ok: true,
        status: 200,
        // eslint-disable-next-line unicorn/no-null -- a `Response` answers a missing header with null.
        headers: { get: () => null },
        json: () => Promise.resolve(JSON.parse(bytes.toString("utf8")) as unknown),
        blob: () => Promise.resolve(blob),
        text: () => Promise.resolve(bytes.toString("utf8")),
        arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer)
      };
    },
    decode: blob => {
      const texture: DiskTexture = { path: paths.get(blob) ?? "" };

      return Promise.resolve(texture as unknown as Assets.DecodedImage);
    },
    createTexture: image => image as unknown as Assets.Texture,
    sliceTexture: (page, frame, options) => {
      const { path } = page as unknown as DiskTexture;
      const { x, y, width, height } = frame;
      const slice: DiskTexture = { path: `${path}#${x},${y}` };

      slices.push({ page: path, frame: { x, y, width, height }, nine: options?.nine });

      return slice as unknown as Assets.Texture;
    },
    destroyTexture: () => undefined
  };

  return { io, fetched, slices };
}

/**
 * Yields the microtask queue to the loop, the way a test waits without a timer.
 *
 * @param times - How many microtasks to give up.
 */
export async function tick(times = 40): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Runs frames of 16 ms, each followed by its microtasks and one task: a file read from disk
 * settles in a later task.
 *
 * @param app - The running game.
 * @param count - How many frames.
 */
export async function frames(app: MiniGame, count = 6): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    app.time.step(16);
    await tick();
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  }
}

/**
 * Runs frames until a condition holds.
 *
 * @param app - The running game.
 * @param done - The condition to wait for.
 * @param limit - How many frames at most.
 * @throws {Error} When the condition still does not hold after the last frame.
 */
export async function until(app: MiniGame, done: () => boolean, limit = 200): Promise<void> {
  for (let frame = 0; frame < limit && !done(); frame += 1) await frames(app, 1);

  if (!done()) throw new Error(`the mini game did not get there in ${limit} frames`);
}

/**
 * Starts the game live, runs its graph and waits for Home. A failure of the graph reaches the
 * caller instead of a handler.
 *
 * @param app - The game, not started.
 * @returns The same game, resting on `home` with the Home screen laid out.
 */
export async function startOnHome(app: MiniGame): Promise<MiniGame> {
  const loop: { failure?: unknown } = {};

  await app.start();
  app.flow.run().catch((error: unknown) => {
    loop.failure = error;
  });
  await until(app, () => loop.failure !== undefined || app.flow.state().path === "home");

  if (loop.failure !== undefined) throw loop.failure;

  await frames(app);

  return app;
}
