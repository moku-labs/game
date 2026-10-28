# Configuration

Global config and the config of every plugin, with defaults. A game sets them in `index.ts`: `orientation`, `referenceSide`, `referenceLong` and `pluginConfigs` of `defineGameApp`. The page, the native app, the system plugins and the save live in `config.ts`, see [config.ts of a game](#configts-of-a-game).

## Global

```ts
createApp({ config: { orientation: "landscape", referenceSide: 1080, referenceLong: 1920 } });
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `orientation` | `"portrait" \| "landscape"` | `"portrait"` | Screen orientation the game is designed for |
| `referenceSide` | `number` | `1080` | Short side of the reference resolution in pixels |
| `referenceLong` | `number` | `1920` | The long side, in reference units, the layout needs inside the safe area. The viewport scale is `min(short / referenceSide, safeLong / referenceLong)`, so a wide screen gives the layout more width instead of shrinking it |

## Per plugin

Set with `defineGameApp({ pluginConfigs: { <plugin>: { ... } } })`, or `createApp({ pluginConfigs })` for an app made by hand. `defineGameApp` does not take the keys the shell writes from the seams: `model.playerProvider`, `initialPlayer`, `initialSession`, `seed`, all of `clock` and `platform`, `flow.mainFlow`, `safeNode`, `renderer.mount`, `assets.manifest`, `io` and `audio.context`. See [The game shell](./shell.md#indexts-the-game).

| Plugin | Key | Type | Default | Meaning |
|---|---|---|---|---|
| `time` | `maxFps` | `30 \| 60 \| 120` | `60` | Frame rate cap; the top of the ladder with `adaptive` |
| `time` | `maxDeltaMs` | `number` | `50` | Upper bound of one frame's delta in milliseconds |
| `time` | `idleFps` | `0 \| 30` | `30` | Frame rate cap of an idle screen. `0` turns the idle cap off. Any plugin lifts it with `wake()` |
| `time` | `idleAfterMs` | `number` | `2000` | Unscaled milliseconds without a `wake()` after which the loop drops to `idleFps` |
| `time` | `adaptive` | `false \| { floor: 30 \| 60 }` | `false` | Adaptive frame rate: the highest divisor of the display rate at or below `maxFps`, down one step when drawn frames come late, up again after steady room, never below `floor`. Off in a headless app and on a fake clock. See the [time README](../src/plugins/time/README.md) |
| `lifecycle` | none | | | The plugin has no config |
| `model` | `playerProvider` | `PlayerStateProvider \| undefined` | `undefined` | The save seam. `undefined` means an in-memory provider: the save lives as long as the app does |
| `model` | `initialPlayer` | `Json` | `{}` | Player state of a new player. Deep-cloned |
| `model` | `initialSession` | `Json` | `{}` | Session state at every start. Deep-cloned |
| `model` | `seed` | `"from-save" \| number` | `"from-save"` | `"from-save"`: a new player gets a random seed once. A number fixes it for tests |
| `model` | `schemaVersion` | `number` | `1` | Version of the save schema this build writes |
| `model` | `migrations` | `readonly Migration[]` | `[]` | Ordered chain. `up` of `from: n` produces version `n + 1` |
| `debug` | none | | | The plugin has no config. `app.debug.overlay.open({ mode? })`, `close()`, `toggle()`, `isOpen()` drive the editor's overlay on a page with the agent and answer `false` elsewhere; the ui extra `DebugTrigger()` calls `open()` after five taps within three seconds of wall time. The start mode is `config.ts` `debug.overlay` |
| `clock` | `source` | `ClockSource \| undefined` | `undefined` | Time source. `undefined` means the system source. Tests pass `fakeClock()` |
| `flow` | `mainFlow` | `AnyFlow \| undefined` | `undefined` | The top-level flow. Required before `run()` |
| `flow` | `safeNode` | `string \| undefined` | `undefined` | Path of the checkpoint entered after a failed retry. `undefined` means the main flow's `start` |
| `flow` | `retries` | `number` | `1` | Retries of a failed transition before `safeNode` |
| `flow` | `settleTimeoutMs` | `number` | `2000` | How long `onStop` waits for the active node to settle after abort |
| `flow` | `journalLimit` | `number` | `500` | Journal entries kept between checkpoints |
| `flow` | `holdMs` | `number` | `0` | How long an answer a closed gate refused is kept, in milliseconds of game time. `0` keeps it for the frame it was given in, and the first answer wins. Above `0` the last answer wins. `Infinity` keeps it until the next gate opens |
| `world` | `settleMs` | `number` | `350` | Length of the default settle motion |
| `world` | `reconciledEvent` | `boolean` | `false` | Emit `world:reconciled` after every reconcile (dev tools) |
| `renderer` | `mount` | `string \| undefined` | `undefined` | Selector of the mount element. `undefined` keeps the renderer inert |
| `renderer` | `preference` | `"webgpu" \| "webgl"` | `"webgpu"` | Preferred backend; Pixi falls back to WebGL |
| `renderer` | `background`, `antialias`, `aspect`, `poolLimit`, `unsupportedMessage`, `loadPixi` | | see the plugin README | Host, viewport and pool settings; `loadPixi` is the lazy loader, a test passes a fake |
| `renderer` | `debug` | `{ nineSlice?: boolean; verifyFrames?: boolean; kept?: boolean }` | `{ nineSlice: false, verifyFrames: false, kept: true }` | Outline every nine-slice from the start; `sync.debug.nineSlice(on)` switches it live. `verifyFrames` (dev and debug builds only) checks every skipped frame, and every kept picture, against the frame drawn live, by pixels. `kept: false` draws every filtered view live; `sync.debug.kept(on)` switches it live |
| `renderer` | `keptMb` | `number` | `64` | MiB the kept pictures may hold: a filtered view whose subtree and filter values did not change is drawn as one quad from an engine-owned texture, also while it moves; the least recently drawn picture goes first when the budget is full. `0` keeps none. Not a finite number of at least 0 throws at `createApp` |
| `renderer` | `onDemand` | `boolean` | `false` | Draw a frame only when something on the screen changed: a written view, a filter value, a reported adapter, a resize, a wake of `time`, a waiting capture. The loop keeps its rate. A game that writes into its own `Display` objects calls `renderer.invalidate(entity)` before the write |
| `renderer` | `maxResolution` | `number` | `2` | Cap of `devicePixelRatio`; a change of the ratio is followed from the next frame. A player's graphics setting is applied by `renderer.monitor.setResolution` from an effect |
| `renderer` | `poolTrim` | `{ restMs: number; aboveMb: number } \| false` | `{ restMs: 1000, aboveMb: 16 }` | Gives back the render targets Pixi's texture pool keeps between frames (filter passes, a blur's ping-pong), strictly between frames: once the screen drew nothing for `restMs` (`onDemand`), `restMs` after a scene change, and on a pause. A rest or a scene change trims only when the targets grew by `aboveMb` MiB since the last trim; a pause trims whatever grew. `false` keeps them until the app stops. Neither `false` nor two finite numbers of at least 0 throws at `createApp` |
| `renderer` | `warm` | `number` | `1` | Probe draws per drawn frame that create the GPU pipelines the game will need while it loads: sprites, graphics, text, particles and every filter `effects` registers with the stages of its inputs, on the canvas and on a texture, with and without a clip (one draw on WebGL). Drawn before the frame and cleared by it: nothing shows. `0` turns the warm-up off: every pipeline is created in the first frame that draws with it. Not a whole number from 0 to 16 throws at `createApp` |
| `renderer` | `monitor` | `{ budgetMs: number \| "rate"; frames: number }` | `{ budgetMs: "rate", frames: 1024 }` | Agent builds: a frame over the budget is a spike (`"rate"`: one frame of the frame's rate, 8.33 ms at 120 fps, 16.7 ms at 60); the ring keeps `frames` (64 to 16384) |
| `input` | `tapSlopPx`, `longPressMs`, `dragStartPx`, `swipeMinPx`, `swipeMaxMs` | `number` | `12`, `450`, `8`, `48`, `300` | Gesture thresholds in reference px and ms |
| `input` | `cursor` | `{ control: string; idle: string }` | `{ control: "pointer", idle: "" }` | CSS cursor over a control and elsewhere |
| `input` | `traceStepPx` | `number` | `32` | Reference px between two hit tests along the finger's path inside one frame of a trace. Keep it below the shortest cell span |
| `input` | `traceInset` | `number` | `0.4` | Radius of a trace cell's hit circle, times the short side of its hit box. A diagonal then crosses no corner of a neighbour |
| `assets` | `manifest` | `string \| Manifest \| undefined` | `undefined` | Manifest URL, or the parsed file in a test |
| `assets` | `textureBudgetMb` | `number` | `192` | Texture memory budget for the LRU unload |
| `assets` | `preloadDepth` | `number` | `2` | Graph edges walked for the preload at a rest node |
| `assets` | `baseUrl`, `io` | | `undefined` | The CDN seam and the fetch/decode/texture seam a test replaces. A bundle's own options are not config: its feature's `assets.ts` sets them, `defineBundles({ ep01: { tier: "feature", release: "leave", mipmaps: ["items/**"] } })` |
| `anim` | `maxTracks` | `number` | `2000` | Dev guard: one warning each time the running track count rises past it. Durations live in the steps, never here |
| `i18n` | `locale` | `string` | `"en"` | The locale at start |
| `i18n` | `fallback` | `string` | `"en"` | The locale a missing key is read from before it is reported missing |
| `i18n` | `locales` | `Record<string, module \| loader>` | `{}` | Compiled modules outside features, per locale. A sub-feature's modules are not here: the sub-feature registers them, and they travel with its bundle |
| `text` | `fonts` | `{ body, digits }` | `{ body: "ui.font-body", digits: "ui.font-digits" }` | The two boot fonts behind the built-in styles `body` and `digits` |
| `ui` | `tapTargetPt` | `number` | `44` | The smallest tap target `lint()` accepts |
| `ui` | `breakpoints` | `{ tall, wide }` | `{ tall: 2, wide: 1.5 }` | Aspect thresholds of the `when` style variants |
| `audio` | `buses` | `{ master, music, sfx }` | `{ master: 1, music: 0.6, sfx: 1 }` | Start gain of each bus, 0..1 |
| `audio` | `musicFadeMs` | `number` | `600` | Cross-fade of a music switch, in real milliseconds |
| `audio` | `sfxFadeMs` | `number` | `120` | Fade of a named sound (`sfx(key, { id })`), in real milliseconds, when a sound with its id replaces it or a stop names no `fadeMs` |
| `audio` | `volumes` | `(player) => Partial<Record<Bus, number>> \| undefined` | `undefined` | Reads the player's choice from the committed player on every `model:committed`. Absent: the buses stay at `buses` |
| `audio` | `context` | `() => AudioContext \| undefined` | `undefined` | The context factory, a test seam. Absent: `new AudioContext()` where the global exists |
| `audio` | `music` | `"decode" \| "stream"` | `"decode"` | How a music track plays. `"decode"`: one AudioBuffer, gapless loop, about 58 MB per 150 s track. `"stream"`: an `<audio>` element, about 12 MB, a loop gap of 5 to 49 ms in Chromium and about 0.4 s in WebKit. MP3 or AAC only |
| `audio` | `session` | `"ambient" \| "playback" \| "auto"` | `"ambient"` | What the page asks iOS for. `"ambient"` mixes with other apps and the silent switch mutes it. `"playback"` stops other apps and plays through the switch. A no-op where `navigator.audioSession` is missing |
| `effects` | `maxParticles` | `number` | `3000` | Live particles over every instance above which `effects:particle-budget` warns once per crossing |
| `effects` | `maxPasses` | `number` | `24` | Render passes per frame above which `effects:pass-budget` warns once per crossing |
| `effects` | `phone` | `boolean \| "auto"` | `"auto"` | Whether the device is a phone. `"auto"`: a coarse pointer and a short side of at most 820 CSS px, read once at start |
| `effects` | `blur` | `{ quality, phoneResolution }` | `{ quality: 2, phoneResolution: 0.5 }` | What a `Blur` with `quality: 0` and `resolution: 0` resolves to |
| `platform` | `provider` | `PlatformProvider \| undefined` | `undefined` | The engine page passes the system shell's provider when `config.ts` names `system` plugins. Absent: the plugin is inert and `back()` answers `"none"` |
| `platform` | `keepAwake` | `boolean` | `false` | Keep the screen on while the game runs; released while it is paused and on stop |

## config.ts of a game

Plain data that `satisfies GameConfig` of `@moku-labs/game/app`. `moku-game` and the page read it; the game logic never does.

```ts
// config.ts
import type { GameConfig } from "@moku-labs/game/app";

export default { page: { title: "mini-game" } } satisfies GameConfig;
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `page.title` | `string` | required | The page title. Never empty |
| `page.lang` | `string` | `"en"` | The `lang` of the page |
| `page.background` | `string` | `"#000000"` | The page behind the canvas, the `theme-color` meta and the native window. The canvas clear colour is `renderer.background` |
| `page.orientation` | `"portrait" \| "landscape" \| "any"` | `"portrait"` | The orientation the native build locks |
| `page.icons` | `{ favicon?, appleTouch? }` | `{}` | Icon files relative to the game, as `<link>` tags |
| `page.head` | `readonly string[]` | `[]` | Raw tags for `<head>`, verbatim |
| `page.boot` | `{ image, width?, fadeMs? }` | `undefined` | The boot picture: an `<img id="moku-boot">` centred over the canvas from the first paint, faded out after the first scene drew, then removed. `image` is a file relative to the game (required), `width` its CSS width (`"40vmin"`), `fadeMs` the fade (`300`; `0` removes it in that frame). Absent: the page shows only `page.background` until the first scene |
| `native` | `{ name, identifier, icon?, targets? }` | `undefined` | The native app. Absent: no native build |
| `system` | `readonly SystemName[]` | `[]` | `lifecycle`, `back`, `haptics`, `keepAwake`, `store`: the system plugins the shell wires |
| `save` | `"memory" \| "local" \| "store"` | `"memory"` | Where the player's save lives |
| `assets.layers` | `Record<string, string>` | `{}` | Asset layers by folder: `{ shared: "ui" }` |
| `debug.overlay` | `"closed" \| "pill" \| "open"` | `"closed"` | How the editor's overlay shows when a debug page starts: `"pill"` and `"open"` (the card) call `app.debug.overlay.open` right after the agents started. Only a page with the agent reads it |
