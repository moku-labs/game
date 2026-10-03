# platform

> Standard plugin — the phone is a provider. A game passes a `PlatformProvider`; the plugin turns its pause and resume into the `"background"` reason of `lifecycle`, its Back press into the Back chain, the `haptic` effect into a tick, and `keepAwake: true` into a screen that stays on while the game runs. Opt-in and last in the array: `[...screen, effectsPlugin, audioPlugin, platformPlugin]`.

```ts
// app.ts, the application layer: the bridge is the game's, the engine never imports a native package
import { createApp, screen, effectsPlugin, audioPlugin, platformPlugin } from "@moku-labs/game";
import { fromSystem } from "./platform-bridge";

export const app = createApp({
  plugins: [...screen, effectsPlugin, audioPlugin, platformPlugin, ...features],
  pluginConfigs: { platform: { provider: fromSystem(system), keepAwake: true } }
});

// a node or an animation, the same on the web and in the shell
await fx(haptic("success"));                                   // flow effect, handled here
defineAnimation("board.merge", { slots: {}, build: () => sequence(tween(...), haptic("light")) });
```

## The provider

Six members. The engine owns the type; a game fills it, usually from `@moku-labs/system`. Every `on*` returns its remover, and the plugin calls each remover on stop.

| Member | What the plugin does with it |
|---|---|
| `onPause(fn)` | `fn` pushes `"background"` on `lifecycle`. `renderer` pushes the same reason on `visibilitychange`; `lifecycle` dedupes, so one pause. On iOS the provider's pause comes about 1.5 s earlier |
| `onResume(fn)` | `fn` pops `"background"` |
| `onBack(fn)` | `fn` runs the Back chain below and returns `true`: the engine took the press, so the provider does not run its own default (Android: leave the app) |
| `haptic(kind)` | Called with one of the seven `HAPTIC_KINDS` of `anim`: `light`, `medium`, `heavy`, `selection`, `success`, `warning`, `error` |
| `keepAwake(on)` | `true` on start and on every resume, `false` on a push that pauses and on stop. Only with `keepAwake: true` in config |
| `exit()` | The last step of the Back chain |

A provider method that throws is caught and logged with `ctx.log.error("platform: the provider failed", { method })`; it never throws into the frame. A failed `keepAwake` leaves the plugin's flag where it was.

## The Back chain

One press, three steps; the first step that takes the press wins.

| Step | Test | `back()` returns |
|---|---|---|
| 1 | `input.pressKey("Escape")` is true: ui tapped the `escape` button of its top root | `"popup"` |
| 2 | `flow.gate.answer({ intent: "back" })` is true: the resting node lists `back` | `"intent"` |
| 3 | nothing took it: `provider.exit()` | `"exit"` |

Without a provider `back()` presses nothing and returns `"none"`. Every popup with an `escape` button closes on Back for free. Escape also ends the editing of a ui text field, so a press while a field is edited ends the edit and answers `"popup"`. A game that wants a confirm on Home lists `back` on its home node and opens the popup there; step 3 is then never reached from Home.

```ts
const home = defineNode({ rest: true, outcomes: { play: type(), back: type() } }); // Back asks first

app.platform.back(); // "intent": Home rests and lists "back"
```

## Haptics

`haptic(kind)` is `anim`'s: a descriptor a node awaits with `fx(...)` and a step a timeline reaches through `flow.fx.dispatch`. This plugin registers the handler of the kind `"haptic"` on start, with `runInFast: false`: a fast walk is silent. The handler resolves at once. The payload is plain JSON, so the kind is checked against `HAPTIC_KINDS` before it reaches the provider; an unknown or missing kind plays nothing and, in a dev build (`__MOKU_GAME_DEV__`), warns once per kind with `platform: unknown haptic kind`.

## Config

| Key | Default | Meaning |
|---|---|---|
| `provider` | `undefined` | The provider. Absent: the plugin is inert, as on the web without a bridge and in headless tests |
| `keepAwake` | `false` | Keep the screen on while the game runs |

## Inert without a provider

No subscription, no haptic handler, no keep-awake: a `haptic` effect has no handler, so `flow` resolves it at once and the same node code runs on the web. `back()` answers `"none"`.

## Lifecycle

`onStart` subscribes to the provider, registers the haptic handler and, with `keepAwake` and the game not paused, keeps the screen on. `onStop` calls every remover in that order, then lets the screen sleep when it was kept on. The `lifecycle:changed` hook acts only between the two.

## Dependencies

`lifecycle` (`push`, `pop`, `isPaused`, the hook), `flow` (`gate.answer`, `fx.handle`), `input` (`pressKey`). All three sit below `platform` in the array. No package dependency: lint rule L13 refuses `@moku-labs/system`, `@moku-labs/native` and `@tauri-apps/*` anywhere under `src/`.

## Events

None. The pause travels as `lifecycle:changed`; Back as an Escape press or a gate answer.
