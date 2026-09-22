import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, screen, type } from "../../../../index";
import type {
  AssetsIo,
  DecodedImage,
  Manifest,
  ManifestFile,
  Texture
} from "../../../assets/types";
import type { Descriptor } from "../../../flow/types";
import type { Json } from "../../../model/types";
import { defineScene } from "../../../scenes/define";
import { music } from "../../descriptors";
import { audioPlugin } from "../../index";
import { createFakeContext, type FakeContext, installFakeWindow } from "../fake-audio-context";

// ---------------------------------------------------------------------------
// Integration: the real time, lifecycle, model, clock, flow, world, renderer,
// input, assets and scenes plugins plus `audio`. There is no document, so the
// renderer is inert; the sounds come out of the fake `io` of `assets` and are
// scheduled on the fake context, which is the only seam this plugin has.
// ---------------------------------------------------------------------------

type Volumes = { master: number; music: number; sfx: number };
type Player = { coins: number; settings: { audio: Volumes } };
type Session = { visits: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** The descriptor `anim` builds for a sound. `audio` owns the handler of the kind. */
function sfx(key: string): Descriptor {
  return { kind: "sfx", payload: { key }, cosmetic: true };
}

/** One `.mp3` of the manifest. */
function sound(key: string, file: string): ManifestFile {
  return {
    key,
    path: `features/board/assets/${file}.mp3`,
    kind: "audio",
    width: 0,
    height: 0,
    mb: 0.004
  };
}

const manifest: Manifest = {
  version: 1,
  bundles: {
    home: { feature: "board", tier: "scene", mb: 0, files: [] },
    board: {
      feature: "board",
      tier: "scene",
      mb: 0.008,
      files: [sound("board.theme", "theme"), sound("orders.complete", "complete")]
    }
  }
};

/** The I/O seam of `assets`: every file answers with its own URL as bytes. */
function createIo(): AssetsIo {
  return {
    fetch: (url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(manifest),
        blob: () => Promise.resolve(new Blob()),
        text: () => Promise.resolve(""),
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode(url).buffer as ArrayBuffer)
      }),
    decode: () => Promise.resolve({} as unknown as DecodedImage),
    createTexture: () => ({}) as unknown as Texture,
    destroyTexture: () => undefined
  };
}

const homeScene = defineScene("home", { bundle: "home", layers: {}, projections: [] });
const boardScene = defineScene("board", {
  bundle: "board",
  layers: {},
  projections: [],
  music: "board.theme"
});

const home = defineNode({ rest: true, scene: "home", outcomes: { play: type() } });

const deliver = defineNode({
  scene: "board",
  outcomes: { done: type() },
  run: async ({ fx, out }) => {
    await fx(sfx("orders.complete"));

    return out.done();
  }
});

const board = defineNode({
  rest: true,
  scene: "board",
  outcomes: { louder: type(), quiet: type() }
});

const louder = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.settings.audio.music = 0.2;

    return out.done();
  }
});

const quiet = defineNode({
  outcomes: { done: type() },
  run: async ({ fx, out }) => {
    // eslint-disable-next-line unicorn/no-null -- `null` is the seam: it stops the music.
    await fx(music(null));

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, deliver, board, louder, quiet },
  start: "home",
  edges: {
    home: { play: "deliver" },
    deliver: { done: "board" },
    board: { louder: "louder", quiet: "quiet" },
    louder: { done: "board" },
    quiet: { done: "board" }
  }
});

const boardFeature = defineFeature("board", {
  flows: [main],
  scenes: [homeScene, boardScene]
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
async function tick(times = 120): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/** Starts the screen set plus `audio`, with or without the fake context. */
async function startApp(context?: FakeContext) {
  const app = createApp({
    plugins: [...screen, audioPlugin, boardFeature],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: {
        initialPlayer: { coins: 0, settings: { audio: { master: 1, music: 0.6, sfx: 1 } } },
        initialSession: { visits: 0 },
        seed: 1
      },
      assets: { manifest, io: createIo() },
      audio: {
        volumes: (player: Json) => (player as unknown as Player).settings.audio,
        ...(context === undefined ? {} : { context: () => context })
      }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  return app;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("audio plugin integration — a live walk with a context", () => {
  it("is locked until the first pointer event on the page", async () => {
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const app = await startApp(context);

    expect(app.audio.unlocked()).toBe(false);

    fakeWindow.dispatch("pointerdown");
    await tick();

    expect(app.audio.unlocked()).toBe(true);
    expect(context.gains).toHaveLength(3);

    await app.stop();
  });

  it("plays the sound a node awaits and the music the scene declared", async () => {
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const app = await startApp(context);

    fakeWindow.dispatch("pointerdown");
    await tick();

    expect(app.flow.gate.answer({ intent: "play" })).toBe(true);
    await tick();

    expect(app.flow.state().path).toBe("board");
    expect(app.scenes.current()).toBe("board");
    expect(context.sources.some(source => !source.loop && source.startedAt === 0)).toBe(true);
    expect(context.sources.some(source => source.loop)).toBe(true);
    expect(context.decodes.some(text => text.includes("complete.mp3"))).toBe(true);
    expect(context.decodes.some(text => text.includes("theme.mp3"))).toBe(true);

    await app.stop();
  });

  it("follows the volume the node committed to the player state", async () => {
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const app = await startApp(context);

    fakeWindow.dispatch("pointerdown");
    await tick();
    expect(app.flow.gate.answer({ intent: "play" })).toBe(true);
    await tick();
    expect(app.flow.gate.answer({ intent: "louder" })).toBe(true);
    await tick();

    expect(app.audio.volume("music")).toBe(0.2);
    expect(context.gains[1]?.gain.ramps.at(-1)).toEqual([0.2, 0]);

    await app.stop();
  });

  it("stops the track when a node awaits music(null)", async () => {
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const app = await startApp(context);

    fakeWindow.dispatch("pointerdown");
    await tick();
    expect(app.flow.gate.answer({ intent: "play" })).toBe(true);
    await tick();
    expect(app.flow.gate.answer({ intent: "quiet" })).toBe(true);
    await tick();

    expect(context.sources.some(source => source.loop && source.stoppedAt !== undefined)).toBe(
      true
    );

    await app.stop();
  });

  it("holds every bus at zero while the game is in the background", async () => {
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const app = await startApp(context);

    fakeWindow.dispatch("pointerdown");
    await tick();

    app.lifecycle.push("background");
    await tick();

    expect(context.gains.map(gain => gain.gain.ramps.at(-1))).toEqual([
      [0, 0],
      [0, 0],
      [0, 0]
    ]);

    app.lifecycle.pop("background");
    await tick();

    expect(context.gains.map(gain => gain.gain.ramps.at(-1))).toEqual([
      [1, 0],
      [0.6, 0],
      [1, 0]
    ]);

    await app.stop();
  });

  it("closes the context when the app stops", async () => {
    installFakeWindow();

    const context = createFakeContext();
    const app = await startApp(context);

    await app.stop();

    expect(context.closes).toBe(1);
    expect(app.audio.unlocked()).toBe(false);
  });
});

describe("audio plugin integration — headless, with no context at all", () => {
  it("answers every member, plays nothing and lets the graph run to the end", async () => {
    const app = await startApp();

    expect(app.audio.unlocked()).toBe(false);
    expect(app.audio.volume("music")).toBe(0.6);

    expect(app.flow.gate.answer({ intent: "play" })).toBe(true);
    await tick();

    expect(app.flow.state().path).toBe("board");

    app.audio.setVolume("sfx", 0.5);
    expect(app.audio.volume("sfx")).toBe(0.5);

    await app.stop();
  });
});
