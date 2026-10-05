# Testing

Headless tests, visual tests, the test layout of this repository and its lint rules.

## Testing entry

`@moku-labs/game/testing` re-exports the headless helpers and the visual tests.

| Export | Signature | Purpose |
|---|---|---|
| `createHeadless` | `(app: HeadlessApp) => Promise<HeadlessGame>` | Sets flow mode `"fast"`, starts the app, starts `flow.run()` unless the app already did, and waits for the first rest point |
| `runRepro` | `(app: HeadlessApp, repro: Repro) => Promise<ReproResult>` | Restores a state and a checkpoint, then walks a route |
| `stepFrames` | `(app: HeadlessApp, count: number, deltaMs: number) => void` | Calls `app.time.step(deltaMs)` `count` times |
| `fakeClock` | `(start = 0) => FakeClock` | A `ClockSource` with `advance(ms)` and `set(moment)` |
| `memory` | `(fixture?: { state: SaveDoc; version: number }) => PlayerStateProvider & { calls: ProviderCall[] }` | In-memory save provider. It keeps what it was committed and records every call |
| `saveOf` | `(player: Json, seed?: number) => SaveDoc` | Builds a save document for a fixture |
| `defineVisualTest` | `(name: string, test: { start: VisualStart; steps: readonly VisualStep[]; webgl?: boolean }) => VisualTest` | A visual test as frozen data: where it starts, its steps, and whether it also runs in the WebGL leg |
| `runVisualTests` | `(setup: VisualSetup, tests: readonly VisualTest[], options?: VisualOptions) => Promise<VisualReport>` | Plays the tests and compares every checkpoint with its baseline files |
| `parseVisualArgv` | `(argv: readonly string[]) => { update?; pixels?; only?; dir?; renderer? }` | Reads `--update`, `--no-pixels`, `--webgl`, `--only <name>` and `--dir <path>` from a command line. `--webgl` runs only the tests with `webgl: true`, on the page with `?renderer=webgl`: such a test writes its picture to `screen.webgl.webp` and shares `state.json` and `describe.json` with the WebGPU leg |

A `HeadlessGame` has `walk(route)`, `answer(answer)`, `state()`, `history()` and `stop()`.

## Visual tests

A visual test is data: where the game starts, then steps. A step is a `/control` command by its short name (`answer`, `tap`, `drag`, `key`, `fill`, `walk`, `restore`, `step`, `pause`, `resume`, `reducedMotion`) with that command's input, or a checkpoint.

```ts
// tests/visual/reward-popup.visual.ts
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
const report = await runVisualTests({ app: () => createScreenGame().app, page: { url: "http://localhost:3000/" } }, [rewardPopup]);
process.exitCode = report.ok ? 0 : 1;
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

The fixture game keeps its visual tests in `tests/visual/`: one `*.visual.ts` per test, the list in `tests.ts`, the script in `run.ts` and the baselines next to them. The script imports the runner from `src/testing`, so a stale `dist/` never writes baselines. `bun run test` runs the headless leg through `tests/integration/visual-headless.test.ts`. Both legs run against the dev page:

```sh
# terminal 1: the dev page of the fixture on a free port
cd tests/integration/merge-game && bun ./web/serve.ts --port 4173

# terminal 2: from the root of the repository
bun run fixture:visual --url http://localhost:4173/            # compare with the baselines
bun run fixture:visual --url http://localhost:4173/ --update   # write the baselines again
bun run fixture:visual --only gift-popup --no-pixels           # one test, headless only
```

Without `--url` the page is `http://localhost:3000/`. The exit code is 1 when a checkpoint differs.

The test of the browser leg itself opens a real Chrome only on request: `MOKU_VISUAL_BROWSER=1 bunx vitest run tests/unit/visual/browser.test.ts`. It also proves the WebP is lossless: random opaque pixels come back byte for byte. Without the variable it skips with its reason, so `bun run test` opens no browser.


## Scripts

```sh
bun run build              # build with tsdown: dist/index.mjs, testing.mjs, assets.mjs, inspect.mjs, control.mjs, jsx-runtime.mjs, jsx-dev-runtime.mjs
bun run typecheck          # tsc --noEmit
bun run lint               # biome check . && eslint .
bun run lint:fix           # biome check --write . && eslint --fix .
bun run format             # biome format --write .
bun run test               # all tests, vitest run
bun run test:unit          # vitest project "unit"
bun run test:integration   # vitest project "integration"
bun run test:coverage      # both projects with coverage, 90% thresholds
bun run validate           # publint and attw with the esm-only profile
bun run fixture:pack       # pack the fixture game into tests/integration/merge-game/dist/assets
bun run fixture:visual     # the fixture's visual tests, both legs: --url <dev page>, --update, --only <name>, --no-pixels, --webgl
bun run fixture:native     # the fixture as a native app on @moku-labs/native: <target> [--simulator] [--page <html>]
bun run release:setup      # moku-release setup
bun run release:doctor     # moku-release doctor
bun run release            # moku-release
```

## Test layout

| Path | Holds |
|---|---|
| `tests/unit/` | Framework-level unit tests: root index, setup |
| `tests/integration/` | Framework-level scenarios across plugins |
| `tests/integration/merge-game/` | The fixture game, written on the public API only. Not published |
| `tests/visual/` | The visual tests of the fixture game and their baselines: `<test>/<checkpoint>/state.json`, `describe.json`, `screen.webp` |
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
| L3 | Determinism: no `Date.now`, `performance.now`, `new Date`, `Math.random`, `setTimeout`, `setInterval` | `model`, `flow`, `clock` except `clock/system.ts`, and the rules of the fixture game |
| L4 | The rules of the fixture game import only their siblings | `tests/integration/merge-game/rules/` |
| L5 | No module-scope state: no top-level `let`, no top-level `Map`, `Set`, `WeakMap`, `WeakSet`. No allowlist | `src/**` |
| L6 | Plugin wiring files need no JSDoc on small inline arrows. Every function declaration and every exported type needs JSDoc with description, params and returns | `src/plugins/*/index.ts` |
| L7 | The public contract carries the docs: every member of a `…Api` type in `types.ts` has JSDoc and a scenario `@example` (when it is called, literal arguments, the result). A member another plugin calls is shown from that plugin's point of view; there is no private tier and no exemption. The implementation of an API method has no JSDoc. Elsewhere an example is allowed, never required | `src/plugins/**/types.ts` |
| L8 | No signature echo: an `@example` whose whole body is one call with bare identifiers is an error | `src/**` |
| L9 | The JSX runtime module is reached only through `src/jsx-runtime.ts` and `src/jsx-dev-runtime.ts`, and those two import nothing else | `src/**` outside `ui` |
| L13 | No import of `@moku-labs/system`, `@moku-labs/native` or `@tauri-apps/*`, type imports included. The game builds the `PlatformProvider` in its own layer | every file under `src/`, tests included |

A game gets L2, L3, L4, L5, L13 and the dev-only imports from the oxlint plugin `@moku-labs/game/lint`, see [Lint for games](./lint.md). Its tests run the real oxlint on fixtures: `tests/unit/lint-plugin.test.ts`.
