// biome-ignore-all assist/source/organizeImports: two-section barrel layout (instances → type namespaces) is house style
/**
 * @file Plugin barrel — plugin instances and namespaced plugin types. Helpers live in src/index.ts.
 */

// ─── Plugin Instances ────────────────────────────────────────
export { assetsPlugin } from "./assets";
export { clockPlugin } from "./clock";
export { flowPlugin } from "./flow";
export { inputPlugin } from "./input";
export { lifecyclePlugin } from "./lifecycle";
export { modelPlugin } from "./model";
export { rendererPlugin } from "./renderer";
export { scenesPlugin } from "./scenes";
export { timePlugin } from "./time";
export { worldPlugin } from "./world";

// ─── Plugin Types (namespace re-exports) ─────────────────────
export * as Assets from "./assets/types";
export * as Clock from "./clock/types";
export * as Flow from "./flow/types";
export * as Input from "./input/types";
export * as Lifecycle from "./lifecycle/types";
export * as Model from "./model/types";
export * as Renderer from "./renderer/types";
export * as Scenes from "./scenes/types";
export * as Time from "./time/types";
export * as World from "./world/types";
