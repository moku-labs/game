/**
 * @file audio plugin — shared types: the three buses, the context seam that makes the plugin
 * testable, the signature of the authoring helper, the state the graph runs on and the public API.
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
 * the loose export accepts any string.
 *
 * @example
 * ```ts
 * const gameMusic: MusicDescriptor<"board.theme"> = music;
 * ```
 */
export type MusicDescriptor<Asset extends string> = (
  key: Asset | null,
  options?: MusicOptions
) => Descriptor;

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
 * audio plugin config.
 *
 * @example
 * ```ts
 * createApp({
 *   plugins: [...screen, audioPlugin],
 *   pluginConfigs: { audio: { musicFadeMs: 400, volumes: player => player.settings.audio } }
 * });
 * ```
 */
export type Config = {
  /** Start gain of each bus, 0..1. Overridden per commit when `volumes` is set. */
  buses: { master: number; music: number; sfx: number };
  /** Cross-fade of a music switch, in real milliseconds of the context clock. */
  musicFadeMs: number;
  /** Reads the player's choice from the committed player. `undefined`: the buses stay at `buses`. */
  volumes: Volumes | undefined;
  /** Context factory, the test seam. `undefined`: `new AudioContext()` when the global exists, otherwise headless. */
  context: (() => AudioContextLike) | undefined;
  /** How many started sounds `journal()` keeps, newest last. `0` turns the journal off. */
  journal: number;
};

/**
 * One sound that started: a play of an `sfx` or a music track that began. `at` is the elapsed
 * game time in milliseconds, `app.time.snapshot().elapsed` at the start.
 *
 * @example
 * ```ts
 * const entry: SoundEntry = { key: "ui.click", bus: "sfx", kind: "sfx", at: 1600 };
 * ```
 */
export type SoundEntry = {
  readonly key: string;
  readonly bus: Bus;
  readonly kind: "sfx" | "music";
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
 * The music that is playing, or the key remembered until the first touch unlocks the context.
 * `source` and `gain` are `undefined` exactly while the track is only remembered.
 *
 * @example
 * ```ts
 * const track: MusicTrack = { key: "board.theme", source: undefined, gain: undefined };
 * ```
 */
export type MusicTrack = {
  key: string;
  source: AudioBufferSourceNode | undefined;
  gain: GainNode | undefined;
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
 * audio plugin state.
 */
export type State = {
  /** `undefined` means headless: no graph, no sound, every member still keeps its value. */
  context: AudioContextLike | undefined;
  buses: Record<Bus, BusState>;
  /** A lifecycle push is in force: every bus is held at zero. */
  paused: boolean;
  unlocked: boolean;
  /** A gesture called `resume()` and it has not settled yet. */
  resuming: boolean;
  /** Sounds fired while `resuming`, one per key; played when the context runs, dropped when it does not. */
  pendingSfx: Map<string, SfxRequest>;
  /** Per key, evicted per key on `assets:bundle-unloaded`. */
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
  /** The removers of the two fx handlers. */
  removers: Array<() => void>;
  /**
   * The sounds that started, oldest first, at most `config.journal` of them. Frozen: a write
   * replaces the whole list, so `journal()` hands it out without a copy.
   */
  journal: readonly SoundEntry[];
};

/**
 * audio plugin API, `app.audio`. Three buses and the unlock flag: what a game changes about sound
 * it commits to the player state, which this plugin applies on the next commit.
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
   * Tells whether the browser let the audio context run. It is false until the first pointer
   * event on the page resumed it, and false for the whole of a headless run.
   *
   * @returns True once the context is running.
   * @example
   * ```ts
   * // A "tap to start" screen stays up until the browser allowed sound.
   * app.audio.unlocked(); // false before the first touch, true after it
   * ```
   */
  unlocked(): boolean;

  /**
   * The sounds that started, oldest first: every play of an `sfx` and every music track that
   * began, at most `config.journal` of them. A sound dropped before the unlock, a missing file
   * and a music switch to the track that already plays are not in it. Empty while
   * `config.journal` is 0, the default, and after the app stopped.
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
 * What one play of a sound asks for: the key and the bus the sound goes to.
 */
export type SfxRequest = { key: string; bus: string };

/**
 * What one music switch asks for: the key, or `null` to fade the current track out.
 */
export type MusicRequest = { key: string | null; fadeMs: number };
