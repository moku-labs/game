/**
 * @file Inspect entry (subpath `./inspect`) — re-exports only: the read side of the editor
 * doors. `defineSource`, `read` and `watch`, the base catalogue `sources` and their types. Every
 * source only reads, so the door is safe in a production build.
 */
export { sources } from "./plugins/flow/doors/catalogue";
export { defineSource } from "./plugins/flow/doors/define";
export { read, watch } from "./plugins/flow/doors/read";
export type { InputOf, InputSchema, Source } from "./plugins/flow/doors/types";
