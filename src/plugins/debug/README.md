# debug

> Micro plugin — the editor's overlay from the game: `app.debug.overlay.open() / close() / toggle() / isOpen()`.

Every app has it, headless and screen, as it has `clock`: it is one of the core plugins of `createCore`. It has no
config, no state, no events and no `depends`.

## API

| Member | What it does | Answers |
|---|---|---|
| `app.debug.overlay.open(options?)` | Shows the overlay: the card by default, the small pill with `{ mode: "pill" }` | `true` when an overlay took the call |
| `app.debug.overlay.close()` | Hides it | `true` when an overlay took the call |
| `app.debug.overlay.toggle()` | Switches between hidden and the last visible mode | `true` when an overlay took the call |
| `app.debug.overlay.isOpen()` | Tells whether it shows, as the pill or the card | `true` while it shows |

```ts
// A game's own gesture: a long press on its logo opens the overlay of a debug build.
app.debug.overlay.toggle(); // true on `moku-game build --debug`; false on the store build, where nothing happens
app.debug.overlay.open({ mode: "pill" }); // true: the small pill
app.debug.overlay.isOpen(); // true
```

The ui tag `DebugTrigger()` is one helper on top of the call: five taps within three seconds of wall time on the
marked view call `app.debug.overlay.open()` (ui README, "Debug trigger"). A game that wants another gesture calls the
API itself, from anywhere the app is, without importing the editor.

### Where a call goes

Each member reads, at call time (the editor's page agent starts after the app):

1. `globalThis.__MOKU_GAME_OVERLAY__`, the channel the page agent sets when it starts and deletes when it stops
   (`open({ mode })`, `close`, `toggle`, `isOpen`). `open()` passes `{ mode: "card" }`.
2. Else the overlay of the released editor 0.10, `globalThis.editor.overlay` (`open`, `close`, `isOpen`, called with
   the overlay as `this`). It has no pill, so the mode is dropped; `toggle` closes an open overlay and opens a closed
   one. This fallback stays for this release.
3. Else the member answers `false`.

A channel member that throws is logged as `debug:overlay-failed` `{ call }` with the error, and the member answers
`false`.

### No agent, no overlay

Without the agent flag (`__MOKU_GAME_AGENT__`, set by `moku-game dev` and `moku-game build --debug`) every member is a
no-op answering `false`: a release build, a library test, `createHeadless`. No guard is needed in game code. Each
member calls the overlay only inside the inline agent guard, so a release bundle carries none of the bodies and no
`debug:overlay-failed` marker.

## Configuration

None. The mode a debug page starts in is the game's `config.ts` key `debug.overlay`:

| `debug.overlay` | What the page does after the agents started |
|---|---|
| `"closed"` (default) | nothing |
| `"pill"` | `app.debug.overlay.open({ mode: "pill" })` |
| `"open"` | `app.debug.overlay.open({ mode: "card" })` |

```ts
// config.ts of a game whose QA builds start with the pill shown:
export default { page: { title: "A Memory Missing" }, debug: { overlay: "pill" } } satisfies GameConfig;
```

Only a page with the agent reads it; another value is refused by `resolveConfig`.

## Reserved name

The plugin name `debug` is the engine's: a game plugin or a feature named `debug` is refused at `createApp` as a
duplicate name.
