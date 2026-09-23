/**
 * @file The dev page of the fixture game: the same plugins as `createScreenGame`, with a real
 * canvas and a manifest fetched over HTTP.
 *
 * Serving: run `bun ./web/serve.ts` from `tests/integration/merge-game/`. It serves the bundled
 * page on `/` and the committed `manifest.json` and every asset under `/features/` as static
 * files (`bun ./index.html` alone answers every path with the page).
 *
 * The page is a dev build: `./dev` sets the dev flag before anything else runs, and the audio
 * journal keeps the last 200 sounds, so the editor and the e2e station can read what was heard.
 */
import "./dev";
import { createApp } from "@moku-labs/game";
import { commands, run } from "@moku-labs/game/control";
import { read, sources, watch } from "@moku-labs/game/inspect";
import { mainFlow } from "../flows/main";
import { screenPlugins, volumesOf } from "../game";
import { startingSession } from "../state";
import { playerFor } from "./scenarios";

const app = createApp({
  plugins: [...screenPlugins],
  // The board column is 2084 units tall: a wide screen scales the whole interface down together.
  config: { referenceLong: 2100 },
  pluginConfigs: {
    renderer: { mount: "#game" },
    assets: { manifest: "/manifest.json" },
    text: { fonts: { body: "ui.font-body", digits: "ui.font-display" } },
    model: { initialPlayer: playerFor(location.search), initialSession: startingSession, seed: 42 },
    flow: { mainFlow, safeNode: "home" },
    i18n: { locale: "ru", fallback: "ru" },
    audio: { volumes: volumesOf, journal: 200 },
    input: { heldScale: 1.08 },
    // The keyboard focus ring of design §4: a dashed ink ring over a cream halo, 9 px of the
    // 390-wide design outside the control.
    ui: {
      focusRing: {
        stroke: 0x3a_22_12,
        strokeWidth: 4,
        dash: 10,
        offset: 25,
        halo: 0xff_f3_d6,
        haloWidth: 12
      }
    }
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

// The editor reaches the game through the doors; e2e scripts use the same handle.
Reflect.set(globalThis, "doors", { read, watch, sources, run, commands });

// Reduced motion follows the system setting, also when the player changes it while the page runs.
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

app.anim.setReducedMotion(reducedMotion.matches);
reducedMotion.addEventListener("change", event => app.anim.setReducedMotion(event.matches));

// The page opens on the splash, which moves to Home by itself once Home and the board are loaded.
// Play is the player's own tap.
await app.start();
