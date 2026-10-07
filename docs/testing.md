# Testing

Headless tests, visual tests, the test layout of this repository and its lint rules.

## The apps of a game

A test makes its app from the game's `index.ts`. `game.headless()` composes the logic only; `game.screen()` composes the screen set, the features and the game's plugins. Both return `{ app, clock, provider }`, the app not started, on a fake clock at `startMoment` and a fresh in-memory save unless a seam passes one. See [The game shell](./shell.md#tests-gameheadless-and-gamescreen).

```ts
// a test of the mini game in tests/fixtures/mini-game
import { createHeadless } from "@moku-labs/game/testing";
import game from "../../index";
import ready from "../scenarios/ready";

const { app } = game.headless({ seed: 7, player: ready(1_000_000).player });
const run = await createHeadless(app);

run.state().path; // "home"
app.model.store.snapshot().player; // { count: 3 }
await run.stop();
```

A screen test passes the parsed manifest and a file seam, `game.screen({ manifest, io }).app`. Without a mount the renderer is inert, so it runs in plain Bun.

## Testing entry

`@moku-labs/game/testing` re-exports the headless helpers and the isolated feature tests. It imports no `node:` module, so a test that runs in a browser can import it. The visual tests live in `@moku-labs/game/visual`, see [Visual tests](#visual-tests).

| Export | Signature | Purpose |
|---|---|---|
| `createHeadless` | `(app: HeadlessApp) => Promise<HeadlessGame>` | Sets flow mode `"fast"`, starts the app, starts `flow.run()` unless the app already did, and waits for the first rest point |
| `runRepro` | `(app: HeadlessApp, repro: Repro) => Promise<ReproResult>` | Restores a state and a checkpoint, then walks a route |
| `stepFrames` | `(app: HeadlessApp, count: number, deltaMs: number) => void` | Calls `app.time.step(deltaMs)` `count` times |
| `fakeClock` | `(start = 0) => FakeClock` | A `ClockSource` with `advance(ms)` and `set(moment)` |
| `memory` | `(fixture?: { state: SaveDoc; version: number }) => PlayerStateProvider & { calls: ProviderCall[] }` | In-memory save provider. It keeps what it was committed and records every call |
| `saveOf` | `(player: Json, seed?: number) => SaveDoc` | Builds a save document for a fixture |
| `isolate` | `(feature: FeaturePlugin, options: IsolateOptions<Nodes>) => (seams?: IsolateSeams) => App` | Composes one feature with the shared layer and nothing else of the game. Returns a factory of apps, not started. See [Isolated feature tests](#isolated-feature-tests) |
| `stub` | `(outcome: string, payload?: Json) => Stub` | Replaces a node or a sub-flow of the isolated flow: it ends at once with this outcome and payload |

A `HeadlessGame` has `walk(route)`, `answer(answer)`, `state()`, `history()` and `stop()`. The types `HeadlessApp`, `HeadlessGame`, `Repro`, `ReproResult`, `IsolateOptions`, `IsolateSeams`, `Stub` and `StubsOf` come from the same entry.

### Isolated feature tests

`isolate(feature, options)` plays one feature without the rest of the game. It composes `options.shared` and the feature as `logicOnly`, then `options.plugins`. The feature's flow becomes a node of a harness main flow `isolated`. Each node listed in `stubs` is replaced by a stub that ends with the given outcome.

```ts
// features/board/__tests__/fixtures/board-only.ts
export const boardOnly = isolate(boardFeature, {
  shared: sharedLayer,
  flow: boardFlow,
  stubs: { settings: stub("closed"), energy: stub("later"), giveToOrder: stub("orderComplete", { rewardId: "r1" }) },
  player: fresh
});

// features/board/__tests__/isolated/tap.isolated.ts
const game = await createHeadless(boardOnly({ player: { ...fresh, energy: 0 } }));
await game.walk([{ at: "board/awaitIntent", intent: "tap" }]); // noEnergy, the stubbed energy ends with later
game.state().path; // "board/awaitIntent"
await game.walk([{ at: "board/awaitIntent", intent: "give" }]);
game.state().path; // "exited": the flow left with orderComplete { rewardId: "r1" }
await game.stop();
```

| Option | Default | What |
|---|---|---|
| `flow` | required | The feature's flow |
| `as` | `flow.id` | The key the game's main flow holds the flow under. The harness uses it as the node name, so paths read as in the game: `as: "info"` for `info: infoFlow` gives `info/show` |
| `shared` | none | The shared layer, composed as `logicOnly` before the feature |
| `stubs` | `{}` | Node name of `flow` to `stub(outcome, payload?)` |
| `plugins` | `[]` | More plugins the feature needs headless |
| `player` | required | The player a new save starts from |
| `session` | `{}` | The session at start |
| `seed` | `1` | The rng seed |

The factory takes the seams of one app: `player`, `session`, `seed` and `clock`, for example `boardOnly({ clock: fakeClock(1_000_000) })`. They win over the options.

- **Exits.** For a flow with outcomes, every exit lands on the rest node `exited`. The journal keeps the outcome and its payload. `{ at: "exited", intent: "again" }` enters the flow once more. A flow without outcomes gets no `exited` node.
- **A node that is not stubbed runs for real.** That holds for the flow of another feature too: the board reaches `settingsFlow` by object, so it runs although the settings feature is not composed. Stub what the test does not want to run.
- **A stub is a sub-flow.** It holds one transit node `end` with the input and outcomes of the replaced node. So a route may still substitute it for one visit: `{ at: "board/energy", result: { outcome: "watch" } }`.
- **A checkpoint compacts `history()`.** After the walk returns to a checkpoint the journal starts again there. Assert on `state()`, on the bookmark, or on the `flow:edge` events of a plugin passed in `plugins`.
- **Typed stubs.** A stub key that is not a node of the flow, and an outcome the node does not declare, are compile errors. `isolate()` refuses them at run time too: `[game] isolate: no node "enrgy" in flow "board".` and `[game] stub at "energy" ends with "done", which "energy" does not declare.`
- **Names.** A feature and a flow share one namespace: name the feature `boardScreen` when its flow is `board`. With stubs the flow is rebuilt, so `describe()` names no owner feature for its nodes.

## Visual tests

`@moku-labs/game/visual` re-exports the visual tests. Its runner reads and writes baseline files, so it runs in node and bun only.

| Export | Signature | Purpose |
|---|---|---|
| `defineVisualTest` | `(name: string, test: { start: VisualStart; steps: readonly VisualStep[]; webgl?: boolean }) => VisualTest` | A visual test as frozen data: where it starts, its steps, and whether it also runs in the WebGL leg |
| `runVisualTests` | `(setup: VisualSetup, tests: readonly VisualTest[], options?: VisualOptions) => Promise<VisualReport>` | Plays the tests and compares every checkpoint with its baseline files |
| `parseVisualArgv` | `(argv: readonly string[]) => { update?; pixels?; only?; dir?; renderer? }` | Reads `--update`, `--no-pixels`, `--pixels`, `--webgl`, `--only <name>` and `--dir <path>` from a command line. `--pixels` runs the pixel leg off a Mac too; the last of `--pixels` and `--no-pixels` wins. `--webgl` runs only the tests with `webgl: true`, on the page with `?renderer=webgl`: such a test writes its picture to `screen.webgl.webp` and shares `state.json` and `describe.json` with the WebGPU leg |

The types `VisualTest`, `VisualStart`, `VisualStep`, `VisualSetup`, `VisualApp`, `VisualPage`, `VisualOptions`, `VisualRenderer`, `VisualTolerance`, `VisualReport`, `VisualTestResult` and `CheckpointResult` come from the same entry.

A visual test is data: where the game starts, then steps. A step is a `/control` command by its short name (`answer`, `tap`, `drag`, `key`, `fill`, `walk`, `restore`, `step`, `pause`, `resume`, `reducedMotion`) with that command's input, or a checkpoint.

```ts
// tests/visual/reward-popup.visual.ts
import { defineVisualTest } from "@moku-labs/game/visual";

export const rewardPopup = defineVisualTest("reward-popup", {
  start: { player: fixtures.ready, checkpoint: "home" },
  steps: [
    { tap: { key: "play" } },
    { answer: { intent: "deliver", payload: { orderId: "o1" } } },
    { checkpoint: "open" },
    { tap: { key: "claim" } },
    { checkpoint: "claimed" }
  ]
});

// tests/visual/run.ts, `bun tests/visual/run.ts --update`
const report = await runVisualTests({ app: () => game.screen({ manifest, io }).app, page: { url: "http://localhost:3000/" } }, [rewardPopup]);
process.exitCode = report.ok ? 0 : 1;
```

A game runs its visual tests with the bin, no script of its own: `moku-game visual`. It reads `tests/visual/index.ts`, whose default export is the two arguments of `runVisualTests`, and keeps the baselines in `tests/visual/baselines/`. When the pixel leg runs and no `--url` is given, it serves the dev page in its own process on a free port and stops it after. The exit code is 1 when a checkpoint differs. See [the shell](./shell.md#visual).

```ts
// tests/visual/index.ts of a game, run with `moku-game visual`, `moku-game visual --update --only reward-popup`
export default { app: () => game.screen({ manifest, io }).app, tests: [rewardPopup] };
```

A checkpoint settles the motions and saves three baseline files next to the test: `<dir>/<test>/<checkpoint>/state.json`, `describe.json` and `screen.webp`. A missing file is written; `--update` rewrites them; any other file is compared. The headless leg plays every test in plain Bun and compares `state.json` and `describe.json` exactly, so it runs in `bun run test`. The pixel leg plays the same steps on the dev page in Chrome with WebGPU, or with WebGL under `--webgl`, on a Mac only, and compares `screen.webp` with a tolerance; a pixel difference with the same state and describe is reported as a rendering regression. The page is the contract: a dev build that sets `globalThis.game` to the app and `globalThis.doors` to `{ read, watch, sources, run, commands }`. No CI job runs pixels.

#### Pixels

The pixel leg runs on a Mac only. `pixels` is on by default when the setup has a `page` and the platform is `darwin`, and off everywhere else. No CI job runs it: a Linux runner has no WebGPU worth trusting.

- **`playwright-core`** is an optional peer dependency. The leg loads it with a dynamic import, so a game that never runs pixels never installs it. Add it with `bun add -d playwright-core`. Without it the run stops with "The pixel leg needs playwright-core"; `--no-pixels` runs the headless leg alone.
- **The browser.** `page.browser` when the setup names one (`{ channel }` or `{ executablePath }`). Otherwise Playwright's own Chromium, whose version `playwright-core` pins, so a Chrome update never moves the baselines: install it with `bunx playwright-core install chromium`. Otherwise the system Google Chrome. Chrome starts with WebGPU on Metal; a page that draws with a renderer other than the requested one fails the leg.
- **The page.** 390 CSS px wide at a device scale of 2, as tall as the game's inert frame: 520 for a 4:3 portrait game, so `screen.webp` is 780 × 1040.
- **Game time.** The leg drives the clock itself, so two runs draw the same pixels: a dash phase, a pulse or a particle reads the same time. It waits until the page has loaded what it asked for (no request for half a second), runs `pause`, then steps the game to 5 s of game time, the last frame shorter so it lands exactly. From there every frame of the restore, of every settle and of a checkpoint is a `step` of 1000/60 ms, the frame of the headless leg; the browser's own frames move no game time. The picture is the stage after the last stepped frame. A `resume` step hands the clock back to the browser.
- **The picture.** The page takes `game.renderer.capture()` and reads its `png`, a PNG data URL. Lossless WebP: the page encodes it with `convertToBlob({ type: "image/webp", quality: 1 })`, which Chrome encodes without loss, so the baseline holds the captured pixels exactly.
- **`--update`** rewrites `state.json`, `describe.json` and `screen.webp` of every test it runs. A pixel difference writes `screen.actual.webp` and `screen.diff.webp` beside the baseline, red where a pixel differs. Git ignores both.
- **Tolerance.** A pixel differs when one of its channels moves by more than 24. A checkpoint differs when more than 0.1% of its pixels do. Both are `tolerance` in the options.

The mini game keeps its visual tests in `tests/visual/`: one `*.visual.ts` per test, the list in `tests.ts`, the script in `run.ts` and the baselines next to them. The script imports the runner from `src/visual`, so a stale `dist/` never writes baselines. `bun run test` runs the headless leg through `tests/integration/visual-headless.test.ts`. The engine commits the headless baselines only, `state.json` and `describe.json`; the pixel baselines of a real game live with the game, as in the merge game of [moku-labs/demos](https://github.com/moku-labs/demos). The pixel leg plays on the dev page of `moku-game dev`; `bun run mini:visual` starts it on a free port and stops it at the end:

```sh
bun run mini:visual                                  # compare with the baselines
bun run mini:visual --no-pixels --update             # write the headless baselines again
bun run mini:visual --only info-popup --no-pixels    # one test, headless only
bun run mini:visual --url http://localhost:3000/     # a page already served by bun run mini:dev
```

The exit code is 1 when a checkpoint differs. The same tests run through the bin with `tests/visual/index.ts`: `bun tests/fixtures/moku-game.ts visual --root tests/fixtures/mini-game --tests tests/visual/index.ts --dir tests/visual --no-pixels`; `tests/integration/app-visual.test.ts` runs it headless.

The test of the browser leg itself opens a real Chrome only on request: `MOKU_VISUAL_BROWSER=1 bunx vitest run tests/unit/visual/browser.test.ts`. It also proves the WebP is lossless: random opaque pixels come back byte for byte. Without the variable it skips with its reason, so `bun run test` opens no browser.


## Scripts

```sh
bun run build              # build with tsdown: dist/index.mjs, testing.mjs, app.mjs, app/page.mjs, app/system.mjs, cli.mjs, visual.mjs, assets.mjs, inspect.mjs, control.mjs, hot.mjs, lint.mjs, project.mjs, jsx-runtime.mjs, jsx-dev-runtime.mjs
bun run typecheck          # tsc --noEmit
bun run lint               # biome check . && eslint .
bun run lint:fix           # biome check --write . && eslint --fix .
bun run format             # biome format --write .
bun run test               # all tests, vitest run
bun run test:unit          # vitest project "unit"
bun run test:integration   # vitest project "integration"
bun run test:coverage      # both projects with coverage, 90% thresholds
bun run validate           # publint and attw with the esm-only profile
bun run mini:pack          # moku-game pack of the mini game: tests/fixtures/mini-game/dist/assets
bun run mini:dev           # moku-game dev of the mini game, from the source: http://localhost:3000/
bun run mini:visual        # the mini game's visual tests, both legs: --update, --only <name>, --no-pixels, --webgl, --url <dev page>
bun run release:setup      # moku-release setup
bun run release:doctor     # moku-release doctor
bun run release            # moku-release
```

## Test layout

| Path | Holds |
|---|---|
| `tests/unit/` | Framework-level unit tests: root index, setup, the isolated feature tests in `tests/unit/testing/`, the game shell in `tests/unit/app/` |
| `tests/integration/` | Framework-level scenarios across plugins; the mini game in its folder, the page bundle and the local save in `tests/integration/app/`; the `moku-game` commands in `app-*.test.ts` |
| `tests/fixtures/mini-game/` | The mini game in the layout of a game, written on the public API only: `index.ts`, `config.ts`, `tests/scenarios/`, one rest node, one popup flow, two features, one bundle. Not published |
| `tests/fixtures/moku-game.ts` | The `moku-game` bin on the source: `bun tests/fixtures/moku-game.ts dev --root tests/fixtures/mini-game` |
| `tests/visual/` | The visual tests of the mini game and their headless baselines: `<test>/<checkpoint>/state.json`, `describe.json` |
| `src/plugins/<name>/__tests__/unit/` | Unit tests of one plugin |
| `src/plugins/<name>/__tests__/integration/` | Integration tests of one plugin |
| `src/plugins/flow/__tests__/types/` | Type-level tests of the graph typing |

Plugin tests never go into the root `tests/` folder. Coverage thresholds are 90% for lines, functions, branches and statements.

## Lint rules

The project rules live in [`eslint.config.ts`](../eslint.config.ts).

| Rule | Says | Applies to |
|---|---|---|
| L1 | A module imports a sibling module only as `import type` from its `types.ts`. The plugin `index.ts` injects sibling APIs | Modules of `model` and `flow` |
| L2 | No static import of `pixi.js` or `yoga-layout`. They are loaded lazily with `import()` | `src/**` |
| L3 | Determinism: no `Date.now`, `performance.now`, `new Date`, `Math.random`, `setTimeout`, `setInterval` | `model`, `flow`, `clock` except `clock/system.ts` |
| L5 | No module-scope state: no top-level `let`, no top-level `Map`, `Set`, `WeakMap`, `WeakSet`. No allowlist | `src/**` |
| L6 | Plugin wiring files need no JSDoc on small inline arrows. Every function declaration and every exported type needs JSDoc with description, params and returns | `src/plugins/*/index.ts` |
| L7 | The public contract carries the docs: every member of a `…Api` type in `types.ts` has JSDoc and a scenario `@example` (when it is called, literal arguments, the result). A member another plugin calls is shown from that plugin's point of view; there is no private tier and no exemption. The implementation of an API method has no JSDoc. Elsewhere an example is allowed, never required | `src/plugins/**/types.ts` |
| L8 | No signature echo: an `@example` whose whole body is one call with bare identifiers is an error | `src/**` |
| L9 | The JSX runtime module is reached only through `src/jsx-runtime.ts` and `src/jsx-dev-runtime.ts`, and those two import nothing else | `src/**` outside `ui` |
| L13 | `@moku-labs/system` is imported only in `src/app/system.ts` and `@moku-labs/native` only in `src/app/native.ts`, the two optional peers of the game shell. `@tauri-apps/*` nowhere. Type imports and `import()` count | every file under `src/`, tests included |

A game gets L2, L3, L4, L5, L13, the dev-only imports and the layout rules (layers, feature doors, test suffixes) from the oxlint plugin `@moku-labs/game/lint`, see [Lint for games](./lint.md). Its tests run the real oxlint on fixtures: `tests/unit/lint-plugin.test.ts`.
