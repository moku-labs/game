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
| `music` | `music(key \| null, { fadeMs? })` of this plugin | One looping track on its own gain into the `music` bus: a buffer source at `music: "decode"`, an `<audio>` element at `music: "stream"`. The same key does nothing, a new key cross-fades, `null` fades out. A key still on its way counts as the same key; any other request replaces it, and the replaced switch starts nothing |

Both handlers are registered with `{ runInFast: false }`: a fast walk never waits for a sound. A game without `audio` has no handler for either kind, and `flow` resolves the effect with `undefined` at once — so the same node code runs in a game that carries no audio at all.

## Volumes come from the player, not from a call

The settings node commits `player.settings.audio`; on every `model:committed` this plugin reads `config.volumes(player)` and applies the buses it names. There is no intent plumbing and no `audio` in a node's context: what the player chose is saved with the player, and a reload applies it before the first scene.

`setVolume`, `volume`, `mute` and `muted` stay for tests and dev tools. `muted(bus)` answers the stored flag; a pause does not change it. With `volumes` configured, the next commit overwrites what `setVolume` set.

## Config

| Key | Default | Meaning |
|---|---|---|
| `buses` | `{ master: 1, music: 0.6, sfx: 1 }` | Start gain of each bus, 0..1 |
| `musicFadeMs` | `600` | Cross-fade of a music switch, in real milliseconds |
| `volumes` | `undefined` | Reads the player's choice from the committed player. Absent: the buses stay at `buses` |
| `context` | `undefined` | Context factory, the test seam. Absent: `new AudioContext()` where the global exists |
| `journal` | `0` | How many started sounds `journal()` keeps. `0`: off |
| `music` | `"decode"` | How music plays: `"decode"` (one buffer per track, gapless) or `"stream"` (a media element, far less memory, a gap at every loop). See Memory |
| `session` | `"ambient"` | What the page asks iOS for: `"ambient"`, `"playback"` or `"auto"`. See The audio session |

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

At `music: "stream"` the push also pauses the playing element once the gains are at zero, so a backgrounded game burns no decoder and shows no Now Playing card. The pop that ends the pause plays it again; a refused `play()` is one warning per key and the track stays as it is, the next switch replaces it. A track still fading out is left to its timer.

## The audio session

`onStart` writes `session` on `navigator.audioSession.type` first, before the context exists, and `onStop` writes `"auto"` back. Only WebKit has the object (Safari and Tauri iOS); everywhere else nothing happens and nothing is logged. A setter that refuses the type is one `ctx.log.warn`.

| `session` | Other apps (Spotify) | Silent switch |
|---|---|---|
| `"ambient"` | keep playing, mixed | mutes the game |
| `"playback"` | stop | the game plays through it |
| `"auto"` | WebKit picks: Web Audio alone is ambient, an audible element is playback | as picked |

Why it is set at all: WebKit moves a page to the playback category the moment an audible element plays, so streamed music would stop the player's own music and ignore the switch. The default `"ambient"` keeps today's behaviour for both modes. In Tauri iOS it is the only lever that reaches page audio: the app's own `AVAudioSession` does not govern the web view.

## Memory

`assets.audio(key)` gives the undecoded bytes and their MIME type; this plugin decodes once per key with `decodeAudioData` and caches the promise, so two plays in flight decode a single time. `assets:bundle-unloaded` names its keys, and exactly those are evicted. `assets:replaced` (dev hot swap) evicts its keys the same way, so the next play of a swapped sound decodes the new bytes; a sound or a track that is playing is not stopped and keeps the old ones. A missing or undecodable key is one `ctx.log.warn` per key and the effect resolves: a broken sound never stops the graph. Sounds always decode; `music` picks how a music track plays.

| | `music: "decode"` (default) | `music: "stream"` |
|---|---|---|
| What plays | one `AudioBufferSourceNode`, `loop = true` | one `<audio>` element on a `blob:` URL of the bytes, through `createMediaElementSource` into the track gain |
| Memory per 150 s track at 48 kHz | about 58 MB decoded, plus about 60 MB once for the first | about 12 MB |
| Cross-fade | two decoded buffers | two elements, about +6 MB |
| Loop | gapless | a gap at every loop: 5 to 49 ms in Chromium, about 0.4 s in WebKit |
| iOS silent switch under `session: "auto"` | respects it | ignores it; the default `"ambient"` makes it respect it |
| Formats | every format the browser decodes | MP3 or AAC (`.mp3`, `.m4a`) only: WebM Opus is silent through a media element in WebKit (bug 276813) |

A game with a tight loop keeps `"decode"`; a game with a three-minute track takes `"stream"` and a track that tolerates a seam. A runtime with WebAudio but no `Audio` constructor plays the track by the decode path and warns once per key.

At `"stream"` every level goes through the track gain, never `element.volume`, which iOS ignores. The fades start when `play()` fulfilled; a refused `play()` (autoplay policy, decoder error) is one warning per key, the old track plays on, and the key is tried again on the next switch. An element has no `stop(when)` on the context clock, so a fading track is freed by a timer when its fade ends: paused, disconnected, unloaded and its URL revoked. A playing streamed track survives `assets:bundle-unloaded`: the Blob copied the bytes, and its URL is revoked when the track is freed, not at unload.

## Headless

Without a context (plain Bun, no `AudioContext`) no element and no URL is ever made, and both handlers are still registered, so every `await fx(sfx(…))` resolves at once. Every member keeps its state and does nothing: `setVolume` stores, `volume` reads it back, `mute` stores the flag, `muted` reads it back, `unlocked()` is `false`. The hooks write state only — `model:committed` still updates the stored volumes, and the scene's music key is still remembered.

## Doors

`inspect.ts` holds `game.sounds` (key `sounds` in `sources`) of the editor's read door,
`@moku-labs/game/inspect`, safe in a production build. Input `{ last: "number?" }`: it reads
`journal()`, all of it or the last `last` entries, and is read again every frame
(`changes: "frame"`). Empty unless `journal` is above 0.
Without `audioPlugin` in the app it throws `[game] The source game.sounds needs audioPlugin.`

`inspect.ts` also holds `game.audioMuted` (key `audioMuted` in `sources`). No input, read every
frame: it answers `muted("master")`. Without `audioPlugin` it throws
`[game] The source game.audioMuted needs audioPlugin.`

`control.ts` holds `game.mute` (key `mute` in `commands`) of the editor's control door,
`@moku-labs/game/control`, dev builds only. Input `{ muted: "boolean" }`, effect `cosmetic`: it
calls `mute("master", muted)`, so music and sfx both go silent and the stored volumes stay. Value:
`muted("master")` after the write. Without `audioPlugin` it throws
`[game] The command game.mute needs audioPlugin.`

## Events

None. `audio` answers descriptors and hooks; nothing above it needs to know that a sound played.
