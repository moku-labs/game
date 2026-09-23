/**
 * @file Control entry (subpath `./control`) — re-exports only: the write side of the editor
 * doors. `defineCommand` and `run`, the base catalogue `commands`, the error a production build
 * throws and their types. Every command runs in dev builds only: a game's production build
 * defines `__MOKU_GAME_DEV__` as `false` and the bundler drops the command bodies.
 */
export { commands } from "./plugins/flow/doors/commands";
export { defineCommand } from "./plugins/flow/doors/define";
export { controlRefused } from "./plugins/flow/doors/dev";
export { run } from "./plugins/flow/doors/run";
export type { Command, Ran } from "./plugins/flow/doors/types";
