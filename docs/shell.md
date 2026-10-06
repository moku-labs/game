# The game shell

A game is a folder. `index.ts` is the game as one data object. `config.ts` is the page, the native app, the system plugins and the save, as plain data. The engine bin `moku-game` serves, builds and packs the folder. A game writes no page, no server, no bridge and no `bunfig.toml`.

| Import | Runs in | Exports |
|---|---|---|
| `@moku-labs/game/app` | anywhere | `defineGameApp`, `startMoment`, the types `GameConfig`, `GameDefinition`, `GameApp`, `GameHandle`, `GamePluginConfigs`, `HeadlessSeams`, `ScreenSeams`, `MemoryProvider`, `Scenario`, `PageAgent`, `SaveKind`, `SystemName` |
| `@moku-labs/game/app/page` | the browser | `startPage`, the page the generated `.moku/main.ts` calls |
| `@moku-labs/game/app/system` | the browser, the native shell | `systemShell`, `fromSystem`, `storeSave`, `createSystemApp`, the types `SystemApp`, `SystemSlice`, `StoreSlice`. The one entry that reaches `@moku-labs/system` |
| `@moku-labs/game/cli` | Node and Bun | `runCli`, `preparePage`, the types `PreparePageOptions`, `PreparedPage` |
| bin `moku-game` | Bun | `dev`, `build`, `native`, `keys`, `pack`, `help` |

`/app` imports no `node:` module, no `@moku-labs/system` and no `@moku-labs/native`. A web-only game never meets either package.

## The folder of a game

| Path | Holds |
|---|---|
| `index.ts` | `export default defineGameApp({ ... })`: the flow, the starting state, the features, the plugins and their configs |
| `config.ts` | `export default { page, native?, system?, save?, assets? } satisfies GameConfig`. Plain data, no call |
| `core/` | The kit (`defineGame`) and its types |
| `shared/` | The shared layer |
| `features/<f>/` | One feature: `flow/`, `rules/`, `views/`, `styles/`, `motion/`, `world/`, `assets/`, `strings/` |
| `plugins/` | The game's own plugins |
| `generated/` | What `moku-game keys` writes: `assets.ts`, `strings.ts`, `strings.<locale>.ts` |
| `manifest.json` | The dev manifest `moku-game keys` writes |
| `tests/` | The tests. `tests/scenarios/<name>.ts` are the prepared saves of `?player=<name>` |
| `.moku/` | What `moku-game` writes: the dev page, its `bunfig.toml`, the Tauri project. Git ignores it |
| `dist/assets/`, `dist/web/`, `dist-native/` | The pack, the web build, the native apps |

A game has no `web/`, no `native.ts`, no `platform-bridge.ts` and no `bunfig.toml`.

The scripts of the game's `package.json`:

```json
{
  "scripts": {
    "dev": "moku-game dev",
    "build": "moku-game build",
    "keys": "moku-game keys",
    "pack": "moku-game pack",
    "native:ios-sim": "moku-game native build ios --simulator"
  }
}
```

Add `.moku/` to `.gitignore`. `moku-game dev` warns until it is there: `[game] dev: add ".moku/" to .gitignore. moku-game writes its dev page there.`

## index.ts: the game

`defineGameApp(definition)` takes the whole game as one object and returns the game: `headless()` and `screen()`. It creates no app. Every type comes from the object: the plugin tuples, the player and the session. No generic at the call site.

```ts
// index.ts of the mini game in tests/fixtures/mini-game
import { defineGameApp } from "@moku-labs/game/app";
import { homeFeature } from "./features/home";
import { infoFeature } from "./features/info";
import { mainFlow } from "./flows/main";
import { startingPlayer, startingSession } from "./state";

export default defineGameApp({
  flow: mainFlow,
  safeNode: "home",
  player: startingPlayer,
  session: startingSession,
  features: [homeFeature, infoFeature],
  headless: { features: [infoFeature] }
});
```

| Key | Default | What |
|---|---|---|
| `flow` | required | The main flow |
| `safeNode` | the start of the main flow | The checkpoint entered after a failed retry |
| `player` | required | The player a new save starts from |
| `session` | required | The session at every start |
| `referenceLong` | `1920` | The long side the layout needs, in reference units |
| `seed` | `42` | The rng seed of a new save |
| `shared` | none | The shared layer, composed first among the features |
| `features` | `[]` | The features of the screen app, in order, after `shared` |
| `plugins` | `[]` | The game's own plugins, after the features. Their APIs land on `screen().app` |
| `headless` | `{}` | `{ features?, plugins? }`: what the headless app composes, nothing else |
| `pluginConfigs` | `{}` | The plugin configs of the game, without the keys the shell owns |

The shell writes some plugin configs from the seams. Those keys are not in the type of `pluginConfigs`: a seam-owned key is a compile error, never a value a shallow merge would drop.

| Plugin | The shell writes | The game keeps |
|---|---|---|
| `model` | `playerProvider`, `initialPlayer`, `initialSession`, `seed` | `schemaVersion`, `migrations` |
| `clock` | `source` | nothing |
| `flow` | `mainFlow`, `safeNode` | `retries`, `settleTimeoutMs`, `journalLimit` |
| `platform` | `provider`, `keepAwake` | nothing |
| `renderer` | `mount`; a seam's `loadPixi` and `preference` win | the rest |
| `assets` | `manifest`, `io` | `textureBudgetMb`, `preloadDepth`, `baseUrl` |
| `audio` | `context`; a seam's `journal` wins | the rest |

The graph is run by the page or by the test, never by the game. A game's exit plugin calls `ctx.require(platformPlugin).exit()` itself.

`defineGameApp` checks what TypeScript cannot stop, a definition from JavaScript or one that casts. `[game] defineGameApp needs flow.` A list entry that `defineFeature` did not make: `[game] defineGameApp: features[2] is not a feature.`

## Tests: game.headless() and game.screen()

| Method | Composes |
|---|---|
| `game.headless(seams?)` | The core plugins, `logicOnly` of `headless.features`, then `headless.plugins`. No screen plugin, no game plugin unless listed |
| `game.screen(seams?)` | The screen set, `audio`, `effects`, `platform`, then `shared`, the features and the game's plugins |

Both return `{ app, clock, provider }`, the app not started. Each call gives a fresh app, a fresh clock and a fresh save. The clock is `fakeClock(startMoment)` and the save a fresh `memory()` unless a seam passes one. `startMoment` is `1_000_000`.

```ts
// a test of the mini game, tests/integration/home.test.ts
import { startMoment } from "@moku-labs/game/app";
import { createHeadless } from "@moku-labs/game/testing";
import game from "../../index";

const { app, clock, provider } = game.headless();
const run = await createHeadless(app);

run.state().path; // "home"
clock.now() === startMoment; // true
provider.calls.map(call => call.method); // ["load", "commit"]: a new player
app.has("renderer"); // false
await run.stop();
```

Without a `renderer.mount` the renderer is inert, so the screen app runs in plain Bun too. A test passes the parsed manifest and a file seam:

```ts
const { app } = game.screen({ manifest, io });
await app.start();
void app.flow.run(); // the page runs the graph
app.renderer.host.kind(); // "none": no mount, no Pixi
app.platform.back(); // "none": no platform seam
```

| Seam | `headless` | `screen` | Default |
|---|---|---|---|
| `seed` | yes | yes | the definition's `seed`, else `42` |
| `clock` | yes | yes | `fakeClock(startMoment)`; the page passes the device clock |
| `provider` | yes | yes | a fresh `memory()` |
| `player`, `session` | yes | yes | the definition's |
| `manifest` | | yes | none. A URL on the page, the parsed file in a test |
| `io` | | yes | the browser fetch, or headless |
| `platform` | | yes | none: the platform plugin is inert, `back()` answers `"none"` |
| `keepAwake` | | yes | `false` |
| `audio` | | yes | `{ context?, journal? }` |
| `renderer` | | yes | `{ mount?, loadPixi?, preference? }` |

## config.ts: the page, native, system, save

```ts
// config.ts: plain data, no call
import type { GameConfig } from "@moku-labs/game/app";

export default {
  page: { title: "Лесной городок", lang: "ru", background: "#10161d", orientation: "portrait", icons: { favicon: "assets/icon.png" } },
  native: { name: "Лесной городок", identifier: "com.mokulabs.timber", icon: "assets/icon.png" },
  system: ["lifecycle", "back", "haptics", "keepAwake"],
  save: "memory",
  assets: { layers: { shared: "ui" } }
} satisfies GameConfig;
```

| Key | Default | What |
|---|---|---|
| `page.title` | required | The page title. Never empty |
| `page.lang` | `"en"` | The `lang` of the page |
| `page.background` | `"#000000"` | The colour behind the canvas, the `theme-color` meta and the native window. The canvas clear colour stays `pluginConfigs.renderer.background` |
| `page.orientation` | `"portrait"` | `"portrait"`, `"landscape"` or `"any"`. The native build locks it; the page writes nothing |
| `page.icons` | none | `{ favicon?, appleTouch? }`: files relative to the game, written as `<link>` tags |
| `page.head` | none | Raw tags for `<head>`, verbatim, in order |
| `native` | none | `{ name, identifier, icon?, targets? }`. Left out, the game has no native build |
| `system` | `[]` | The system plugins the shell wires: `lifecycle`, `back`, `haptics`, `keepAwake`, `store` |
| `save` | `"memory"` | `"memory"`, `"local"` or `"store"` |
| `assets.layers` | `{}` | Asset layers by folder: `{ shared: "ui" }` becomes `--layer shared=ui` |

A value TypeScript would refuse, in a file that skips `satisfies`, stops `moku-game` and the page:

- `[game] config.save is "disk".` with `Use "memory", "local" or "store".`
- `[game] config.system names "tray", which the game shell does not wire.`
- `[game] config.page.title is empty.`
- `[game] moku-game: page.background "url(x)" is not a CSS color.`, and the same for `page.lang`.
- `[game] moku-game: page.icons.favicon "assets/icon.png" is not a file in the game.`

## The page

`moku-game dev` and `moku-game build` write the page. Its `main.ts` calls `startPage(game, config, options)` of `@moku-labs/game/app/page`. The dev `main.ts` of the mini game:

```ts
// Written by moku-game dev. Do not edit.
import "./dev.ts";
import { startPage } from "@moku-labs/game/app/page";
import game from "../index.ts";
import config from "../config.ts";
import scenario0 from "../tests/scenarios/ready.ts";

await startPage(game, config, {
  scenarios: { "ready": scenario0 }
});
```

`startPage`, in order:

1. Resolves `config.ts`.
2. Picks the start. `?player=<name>` runs the scenario of that name on a fresh memory save, never on the stored one.
3. Builds the system shell when the page has one, then picks the save.
4. Makes the screen app: the canvas on `#game`, `manifest.json` next to the page, the device clock, the shell's platform, keep-awake when `system` lists `keepAwake`. `?renderer=webgl` asks Pixi for WebGL.
5. Sets `globalThis.game` (the app), `globalThis.system` (the system app, or `undefined`) and `globalThis.doors` (`read`, `watch`, `sources`; in dev also `run` and `commands`).
6. Follows the reduced-motion setting, also when it changes.
7. Starts the shell, then the app, then runs the graph. A graph that stops is logged as `[game] The graph stopped.`, never thrown.
8. In dev, starts the agents, each with `{ app, name, modules }`.

Every problem goes to the app's log. An unknown scenario logs `[game] No scenario "x".` and the page starts from the starting player.

A scenario is the default export of `tests/scenarios/<name>.ts`. It gets the device time, so a timer can be due already:

```ts
// tests/scenarios/ready.ts of the mini game: `?player=ready` opens with the counter at 3.
import type { Scenario } from "@moku-labs/game/app";
import type { Player } from "../../state";

const ready: Scenario<Player> = () => ({ player: { count: 3 } });

export default ready;
```

A test starts from the same save: `game.headless({ player: ready(startMoment).player })`.

## The save

| `save` | Where the player lives |
|---|---|
| `"memory"` | In memory, for this page only |
| `"local"` | `localStorage`, under `<native.identifier>:save`, or `moku-game:save` without `native`. A page that has no `localStorage` or refuses a write gets a memory save and logs `[game] localStorage is not available, so the save lives in memory.` |
| `"store"` | The system store: idb on the web, the Tauri store in the native app. It needs the system shell and `@moku-labs/system` |

A store save that cannot be read rejects the load: `[game] The save could not be read from the system store: …`. The game does not start over a real save as a new player. A refused write is logged, and the next write still goes.

## System and native: optional peers

`@moku-labs/system` and `@moku-labs/native` are optional peer dependencies. A web-only game installs neither.

| Package | When | Install |
|---|---|---|
| `@moku-labs/system` | `config.ts` names a `system` plugin, or `save` is `"store"` | `bun add @moku-labs/system@^0.3.1` |
| `@moku-labs/native` | `moku-game native …` | `bun add -d @moku-labs/native@^0.3.2` |

The page imports the shell only when the game needs it. The generated `main.ts` then imports `systemShell` from `@moku-labs/game/app/system` and passes it to `startPage`. It loads each named system plugin with its own `import()`. Without the package: `[game] config.system needs @moku-labs/system.`

| `system` name | The engine gets |
|---|---|
| `lifecycle` | Pause and resume, the `"background"` reason of `lifecycle` |
| `back` | The hardware Back press and `exit()` |
| `haptics` | The `haptic` effect |
| `keepAwake` | The screen wake lock while the game runs |
| `store` | The store save |

A game that builds its own shell takes the parts from `@moku-labs/game/app/system`:

```ts
import { createSystemApp, fromSystem } from "@moku-labs/game/app/system";

const system = await createSystemApp(["lifecycle", "back", "haptics"], "com.mokulabs.timber");
await system.start();
const { app } = game.screen({ platform: fromSystem(system) }); // Back, pause, haptics reach the system app
```

`storeSave(store, key, report)` makes the save provider over a system store, for the `provider` seam.

`moku-game native` maps `config.ts` to the config of `@moku-labs/native`:

| Native config | From |
|---|---|
| `app.name`, `app.identifier`, `app.icon` | `native.name`, `native.identifier`, `native.icon` |
| `app.orientation`, `app.backgroundColor` | `page.orientation`, `page.background` |
| `web.build` | `moku-game build`, with the runner flags |
| `web.devCommand`, `web.devUrl` | `moku-game dev --port 5173`, `http://localhost:5173` |
| `web.dist` | `<game>/dist/web` |
| `system` | One row per name that needs a Tauri capability: `back`, `haptics`, `store`. A `"store"` save adds `store` |
| `targets` | `native.targets`, else the target of the command |
| `projectDir`, `outDir` | `<game>/.moku/tauri`, `<game>/dist-native` |

## Commands

```
moku-game <command> [options]

  dev [--port 3000] [--packed]          serve the game with hot reload
  build [--out dist/web]                pack the assets and build the page
  native build <target> [--simulator]   build the native app (ios, macos, android)
  native dev <target>                   run the native shell on the dev server
  native doctor | native clean          check or remove the native project
  keys [--check]                        write generated/assets.ts and manifest.json
  pack [--no-cache]                     pack the assets into dist/assets
  help                                  print this text

Every command: --root <dir> (default .), --preload <path>, --serve-plugin <path>.
```

| Flag | Command | Default | What |
|---|---|---|---|
| `--root <dir>` | every | `.` | The game folder, against the cwd |
| `--preload <path>` | every | none | A file Bun preloads. Repeats |
| `--serve-plugin <path>` | `dev`, `build`, `native` | none | A Bun plugin the page bundles with, after the hot plugin. Repeats |
| `--port <n>` | `dev` | `3000` | An integer 0-65535. `0` takes a free port |
| `--packed` | `dev` | off | Serves `<game>/dist/assets` instead of the raw files |
| `--out <dir>` | `build` | `<game>/dist/web` | The output folder, replaced by the run |
| `--simulator` | `native build` | off | iOS: the simulator build |
| `--check` | `keys` | off | Fails when an output is out of date |
| `--no-cache` | `pack` | off | A cold pack |

The global flags go before or after the command word. The exit code is `0` on success, else `1` and a `[game] …` line, or the code of the scanner or the dev server.

### dev

`moku-game dev` writes the dev page into `<game>/.moku/`: `index.html`, `dev.ts`, `main.ts` and `bunfig.toml`. A file is written only when its text changed. It then runs Bun again under that bunfig, in the game folder, and serves the page. It prints two lines; the second is the bound URL, plain, on its own line:

```
› mini-game: dev server, raw assets. Ctrl+C stops it.
http://localhost:3000/
```

- `/` is the page, `/manifest.json` the manifest of the game, or of `dist/assets` with `--packed`. Any other path is a file of the game, or of `dist/assets` with `--packed`. A segment that starts with a dot, such as `.moku` or `..`, and `node_modules` answer 404.
- The bunfig lists the engine's hot plugin first and defines `__MOKU_GAME_DEV__` as `true`. `dev.ts` sets the global too. See [Hot swap](./hot-swap.md).
- `main.ts` lists `tests/scenarios/*.ts`, sorted, by file stem. Test files, `.d.ts` and `index.ts` are skipped. A new or removed scenario file rewrites `main.ts`, and the page reloads. A `tests/scenarios/` folder created after the start needs a restart.
- Ctrl+C stops the server with exit code 0. A taken port: `[game] dev: port 3000 is in use.` with `Pass --port 0 for a free port.`
- Without `manifest.json` it warns `Run "moku-game keys" first.` and serves on.

### build

`moku-game build` packs the assets with the layers of `config.ts`, then bundles the production page into `--out`: the HTML and `main.ts` in memory, minified, for the browser, `__MOKU_GAME_DEV__` defined `false`, no hot plugin. It copies the pack beside the page, `manifest.json` next to `index.html`. It writes nothing under `.moku/`.

The page carries no scenario, no agent, no `.dev` module and no `/control`. Every link starts with `./`, so the build runs from any http sub-path and from the Tauri protocol, not from `file://`. It prints `built "<out>": <n> files, <kb> KB.` An `--out` that is the game, holds it, or touches `dist/assets` is refused.

### native

`moku-game native <verb> [<target>]` runs one verb of `@moku-labs/native` over the native config above. `build` and `dev` need a target, such as `ios`. `doctor` and `clean` take one or none. Native prints its own progress and failures.

### keys and pack

`keys` and `pack` run the asset scanner of `@moku-labs/game/assets` with the game's paths and one `--layer` per `assets.layers` entry. `keys` writes `generated/assets.ts`, the compiled strings and `manifest.json`. `pack` writes `dist/assets`. See [the asset keys](./quick-start.md#a-screen-the-body-font-and-the-asset-keys).

## The editor: preparePage

The editor takes the same page from the engine. `preparePage(root, options?)` of `@moku-labs/game/cli` writes the dev page of `moku-game dev` and answers its paths. It starts no server and no watcher, and throws the same `[game]` errors.

```ts
// The editor bin, started with --root games/timber:
const { preparePage } = await import(Bun.resolveSync("@moku-labs/game/cli", root));
await preparePage("games/timber", { agents: ["@moku-labs/editor/agent/page"] });
// { html: "<cwd>/games/timber/.moku/index.html", bunfig: "<cwd>/games/timber/.moku/bunfig.toml" }
```

| Option | What |
|---|---|
| `agents` | Agent modules the page starts after the app, in order. Each default-exports a `PageAgent`. With agents, `main.ts` also imports the game's `**/*.dev.ts` modules and hands them to the agents |
| `preload` | Files Bun preloads in the serving process |
| `servePlugins` | Bun plugins the page bundles with, after the hot plugin |

## A game against the engine working tree

The engine repository carries a recipe for a game that runs on its source instead of the installed package. It is not in the npm package.

```sh
moku-game dev --preload <tree>/scripts/tree/preload.ts --serve-plugin <tree>/scripts/tree/bundle.ts
```

In the engine repository the mini game runs the same way: `bun run mini:dev` serves `tests/fixtures/mini-game`, and `bun run mini:pack` packs it.
