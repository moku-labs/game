/**
 * @file The dev page of the mini game: the app of `createMiniGame` with a real canvas, a manifest
 * fetched over HTTP and the audio journal of the last 200 sounds, and the two handles every caller
 * reaches the game through. `./dev` sets the dev flag before anything else runs. The page draws
 * with WebGPU; `?renderer=webgl` asks for WebGL, as the WebGL leg of the visual tests does, and
 * `?player=ready` starts from the prepared save of `scenarios.ts`.
 */
import "./dev";
import { commands, run } from "@moku-labs/game/control";
import { read, sources, watch } from "@moku-labs/game/inspect";
import type { MiniGame } from "../game";
import { createMiniGame } from "../game";
import { playerFor } from "./scenarios";

const query = new URLSearchParams(location.search);
const app = createMiniGame({
  player: playerFor(location.search),
  manifest: "/manifest.json",
  audio: { journal: 200 },
  renderer: {
    mount: "#game",
    preference: query.get("renderer") === "webgl" ? "webgl" : "webgpu"
  }
});

// The visual tests, the e2e scripts and the editor reach the game through these two handles.
Reflect.set(globalThis, "game", app);
Reflect.set(globalThis, "doors", { read, watch, sources, run, commands });

/**
 * Runs the graph for as long as the page lives, so nothing awaits it; a failure goes to the log.
 *
 * @param game - The started game.
 */
function runGraph(game: MiniGame): void {
  game.flow.run().catch((error: unknown) => {
    game.log.error(
      "mini-game: the graph stopped",
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  });
}

await app.start();
runGraph(app);
