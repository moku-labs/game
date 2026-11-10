# clock

> Standard plugin — trusted time as an input of the game: a monotonic `now()` and one `elapsed { now }` signal at the next due moment.

Time is an input, never a read inside logic. The clock answers `now()` and delivers ONE `elapsed`
signal when the moment the rules asked for arrives — there is no tick every second. Timers of the
game are moments stored in player state; how long is left is computed by pure rules.

`system.ts` is the only file of the logic set allowed to touch `Date.now` and `setTimeout` (lint
rule L3). Everything else, including `fake.ts`, goes through the `ClockSource` of the state.

## API

| Method | Behaviour |
|---|---|
| `now(): number` | `last = max(last, source.now())`, truncated to whole milliseconds. Monotonic non-decreasing: a device clock moved back cannot move game time back. |
| `scheduleAt(moment: number \| undefined): void` | Replaces the single pending due moment. `undefined` cancels it. A moment in the past is scheduled with a zero delay on the source, so it fires on the next macrotask, never synchronously. A delay longer than a platform timer keeps (2^31−1 ms, 24.8 days) is cut to it: the timer fires early and is armed again for the rest, one timer at a time. |
| `onElapsed(fn: (input: { now: number }) => void): () => void` | Registers a listener; returns the unsubscribe. `flow` is the listener: it puts `elapsed { now }` into its inbox. |
| `poke(): void` | Delivers `elapsed { now: now() }` to the listeners immediately, without touching the pending moment. `flow` calls it on resume from background. |
| `advance(ms: number): number` | Moves the clock forward by `ms`, a finite number above 0: a shift every later reading adds. A pending moment due after the move is delivered before the call returns, and forgotten; one still ahead is armed again for the rest of its wait. Answers `now()` after the move. 0, a negative or a number that is not finite throws `[game] clock.advance moves the clock forward, not by 0 ms.` The door `game.clock` calls it (F157): a visual test's frames move game time but not this clock. |
| `dueAt(): number \| undefined` | The pending due moment, for inspection and tests. |
| `pending(): number` | How many scheduled timers are not yet due: 1 while a moment is scheduled, else 0 (the clock holds one). A count, no allocation: the renderer's monitor reads it once a second in a debug build as a leak signal, a moment left scheduled after its screen closed. |
| `listeners(): number` | How many `onElapsed` listeners are registered. A count, no allocation: the renderer's monitor reads it once a second in a debug build as a leak signal, a screen that registers a listener on every visit and never removes it grows the count by one per visit; the remover takes it back down. |

When the timer fires, `dueAt` becomes `undefined` first, then every listener gets `{ now: now() }`.
The clock never reschedules by itself: after the catch-up edge the rules decide the next moment.

```ts
const clock = ctx.require(clockPlugin);

const off = clock.onElapsed(input => inbox.push({ type: "elapsed", now: input.now }));
clock.scheduleAt(rules.nextDue(player, tables));
```

`control.ts` holds `game.clock` (key `clock` in `commands`), input `{ advanceMs: "number" }`,
effect `cheat`: it calls `advance(advanceMs)` and answers `{ now }`. While `game.pause` holds, the
clock stands, and this command and `game.step` are the only things that move it (F169). A visual test writes it as the
step `{ clock: { advanceMs: 60_000 } }`, and a moment a rest node waits on arrives through the graph.

```ts
(await run(app, commands.clock, { advanceMs: 60_000 })).value; // { now: 1000060000 }
```

A node never touches the clock: it writes `await fx(schedule(rules.nextDue(player, tables)))` and
`flow`'s `schedule` effect handler calls `scheduleAt`.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `source` | `ClockSource \| undefined` | `undefined` | Time source. `undefined` means the system source of `system.ts`. Tests pass `fakeClock()`. |

```ts
createApp({ pluginConfigs: { clock: { source: fakeClock(1000) } } });
```

A `ClockSource` is `now(): number`, `setTimer(fn, delayMs): unknown` and `clearTimer(handle): void`. The plugin never asks `setTimer` for more than 2^31−1 ms, the most a platform timer keeps; the system source itself also waits a longer delay in steps, so no path hands `setTimeout` a delay that overflows.

## Testing

`fakeClock(start = 0)` — re-exported from `@moku-labs/game/testing` — is a `ClockSource` plus
`advance(ms)` and `set(moment)`. It owns its timer list and needs no real timer:

- `advance(ms)` moves the clock forward and fires every timer that falls due **synchronously**, in
  due order; timers due at the same moment fire in schedule order. A timer scheduled inside a
  callback fires in the same `advance` when it is due before the end of the window.
- A moment already in the past is scheduled with a zero delay, so it fires on the next `advance(0)`
  or `advance(n)` — that is the fake's macrotask.
- `set(moment)` jumps the clock without firing anything and may move it back, which is how a device
  clock set by hand is tested. `now()` stays put, because the high-water mark holds.

## Events

None. `elapsed` is an input of the graph, delivered through the listener registry, not a broadcast.
The plugin emits nothing.

## Dependencies and hooks

`depends: [lifecyclePlugin]`, for the hook only: no API is required. On `lifecycle:changed` the
clock stops while the stack holds `devtools` (the editor's `game.pause`, F169) and goes on when it
no longer does. While it stands, `now()` reads the moment it stopped at, no timer is armed and only
`advance` moves it: the doors `game.clock` and `game.step` (each stepped frame moves it by its
`deltaMs`, before the frame runs). A moment that comes due on an advance is delivered at once. On
resume it goes on from where it stood: the span it stood is folded into the shift, so it lags the
source by that span and keeps every advance; the pending moment is armed again. Any other reason,
such as `background`, leaves the clock on the source, so real-time timers (energy refills) see the
time that passed. The clock sits before `flow`, so its hook runs first and the resume poke of
`flow` reads the clock that goes on again.

## Lifecycle

- No `onStart`. No timer is created until `scheduleAt` is called.
- **onStop** is `({ state }) => cancelPending(state)`: it clears the pending timer and forgets the
  due moment, so `dueAt()` reports nothing after a stop.
