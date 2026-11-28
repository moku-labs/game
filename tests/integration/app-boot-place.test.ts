/**
 * @file The CSS of a placed boot picture in a real Chromium, opt-in (`MOKU_VISUAL_BROWSER=1`): a
 * page `pageHtml` writes for a `page.boot` with `frame` and `rect` is loaded at a phone's window,
 * and the box of `#moku-boot` is where `bootPlacement` says, within Chromium's layout unit of
 * 1/64 px: the worked portrait
 * config at 384 × 832, the default aspect at 360 × 1000, a landscape game at 832 × 384. `bun run
 * test` runs no browser: this test skips with its reason.
 */
import { describe, expect, it } from "vitest";
import { bootPlacement } from "../../src/app/boot";
import { resolveConfig } from "../../src/app/config";
import { pageHtml } from "../../src/app/generate";
import type { GameConfig, ResolvedGameConfig } from "../../src/app/types";
import type { Rect } from "../../src/plugins/renderer/viewport/types";
import { NO_KEYCHAIN_FLAGS } from "../../src/visual/leg-browser";

/**
 * How far a box may lie from `bootPlacement`, CSS px: Chromium lays out in whole 1/64 px, rounded
 * down, so 346.667 reads 346.65625, and 328.125 from `100vw * 2.333333` (21 / 9 at 6 decimals,
 * 0.00005 px short) reads 328.109375. Measured 2026-11-27: one unit off at most.
 */
const LAYOUT_UNIT = 1 / 64;

/** The origin the page is served from, by the routes of the test. */
const ORIGIN = "http://boot.test";

/** A 1 × 1 PNG, the picture of the page: a broken image may lay out with no size. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/** The box of `#moku-boot`, read in the page as a string: a function would be instrumented under coverage. */
const READ_BOX =
  "(() => { const box = document.querySelector('#moku-boot').getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; })()";

/**
 * The resolved page of a placed boot picture.
 *
 * @param page - The page fields over the title, the boot with its placement among them.
 * @returns The page.
 */
function placedPage(page: Omit<GameConfig["page"], "title">): ResolvedGameConfig["page"] {
  return resolveConfig({ page: { title: "T", ...page } }).page;
}

/** The worked portrait config of A Memory Missing. */
const worked = placedPage({
  boot: {
    image: "assets/boot.png",
    frame: { width: 1024, height: 1536 },
    rect: { x: 215, y: 402, width: 600, height: 640 },
    aspect: { min: 0.4, max: 2.6 },
    fadeMs: 0
  }
});

/** The same picture on the renderer's default aspect. */
const fallback = placedPage({
  boot: {
    image: "assets/boot.png",
    frame: { width: 1024, height: 1536 },
    rect: { x: 215, y: 402, width: 600, height: 640 }
  }
});

/** The picture turned for a landscape game, on the default aspect. */
const turned = placedPage({
  orientation: "landscape",
  boot: {
    image: "assets/boot.png",
    frame: { width: 1536, height: 1024 },
    rect: { x: 402, y: 215, width: 640, height: 600 }
  }
});

/**
 * The box `bootPlacement` gives a page at a window.
 *
 * @param page - The resolved page.
 * @param width - CSS width of the window.
 * @param height - CSS height of the window.
 * @returns The box.
 */
function expectedBox(page: ResolvedGameConfig["page"], width: number, height: number): Rect {
  const place = page.boot?.place;

  if (place === undefined) throw new Error("the page has no placed boot picture");

  return bootPlacement({ width, height }, place);
}

describe("a placed boot picture in a browser", () => {
  it("stands where bootPlacement says, within 1/64 px, portrait, default aspect and landscape", async ctx => {
    ctx.skip(
      process.env.MOKU_VISUAL_BROWSER !== "1",
      "opt-in: run with MOKU_VISUAL_BROWSER=1 and the Chromium of playwright-core"
    );

    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ args: [...NO_KEYCHAIN_FLAGS] });

    try {
      const cases = [
        { page: worked, width: 384, height: 832 },
        { page: fallback, width: 360, height: 1000 },
        { page: turned, width: 832, height: 384 }
      ];

      for (const { page, width, height } of cases) {
        const tab = await browser.newPage({ viewport: { width, height } });
        const html = pageHtml(page, { toRoot: "./", script: "./main.js" });

        await tab.route(`${ORIGIN}/**`, route => {
          const url = route.request().url();

          if (url.endsWith("/index.html")) {
            return route.fulfill({ contentType: "text/html", body: html });
          }

          if (url.endsWith("/assets/boot.png")) {
            return route.fulfill({ contentType: "image/png", body: PIXEL });
          }

          return route.fulfill({ contentType: "text/javascript", body: "" });
        });
        await tab.goto(`${ORIGIN}/index.html`);
        await tab.waitForFunction("document.querySelector('#moku-boot').complete");

        const box = (await tab.evaluate(READ_BOX)) as Rect;
        const expected = expectedBox(page, width, height);
        const off = {
          x: Math.abs(box.x - expected.x),
          y: Math.abs(box.y - expected.y),
          width: Math.abs(box.width - expected.width),
          height: Math.abs(box.height - expected.height)
        };

        expect(
          Math.max(off.x, off.y, off.width, off.height),
          JSON.stringify({ width, height, off })
        ).toBeLessThanOrEqual(LAYOUT_UNIT);
        await tab.close();
      }
    } finally {
      await browser.close();
    }
  }, 60_000);
});
