/**
 * P17 probe, trace half. Measures the hit-test cost of a 10x10 and a 20x20 letter grid three ways
 * (engine `renderer.sync.hitTest`, real Pixi `EventBoundary.hitTest`, grid math) and checks
 * segment sampling, diagonal precision and backtracking. Spike code, not engine code.
 */
import * as pixi from "pixi.js";
import "pixi.js/events"; // installs the FederatedContainer mixin (isInteractive), as browserAll does
import { describe, expect, it } from "vitest";
import { FakeTexture } from "../../src/plugins/renderer/__tests__/fake-pixi";
import { createMockRenderer } from "../../src/plugins/renderer/__tests__/mock-renderer";
import { Sprite, Transform } from "../../src/plugins/renderer/components";
import { Layer, Order } from "../../src/plugins/world/ecs/define";

const owner = { kind: "plugin", name: "p17" } as const;
const SIZE = 64; // fake texture is 64x64, default anchor 0.5
const PITCH = 72; // 8 px gap between cells
const ORIGIN = 100;

type Pt = { x: number; y: number };
type Hit = (x: number, y: number) => number | undefined;

const center = (col: number, row: number): Pt => ({
  x: ORIGIN + col * PITCH,
  y: ORIGIN + row * PITCH
});

/** Deterministic points spread over the grid area. */
function points(count: number, side: number): Pt[] {
  let seed = 7;
  const next = (): number => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const span = side * PITCH;
  return Array.from({ length: count }, () => ({
    x: ORIGIN - PITCH / 2 + next() * span,
    y: ORIGIN - PITCH / 2 + next() * span
  }));
}

function bench(label: string, hit: Hit, pts: Pt[]): number {
  for (const p of pts.slice(0, 200)) hit(p.x, p.y); // warm-up
  const start = performance.now();
  for (const p of pts) hit(p.x, p.y);
  const usPerCall = ((performance.now() - start) * 1000) / pts.length;
  console.log(`[p17] ${label}: ${usPerCall.toFixed(2)} us per hit test`);
  return usPerCall;
}

/** Engine grid: real sync module over the fake Pixi, one sprite per cell. */
async function engineGrid(side: number): Promise<{ hit: Hit; cellOf: Map<number, string> }> {
  const mock = createMockRenderer();
  await mock.start();
  mock.api.sync.textures.provide(() => new FakeTexture({}) as never);
  mock.world.projection.setLayers([{ name: "cells", sort: "none" }]);
  mock.modules.sync.pass();
  const cellOf = new Map<number, string>();
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      const c = center(col, row);
      const entity = mock.world.ecs.spawn(owner, [
        Layer({ name: "cells" }),
        Transform({ x: c.x, y: c.y }),
        Sprite({ texture: "cell" }),
        Order({ value: row * side + col })
      ]);
      cellOf.set(entity, `${col},${row}`);
    }
  }
  mock.modules.sync.pass();
  const accept = (entity: number): boolean => mock.world.ecs.has(entity, Order);
  return { hit: (x, y) => mock.api.sync.hitTest(x, y, accept), cellOf };
}

/** Real Pixi grid: containers with a rectangle hitArea, eventMode static. */
function pixiGrid(side: number): Hit {
  const root = new pixi.Container({ isRenderGroup: true });
  root.eventMode = "static";
  const ids = new Map<pixi.Container, number>();
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      const c = center(col, row);
      const cell = new pixi.Container();
      cell.position.set(c.x, c.y);
      cell.hitArea = new pixi.Rectangle(-SIZE / 2, -SIZE / 2, SIZE, SIZE);
      cell.eventMode = "static";
      root.addChild(cell);
      ids.set(cell, row * side + col);
    }
  }
  // Pixi fills world matrices at render time; done by hand here.
  pixi.updateRenderGroupTransforms(root.renderGroup, true);
  const boundary = new pixi.EventBoundary(root);
  return (x, y) => {
    const target = boundary.hitTest(x, y);
    return target === undefined || target === null ? undefined : ids.get(target);
  };
}

/** Grid math: the cell index from the point, gap aware. */
function mathGrid(side: number): Hit {
  return (x, y) => {
    const col = Math.round((x - ORIGIN) / PITCH);
    const row = Math.round((y - ORIGIN) / PITCH);
    if (col < 0 || row < 0 || col >= side || row >= side) return undefined;
    const c = center(col, row);
    if (Math.abs(x - c.x) > SIZE / 2 || Math.abs(y - c.y) > SIZE / 2) return undefined;
    return row * side + col + 0; // + 0 turns -0 into 0
  };
}

/** Points from `a` to `b` at most `step` apart, `a` excluded, `b` included. */
function segment(a: Pt, b: Pt, step: number): Pt[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
  return Array.from({ length: n }, (_, i) => ({
    x: a.x + ((b.x - a.x) * (i + 1)) / n,
    y: a.y + ((b.y - a.y) * (i + 1)) / n
  }));
}

/** The trace reducer: new cell appends, the cell before the last pops (backtrack), a used cell is ignored. */
function stepPath(path: readonly number[], cell: number | undefined): number[] {
  if (cell === undefined || path.at(-1) === cell) return [...path];
  if (path.at(-2) === cell) return path.slice(0, -1);
  if (path.includes(cell)) return [...path];
  return [...path, cell];
}

function trace(hit: Hit, frames: Pt[], step: number | undefined): number[] {
  let path: number[] = [];
  let last = frames[0] as Pt;
  path = stepPath(path, hit(last.x, last.y));
  for (const p of frames.slice(1)) {
    const samples = step === undefined ? [p] : segment(last, p, step);
    for (const s of samples) path = stepPath(path, hit(s.x, s.y));
    last = p;
  }
  return path;
}

describe("P17 trace", () => {
  it("measures hit-test cost for 100 and 400 cells", async () => {
    const results: Record<string, number> = {};
    for (const side of [10, 20]) {
      const pts = points(20_000, side);
      const engine = await engineGrid(side);
      const pixiHit = pixiGrid(side);
      const math = mathGrid(side);
      // Same answers in all three (map engine entity to index).
      for (const p of pts.slice(0, 500)) {
        const e = engine.hit(p.x, p.y);
        const name = e === undefined ? undefined : engine.cellOf.get(e);
        const m = math(p.x, p.y);
        const fromMath = m === undefined ? undefined : `${m % side},${Math.floor(m / side)}`;
        expect(name).toBe(fromMath);
        expect(pixiHit(p.x, p.y)).toBe(m);
      }
      results[`engine ${side * side}`] = bench(`engine sync.hitTest, ${side * side} cells`, engine.hit, pts);
      results[`pixi ${side * side}`] = bench(`pixi EventBoundary.hitTest, ${side * side} cells`, pixiHit, pts);
      results[`math ${side * side}`] = bench(`grid math, ${side * side} cells`, math, pts);
    }
    console.log("[p17] cost", JSON.stringify(results));
  });

  it("a fast swipe that crosses 10 cells in one frame: one point vs segment sampling", () => {
    const hit = mathGrid(10);
    // Two frames: finger in cell (0,0), next frame in cell (9,0). Coalesced to one move.
    const frames = [center(0, 0), center(9, 0)];
    const onePoint = trace(hit, frames, undefined);
    const sampled = trace(hit, frames, SIZE / 2);
    console.log(`[p17] fast swipe: one point -> ${JSON.stringify(onePoint)}, sampled step 32 -> ${JSON.stringify(sampled)}`);
    expect(onePoint).toEqual([0, 9]);
    expect(sampled).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // The step must be below the narrowest cell span the line can cross; a step of 80 skips cells.
    const coarse = trace(hit, frames, 100);
    console.log(`[p17] fast swipe, step 100 -> ${JSON.stringify(coarse)}`);
    expect(coarse.length).toBeLessThan(10);
  });

  it("a diagonal drawn 10 px off the centre line: full box vs inset circle", () => {
    const box = mathGrid(10);
    const radius = 0.4 * PITCH; // 28.8 px
    const circle: Hit = (x, y) => {
      const col = Math.round((x - ORIGIN) / PITCH);
      const row = Math.round((y - ORIGIN) / PITCH);
      if (col < 0 || row < 0 || col >= 10 || row >= 10) return undefined;
      const c = center(col, row);
      return Math.hypot(x - c.x, y - c.y) <= radius ? row * 10 + col : undefined;
    };
    for (const dy of [10, 20, 26]) {
      const off = (p: Pt): Pt => ({ x: p.x, y: p.y + dy });
      const frames = [off(center(0, 0)), off(center(1, 1)), off(center(2, 2)), off(center(3, 3))];
      const boxPath = trace(box, frames, 8);
      const circlePath = trace(circle, frames, 8);
      console.log(`[p17] diagonal +${dy}px: box -> ${JSON.stringify(boxPath)}, circle r=0.4*pitch -> ${JSON.stringify(circlePath)}`);
    }
  });

  it("backtracking pops the last cell, re-entering an older cell does nothing", () => {
    const hit = mathGrid(10);
    const frames = [center(0, 0), center(1, 0), center(2, 0), center(1, 0), center(1, 1), center(0, 0)];
    const path = trace(hit, frames, SIZE / 2);
    console.log(`[p17] backtrack: ${JSON.stringify(path)}`);
    expect(path).toEqual([0, 1, 11]);
  });

  it("engine hitTest per frame budget: 10 samples on 400 cells", async () => {
    const engine = await engineGrid(20);
    const frames = Array.from({ length: 300 }, (_, i) => ({ x: ORIGIN + (i % 20) * PITCH, y: ORIGIN + ((i * 7) % 20) * PITCH }));
    const start = performance.now();
    let last = frames[0] as Pt;
    for (const p of frames) {
      for (const s of segment(last, p, 10).slice(0, 10)) engine.hit(s.x, s.y);
      last = p;
    }
    const msPerFrame = (performance.now() - start) / frames.length;
    console.log(`[p17] engine, 10 hit tests per frame on 400 cells: ${msPerFrame.toFixed(3)} ms per frame`);
  });
});
