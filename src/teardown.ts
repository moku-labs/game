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
 * Registers a disposer for one plugin of one app. A second call with the same key replaces the first.
 *
 * @param global - The app's frozen global config object, used as identity.
 * @param key - Plugin name.
 * @param dispose - Function that frees the plugin's resources.
 * @example
 * ```ts
 * teardown.register(ctx.global, "time", stopLoop);
 * ```
 */
function register(global: object, key: string, dispose: Disposer): void {
  const disposers = registry.get(global) ?? new Map<string, Disposer>();

  disposers.set(key, dispose);
  registry.set(global, disposers);
}

/**
 * Runs and removes the disposer of one plugin. A missing key is a no-op.
 * A throwing disposer is reported and never rethrown, so one plugin cannot block the stop of the others.
 *
 * @param global - The app's global config object.
 * @param key - Plugin name.
 * @returns Resolves when the disposer has finished.
 * @example
 * ```ts
 * await teardown.run(global, "time");
 * ```
 */
async function run(global: object, key: string): Promise<void> {
  const disposers = registry.get(global);
  const dispose = disposers?.get(key);
  if (!disposers || !dispose) return;

  // Forget first: a second stop must not run the disposer again, even if it throws.
  disposers.delete(key);

  try {
    await dispose();
  } catch (error) {
    reportError(`The disposer of "${key}" failed.`, error);
  }
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
