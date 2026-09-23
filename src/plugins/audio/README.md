# audio

> Standard plugin — sound is never an object a node holds. A sound is a descriptor a node awaits, music is a declaration of the scene, and the volumes are what the player committed. Opt-in: a game composes `[...screen, audio]`.

```ts
// features/orders/deliver.ts — the sound sits on the edge, next to the commit
export const deliver = defineNode({
  scene: "board",
  outcomes: { claimed: type<{ orderId: string }>() },
  run: async ({ fx, out, input }) => {
    fx(sfx("orders.complete")); // resolves when the sound STARTED, not when it ended
    await fx(popup(RewardPopup, { reward }));

    return out.claimed({ orderId: input.orderId });
  }
});

// features/board/view/scene.ts — music is declared, never started by a call
export const boardScene = defineScene("board", { bundle: "board", music: "board.theme", layers: {}, projections: [] });

// web/main.ts — the buses follow the committed player
createApp({
  plugins: [...screen, audio, settingsFeature],
  pluginConfigs: { audio: { volumes: player => player.settings.audio } }
});
```

## The two effect kinds

| Kind | Built by | Behaviour |
|---|---|---|
| `sfx` | `anim`'s `sfx(key, { bus? })` | A new `AudioBufferSourceNode` per play into its bus. Two plays in one frame are heard twice. The promise resolves when `start()` was called; the handler's `signal` is ignored, because a sound that began plays to its end |
| `music` | `music(key \| null, { fadeMs? })` of this plugin | One looping source on its own gain into the `music` bus. The same key does nothing, a new key cross-fades, `null` fades out. A key still decoding counts as the same key; any other request replaces it, and the replaced switch starts nothing |

Both handlers are registered with `{ runInFast: false }`: a fast walk never waits for a sound. A game without `audio` has no handler for either kind, and `flow` resolves the effect with `undefined` at once — so the same node code runs in a game that carries no audio at all.

## Volumes come from the player, not from a call

The settings node commits `player.settings.audio`; on every `model:committed` this plugin reads `config.volumes(player)` and applies the buses it names. There is no intent plumbing and no `audio` in a node's context: what the player chose is saved with the player, and a reload applies it before the first scene.

`setVolume`, `volume` and `mute` stay for tests and dev tools. With `volumes` configured, the next commit overwrites what `setVolume` set.

## Config

| Key | Default | Meaning |
|---|---|---|
| `buses` | `{ master: 1, music: 0.6, sfx: 1 }` | Start gain of each bus, 0..1 |
| `musicFadeMs` | `600` | Cross-fade of a music switch, in real milliseconds |
| `volumes` | `undefined` | Reads the player's choice from the committed player. Absent: the buses stay at `buses` |
| `context` | `undefined` | Context factory, the test seam. Absent: `new AudioContext()` where the global exists |
| `journal` | `0` | How many started sounds `journal()` keeps. `0`: off |

## The graph and the clock

`master` goes into `context.destination`, `music` and `sfx` into `master`, and a music track has its own gain into `music`. Every change is `gain.setValueAtTime(current, now)` then `gain.linearRampToValueAtTime(target, now + seconds)` on the **context** clock, never on `time`: a paused game must not freeze a fade-out, and a fade is not game state. The one edge to `time` is the stamp of the journal.

## The journal

With `journal` above 0 every sound that started is kept in a ring of that size: each `sfx` play and each music track that began, as `{ key, bus, kind, at }`, where `at` is `app.time.snapshot().elapsed`. A sound dropped before the unlock, a missing file and a switch to the track that already plays leave no entry. `app.audio.journal()` returns the list itself, oldest first: it is frozen, and every new sound replaces it with a new frozen list, so a list read earlier never changes. `onStop` resets it to a frozen empty list. Tests and the dev page set `journal: 200`.

```ts
app.audio.journal(); // [{ key: "orders.complete", bus: "sfx", kind: "sfx", at: 1600 }]
```

## The unlock

A browser starts every context suspended. `onStart` puts one `pointerdown` and one `touchend` listener on `window` (`once`, `passive`); the first of them removes both and resumes the context. `unlocked()` turns true only when the context really reached `"running"`, and a refused resume warns once and puts the listeners back, so the next gesture tries again. The listeners sit on `window`, not on the canvas: the gesture may as well be a button of the game's loading page, which `input` never sees. Music a scene declared while the context was locked is remembered and started by that first gesture. When the same tap also enters a scene with the same track, the track starts once: the second request finds the first still decoding and does nothing. A sound effect requested while that resume is still pending — the click of the very button that unlocks the context — is queued, one per key, and played as soon as the context runs; a refused resume drops the queue.

## Pause and iOS

`lifecycle:changed` holds every bus at zero on a push and puts the stored volumes back on a pop — a bus muted by `mute` stays muted. When the pause ends and the context is `"suspended"` or `"interrupted"` (Safari, after a call or the lock screen), it is resumed; a refusal re-installs the unlock listeners.

## Memory

`assets.audio(key)` gives the undecoded bytes; this plugin decodes once per key with `decodeAudioData` and caches the promise, so two plays in flight decode a single time. `assets:bundle-unloaded` names its keys, and exactly those are evicted. A missing or undecodable key is one `ctx.log.warn` per key and the effect resolves: a broken sound never stops the graph. Music is buffered, not streamed — streamed music is a backlog item.

## Headless

Without a context (plain Bun, no `AudioContext`) both handlers are still registered, so every `await fx(sfx(…))` resolves at once. Every member keeps its state and does nothing: `setVolume` stores, `volume` reads it back, `mute` stores the flag, `unlocked()` is `false`. The hooks write state only — `model:committed` still updates the stored volumes, and the scene's music key is still remembered.

## Doors

`inspect.ts` holds `game.sounds` (key `sounds` in `sources`) of the editor's read door,
`@moku-labs/game/inspect`, safe in a production build. Input `{ last: "number?" }`: it reads
`journal()`, all of it or the last `last` entries, and is read again every frame
(`changes: "frame"`). Empty unless `journal` is above 0.

## Events

None. `audio` answers descriptors and hooks; nothing above it needs to know that a sound played.
