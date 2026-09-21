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
| `scheduleAt(moment: number \| undefined): void` | Replaces the single pending due moment. `undefined` cancels it. A moment in the past is scheduled with a zero delay on the source, so it fires on the next macrotask, never synchronously. |
| `onElapsed(fn: (input: { now: number }) => void): () => void` | Registers a listener; returns the unsubscribe. `flow` is the listener: it puts `elapsed { now }` into its inbox. |
| `poke(): void` | Delivers `elapsed { now: now() }` to the listeners immediately, without touching the pending moment. `flow` calls it on resume from background. |
| `dueAt(): number \| undefined` | The pending due moment, for inspection and tests. |

When the timer fires, `dueAt` becomes `undefined` first, then every listener gets `{ now: now() }`.
The clock never reschedules by itself: after the catch-up edge the rules decide the next moment.

```ts
const clock = ctx.require(clockPlugin);

const off = clock.onElapsed(input => inbox.push({ type: "elapsed", now: input.now }));
clock.scheduleAt(rules.nextDue(player, tables));
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

A `ClockSource` is `now(): number`, `setTimer(fn, delayMs): unknown` and `clearTimer(handle): void`.

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
The plugin declares no `depends` and emits nothing.

## Lifecycle

- **onStart** registers the teardown disposer. No timer is created until `scheduleAt` is called;
  the disposer reads `state.handle` at stop time, because it does not exist yet at start.
- **onStop** runs `teardown.run(global, "clock")`, which clears the pending timer.
