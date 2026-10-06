/**
 * @file The hot swap of `moku-game dev` in a real Chromium, opt-in (`MOKU_VISUAL_BROWSER=1`):
 * the page of a copy of the mini game boots on `?renderer=webgl&player=ready`, a save of the Home
 * view swaps the counter text, and the page does not load again. `bun run test` runs no browser:
 * this test skips with its reason.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { copyMiniGame, removeCopies, startBin, urlOf } from "./app-helpers";

/** The copies of this file, removed after it. */
const copies: string[] = [];

/** The flags of a Chromium that draws WebGL without a GPU, as the spike ran it. */
const SOFTWARE_GL = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

/** What the page reads of the running game. */
type Readout = { path: string | undefined; counter: string | undefined };

/**
 * Reads the position and the Home counter of the running game, in the page, through the doors.
 *
 * @returns The path of the graph and the text of the counter.
 */
function readPage(): Readout {
  const game: unknown = Reflect.get(globalThis, "game");
  const doors = Reflect.get(globalThis, "doors") as {
    read(app: unknown, source: unknown): { path?: string; children?: { content?: string }[] };
    sources: { position: unknown; ui: unknown };
  };
  const tree = doors.read(game, doors.sources.ui);

  return {
    path: doors.read(game, doors.sources.position).path,
    counter: tree.children?.[0]?.content
  };
}

afterAll(() => {
  removeCopies(copies);
});

describe("moku-game dev in a browser", () => {
  it("a save of a view swaps it with no page load", async ctx => {
    ctx.skip(
      process.env.MOKU_VISUAL_BROWSER !== "1",
      "opt-in: run with MOKU_VISUAL_BROWSER=1 and the Chromium of playwright-core"
    );
    ctx.skip(
      /\bcov_\w+\(/u.test(String(readPage)),
      "coverage instruments the page function, so it cannot run in Chromium"
    );

    const { chromium } = await import("playwright-core");
    const root = copyMiniGame("hot");
    const view = path.join(root, "features", "home", "view.tsx");
    const started = startBin(["dev", "--root", root, "--port", "0"]);
    const browser = await chromium.launch({ args: SOFTWARE_GL });

    copies.push(root);

    try {
      const url = await urlOf(started);
      const page = await browser.newPage();
      const loads: string[] = [];
      const read = (): Promise<Readout> => page.evaluate(readPage);

      page.on("load", () => loads.push("load"));
      await page.goto(`${url}?renderer=webgl&player=ready`);
      await page.waitForFunction(() => Reflect.get(globalThis, "doors") !== undefined);
      await expect.poll(read, { timeout: 20_000 }).toEqual({ path: "home", counter: "3" });

      writeFileSync(view, readFileSync(view, "utf8").replace("content={`", "content={`#"));

      await expect.poll(read, { timeout: 20_000 }).toEqual({ path: "home", counter: "#3" });
      expect(loads).toEqual(["load"]);
    } finally {
      await browser.close();
      started.child.kill("SIGINT");
      await started.exit;
    }
  }, 120_000);
});
