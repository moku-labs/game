/**
 * @file flow/doors — the types of the two editor doors: sources (`/inspect`) and commands
 * (`/control`). A descriptor is data: an id, a title, an input schema and one function.
 */
import type { Log } from "@moku-labs/common/browser";
import type { Json, Snapshot } from "../../model/types";
import type { HeadlessApp } from "../headless";

/**
 * The kinds an input field can take. `json` is any JSON value the command checks itself.
 *
 * @example
 * ```ts
 * // The schema of game.step: the frame count, and the frame length in milliseconds.
 * const kinds: InputKind[] = ["number", "number"];
 * ```
 */
export type InputKind = "string" | "number" | "boolean" | "json";

/**
 * The input of a source or a command: field name to kind. A kind ending in `?` is optional, so
 * "key or target" is two optional fields and the command checks that one is given.
 *
 * @example
 * ```ts
 * // game.restore takes exactly one of the two.
 * const input: InputSchema = { bookmark: "json?", repro: "json?" };
 * ```
 */
export type InputSchema = Readonly<Record<string, InputKind | `${InputKind}?`>>;

/** The TypeScript type of each input kind. */
type KindTypes = { string: string; number: number; boolean: boolean; json: Json };

/** The value type of one field kind, optional or not. */
type ValueOf<Kind> = Kind extends `${infer Base extends InputKind}?`
  ? KindTypes[Base]
  : Kind extends InputKind
    ? KindTypes[Kind]
    : never;

/** The fields of a schema whose kind has no `?`. */
type RequiredKeys<S extends InputSchema> = {
  [K in keyof S]: S[K] extends InputKind ? K : never;
}[keyof S];

/** Shows an intersection as one object type. */
type Flat<T> = { [K in keyof T]: T[K] };

/**
 * The input value a schema describes. A `?` field may be left out or be `undefined`.
 *
 * @example
 * ```ts
 * type Step = InputOf<{ frames: "number"; deltaMs: "number?" }>; // { frames: number; deltaMs?: number | undefined }
 * const step: Step = { frames: 3 };
 * ```
 */
export type InputOf<S extends InputSchema> = Flat<
  { -readonly [K in RequiredKeys<S>]: ValueOf<S[K]> } & {
    -readonly [K in Exclude<keyof S, RequiredKeys<S>>]?: ValueOf<S[K]> | undefined;
  }
>;

/**
 * The input argument of `read` and `run`: optional when every field of the schema is optional,
 * required otherwise.
 *
 * @example
 * ```ts
 * type History = InputArguments<{ last: "number?" }>; // [input?: { last?: number | undefined }]
 * type Rect = InputArguments<{ key: "string" }>; // [input: { key: string }]
 * ```
 */
export type InputArguments<S extends InputSchema> =
  Partial<InputOf<S>> extends InputOf<S> ? [input?: InputOf<S>] : [input: InputOf<S>];

/**
 * The input argument of `watch`: `undefined` is allowed when every field is optional.
 *
 * @example
 * ```ts
 * type Position = WatchInput<{}>; // {} | undefined
 * type Rect = WatchInput<{ key: "string" }>; // { key: string }
 * ```
 */
export type WatchInput<S extends InputSchema> =
  Partial<InputOf<S>> extends InputOf<S> ? InputOf<S> | undefined : InputOf<S>;

/**
 * When `watch` reads a source again: every frame, when the committed model changed, or when
 * the graph moved (an edge, a gate, a mode).
 *
 * @example
 * ```ts
 * // game.position moves only with the graph; game.render changes every frame.
 * const changes: Changes = "edge";
 * ```
 */
export type Changes = "frame" | "commit" | "edge";

/**
 * What a command does to the game. `route` goes through the graph and keeps the session clean;
 * `cheat` and `raw` taint it and are journaled.
 *
 * @example
 * ```ts
 * // game.restore replaces the whole state: the session is not a played one any more.
 * const effect: Effect = "raw";
 * ```
 */
export type Effect = "read" | "route" | "cosmetic" | "cheat" | "raw";

/**
 * A read-only view on a running game: an id, a title, the input it takes, when it changes and
 * how to read it. `App` is what the reader needs: the headless app by default, a screen source
 * asks for the screen plugins.
 *
 * @example
 * ```ts
 * // A game's .dev module: the coins a panel shows, re-read on every commit.
 * const coins = defineSource({
 *   id: "timber.coins",
 *   title: "Coins",
 *   input: {},
 *   changes: "commit",
 *   read: (app: HeadlessApp & { model: ModelApi }) => app.model.store.snapshot().player
 * });
 * read(app, coins); // { coins: 120, ... }
 * ```
 */
export type Source<S extends InputSchema, O, App = HeadlessApp> = {
  readonly id: string;
  readonly title: string;
  readonly input: S;
  readonly changes: Changes;
  readonly read: (app: App, input: InputOf<S>) => O;
};

/**
 * A dev-only action on a running game: an id, a title, the input it takes, its effect and how to
 * run it. The body starts with the inline dev guard, so a production build drops it.
 *
 * @example
 * ```ts
 * // A game's .dev module: jump to a level through the graph, the session stays clean.
 * const jumpToLevel = defineCommand({
 *   id: "timber.jumpToLevel",
 *   title: "Go to level",
 *   input: { level: "number" },
 *   effect: "route",
 *   run: (app, { level }) => app.flow.walk([{ at: "home", intent: "play", payload: { level } }])
 * });
 * (await run(app, jumpToLevel, { level: 3 })).state.path; // "board/awaitIntent"
 * ```
 */
export type Command<S extends InputSchema, O, App = HeadlessApp> = {
  readonly id: string;
  readonly title: string;
  readonly input: S;
  readonly effect: Effect;
  readonly run: (app: App, input: InputOf<S>) => O | Promise<O>;
};

/**
 * Where the game stands after a command: the graph path, the frame and whether the session
 * was tainted by a cheat or a raw write.
 *
 * @example
 * ```ts
 * const envelope: Envelope = { path: "board/awaitIntent", frame: 1840, tainted: false };
 * ```
 */
export type Envelope = { readonly path: string; readonly frame: number; readonly tainted: boolean };

/**
 * What `run` resolves with: the command's value and the envelope read after it.
 *
 * @example
 * ```ts
 * // A tap on Play while the home screen rests.
 * const ran: Ran<boolean> = { value: true, state: { path: "board/awaitIntent", frame: 312, tainted: false } };
 * ```
 */
export type Ran<O> = { readonly value: O; readonly state: Envelope };

/**
 * One journaled cheat or raw command: its id, the input it got and the frame it ran on.
 *
 * @example
 * ```ts
 * const entry: CheatEntry = { id: "game.restore", input: { bookmark: { path: "home" } }, frame: 96 };
 * ```
 */
export type CheatEntry = {
  readonly id: string;
  readonly input: Readonly<Record<string, Json | undefined>>;
  readonly frame: number;
};

/**
 * What `watch` needs of an app: the frame loop, the graph and the committed model it compares.
 * Every app with the default plugins fits.
 *
 * @example
 * ```ts
 * const app: WatchApp = createApp({ pluginConfigs: { flow: { mainFlow } } });
 * ```
 */
export type WatchApp = HeadlessApp & {
  readonly model: { readonly store: { snapshot(): Snapshot } };
};

/**
 * What the base commands need of an app: the headless app plus the log, where every command
 * leaves a `moku:dev` entry. Every app with the default plugins fits.
 *
 * @example
 * ```ts
 * const app: ControlApp = createApp({ pluginConfigs: { flow: { mainFlow } } });
 * app.log.trace().at(-1)?.event; // "moku:dev" after a command ran
 * ```
 */
export type ControlApp = HeadlessApp & { readonly log: Log.LogApi };
