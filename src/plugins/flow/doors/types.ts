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
 *   id: "mini.coins",
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
 * Where the editor's overlay shows a command: a switch (`"toggle"`) or a button (`"button"`). A
 * command without the marker is not shown there.
 *
 * @example
 * ```ts
 * // The overlay's "Glow" switch of a game.
 * const marker: OverlayMarker = "toggle";
 * ```
 */
export type OverlayMarker = "toggle" | "button";

/**
 * The input schema of an overlay toggle: the state the switch asks for, and nothing else.
 *
 * @example
 * ```ts
 * // The overlay runs a toggle with { on: !value(app) }.
 * const input: ToggleInput = { on: "boolean" };
 * ```
 */
export type ToggleInput = { readonly on: "boolean" };

/**
 * The input schema of an overlay toggle with `choices`: the state the switch asks for and the pick
 * of the row under it. `choice` is `"string"` or `"string?"`: the editor's registry refuses any other
 * kind at start.
 *
 * @example
 * ```ts
 * // A tester on a phone picks how a purchase ends: the overlay runs { on: true, choice: "failure" }.
 * const input: ChoiceInput = { on: "boolean", choice: "string" };
 * ```
 */
export type ChoiceInput = { readonly on: "boolean"; readonly choice: "string" | "string?" };

/** The schema a toggle accepts: exactly `{ on: "boolean" }`; any schema while `S` is the wide one. */
type ToggleSchema<S extends InputSchema> = string extends keyof S
  ? S
  : [Exclude<keyof S, "on">] extends [never]
    ? S extends ToggleInput
      ? S
      : never
    : never;

/** The schema a toggle with `choices` accepts: exactly `ChoiceInput`; any schema while `S` is the wide one. */
type ChoiceSchema<S extends InputSchema> = string extends keyof S
  ? S
  : [Exclude<keyof S, keyof ChoiceInput>] extends [never]
    ? S extends ChoiceInput
      ? S
      : never
    : never;

/** The schema a button accepts: no required field; any schema while `S` is the wide one. */
type ButtonSchema<S extends InputSchema> = string extends keyof S
  ? S
  : [RequiredKeys<S>] extends [never]
    ? S
    : never;

/**
 * The overlay part of a command, one of four shapes: none, a toggle with its input
 * `{ on: "boolean" }` and its `value`, a toggle with `choices`, whose input adds `choice` and which
 * has a `choice(app)` too, or a button with no required input and no `value`. Any other combination
 * does not compile.
 */
type CommandOverlay<S extends InputSchema, App> =
  | {
      /** Not shown in the overlay. */
      readonly overlay?: never;
      /** Only a toggle has a value. */
      readonly value?: never;
      /** Only a toggle with a row of choices has them. */
      readonly choices?: never;
      /** Only a toggle with a row of choices reads one. */
      readonly choice?: never;
    }
  | {
      /** A switch of the overlay, run with `{ on: !value(app) }`. */
      readonly overlay: "toggle";
      readonly input: ToggleSchema<S>;
      /** The current value of the switch, read by the overlay to draw it. */
      readonly value: (app: App) => boolean;
      /** Only a toggle with a row of choices has them. */
      readonly choices?: never;
      /** Only a toggle with a row of choices reads one. */
      readonly choice?: never;
    }
  | {
      /** A switch of the overlay with a row of choices, run with `{ on, choice }`. */
      readonly overlay: "toggle";
      readonly input: ChoiceSchema<S>;
      /** The current value of the switch, read by the overlay to draw it. */
      readonly value: (app: App) => boolean;
      /** The row under the switch, one word each, none twice. */
      readonly choices: readonly [string, ...string[]];
      /** The choice the row marks. The game keeps it, in its own `.dev` module. */
      readonly choice: (app: App) => string;
    }
  | {
      /** A button of the overlay, run with `{}`. */
      readonly overlay: "button";
      readonly input: ButtonSchema<S>;
      /** Only a toggle has a value. */
      readonly value?: never;
      /** Only a toggle with a row of choices has them. */
      readonly choices?: never;
      /** Only a toggle with a row of choices reads one. */
      readonly choice?: never;
    };

/**
 * An action on a running game, on the dev page and on a debug page: an id, a title, the input it
 * takes, its effect and how to run it. Its body starts with the guard of its effect: the agent
 * form for `read` and `cosmetic`, the control form for the others (see docs/doors.md), so a
 * production build drops it. A game's `.dev` command with only the `__MOKU_GAME_DEV__` guard runs
 * in dev and is refused on a debug page. With `overlay` the editor's overlay shows it: a toggle
 * takes the input `{ on: "boolean" }` and a `value(app)`, with `choices` also `choice` in the input
 * and a `choice(app)`, a button no required input and no value; the types refuse every other shape.
 *
 * @example
 * ```ts
 * // A game's .dev module: jump to a level through the graph, the session stays clean.
 * const jumpToLevel = defineCommand({
 *   id: "mini.jumpToLevel",
 *   title: "Go to level",
 *   input: { level: "number" },
 *   effect: "route",
 *   run: (app, { level }) => {
 *     if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();
 *     return app.flow.walk([{ at: "home", intent: "play", payload: { level } }]);
 *   }
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
} & CommandOverlay<S, App>;

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
