/**
 * @file The dev page of the fixture game: the same composition as `createScreenGame`, with a real
 * canvas and a manifest fetched over HTTP.
 *
 * Serving: run `bun ./web/index.html` from `tests/integration/merge-game/`. Bun's dev server
 * bundles this module and serves the folder it was started in as the web root, so `/manifest.json`
 * and the tiles under `/features/board/assets/` are the committed files of the fixture.
 */
import { createApp, screen } from "@moku-labs/game";
import { mainFlow } from "../flows/main";
import { rewardFeature } from "../flows/reward";
import { startingPlayer, startingSession } from "../state";
import { boardView } from "../view";

/** How many frames the page waits for the gate before it gives up on entering the board. */
const maxAttempts = 120;

const app = createApp({
  plugins: [...screen, rewardFeature, boardView],
  pluginConfigs: {
    renderer: { mount: "#game" },
    assets: { manifest: "/manifest.json" },
    model: { initialPlayer: startingPlayer, initialSession: startingSession, seed: 42 },
    flow: { mainFlow, safeNode: "home" }
  },
  onStart: ctx => {
    ctx.flow.run().catch((error: unknown) => {
      ctx.log.error(
        "merge-game: the graph stopped",
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    });
  }
});

/**
 * Answers the first intent of the game. The `home` node is a rest node without a scene, so this
 * page walks straight onto the board and waits for the gate to open.
 *
 * @param attempt - How many frames the page has waited.
 */
function enterBoard(attempt: number): void {
  if (attempt > maxAttempts || app.flow.gate.answer({ intent: "play" })) return;

  requestAnimationFrame(() => enterBoard(attempt + 1));
}

// The e2e station drives the page through this handle: `game.input.drag(...)`, `game.flow.state()`.
Reflect.set(globalThis, "game", app);

await app.start();

enterBoard(0);
