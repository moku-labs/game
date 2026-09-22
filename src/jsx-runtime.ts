/**
 * @file The JSX runtime a game reaches through `"jsxImportSource": "@moku-labs/game"` (subpath
 * `./jsx-runtime`). Re-exports only: the code lives in `plugins/ui/jsx/runtime.ts`.
 */
export type { JSX } from "./plugins/ui/jsx/runtime";
export { Fragment, jsx, jsxs } from "./plugins/ui/jsx/runtime";
