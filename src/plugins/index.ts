// biome-ignore-all assist/source/organizeImports: two-section barrel layout (instances → type namespaces) is house style
/**
 * @file Plugin barrel — plugin instances and namespaced plugin types. Helpers live in src/index.ts.
 */

// ─── Plugin Instances ────────────────────────────────────────
export { clockPlugin } from "./clock";
export { flowPlugin } from "./flow";
export { lifecyclePlugin } from "./lifecycle";
export { modelPlugin } from "./model";
export { timePlugin } from "./time";

// ─── Plugin Types (namespace re-exports) ─────────────────────
export * as Clock from "./clock/types";
export * as Flow from "./flow/types";
export * as Lifecycle from "./lifecycle/types";
export * as Model from "./model/types";
export * as Time from "./time/types";
