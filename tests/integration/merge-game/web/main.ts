/**
 * @file The dev page of the fixture game: the same plugins as `createScreenGame`, with a real
 * canvas and a manifest fetched over HTTP.
 *
 * Serving: run `bun ./web/serve.ts` from `tests/integration/merge-game/`. It serves the bundled
 * page on `/` and the committed `manifest.json` and every asset under `/features/` as static
 * files (`bun ./index.html` alone answers every path with the page).
 */
import { createApp } from "@moku-labs/game";
import { mainFlow } from "../flows/main";
import { screenPlugins, volumesOf } from "../game";
import { startingPlayer, startingSession } from "../state";

const app = createApp({
  plugins: [...screenPlugins],
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

// The e2e station drives the page through this handle: `game.input.drag(...)`, `game.flow.state()`.
Reflect.set(globalThis, "game", app);

// The page opens on the splash, which moves to Home by itself once Home and the board are loaded.
// Play is the player's own tap.
await app.start();
