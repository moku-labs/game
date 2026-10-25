/**
 * @file audio plugin — shared types: the three buses, the context seam that makes the plugin
 * testable, the two ways music plays, the audio session, the signature of the authoring helper,
 * the state the graph runs on and the public API.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";
import type { Api as AssetsApi, Events as AssetsEvents } from "../assets/types";
import type { Descriptor, Api as FlowApi } from "../flow/types";
import type { Events as LifecycleEvents } from "../lifecycle/types";
import type { Json, Api as ModelApi, Events as ModelEvents } from "../model/types";
import type { Events as ScenesEvents } from "../scenes/types";
import type { Api as TimeApi } from "../time/types";

/**
 * The three volume buses. `master` carries the whole game, `music` the scene track, `sfx` every
 * sound a node or a timeline fires.
 *
 * @example
 * ```ts
 * const bus: Bus = "music";
 * ```
 */
export type Bus = "master" | "music" | "sfx";

/**
 * The part of `AudioContext` the plugin uses. A test passes its own through `config.context`, so
 * nothing in the unit tests touches a sound card. `state` adds Safari's `"interrupted"`, which a
 * phone call or the lock screen puts a context into.
 *
 * @example
 * ```ts
 * // A dev tool builds the engine's context itself and hands it to the plugin.
 * const context: AudioContextLike = new AudioContext();
 * createApp({ plugins: [...screen, audioPlugin], pluginConfigs: { audio: { context: () => context } } });
 * ```
 */
export type AudioContextLike = Pick<
  AudioContext,
  | "destination"
  | "currentTime"
  | "createGain"
  | "createBufferSource"
  | "decodeAudioData"
  | "createMediaElementSource"
  | "resume"
  | "close"
> & { readonly state: AudioContext["state"] | "interrupted" };

/**
 * What `music` accepts besides the key. An absent `fadeMs` means `config.musicFadeMs` at play time.
 *
 * @example
 * ```ts
 * const options: MusicOptions = { fadeMs: 200 };
 * ```
 */
export type MusicOptions = { fadeMs?: number };

/**
 * `music` bound to the audio asset keys of one game. `defineGame` returns it through `audioFor`;
 * the loose export accepts any string. The descriptor resolves nothing.
 *
 * @example
 * ```ts
 * const gameMusic: MusicDescriptor<"board.theme"> = music;
 * ```
 */
export type MusicDescriptor<Asset extends string> = (
  key: Asset | null,
  options?: MusicOptions
) => Descriptor<void>;

/**
 * Reads the player's volume choice out of the committed player state. Every bus it names is
 * applied; the ones it leaves out keep the value they had.
 *
 * @example
 * ```ts
 * const volumes: Volumes = player => (player as { settings: { audio: { music: number } } }).settings.audio;
 * ```
 */
export type Volumes = (player: Json) => Partial<Record<Bus, number>>;

/**
 * `Volumes`, written against the player type of one game: `defineGame` hands it as `volumes`, so
 * the callback reads the game's player with no cast. The same function at run time.
 *
 * @example
 * ```ts
 * // index.ts of a game: `volumes` comes from the kit, so `player` is the game's Player.
 * pluginConfigs: { audio: { volumes: volumes(player => ({ music: player.settings.music })) } }
 * ```
 */
export type VolumesFor<Player> = (
  read: (player: Player) => Partial<Record<Bus, number>>
) => Volumes;

/**
 * How a music track is played. `"decode"`: one AudioBuffer per track, gapless, about 58 MB per
 * 150 s at 48 kHz. `"stream"`: an `<audio>` element on a `blob:` URL of the bytes `assets` holds,
 * about 12 MB, and a gap at every loop: 5 to 49 ms in Chromium, about 0.4 s in WebKit. A tight
 * loop keeps `"decode"`; a long track that tolerates a seam takes `"stream"`.
 *
 * @example
 * ```ts
 * const mode: MusicMode = "stream";
 * ```
 */
export type MusicMode = "decode" | "stream";

/**
 * What the page asks iOS for. `"ambient"`: mixes with other apps, the silent switch mutes it.
 * `"playback"`: stops other apps, plays through the switch. `"auto"`: WebKit picks.
 *
 * @example
 * ```ts
 * const session: AudioSessionType = "playback";
 * ```
 */
export type AudioSessionType = "ambient" | "playback" | "auto";

/**
 * The part of `navigator.audioSession` the plugin writes. `lib.dom` has no type for it, and only
 * WebKit has the object at all.
 *
 * @example
 * ```ts
 * // What Safari answers before the plugin started: no override.
 * const session: AudioSessionLike = { type: "auto" };
 * ```
 */
export type AudioSessionLike = { type: string };

/**
 * One music track played by an element at `music: "stream"`: the element, its source node in the
 * graph, the track gain every level goes through, and the `blob:` URL the element reads.
 *
 * @example
 * ```ts
 * // `state.music.stream` once "board.theme" plays at `music: "stream"`.
 * const { element, url }: StreamTrack = track;
 * element.loop; // true
 * url.startsWith("blob:"); // true
 * ```
 */
export type StreamTrack = {
  element: HTMLAudioElement;
  node: MediaElementAudioSourceNode;
  gain: GainNode;
  url: string;
};

/**
 * A streamed track that fades out. Its timer frees the element when the fade ends: an element has
 * no `stop(when)` on the context clock.
 *
 * @example
 * ```ts
 * // A switch at `musicFadeMs: 600` keeps the old track here for 600 ms.
 * const entry: RetiringTrack = { stream: oldTrack, timer: setTimeout(free, 600) };
 * ```
 */
export type RetiringTrack = { stream: StreamTrack; timer: ReturnType<typeof setTimeout> };

/**
 * audio plugin config.
 *
 * @example
 * ```ts
 * // `volumes` comes from the game's `defineGame` kit, so `player` is the game's Player.
 * createApp({
 *   plugins: [...screen, audioPlugin],
 *   pluginConfigs: {
 *     audio: { musicFadeMs: 400, music: "stream", session: "playback", volumes: volumes(player => player.settings.audio) }
 *   }
 * });
 * ```
 */
export type Config = {
  /** Start gain of each bus, 0..1. Overridden per commit when `volumes` is set. */
  buses: { master: number; music: number; sfx: number };
  /** Cross-fade of a music switch, in real milliseconds of the context clock. */
  musicFadeMs: number;
  /**
   * Fade of a named sound, an `sfx` with `id`, in real milliseconds of the context clock: when a
   * new sound with its id replaces it and names no `fadeMs`, or a stop names none.
   */
  sfxFadeMs: number;
  /** Reads the player's choice from the committed player. `undefined`: the buses stay at `buses`. */
  volumes: Volumes | undefined;
  /** Context factory, the test seam. `undefined`: `new AudioContext()` when the global exists, otherwise headless. */
  context: (() => AudioContextLike) | undefined;
  /** How many started sounds `journal()` keeps, newest last. `0` turns the journal off. */
  journal: number;
  /** How music plays. `"stream"` needs MP3 or AAC: WebM Opus is silent through a media element in WebKit (bug 276813). Sounds always decode. */
  music: MusicMode;
  /** Set on `navigator.audioSession.type` in `onStart`, before the context exists. No-op where the API is missing (every Chromium, Firefox). */
  session: AudioSessionType;
};

/**
 * One sound that started: a play of an `sfx` or a music track that began. `at` is the elapsed
 * game time in milliseconds, `app.time.snapshot().elapsed` at the start. `id` is there only for
 * an `sfx` started with one.
 *
 * @example
 * ```ts
 * const entry: SoundEntry = { key: "ui.click", bus: "sfx", kind: "sfx", at: 1600 };
 * const line: SoundEntry = { key: "story.line1", bus: "sfx", kind: "sfx", id: "voice", at: 2400 };
 * ```
 */
export type SoundEntry = {
  readonly key: string;
  readonly bus: Bus;
  readonly kind: "sfx" | "music";
  readonly id?: string;
  readonly at: number;
};

/**
 * What the plugin keeps for one bus: its gain node while a context exists, the volume a game or
 * the player chose, and whether it is muted.
 *
 * @example
 * ```ts
 * const entry: BusState = { gain: undefined, volume: 0.6, muted: false };
 * ```
 */
export type BusState = { gain: GainNode | undefined; volume: number; muted: boolean };

/**
 * The music that is playing, or the key remembered until the context is unlocked.
 * `source` plays a decoded track, `stream` a streamed one; they are never both set. Both
 * `undefined`: the key is only remembered (a locked context, or a refused `play()`).
 *
 * @example
 * ```ts
 * const track: MusicTrack = { key: "board.theme", gain: undefined, source: undefined, stream: undefined };
 * ```
 */
export type MusicTrack = {
  key: string;
  gain: GainNode | undefined;
  source: AudioBufferSourceNode | undefined;
  stream: StreamTrack | undefined;
};

/**
 * A music switch that waits for its buffer to decode. Its identity is the token: a later request
 * replaces it, and the replaced switch neither starts nor fades anything when its buffer arrives.
 *
 * @example
 * ```ts
 * const waiting: MusicSwitch = { key: "ui.theme" };
 * ```
 */
export type MusicSwitch = { key: string };

/**
 * The sound that plays, or still decodes, under one id. The entry object is the token, as a
 * `MusicSwitch` is: a sound whose entry is no longer the one `named` holds when its buffer arrives
 * starts nothing. `gain` and `source` stay `undefined` until the sound started.
 */
export type NamedSound = {
  gain: GainNode | undefined;
  source: AudioBufferSourceNode | undefined;
};

/**
 * audio plugin state.
 */
export type State = {
  /** `undefined` means headless: no graph, no sound, every member still keeps its value. */
  context: AudioContextLike | undefined;
  buses: Record<Bus, BusState>;
  /** A lifecycle push is in force: every bus is held at zero. */
  paused: boolean;
  unlocked: boolean;
  /** A gesture called `resume()` and it has not settled yet. The start attempt never sets it. */
  resuming: boolean;
  /**
   * Sounds fired while `resuming`: one per id, under `"#" + id`, and one per key for a sound
   * without an id. Played when the context runs, dropped when it does not.
   */
  pendingSfx: Map<string, SfxRequest>;
  /** The sound that plays, or decodes, under each id; an entry leaves when its sound ends or stops. */
  named: Map<string, NamedSound>;
  /** Per key, evicted per key on `assets:bundle-unloaded` and `assets:replaced`. */
  decoded: Map<string, Promise<AudioBuffer>>;
  /** Asset keys that already got their one warning. */
  warned: Set<string>;
  /** `config.volumes` threw once and was reported; it is not reported again this run. */
  warnedVolumes: boolean;
  music: MusicTrack | undefined;
  /** The latest switch still decoding; `undefined` once it started or a later request replaced it. */
  musicPending: MusicSwitch | undefined;
  /** Removes the two window listeners of the unlock. */
  unlock: (() => void) | undefined;
  /** The removers of the three fx handlers. */
  removers: Array<() => void>;
  /** The `navigator.audioSession` that took `config.session`; `stop` writes `"auto"` back to it. */
  session: AudioSessionLike | undefined;
  /** Streamed tracks that fade out, each freed by its timer. */
  retiring: Set<RetiringTrack>;
  /**
   * The sounds that started, oldest first, at most `config.journal` of them. Frozen: a write
   * replaces the whole list, so `journal()` hands it out without a copy.
   */
  journal: readonly SoundEntry[];
};

/**
 * audio plugin API, `app.audio`. Three buses, the unlock flag, the journal and the stop of a named
 * sound: what a game changes about sound it commits to the player state, which this plugin applies
 * on the next commit.
 *
 * @example
 * ```ts
 * // A dev overlay pulls the music down and reads the value back.
 * app.audio.setVolume("music", 0.2);
 * app.audio.volume("music"); // 0.2
 * ```
 */
export type AudioApi = {
  /**
   * Sets the volume of one bus and schedules the new gain at once. The value is clamped to 0..1
   * and `NaN` becomes 0. Nothing is persisted: a game stores the choice in the player state and
   * lets `config.volumes` apply it, so the next commit overwrites what this call set.
   *
   * @param bus - The bus to change.
   * @param value - The new volume, 0..1.
   * @throws {Error} When the bus does not exist.
   * @example
   * ```ts
   * // A test turns the music off before it walks the graph, so nothing rings.
   * app.audio.setVolume("music", 0);
   * app.audio.volume("music"); // 0
   * ```
   */
  setVolume(bus: Bus, value: number): void;

  /**
   * The stored volume of a bus, never the live gain: a muted or paused bus still answers the
   * value the player chose.
   *
   * @param bus - The bus to read.
   * @returns The stored volume, 0..1.
   * @throws {Error} When the bus does not exist.
   * @example
   * ```ts
   * // The settings screen draws the slider of the sfx bus at its stored place.
   * app.audio.mute("sfx", true);
   * app.audio.volume("sfx"); // 1: muting does not move the slider
   * ```
   */
  volume(bus: Bus): number;

  /**
   * Mutes or unmutes one bus. The flag is independent of the pause: a bus muted here stays muted
   * when the game comes back from the background.
   *
   * @param bus - The bus to change.
   * @param on - `true` mutes it, `false` lets it play again.
   * @throws {Error} When the bus does not exist.
   * @example
   * ```ts
   * // A dev overlay silences the whole game while a profiler trace runs.
   * app.audio.mute("master", true);
   * app.audio.volume("master"); // 1, and nothing is heard
   * ```
   */
  mute(bus: Bus, on: boolean): void;

  /**
   * Tells whether one bus is muted: the stored flag `mute` wrote. A pause does not change it, and
   * a headless run answers it too.
   *
   * @param bus - The bus to read.
   * @returns True while the bus is muted.
   * @throws {Error} When the bus does not exist.
   * @example
   * ```ts
   * // The settings screen draws the Sound switch off after the player muted the game.
   * app.audio.mute("master", true);
   * app.audio.muted("master"); // true
   * ```
   */
  muted(bus: Bus): boolean;

  /**
   * Tells whether the audio context runs. A shell that lets audio play with no gesture, such as a
   * native webview with the requirement switched off, makes it true at start: at once when the
   * context is created running, otherwise when the `resume()` of `onStart` fulfils. A browser
   * that wants a gesture keeps it false until the first pointer event on the page resumed the
   * context. It is false for the whole of a headless run.
   *
   * @returns True once the context is running.
   * @example
   * ```ts
   * // A "tap for sound" hint stays on screen only while the shell holds the sound back.
   * await app.start();
   * app.audio.unlocked(); // true where the context was created running, false in a browser tab
   * // The player touches the page of that tab.
   * app.audio.unlocked(); // true
   * ```
   */
  unlocked(): boolean;

  /**
   * The sounds that started, oldest first: every play of an `sfx` and every music track that
   * began, at most `config.journal` of them. A sound dropped before the unlock, a missing file
   * and a music switch to the track that already plays are not in it. Empty while
   * `config.journal` is 0, the default, and after the app stopped.
   *
   * No copy and no live view: the list and its entries are never written. Every new sound replaces the plugin's list
   * with a new frozen one, so a list read earlier keeps what it held, and a caller cannot change the journal through it.
   *
   * @returns The journal, frozen; a later sound replaces the list and leaves this one as it was.
   * @example
   * ```ts
   * // A test composed with `pluginConfigs.audio = { journal: 200 }` taps "deliver" after the
   * // first touch and checks the chime was heard.
   * app.audio.journal();
   * // [{ key: "board.theme", bus: "music", kind: "music", at: 0 },
   * //  { key: "orders.complete", bus: "sfx", kind: "sfx", at: 1600 }]
   * ```
   */
  journal(): readonly SoundEntry[];

  /**
   * Fades out and ends the sound that plays under one id, an `sfx` started with `{ id }`. The
   * same stop as the effect kind `stopSfx`: a sound with that id still decoding never starts, one
   * waiting for the unlock is dropped, and an id nothing plays under changes nothing. Headless it
   * does nothing.
   *
   * @param id - The id the sound was started with, `"voice"` for `sfx(key, { id: "voice" })`.
   * @param options - How the sound ends.
   * @param options.fadeMs - Length of the fade in real milliseconds; `config.sfxFadeMs` when absent, `0` cuts it at once.
   * @example
   * ```ts
   * // A test composed with `journal: 200` cuts the narrator's line before it checks the next screen.
   * app.audio.journal().at(-1); // { key: "story.line1", bus: "sfx", kind: "sfx", id: "voice", at: 0 }
   * app.audio.stop("voice", { fadeMs: 0 }); // the line ends now and stays in the journal
   * ```
   */
  stop(id: string, options?: { fadeMs?: number }): void;
};

/**
 * Resolved dependency APIs.
 */
export type Deps = { flow: FlowApi; assets: AssetsApi; model: ModelApi; time: TimeApi };

/**
 * What the kernel context offers before the deps are attached.
 *
 * `audio` owns no event, so `emit` is the kernel's and never called here.
 */
export type KernelSlice = PluginCtx<Config, State> & {
  readonly global: object;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * Domain context shared by the files of the plugin: the kernel slice plus the resolved deps.
 */
export type AudioCtx = KernelSlice & { readonly deps: Deps };

/**
 * Payload of the `model:committed` hook: the source of every volume a game sets.
 */
export type ModelCommitted = ModelEvents["model:committed"];

/**
 * Payload of the `scenes:changed` hook: `music` is the track the next scene declared.
 */
export type SceneChanged = ScenesEvents["scenes:changed"];

/**
 * Payload of the `lifecycle:changed` hook: the pause that holds every bus at zero.
 */
export type LifecycleChanged = LifecycleEvents["lifecycle:changed"];

/**
 * Payload of the `assets:bundle-unloaded` hook: `keys` names every decoded sound that is gone.
 */
export type BundleUnloaded = AssetsEvents["assets:bundle-unloaded"];

/**
 * Payload of the `assets:replaced` hook: `keys` names every asset a dev hot swap gave new bytes.
 */
export type AssetsReplaced = AssetsEvents["assets:replaced"];

/**
 * What one play of a sound asks for: the key, the bus the sound goes to, the id it plays under
 * (`undefined`: none), and the fade in milliseconds of the sound with that id it replaces.
 */
export type SfxRequest = { key: string; bus: string; id: string | undefined; fadeMs: number };

/**
 * What one music switch asks for: the key, or `null` to fade the current track out.
 */
export type MusicRequest = { key: string | null; fadeMs: number };
