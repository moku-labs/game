/**
 * @file The dev page of the fixture game: the same composition as `createScreenGame`, with a real
 * canvas and a manifest fetched over HTTP.
 *
 * Serving: run `bun ./web/serve.ts` from `tests/integration/merge-game/`. It serves the bundled
 * page on `/` and the committed `manifest.json` and every asset under `/features/` as static
 * files (`bun ./index.html` alone answers every path with the page).
 */
import { audioPlugin, createApp, screen } from "@moku-labs/game";
import { hudFeature } from "../features/hud";
import { ordersFeature } from "../features/orders";
import { settingsFeature } from "../features/settings";
import { settingsLocalePlugin } from "../features/settings/plugin";
import { mainFlow } from "../flows/main";
import { rewardFeature } from "../flows/reward";
import { volumesOf } from "../game";
import { startingPlayer, startingSession } from "../state";
import { boardView } from "../view";

/** How many frames the page waits for the gate before it gives up on entering the board. */
const maxAttempts = 120;

const app = createApp({
  plugins: [
    ...screen,
    audioPlugin,
    rewardFeature,
    boardView,
    hudFeature,
    ordersFeature,
    settingsFeature,
    settingsLocalePlugin
  ],
  pluginConfigs: {
    renderer: { mount: "#game" },
    assets: { manifest: "/manifest.json" },
    text: { fonts: { body: "ui.font-body", digits: "ui.font-display" } },
    model: { initialPlayer: startingPlayer, initialSession: startingSession, seed: 42 },
    flow: { mainFlow, safeNode: "home" },
    i18n: { locale: "ru", fallback: "ru" },
    audio: { volumes: volumesOf }
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
