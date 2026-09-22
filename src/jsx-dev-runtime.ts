/**
 * @file The development JSX runtime (subpath `./jsx-dev-runtime`). Bun evaluates it in every mode
 * but `bun build --production` (spike P4, case 10), so it ships next to `jsx-runtime`. Re-exports
 * only: the code lives in `plugins/ui/jsx/runtime.ts`.
 */
export type { JSX } from "./plugins/ui/jsx/runtime";
export { Fragment, jsx, jsxDEV, jsxs } from "./plugins/ui/jsx/runtime";
