/**
 * @file Control entry (subpath `./control`) — re-exports only: the write side of the editor
 * doors. `defineCommand` and `run`, the base catalogue `commands`, the errors a production build
 * and a read-only debug build throw, and their types. Commands run in dev builds and debug builds
 * (every command with `--debug`; the read and cosmetic ones alone with `--debug=read`): a game's production build
 * defines `__MOKU_GAME_DEV__`, `__MOKU_GAME_AGENT__` and `__MOKU_GAME_CONTROL__` as `false` and
 * the bundler drops the command bodies.
 */
export { commands } from "./plugins/flow/doors/commands";
export { defineCommand } from "./plugins/flow/doors/define";
export type { ControlReadOnlyError, ControlRefusedError } from "./plugins/flow/doors/dev";
export { controlReadOnly, controlRefused } from "./plugins/flow/doors/dev";
export { run } from "./plugins/flow/doors/run";
export type { ChoiceInput, Command, Ran } from "./plugins/flow/doors/types";
