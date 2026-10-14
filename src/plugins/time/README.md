# time

> Standard plugin — the one clock of the screen: a single `requestAnimationFrame` loop, six fixed frame phases, the `Time` resource, the measurement of an agent build and the native shell's frame rate. Emits `time:thermal`.

Nothing else in the engine calls `requestAnimationFrame`, `ticker.add`, `setTimeout` or `setInterval` for frame work. Every frame consumer registers a callback here. The frame never goes through the event bus: callbacks are direct function calls.

Every frame runs the six phases in this order:

| Phase | For |
|---|---|
| `input` | pointer and key state collected for this frame |
| `animate` | tweens, timelines, spring values |
| `layout` | measuring and placing nodes |
| `sync` | writing the model's view state to the scene |
| `signals` | the flow graph's frame slot (effect completions) |
| `render` | drawing |

Callbacks of one phase run in registration order. A callback registered during a frame runs from the next frame on. A throwing callback is caught, reported through `ctx.log.error("time: frame callback failed", { phase, error })`, and the remaining callbacks still run.

## API

| Method | Behaviour |
|---|---|
| `onFrame(phase, fn)` | Registers `fn` for `phase`; returns the unsubscribe function. `fn` receives the current `Readonly<Time>`. |
| `snapshot()` | A snapshot of the current `Time` — `{ delta, elapsed, scale, frame, idle }`, in scaled milliseconds. |
| `setScale(scale)` | Sets the time scale; every delta is multiplied by it. A negative value is clamped to 0; 0 freezes game time while frames keep running. |
| `pause()` / `resume()` | While paused no phase runs and `elapsed` does not advance. `resume` drops the stale timestamp, so the first frame after a pause has a normal delta. Called by `lifecycle`. |
| `isPaused()` | True while paused. |
| `isRunning()` | True while a real frame source drives the loop. False in plain Bun. |
| `wake()` | Resets the idle timer: the next frame runs at `maxFps` again. Cheap, idempotent, safe inside a frame. Called by `input` (a pointer sample), `anim` (a track starts), `flow` (an edge), `assets` (a load settles), `scenes` (a switch), `text` (a locale change), `ui` (a reconcile). |
| `step(deltaMs)` | Runs exactly one frame with the given unscaled delta, ignoring the fps cap, the pause flag and `maxDeltaMs`; the scale still applies. Throws when called from inside a frame callback. For tests and tools. |
| `measure(listener)` | Agent builds: hands `listener` what `time` measured of every frame, after `render` (see "Measuring a frame"). The unsubscribe; a second call does nothing. Without the flag the listener is never called. |
| `agentClock()` | Agent builds: the page clock for measurement (`performance.now()`); `undefined` otherwise. `world` times its systems with it. Never for game logic. |
| `chargeAgent(ms)` | For engine plugins. Agent builds: charges the editor's own work (its overlay, its page agent) to the frame running now, so the adaptive frame rate leaves it out. The renderer's monitor calls it when an agent span closes. Nothing otherwise. |

```ts
const time = ctx.require(timePlugin);
const off = time.onFrame("animate", t => advanceTweens(t.delta));

// in a test
app.time.step(16);
expect(app.time.snapshot().frame).toBe(1);
```

## Frame algorithm

The cap of a frame is `idleFps` while the screen is idle and `maxFps` otherwise. The first frame, and the first frame after a `resume`, counts as one capped frame (`1000 / cap`) instead of the gap to a stale timestamp. Otherwise the raw delta is `timestamp - lastTimestamp`. A frame that arrives earlier than `1000 / cap - 1` ms is skipped. The delta is clamped at `maxDeltaMs`, multiplied by `scale`, added to `elapsed`, and `frame` is increased before the phases run.

## Measuring a frame (agent builds)

In an agent build (`__MOKU_GAME_AGENT__`: dev pages and `--debug` builds) a frame with a measure
listener runs measured: the same callbacks in the same order with the same error report, plus eight
reads of the page clock (one before the first phase, one after each phase, one after the
listeners). The record is one object rewritten every frame, `FrameMeasure`:

| Field | Meaning |
|---|---|
| `frame`, `at` | `Time.frame`, and the start of the frame on the page clock: the `requestAnimationFrame` timestamp, or the moment `step()` began. |
| `gapMs` | `at` minus `at` of the previous measured frame; NaN for the first, the first after a `resume()`, and a stepped frame. |
| `capMs`, `rateMs` | `1000 / cap` of this frame (the idle cap included), and one frame of the loop's rate without the idle cap: `1000 / maxFps` (spec 21 makes it the adaptive rate). |
| `skipped` | Ticks the cap skipped since the previous measured frame. |
| `startMs`, `phaseMs`, `workMs` | The delay before the first phase (0 when stepped), the six phase durations, and `at` to the end of `render`. |
| `listenersMs` | What the measure listeners took in the frame before. |
| `idle`, `stepped` | The frame ran under the idle cap; it came from `step()`. |

`step()` frames are measured too, `stepped: true`. No allocation per frame. Without the flag the
listener list does not exist, the clock is never read and every frame runs as before; with the flag
and no listener the clock is not read either. `chargeAgent` spans are zeroed at the end of every
frame of the frame source, after the phases and the listeners; a stepped frame keeps them.

## On the native shell

On a page with `__MOKU_NATIVE__` of version 1 (the native shell of `@moku-labs/native`), `time`
asks the panel for `maxFps` at start (`display.setFrameRate(maxFps)`), so a 60 fps game does not
keep the panel at 120 Hz, and hands the request back at stop (`setFrameRate(null)`). Every build: it
is product behaviour, not measurement. A refused request is warned about once and the app runs on.
`src/plugins/time/native.ts` is the one reader of the global in the engine. In an agent build it
also holds the engine's one listener of the window event `moku-native:thermal` and emits
`time:thermal` with the normalized reading; the renderer's performance log writes it as a
`thermal` line. A browser page, and a build without the flag, add no listener.

## The idle cap

The loop counts unscaled time of the frame source since the last `wake()`. When `idleFps` is not 0 and that time passes `idleAfterMs`, the screen is idle: the cap drops to `idleFps` and `snapshot().idle` is true. The next `wake()` lifts it at once, and a `resume()` counts as a wake. The clock of the timer is unscaled, so `setScale(0)` does not stop the idle detection, and `step(deltaMs)` is never capped: a test drives its own frames.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `maxFps` | `30 \| 60 \| 120` | `60` | Frame rate cap. 30 for weak or hot devices. 120 only helps where the WebView delivers 120 Hz frames: Android today. WKWebView on iOS and macOS is capped at 60 by WebKit. |
| `maxDeltaMs` | `number` | `50` | Upper bound of one frame's delta, so a backgrounded tab does not produce a giant step. |
| `idleFps` | `0 \| 30` | `30` | Frame rate cap of an idle screen. `0` turns the idle cap off: every frame runs at `maxFps`. |
| `idleAfterMs` | `number` | `2000` | Unscaled milliseconds without a `wake()` after which the loop drops to `idleFps`. |

```ts
createApp({ pluginConfigs: { time: { maxFps: 30, idleFps: 0 } } });
```

## Events

| Event | Payload | When |
|---|---|---|
| `time:thermal` | `ThermalReading` (`{ status, headroom, at, android }`, a missing field `null`) | The native shell reported a thermal reading, in an agent build. Never per frame. |

Frame work is never an event.

## Lifecycle

`onStart` starts the loop when `globalThis.requestAnimationFrame` is a function, then asks the native shell for the frame rate and, on the shell in an agent build, adds the thermal listener. In plain Bun there is no frame source: nothing starts, `isRunning()` stays false and tests drive frames with `step`. `onStop` is `({ state }) => stopTime(state)`: it cancels the pending frame, hands the frame rate back to the shell and removes the thermal listener.

## Doors

`control.ts` holds `game.step` (key `step` in `commands`) and `game.timeScale` (key `timeScale`)
of the editor's write door, `@moku-labs/game/control`, dev builds only. Both are effect
`cosmetic`: the session stays clean.

- `game.step` — input `{ frames: "number", deltaMs: "number?" }`. It calls `step(deltaMs)`
  `frames` times, also while paused, with `deltaMs` 1000/60 by default, and answers `snapshot()`.
  `frames` must be a whole number of 0 or more, or it throws.
- `game.timeScale` — input `{ scale: "number" }`. It calls `setScale(scale)` and answers
  `snapshot()`. `scale` must be a finite number of 0 or more, or it throws: `setScale` clamps
  silently, the command refuses, so an editor slider cannot pass `NaN`. At 0 game time stands
  still while frames keep running, and `game.step` still steps.

```ts
// The editor slows a merge to a quarter speed.
(await run(app, commands.timeScale, { scale: 0.25 })).value.scale; // 0.25
```
