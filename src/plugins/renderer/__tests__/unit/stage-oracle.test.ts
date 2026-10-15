import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Display, Shape, Transform } from "../../components";
import { startDrawn } from "../demand-harness";
import { installFakeDom } from "../fake-dom";
import { watchFrames } from "../stage-oracle";
import { type StageApplication, stagePixi } from "../stage-pixi";

// ---------------------------------------------------------------------------
// The picture oracle's own test (spec 23 P13.1): a kept picture is followed by
// hand through the protocol the cache uses (the subtree into a picture, the
// stand-in with the filters into the output, the quad beside the hidden top),
// and every way of breaking it is seen at the next stage render.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A picture kept by hand, and the oracle that watches it. */
type Kept = {
  app: StageApplication;
  oracle: ReturnType<typeof watchFrames>;
  top: pixi.Container;
  dot: pixi.Graphics;
  standIn: pixi.Sprite;
  quad: pixi.Sprite;
  filter: pixi.AlphaFilter;
  /** Draws the stage. */
  draw(): void;
  /** Renders the three stages again, as a retake does. */
  retake(): void;
};

/**
 * Builds a stage with one view (a container with a dot at x 100) and keeps its picture by the cache's protocol.
 *
 * @returns The kept picture.
 */
async function keptByHand(): Promise<Kept> {
  installFakeDom({ width: 400, height: 400 });

  const page = stagePixi();
  const app = new page.module.Application() as unknown as StageApplication;

  await app.init({});

  const oracle = watchFrames(app, pixi);
  const top = new pixi.Container({ label: "view", x: 100, y: 50 });
  const dot = new pixi.Graphics().rect(0, 0, 10, 10).fill(0xff_00_00);
  const s1 = pixi.RenderTexture.create({ width: 10, height: 10 });
  const s3 = pixi.RenderTexture.create({ width: 10, height: 10 });
  const filter = new pixi.AlphaFilter();
  const standIn = new pixi.Sprite({ texture: s1, label: "stand-in" });
  const quad = new pixi.Sprite({ texture: s3, label: "quad" });

  top.addChild(dot);
  app.stage.addChild(top, quad);
  standIn.filters = [filter];

  const retake = (): void => {
    app.renderer.render({
      container: top,
      target: s1,
      transform: new pixi.Matrix(1, 0, 0, 1, top.x - 100, top.y - 50)
    });
    app.renderer.render({ container: standIn, target: s3, transform: new pixi.Matrix() });
  };

  retake();
  top.renderable = false;
  quad.position.set(100, 50);

  return {
    app,
    oracle,
    top,
    dot,
    standIn,
    quad,
    filter,
    draw: () => app.renderer.render(app.stage),
    retake
  };
}

describe("expectPicturesCurrent", () => {
  it("is clean for a picture kept by the protocol, also when the view and its quad move together", async () => {
    const kept = await keptByHand();

    kept.draw();
    kept.top.x = 140;
    kept.quad.x = 140;
    kept.draw();

    expect(kept.oracle.pictures).toEqual([]);
  });

  it("fails when a kept subtree changed without a retake, naming the top and the node", async () => {
    const kept = await keptByHand();

    kept.dot.x = 3;
    kept.draw();

    expect(kept.oracle.pictures).toEqual([
      expect.objectContaining({
        picture: "view",
        field: expect.stringMatching(/^subtree: .*Graphics/)
      })
    ]);

    kept.retake();
    kept.draw();

    expect(kept.oracle.pictures).toHaveLength(1);
  });

  it("fails when the filters changed without a new output", async () => {
    const kept = await keptByHand();

    kept.filter.alpha = 0.25;
    kept.draw();

    expect(kept.oracle.pictures).toEqual([
      expect.objectContaining({ picture: "view", field: expect.stringMatching(/^filters: /) })
    ]);
  });

  it("fails when a quad and its top are both drawn, and when a quad is off its place", async () => {
    const kept = await keptByHand();

    kept.top.renderable = true;
    kept.draw();
    kept.top.renderable = false;
    kept.quad.x = 101;
    kept.draw();

    expect(kept.oracle.pictures.map(stale => stale.field)).toEqual([
      "the top is drawn beside its quad",
      "quad at 101,50, its picture lands at 100,50"
    ]);
  });

  it("fails when a top hidden for its picture is shown by no quad: neither is drawn", async () => {
    const kept = await keptByHand();

    kept.quad.visible = false;
    kept.draw();

    expect(kept.oracle.pictures).toEqual([
      expect.objectContaining({ picture: "view", field: "hidden for a picture that no quad shows" })
    ]);
  });

  it("catches a stale picture when a game writes its Display without telling the renderer: drawn, and skipped", async () => {
    const drawn = await startDrawn({ onDemand: true });
    const lamp = drawn.spawn(Transform({ x: 600, y: 100 }), Shape({ w: 8, h: 8 }));
    const flame = new pixi.Graphics().rect(0, 0, 30, 30).fill(0xff_80_00);
    const stove = drawn.spawn(
      Transform({ x: 100, y: 100 }),
      Display({ object: new pixi.Container({ children: [flame] }) })
    );

    drawn.mock.api.sync.filters.set(stove, [
      { filter: new pixi.AlphaFilter(), passes: 1, cache: "local" }
    ]);

    for (let frame = 1; frame <= 4; frame += 1) {
      drawn.mock.world.ecs.set(lamp, Transform, { x: 600 + frame });
      drawn.frame();
    }

    expect(drawn.oracle.pictures).toEqual([]);

    // The game forgot `renderer.invalidate(stove)` before its write; the lamp draws the frame.
    flame.x = 5;
    drawn.mock.world.ecs.set(lamp, Transform, { x: 700 });
    drawn.frame();

    expect(drawn.oracle.pictures[0]?.field).toMatch(/^subtree: /);

    // The same forgotten write in a frame nothing else draws: the frame oracle sees it through the quad.
    flame.x = 9;
    drawn.frame();

    expect(drawn.oracle.missed).toHaveLength(1);
    drawn.mock.stop();
  });
});
