# time

> Standard plugin — the one clock of the screen: a single `requestAnimationFrame` loop, six fixed frame phases and the `Time` resource.

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

```ts
const time = ctx.require(timePlugin);
const off = time.onFrame("animate", t => advanceTweens(t.delta));

// in a test
app.time.step(16);
expect(app.time.snapshot().frame).toBe(1);
```

## Frame algorithm

The cap of a frame is `idleFps` while the screen is idle and `maxFps` otherwise. The first frame, and the first frame after a `resume`, counts as one capped frame (`1000 / cap`) instead of the gap to a stale timestamp. Otherwise the raw delta is `timestamp - lastTimestamp`. A frame that arrives earlier than `1000 / cap - 1` ms is skipped. The delta is clamped at `maxDeltaMs`, multiplied by `scale`, added to `elapsed`, and `frame` is increased before the phases run.

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

None. Frame work is never an event.

## Lifecycle

`onStart` starts the loop when `globalThis.requestAnimationFrame` is a function. In plain Bun there is no frame source: nothing starts, `isRunning()` stays false and tests drive frames with `step`. `onStop` is `({ state }) => stopLoop(state)`: it cancels the pending frame.
