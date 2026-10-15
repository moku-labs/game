# time

> Standard plugin — the one clock of the screen: a single `requestAnimationFrame` loop, six fixed frame phases, the `Time` resource, the measurement of an agent build, the adaptive frame rate and the native shell's frame rate. Emits `time:thermal` and `time:rate`.

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
| `wake()` | Resets the idle timer: the next frame runs at the loop's rate again. Cheap, idempotent, safe inside a frame. Called by `input` (a pointer sample), `anim` (a track starts), `flow` (an edge), `assets` (a load settles), `scenes` (a switch), `text` (a locale change), `ui` (a reconcile). |
| `wakes()` | How many wakes the clock has had since the app started, `resume` included; it only grows. The renderer compares two readings and draws the frame after any wake, a safety net of `renderer.onDemand`. `step` does not count. |
| `step(deltaMs)` | Runs exactly one frame with the given unscaled delta, ignoring the fps cap, the pause flag and `maxDeltaMs`; the scale still applies. Throws when called from inside a frame callback. For tests and tools. |
| `measure(listener)` | Agent builds: hands `listener` what `time` measured of every frame, after `render` (see "Measuring a frame"). The unsubscribe; a second call does nothing. Without the flag the listener is never called. |
| `agentClock()` | Agent builds: the page clock for measurement (`performance.now()`); `undefined` otherwise. `world` times its systems with it. Never for game logic. |
| `chargeAgent(ms)` | For engine plugins. Agent builds: charges the editor's own work (its overlay, its page agent) to the frame running now, so the adaptive frame rate leaves it out. The renderer's monitor calls it when an agent span closes. Nothing otherwise. |
| `rate()` | The loop's frame rate: `{ fps, mode, reason, displayHz, ladder, thermal }` (`Time.FrameRate`). One frozen object, the same until something in it changes: cheap to read every frame. |
| `setRate(choice)` | `"auto"`, 30, 60 or 120. A number forces the cap (never above `maxFps`); the adaptive rule and the heat leave it alone. `"auto"` gives the rate back: the top of the ladder (a step lower under heat), or `maxFps` without `adaptive`. An equal choice changes nothing. Answers `rate()`; anything else throws `[game] time.setRate takes "auto", 30, 60 or 120.` |
| `frameDrawn()` | For engine plugins: the renderer's `render` phase reports a frame Pixi drew. Only drawn frames count for the adaptive rate. One assignment; a stepped frame forgets it. |
| `frameProbed()` | For engine plugins: the frame also drew warm-up probes. It is drawn, but never a sample of the adaptive rate. One assignment; a stepped frame forgets it. |

```ts
const time = ctx.require(timePlugin);
const off = time.onFrame("animate", t => advanceTweens(t.delta));

// in a test
app.time.step(16);
expect(app.time.snapshot().frame).toBe(1);
```

## Frame algorithm

The cap of a frame is `idleFps` while the screen is idle (never above the rate) and the loop's rate, `rate().fps`, otherwise: `maxFps` unless `adaptive` or `setRate` changed it. The first frame, and the first frame after a `resume`, counts as one capped frame (`1000 / cap`) instead of the gap to a stale timestamp. Otherwise the raw delta is `timestamp - lastTimestamp`. A frame that arrives earlier than `1000 / cap - slack` is skipped. The slack is half a display period when one frame of the cap is a whole number of display periods (8.3 ms for a 60 cap on a 60 Hz panel, 4.2 ms on a 120 Hz one), so vsync jitter (15.6–17.8 ms ticks at 60 Hz) never drops a frame and a tick one period early is still skipped. When the cap falls between two vsyncs it is 1 ms: a 144 Hz panel under a 60 cap runs every third tick, 48 fps, as before. Until the display rate is known the slack is 12 % of the frame, at least 1 ms (2 ms at 60). The delta is clamped at `maxDeltaMs`, multiplied by `scale`, added to `elapsed`, and `frame` is increased before the phases run.

## Measuring a frame (agent builds)

In an agent build (`__MOKU_GAME_AGENT__`: dev pages and `--debug` builds) a frame with a measure
listener runs measured: the same callbacks in the same order with the same error report, plus eight
reads of the page clock (one before the first phase, one after each phase, one after the
listeners). The record is one object rewritten every frame, `FrameMeasure`:

| Field | Meaning |
|---|---|
| `frame`, `at` | `Time.frame`, and the start of the frame on the page clock: the `requestAnimationFrame` timestamp, or the moment `step()` began. |
| `gapMs` | `at` minus `at` of the previous measured frame; NaN for the first, the first after a `resume()`, and a stepped frame. |
| `capMs`, `rateMs` | `1000 / cap` of this frame (the idle cap included), and one frame of the loop's rate without the idle cap: `1000 / rate().fps`, from the frame a switch happens in. |
| `displayMs` | One display period, `1000 / rate().displayHz`; NaN until the display rate is known. No frame comes sooner, so a spike budget is `max(rateMs, displayMs)`. |
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
asks the panel for the loop's rate at start and on every change of it
(`display.setFrameRate(rate().fps)`), so a 60 fps game does not keep the panel at 120 Hz, and hands
the request back at stop (`setFrameRate(null)`). Every build: it is product behaviour, not
measurement. A refused request is warned about once and the app runs on. With `adaptive` the
answer's `maxHz` (and `display.maxHz` once the shell is `ready`) is the display rate; `panelHz`, the
rate set now, is only logged. `src/plugins/time/native.ts` is the one reader of the global in the
engine. In an agent build, or with `adaptive`, it also holds the engine's one listener of the window
event `moku-native:thermal` and emits `time:thermal` with the normalized reading; the renderer's
performance log writes it as a `thermal` line, and the adaptive rule reads the status. A browser
page, and a build with neither, add no listener.

## The idle cap

The loop counts unscaled time of the frame source since the last `wake()`: each frame adds its raw gap, at most `idleAfterMs` (not the delta clamped at `maxDeltaMs`), so a page the browser throttles to 1 Hz goes idle after two seconds, not forty. When `idleFps` is not 0 and that time passes `idleAfterMs`, the screen is idle: the cap drops to `idleFps` and `snapshot().idle` is true. The next `wake()` lifts it at once, and a `resume()` counts as a wake. The clock of the timer is unscaled, so `setScale(0)` does not stop the idle detection, and `step(deltaMs)` is never capped: a test drives its own frames.

## Adaptive frame rate

With `time: { maxFps: 120, adaptive: { floor: 60 } }` the loop runs at the highest divisor of the
display's refresh rate at or below `maxFps`, and moves between the divisors by itself. Off by
default: without `adaptive` the cap is `maxFps` unless the game calls `setRate`.

**The ladder** is the divisors `displayHz / k` between `floor` and `maxFps`, highest first: a
120 Hz panel gives `[120, 60]`, a 60 Hz one `[60]`, a 144 Hz monitor `[72]` (not the uneven 120 of
a cap that is no divisor), 240 Hz `[120, 80, 60]`, 90 Hz with `floor: 30` `[90, 45, 30]`. When no
divisor reaches the floor the highest one at or below `maxFps` stands alone, and the rule has
nothing to choose. Known limit: a 90 Hz panel with `floor: 60` has the ladder `[90]` and stays at 90.

**The display rate** comes from the ticks of the frame source, the ones the cap skips included (at
60 on a 120 Hz panel they are still 8.3 ms apart): a window of 120 ticks votes for the highest
rate with a quarter of them. Every app learns it, adaptive or not: without `adaptive` the window is
30 ticks while the rate is unknown (half a second at 60 Hz), so `rate().displayHz`, the cap's
slack and the monitor's `displayMs` know the panel early; the ladder stays empty. A higher rate is learned at once, a lower one after two windows (a
battery saver), never from a panel the shell holds at 60 on our own request. On the native shell
`maxHz` teaches it at once. No decision is made before it is known, about a second at start, which
keeps the boot's long frames out. A rising display rate never raises the rate by itself.

**A sample** is the interval between two frames of the frame source after a frame the renderer
drew (`frameDrawn()`). Not a sample: a still screen under `onDemand`, a frame under the idle cap, a
warm-up frame (`frameProbed()`), an interval over 500 ms (the page was away), the first interval
after a switch and after a `resume()`, a forced rate. A stepped frame never feeds the rule.

**Down** one step when, over the drawn intervals of the last second, the late ones reach
`max(8, ceil(10 %))`. Late is past `1000 / fps + 500 / displayHz`: at 120 on a 120 Hz panel a frame
that took two vsyncs (16.7 ms) is late, at 60 one that took three (25 ms). The p90 of the window is
over the line exactly when more than a tenth of it is: counting needs no sort. A full second at 120
needs 12 late intervals, a short tap animation of 30 drawn frames needs 8, a mount hitch of one to
three long frames never drops it. Never below `floor`.

**Up** one step, never more, when the dwell since the last switch has passed (5 s at first), the
last three seconds hold at least 90 drawn frames, at most one late interval, at most a tenth of
heavy frames, and the shell reports no heat. At the lower rate every interval is on time when the
work fits the longer frame, so the rule reads the work instead: a frame is heavy when its main-thread
work (from its start to the end of its `render` phase, never after the measure listeners) is over
half of the higher rate's frame, 4.17 ms toward 120. No GPU time is an input: a store build has no
GPU timer, and GPU ms rises at 60 against 120 on a phone that clocks its GPU down. The return is a
probe judged by the drop rule on its own intervals: a drop within 10 s of a return is a failed
return and doubles the dwell (5, 10, 20, 40, 80, then 120 s at most); a returned rate held for 60 s
resets it to 5 s at the next drop. A GPU-bound screen whose JS is light costs one short probe per
dwell. The windows are emptied at every switch, so evidence of one rate never judges another. In an
agent build the overlay's own span (`chargeAgent`) is left out of a frame's work, but it stays in
the frame interval: force the rate with `game.frameRate` for a clean A/B run.

**Heat.** On the native shell the thermal status `moderate` drops one step at once, `severe` and
above drop to the floor, and both block every return while they last. A status that falls back
returns nothing by itself: the return rule decides. A forced rate stays.

**Every switch** emits `time:rate` (`Time.RateChange`: `from`, `to`, `reason`, `mode`, `displayHz`,
`thermal`, the `window` evidence and the `dwellMs`), logs `time: frame rate` with `{ from, to,
reason }`, asks the shell for the new panel rate and, in an agent build, is a `rate` line of the
renderer's performance log.

**Off in a headless app and on a fake clock**: `defineGameApp` writes `adaptive: false` for both,
so a test runs as it always did; the page passes the device clock and keeps the game's
`adaptive`. Bun has no `requestAnimationFrame`, so no tick ever reaches the rule there.

**The cost**: a few comparisons per tick and one clock read per run frame; every number lives in
one governor allocated at `createApp` (typed arrays for the ring of 512 samples), so a frame
allocates nothing. Only a switch allocates: its payload, the snapshot, the request.

```ts
// index.ts of the game: 120 where the phone holds it, 60 where it does not.
export default defineGameApp({
  flow: mainFlow,
  player,
  session,
  pluginConfigs: { time: { maxFps: 120, adaptive: { floor: 60 } } }
});

app.time.rate(); // { fps: 60, mode: "auto", reason: "missed", displayHz: 120, ladder: [120, 60], thermal: "none" }
app.time.setRate(60); // the player's "60": forced until setRate("auto")
```

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `maxFps` | `30 \| 60 \| 120` | `60` | Frame rate cap, the top of the ladder with `adaptive`. 30 for weak or hot devices. 120 only helps where the WebView delivers 120 Hz frames: Android today. WKWebView on iOS and macOS is capped at 60 by WebKit. |
| `maxDeltaMs` | `number` | `50` | Upper bound of one frame's delta, so a backgrounded tab does not produce a giant step. |
| `idleFps` | `0 \| 30` | `30` | Frame rate cap of an idle screen. `0` turns the idle cap off: every frame runs at `maxFps`. |
| `idleAfterMs` | `number` | `2000` | Unscaled milliseconds without a `wake()` after which the loop drops to `idleFps`. |
| `adaptive` | `false \| { floor: 30 \| 60 }` | `false` | Adaptive frame rate between `maxFps` (or the display) and `floor`; see "Adaptive frame rate". Any other value, and a floor above `maxFps`, throws at `createApp`. |

```ts
createApp({ pluginConfigs: { time: { maxFps: 30, idleFps: 0 } } });
```

## Events

| Event | Payload | When |
|---|---|---|
| `time:thermal` | `ThermalReading` (`{ status, headroom, at, android }`, a missing field `null`) | The native shell reported a thermal reading, in an agent build or with `adaptive`. Never per frame. |
| `time:rate` | `RateChange` (`{ from, to, reason, mode, displayHz, thermal, window, dwellMs }`) | The loop's frame rate or its mode changed: the adaptive rule, the display, the heat or `setRate`. Never per frame, never at start. |

Frame work is never an event.

## Lifecycle

`onStart` starts the loop when `globalThis.requestAnimationFrame` is a function, then, on the native shell, asks it for the loop's rate and adds the thermal listener (in an agent build or with `adaptive`); with `adaptive` it also reads the shell's `maxHz` and its thermal status once. In plain Bun there is no frame source: nothing starts, `isRunning()` stays false and tests drive frames with `step`. `onStop` is `({ state }) => stopTime(state)`: it cancels the pending frame, hands the frame rate back to the shell and removes the thermal listener. `resume()` restarts the adaptive rule's windows and tick history.

## Doors

`control.ts` holds `game.step` (key `step` in `commands`), `game.timeScale` (key `timeScale`)
and `game.frameRate` (key `frameRate`) of the editor's write door, `@moku-labs/game/control`, dev
and debug builds. All three are effect `cosmetic`: the session stays clean.

- `game.step` — input `{ frames: "number", deltaMs: "number?" }`. It calls `step(deltaMs)`
  `frames` times, also while paused, with `deltaMs` 1000/60 by default, and answers `snapshot()`.
  `frames` must be a whole number of 0 or more, or it throws.
- `game.timeScale` — input `{ scale: "number" }`. It calls `setScale(scale)` and answers
  `snapshot()`. `scale` must be a finite number of 0 or more, or it throws: `setScale` clamps
  silently, the command refuses, so an editor slider cannot pass `NaN`. At 0 game time stands
  still while frames keep running, and `game.step` still steps.

- `game.frameRate` — input `{ fps: "number?" }`. It calls `setRate(fps)`, or `setRate("auto")`
  without `fps`, and answers `rate()`. For an A/B run on the phone: the same screen at 120 and at
  60. A wrong `fps` is refused by `setRate`.

```ts
// The editor slows a merge to a quarter speed.
(await run(app, commands.timeScale, { scale: 0.25 })).value.scale; // 0.25
// An A/B run of the memory screen at 60, then the rate back to the config.
(await run(app, commands.frameRate, { fps: 60 })).value.fps; // 60
(await run(app, commands.frameRate, {})).value.mode; // "auto"
```
