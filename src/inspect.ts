/**
 * @file Inspect entry (subpath `./inspect`) — re-exports only: the read side of the editor
 * doors. `defineSource`, `read` and `watch`, the base catalogue `sources` and their types. Every
 * source only reads, so the door is safe in a production build. It reaches no command module,
 * so its bundle carries no command descriptor.
 */
export { defineSource } from "./plugins/flow/doors/define";
export { read, watch } from "./plugins/flow/doors/read";
export { sources } from "./plugins/flow/doors/sources";
export type { InputOf, InputSchema, Source } from "./plugins/flow/doors/types";
