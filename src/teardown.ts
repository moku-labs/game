/**
 * @file Teardown registry — the single allowlisted module-scope state of the package.
 */

/**
 * Function that frees one plugin's resources.
 *
 * @example
 * ```ts
 * const dispose: Disposer = () => cancelAnimationFrame(handle);
 * ```
 */
export type Disposer = () => void | Promise<void>;

// @no-module-state-check — onStop receives only { global } (spec/08 §2); plugins find their resources here.
// biome-ignore lint/correctness/noUnusedVariables: used by the bodies that build wave 1 writes
const registry = new WeakMap<object, Map<string, Disposer>>();

/**
 * Reports an error from a place that has no `ctx.log`.
 *
 * @param message - What failed.
 * @param error - The caught error.
 * @example
 * ```ts
 * reportError("A disposer failed.", error);
 * ```
 */
export function reportError(message: string, error: unknown): void {
  // @log-sink — the only console call in src: onStop and the framework onError have no ctx.
  console.error(`[game] ${message}`, error);
}

/**
 * Framework-level `onError`: a hook threw.
 *
 * @param error - The error thrown by a hook.
 * @example
 * ```ts
 * createCore(coreConfig, { plugins, onError: reportHookError });
 * ```
 */
export function reportHookError(error: Error): void {
  reportError("A hook failed.", error);
}

/**
 * Registers a disposer for one plugin of one app.
 *
 * @param _global - The app's frozen global config object, used as identity.
 * @param _key - Plugin name.
 * @param _dispose - Function that frees the plugin's resources.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * teardown.register(ctx.global, "time", stopLoop);
 * ```
 */
function register(_global: object, _key: string, _dispose: Disposer): void {
  throw new Error("not implemented");
}

/**
 * Runs and removes the disposer of one plugin.
 *
 * @param _global - The app's global config object.
 * @param _key - Plugin name.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * await teardown.run(global, "time");
 * ```
 */
async function run(_global: object, _key: string): Promise<void> {
  throw new Error("not implemented");
}

/**
 * Teardown registry keyed by `ctx.global`.
 *
 * @example
 * ```ts
 * onStop: ({ global }) => teardown.run(global, "time")
 * ```
 */
export const teardown = { register, run };
