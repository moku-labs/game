# lifecycle

> Standard plugin — the stack of reasons why the game is paused: the world stands while the stack is not empty, so two reasons never cancel each other's pause.

Anyone may push a reason: the renderer (hidden tab, device lost), the platform plugin (app in background, system dialog), the editor (tools). Each of them pops its own reason when it no longer holds, and the game runs again only when the last reason leaves.

The named reasons are `background`, `devtools`, `system-dialog` and `device-lost`; a game may push any other string.

```ts
const lifecycle = ctx.require(lifecyclePlugin);

lifecycle.push("background"); // time.pause()
lifecycle.push("devtools"); // still one pause
lifecycle.pop("background"); // still paused: devtools holds
lifecycle.pop("devtools"); // time.resume()
```

## API

| Method | Behaviour |
|---|---|
| `push(reason)` | Adds the reason to the end of the stack. A reason already on the stack is ignored: no state change, no `time` call, no event. The first reason on an empty stack calls `time.pause()`. Emits `lifecycle:changed`. |
| `pop(reason)` | Removes the reason. A reason that is not on the stack is ignored, the same way. When the stack becomes empty it calls `time.resume()`. Emits `lifecycle:changed`. |
| `reasons()` | A frozen copy of the stack, in insertion order. Later changes do not reach a copy already handed out. |
| `isPaused()` | True while the stack is not empty. |

## Configuration

None. The plugin has no tunable behaviour.

## Events

| Event | Payload |
|---|---|
| `lifecycle:changed` | `{ reason, action: "push" \| "pop", reasons: readonly PauseReason[], paused: boolean, resumed: boolean }` |

Emitted on every real change of the stack, never on an ignored duplicate push or an absent pop. `reason` and `action` say what changed, so a listener can react to `background` being pushed even when another reason already paused the game. `reasons` is a frozen snapshot of the whole stack after the change. `paused` is `reasons.length > 0`. `resumed` is true only on the change that emptied the stack — `flow` uses it to deliver `elapsed`.

```ts
hooks: ctx => ({
  "lifecycle:changed": ({ resumed }) => {
    if (resumed) deliverElapsed(ctx);
  }
});
```

## Doors

`control.ts` holds `game.pause` and `game.resume` (keys `pause` and `resume` in `commands`) of the
editor's write door, `@moku-labs/game/control`, dev builds only. They push and pop the reason
`devtools` and answer `isPaused()`, so after `game.resume` another reason, such as a hidden tab,
keeps its hold. Effect `cosmetic`, no input.

## Dependencies

`time`. It sits below lifecycle, so pausing it is a direct call — `time.pause()` and `time.resume()`, resolved once with `ctx.require(timePlugin)` — never an event (`spec/07-COMMUNICATION.md §5`: a lower plugin cannot hook a higher one's event). `lifecycle:changed` is for the plugins above: `flow`, `audio`.

`time.pause()` is called once, when the stack goes from empty to one reason; `time.resume()` once, when the last reason leaves.

## Lifecycle

None of `onInit`, `onStart` and `onStop` is used. The plugin owns no resource: the DOM visibility listeners belong to `renderer` and `platform`, which push reasons.
