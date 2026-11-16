/**
 * @file assets plugin — a `ready` nobody rests on (F204, A Memory Missing on the A26). The `ready` effect posts the
 * inbox event once its bundles settle, whoever asked. A `ready` posted for an ask nobody waits on (a warm started with
 * `fx.start`, an ask whose wait was left by Back, the second of two asks for one bundle) stayed in the inbox, and the
 * next rest that lists `ready` ended at once: its node asked again, got `false` and rested again. Every cold window paid
 * two frames for it, and the popup's dim never showed on the first wait.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, ready, type } from "../../../../index";
import { rendererPlugin } from "../../../renderer";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import { createFakePixi, FakeTexture } from "../../../renderer/__tests__/fake-pixi";
import { worldPlugin } from "../../../world";
import { assetsPlugin } from "../../index";
import type { Manifest, Texture } from "../../types";
import { createFakeIo, type FakeIo } from "../unit/mock-assets";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: Record<string, unknown>;
}>();

/**
 * One lazy bundle of one picture.
 *
 * @param name - The picture's name.
 * @returns The bundle.
 */
function bundleOf(name: string): Manifest["bundles"][string] {
  return {
    feature: "ep01",
    tier: "lazy",
    mb: 0.063,
    files: [{ key: `ep01.${name}`, path: `ep01/${name}.png`, width: 128, height: 128, mb: 0.063 }]
  };
}

const manifest: Manifest = {
  version: 1,
  bundles: { "ep01.memory": bundleOf("memory"), "ep01.album": bundleOf("album") }
};

/** How many times each window asked `ready`. */
const asks = { memory: 0, album: 0 };

// `claim` warms the memory with `fx.start`, as the game's claim of an order does, and nobody rests on it.
const home = defineNode({
  rest: true,
  outcomes: { claim: type(), memory: type(), album: type() }
});
const claim = defineNode({
  outcomes: { done: type() },
  run: ({ fx, out }) => {
    fx.start(ready("ep01.memory"));

    return out.done();
  }
});
// A window: a transit node asks, a rest waits for `ready` and still answers Back.
const askMemory = defineNode({
  outcomes: { wait: type(), open: type() },
  run: async ({ fx, out }) => {
    asks.memory += 1;
    if ((await fx(ready("ep01.memory"))) === false) return out.wait();

    return out.open();
  }
});
const waitMemory = defineNode({
  rest: true,
  inbox: ["ready"],
  outcomes: { ready: type(), back: type() }
});
const memory = defineNode({ rest: true, outcomes: { leave: type() } });
// The other window rests in its own body: the ask is made inside the rest that waits.
const album = defineNode({
  rest: true,
  inbox: ["ready"],
  outcomes: { ready: type(), back: type(), open: type() },
  run: async ({ fx, out }) => {
    asks.album += 1;
    if ((await fx(ready("ep01.album"))) !== false) return out.open();

    // Rests until the inbox delivers `ready` or the gate answers Back.
    return new Promise(() => undefined);
  }
});
const albumOpen = defineNode({ rest: true, outcomes: { leave: type() } });
const main = defineFlow("main", {
  nodes: { home, claim, askMemory, waitMemory, memory, album, albumOpen },
  start: "home",
  edges: {
    home: { claim: "claim", memory: "askMemory", album: "album" },
    claim: { done: "home" },
    askMemory: { wait: "waitMemory", open: "memory" },
    waitMemory: { ready: "askMemory", back: "home" },
    memory: { leave: "home" },
    album: { ready: "album", back: "home", open: "albumOpen" },
    albumOpen: { leave: "home" }
  }
});
const game = defineFeature("ep01", { flows: [main] });

const running: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
  asks.memory = 0;
  asks.album = 0;
  vi.unstubAllGlobals();
});

/**
 * The fake io with textures the fake Pixi can upload.
 *
 * @returns The io.
 */
function pixiIo(): FakeIo {
  const io = createFakeIo();

  io.createTexture = (): Texture =>
    new FakeTexture({ source: { width: 128, height: 128, destroyed: false } }) as never;

  return io;
}

/**
 * Starts the game on `home`, its renderer drawing on demand on the fake page.
 *
 * @returns The app, the io and the frame driver.
 */
async function startGame() {
  installFakeDom({ width: 1080, height: 1920 });

  const pixi = createFakePixi();
  const io = pixiIo();
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, assetsPlugin, game],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialPlayer: { visits: 0 }, initialSession: { visits: 0 }, seed: 1 },
      renderer: {
        mount: "#game",
        loadPixi: () => Promise.resolve(pixi.module),
        warm: 0,
        onDemand: true
      },
      assets: { manifest, io, preloadDepth: 0, textureBudgetMb: 250 }
    }
  });

  await app.start();
  running.push(app);
  app.flow.run().catch(() => undefined);

  /**
   * Gives the runner and the loads their turn, then steps frames of 16 ms.
   *
   * @param count - How many frames.
   */
  const frames = async (count: number): Promise<void> => {
    for (let frame = 0; frame < count; frame += 1) {
      for (let turn = 0; turn < 80; turn += 1) await Promise.resolve();
      app.time.step(16);
    }

    for (let turn = 0; turn < 80; turn += 1) await Promise.resolve();
  };

  /**
   * Answers the gate and lets the graph move.
   *
   * @param intent - The intent.
   */
  const answer = async (intent: string): Promise<void> => {
    expect(app.flow.gate.answer({ intent })).toBe(true);
    await frames(2);
  };

  await frames(2);

  return { app, io, frames, answer };
}

describe("assets integration: a ready nobody rests on (F204)", () => {
  // Bug: the `ready` of the warm `claim` started stayed in the inbox and ended the album's first wait at once.
  it("keeps a window waiting after a warm started with fx.start settled at a rest that does not list ready", async () => {
    const { app, io, frames, answer } = await startGame();

    await answer("claim");
    await frames(4);

    expect(app.flow.state().path).toBe("home");
    expect(app.assets.isLoaded("ep01.memory")).toBe(true);

    io.control.gated = true;
    await answer("album");
    await frames(2);

    expect(app.flow.state().path).toBe("album");
    expect(asks.album).toBe(1);

    io.releaseAll();
    await frames(4);

    expect(app.flow.state().path).toBe("albumOpen");
    expect(asks.album).toBe(2);
  });

  // Bug: the `ready` of an ask whose wait was left by Back ended the next window's wait at once.
  it("drops the ready of an ask whose wait was left by Back", async () => {
    const { app, io, frames, answer } = await startGame();

    io.control.gated = true;
    await answer("memory");

    expect(app.flow.state().path).toBe("waitMemory");

    await answer("back");
    io.release(url => url.includes("memory"));
    await frames(4);

    expect(app.flow.state().path).toBe("home");

    await answer("album");
    await frames(2);

    expect(app.flow.state().path).toBe("album");
    expect(asks.album).toBe(1);

    io.releaseAll();
    await frames(4);

    expect(app.flow.state().path).toBe("albumOpen");
    expect(asks.album).toBe(2);
  });

  // Bug: two asks for one bundle posted two `ready`s; the first ended the wait, the second the next window's wait.
  it("posts one ready for two asks of one bundle, so the next window still waits", async () => {
    const { app, io, frames, answer } = await startGame();

    io.control.gated = true;
    await answer("memory");
    await answer("back");
    await answer("memory");

    expect(app.flow.state().path).toBe("waitMemory");

    io.release(url => url.includes("memory"));
    await frames(4);

    expect(app.flow.state().path).toBe("memory");
    expect(asks.memory).toBe(3);

    await answer("leave");
    await answer("album");
    await frames(2);

    expect(app.flow.state().path).toBe("album");
    expect(asks.album).toBe(1);

    io.releaseAll();
    await frames(4);

    expect(app.flow.state().path).toBe("albumOpen");
  });

  // Guard of the fix: a rest that asks in its own body still takes the `ready` of that ask.
  it("ends a rest that asked in its own body once its bundle is there", async () => {
    const { app, io, frames, answer } = await startGame();

    io.control.gated = true;
    await answer("album");

    expect(app.flow.state().path).toBe("album");

    io.releaseAll();
    await frames(4);

    expect(app.flow.state().path).toBe("albumOpen");
    expect(asks.album).toBe(2);
  });
});
