import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, screen, type } from "../../../../index";
import { createFakeIo } from "../../../assets/__tests__/unit/mock-assets";
import type { Manifest, ManifestFile } from "../../../assets/types";
import type { Json } from "../../../model/types";
import { defineScene } from "../../../scenes/define";
import type { SceneState } from "../../../scenes/types";
import { restoreCommand, saveImportCommand } from "../../control";
import { run } from "../../doors/run";

// ---------------------------------------------------------------------------
// Integration: a restore door and game.saveImport over a mounted ward whose
// bundles depend on the session (F199). The ward stays mounted through both, so
// the state must not land before the bundles it names for that state are in:
// otherwise its views draw keys of a bundle nobody loaded.
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
 * Builds the one file of a bundle, whose path names the bundle.
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

/** Three lazy bundles: nothing loads before a node, a scene or a door asks for it. */
const manifest: Manifest = {
  version: 1,
  bundles: Object.fromEntries(
    ["hub", "location", "ep01", "ep02"].map(name => [
      name,
      { feature: "location", tier: "lazy", mb: 0.016, files: [fileOf(name)] }
    ])
  )
};

const wardScene = defineScene("ward", {
  bundle: "location",
  bundles: ({ session }: SceneState<Json, Session>) => [session.episode],
  layers: { room: {} },
  projections: []
});

const hubScene = defineScene("hub", { bundle: "hub", layers: {}, projections: [] });

const hub = defineNode({ rest: true, checkpoint: true, scene: "hub", outcomes: { go: type() } });

const explore = defineNode({
  rest: true,
  checkpoint: true,
  scene: "ward",
  outcomes: { stay: type() }
});

const main = defineFlow("main", {
  nodes: { hub, explore },
  start: "hub",
  edges: { hub: { go: "explore" }, explore: { stay: "explore" } }
});

const locationFeature = defineFeature("location", { flows: [main], scenes: [hubScene, wardScene] });

/**
 * Yields the microtask queue to the loop, the way a test waits without a timer.
 *
 * @param times - How many turns to give it.
 */
async function tick(times = 120): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the game on the ward of episode 1, every bundle in.
 *
 * @param io - The I/O seam, ungated while the app starts.
 * @returns The started app.
 */
async function startOnWard(io: ReturnType<typeof createFakeIo>) {
  const app = createApp({
    plugins: [...screen, locationFeature],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialPlayer: { coins: 0 }, initialSession: { episode: "ep01" }, seed: 1 },
      assets: { manifest, preloadDepth: 0, io }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();
  await app.flow.walk([{ at: "hub", intent: "go" }]);

  return app;
}

/** The save of episode 2, as game.saveExport answers one. */
const onTwo = { player: { coins: 9 }, session: { episode: "ep02" }, rng: { seed: 3, streams: {} } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("F199: the doors land a state only once the mounted scene's bundles for it are in", () => {
  it.each([
    [
      "game.saveImport",
      (app: Awaited<ReturnType<typeof startOnWard>>) => run(app, saveImportCommand, { save: onTwo })
    ],
    [
      "game.restore",
      (app: Awaited<ReturnType<typeof startOnWard>>) =>
        run(app, restoreCommand, {
          bookmark: { ...app.flow.bookmark(), ...onTwo, path: "explore" }
        })
    ]
  ] as const)("%s keeps the ward on the old state while episode 2 loads", async (_door, open) => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const io = createFakeIo();
    const app = await startOnWard(io);

    expect(app.scenes.current()).toBe("ward");
    io.control.gated = true;

    const door = { done: false };

    open(app).then(
      () => {
        door.done = true;
      },
      () => {
        door.done = true;
      }
    );
    await tick();

    // Episode 2 is held: the mounted ward still reads episode 1, whose bundle is in.
    expect(io.held.map(entry => entry.url)).toEqual(["/features/location/assets/ep02.png"]);
    expect(app.model.store.snapshot().session).toEqual({ episode: "ep01" });
    expect(door.done).toBe(false);

    io.control.gated = false;
    io.releaseAll();
    await tick();

    expect(door.done).toBe(true);
    expect(app.model.store.snapshot().session).toEqual({ episode: "ep02" });
    expect(app.assets.isLoaded("ep02")).toBe(true);

    await app.stop();
  });

  // Bug: a failed load still lands the save, so the ward draws an episode that is not there.
  it("game.saveImport refuses a save whose bundle fails to load and keeps the old state", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const io = createFakeIo();
    const app = await startOnWard(io);

    io.control.gated = true;

    const refused = run(app, saveImportCommand, { save: onTwo }).then(
      () => undefined,
      (error: unknown) => error
    );

    await tick();
    io.held[0]?.reject(new Error("offline"));

    expect(await refused).toBeInstanceOf(Error);
    expect(app.model.store.snapshot().session).toEqual({ episode: "ep01" });

    await app.stop();
  });
});
