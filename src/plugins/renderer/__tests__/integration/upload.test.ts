import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, exit, type } from "../../../../index";
import { worldPlugin } from "../../../world";
import { rendererPlugin } from "../../index";
import type { PixiTexture } from "../../types";
import { installFakeDom } from "../fake-dom";
import { createFakePixi, type FakeGpuTextureSystem, FakeTexture } from "../fake-pixi";

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Integration: the real time, lifecycle, clock, flow, world and renderer. A game's textures reach the GPU through
// `app.renderer.sync.textures.upload` in the render phase of the real frame loop, one per drawn frame by default,
// with `onDemand` on: the queue asks for its own frames.
// ---------------------------------------------------------------------------

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { coins: number };
  session: { moves: number };
  assets: string;
  strings: Record<string, unknown>;
}>();

const home = defineNode({ outcomes: { quit: type() }, rest: true });
const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: { over: type() },
  edges: { home: { quit: exit("over") } }
});
const game = defineFeature("game", { flows: [main] });

/**
 * Yields the microtask queue, so a promise the renderer answered reaches its `then`.
 *
 * @param times - How many microtasks to wait.
 */
async function tick(times = 40): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

describe("renderer integration: the texture upload queue", () => {
  // Bug: the queue is not reachable from the app, or the real frame loop never steps it while the screen stands still.
  it("uploads a game's textures one a drawn frame of the real loop and answers a call left waiting false at stop", async () => {
    installFakeDom({ width: 1080, height: 1920 });
    const pixi = createFakePixi();
    const app = createApp({
      plugins: [worldPlugin, rendererPlugin, game],
      pluginConfigs: {
        flow: { mainFlow: main },
        model: { initialPlayer: { coins: 0 }, initialSession: { moves: 0 }, seed: 1 },
        renderer: {
          mount: "#game",
          loadPixi: () => Promise.resolve(pixi.module),
          warm: 0,
          onDemand: true
        }
      }
    });

    await app.start();
    app.time.step(16);
    app.time.step(16);

    const textures = Array.from(
      { length: 3 },
      () => new FakeTexture({ source: { width: 64, height: 64, destroyed: false } })
    ) as unknown as PixiTexture[];
    const made = (pixi.last().renderer.texture as FakeGpuTextureSystem).made;
    let answer: boolean | undefined;

    app.renderer.sync.textures.upload(textures).then(value => {
      answer = value;
    });
    app.time.step(16);

    expect(made.size).toBe(1);

    app.time.step(16);
    app.time.step(16);
    await tick();

    expect(made.size).toBe(3);
    expect(answer).toBe(true);

    const left = app.renderer.sync.textures.upload([
      new FakeTexture({ source: { width: 64, height: 64, destroyed: false } }) as never
    ]);

    await app.stop();

    await expect(left).resolves.toBe(false);
  });
});
