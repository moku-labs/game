import { describe, expect, it } from "vitest";
import { createApp, createPlugin, defineGame, screen, type } from "../../../../index";
import { createFakeIo } from "../../../assets/__tests__/unit/mock-assets";
import type { Manifest, ManifestFile } from "../../../assets/types";
import type { Bookmark } from "../../../flow/types";
import type { Json } from "../../../model/types";
import { defineScene } from "../../define";
import { scenesPlugin } from "../../index";
import type { Events, SceneState } from "../../types";

// ---------------------------------------------------------------------------
// Integration: a scene names the bundle of the episode the session plays. The
// real screen plugins over the gated fake io of assets: every bundle is lazy and
// the preload is off, so a bundle loads only when a node or a scene asks for it,
// and a test holds or releases its fetch. The three ways into a node: a live
// walk, a restore in a fresh app, and the recovery at the safe node.
// ---------------------------------------------------------------------------

type Player = { coins: number };
type Session = { episode: string };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

/**
 * Builds the one file of a bundle: a 64x64 picture whose path names the bundle.
 *
 * @param bundle - The bundle name.
 * @returns The manifest file entry.
 */
function fileOf(bundle: string): ManifestFile {
  return {
    key: `location.${bundle}`,
    path: `features/location/assets/${bundle}.png`,
    width: 64,
    height: 64,
    mb: 0.016
  };
}

/** Four lazy bundles: nothing loads before a node or a scene asks for it. */
const manifest: Manifest = {
  version: 1,
  bundles: Object.fromEntries(
    ["hub", "location", "ep01", "ep02"].map(name => [
      name,
      { feature: "location", tier: "lazy", mb: 0.016, files: [fileOf(name)] }
    ])
  )
};

const hubScene = defineScene("hub", { bundle: "hub", layers: {}, projections: [] });

const wardScene = defineScene("ward", {
  bundle: "location",
  bundles: ({ session }: SceneState<Json, Session>) => [session.episode],
  layers: { room: {} },
  projections: []
});

const hub = defineNode({ rest: true, checkpoint: true, scene: "hub", outcomes: { go: type() } });

const explore = defineNode({
  rest: true,
  checkpoint: true,
  scene: "ward",
  outcomes: { break: type() },
  recover: ({ session }) => {
    session.episode = "ep01";
  }
});

const breaker = defineNode({
  outcomes: { done: type() },
  run: () => {
    throw new Error("the ward broke");
  }
});

const main = defineFlow("main", {
  nodes: { hub, explore, breaker },
  start: "hub",
  edges: { hub: { go: "explore" }, explore: { break: "breaker" }, breaker: { done: "explore" } }
});

const locationFeature = defineFeature("location", {
  flows: [main],
  scenes: [hubScene, wardScene]
});

/** Every `scenes:changed` the probe plugin heard, in order. */
const heard: Events["scenes:changed"][] = [];

const probePlugin = createPlugin("sceneBundlesProbe", {
  depends: [scenesPlugin],
  hooks: () => ({
    "scenes:changed": (payload: Events["scenes:changed"]) => {
      heard.push(payload);
    }
  })
});

/**
 * Yields the microtask queue to the loop, the way a test waits without a timer.
 *
 * @param times - How many turns to give it.
 */
async function tick(times = 120): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Tells whether a fetched url is the file of one bundle.
 *
 * @param bundle - The bundle name.
 * @returns The match for `io.release`.
 */
function fileOfBundle(bundle: string): (url: string) => boolean {
  return url => url.endsWith(`/${bundle}.png`);
}

/**
 * Starts the screen set and the location feature over the fake io, settled on "hub".
 *
 * @param io - The I/O seam, ungated while the app starts.
 * @param episode - The episode the session starts with.
 * @returns The started app.
 */
async function startApp(io: ReturnType<typeof createFakeIo>, episode = "ep01") {
  heard.length = 0;

  const app = createApp({
    plugins: [...screen, locationFeature, probePlugin],
    pluginConfigs: {
      flow: { mainFlow: main, safeNode: "explore" },
      model: { initialPlayer: { coins: 0 }, initialSession: { episode }, seed: 1 },
      assets: { manifest, preloadDepth: 0, io }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  return app;
}

describe("scene bundles integration — a live walk", () => {
  it("a live walk mounts the ward only after location and the episode the session names are in", async () => {
    const io = createFakeIo();
    const app = await startApp(io);

    expect(app.scenes.current()).toBe("hub");

    io.control.gated = true;
    expect(app.flow.gate.answer({ intent: "go" })).toBe(true);
    await tick();
    io.release(fileOfBundle("location"));
    await tick();

    expect(io.fetched.some(fileOfBundle("ep01"))).toBe(true);
    expect(app.scenes.current()).toBe("hub");

    io.release(fileOfBundle("ep01"));
    await tick();

    expect(app.scenes.current()).toBe("ward");
    expect(app.flow.state()).toMatchObject({ path: "explore", pending: { gate: ["break"] } });
    expect(io.fetched.some(fileOfBundle("ep02"))).toBe(false);

    await app.stop();
  });
});

describe("scene bundles integration — a restore", () => {
  it("a restore at the ward in a fresh app mounts it only after the episode of the restored session is in, and never fetches the other episode", async () => {
    const first = await startApp(createFakeIo());

    await first.flow.walk([{ at: "hub", intent: "go" }]);
    expect(first.scenes.current()).toBe("ward");

    const bookmark: Bookmark = {
      ...structuredClone(first.flow.bookmark()),
      session: { episode: "ep02" }
    };

    await first.stop();

    const io = createFakeIo();
    const app = await startApp(io);

    io.control.gated = true;
    await app.flow.restore(bookmark);
    await tick();
    io.release(fileOfBundle("location"));
    await tick();

    // The scene stage reads the restored session: it waits for "ep02", and the gate stays shut.
    expect(io.held.map(entry => entry.url)).toEqual(["/features/location/assets/ep02.png"]);
    expect(app.scenes.current()).not.toBe("ward");
    expect(app.flow.state().pending.gate).toBeUndefined();

    io.control.gated = false;
    io.releaseAll();
    await app.flow.walk([]);

    expect(app.scenes.current()).toBe("ward");
    expect(app.flow.state()).toMatchObject({ path: "explore", pending: { gate: ["break"] } });
    expect(io.fetched.some(fileOfBundle("ep02"))).toBe(true);
    expect(io.fetched.some(fileOfBundle("ep01"))).toBe(false);

    await app.stop();
  });
});

describe("scene bundles integration — the safe-node recovery", () => {
  it("the safe-node recovery awaits the episode its recover wrote before the safe node's gate opens", async () => {
    const io = createFakeIo();
    const app = await startApp(io, "ep02");

    app.flow.gate.answer({ intent: "go" });
    await tick();

    expect(app.scenes.current()).toBe("ward");

    io.control.gated = true;
    // The first failure is retried from "explore"; the second goes to the safe node, whose
    // recover writes the episode "ep01".
    app.flow.gate.answer({ intent: "break" });
    await tick();
    app.flow.gate.answer({ intent: "break" });
    await tick();

    expect(app.model.store.snapshot().session).toEqual({ episode: "ep01" });
    expect(io.fetched.some(fileOfBundle("ep01"))).toBe(true);
    expect(app.flow.state()).toMatchObject({ path: "explore" });
    expect(app.flow.state().pending.gate).toBeUndefined();

    io.release(fileOfBundle("ep01"));
    await tick();

    expect(app.flow.state()).toMatchObject({ path: "explore", pending: { gate: ["break"] } });
    expect(app.scenes.current()).toBe("ward");
    expect(heard.map(change => change.to)).toEqual(["hub", "ward"]);

    await app.stop();
  });
});
