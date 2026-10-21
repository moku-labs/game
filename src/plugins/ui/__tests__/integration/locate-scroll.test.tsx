import { afterEach, describe, expect, it } from "vitest";
import { read } from "../../../flow/doors/read";
import { locateSource } from "../../inspect";
import { frames, mount, PINNED, type ScrollApp, startScrollApp } from "../scroll-app";

// ---------------------------------------------------------------------------
// Integration: game.locate under a scroll (F39). The order strip of A Memory
// Missing's board: a 306 u window over a 696 u track, opened on 318. An element
// is located where it is drawn, moved by the scroll's offset and cut by the
// scroll's clip. Real world, real Yoga, plain Bun, inert renderer.
// ---------------------------------------------------------------------------

/** The app of the running test, stopped after it. */
let running: ScrollApp | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

/**
 * Starts the fixture with the strip mounted and settled.
 *
 * @returns The app.
 */
async function startStrip(): Promise<ScrollApp> {
  running = await startScrollApp();
  mount(running, "strip");
  frames(running, 2);

  return running;
}

describe("game.locate under a scroll (F39)", () => {
  it("finds nothing of a tile the strip scrolled out of its window", async () => {
    // Bug caught: the strip stands on 318, the first event is drawn at -318 and clipped away, yet
    // locate gave its layout box at x 0, so the editor's picker picked it over what is drawn there.
    const app = await startStrip();

    expect(read(app, locateSource, { key: "event1" })).toBeUndefined();
    expect(read(app, locateSource, { key: "order1" })).toBeUndefined();
  });

  it("moves a tile by the scroll's offset and cuts it to the window", async () => {
    // Bug caught: the offset is a Transform the scroll step writes, which locate never read.
    const app = await startStrip();

    expect(app.ui.scroll("strip", 100)).toBe(true);
    frames(app, 1);

    expect(read(app, locateSource, { key: "event1" })).toEqual({ x: 0, y: 0, w: 16, h: 120 });
    expect(read(app, locateSource, { key: "order1" })).toEqual({ x: 16, y: 0, w: 116, h: 120 });
  });

  it("keeps the scroll's own box and cuts its track to the window", async () => {
    // The clip masks only the children: the scroll keeps its own box, the track is cut to it.
    const app = await startStrip();

    expect(read(app, locateSource, { key: "strip" })).toEqual({ x: 0, y: 0, w: PINNED, h: 120 });
    expect(read(app, locateSource, { key: "track" })).toEqual({ x: 0, y: 0, w: PINNED, h: 120 });
  });
});
