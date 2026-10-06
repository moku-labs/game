/**
 * @file The defaults of a game's `config.ts`, and the checks of the values TypeScript cannot stop
 * in a file that skips `satisfies GameConfig`. No IO: the page and the CLI both call it. Not
 * exported from any entry.
 */
import type { GameConfig, ResolvedGameConfig, SaveKind, SystemName } from "./types";

/**
 * The save kinds a config may name.
 *
 * @returns The set of save kinds.
 * @example
 * ```ts
 * saveKinds().has("disk"); // false
 * ```
 */
function saveKinds(): ReadonlySet<string> {
  return new Set<SaveKind>(["memory", "local", "store"]);
}

/**
 * The system plugins the game shell wires, by their `@moku-labs/system` names.
 *
 * @returns The set of system names.
 * @example
 * ```ts
 * systemNames().has("keepAwake"); // true
 * systemNames().has("tray"); // false
 * ```
 */
function systemNames(): ReadonlySet<string> {
  return new Set<SystemName>(["lifecycle", "back", "haptics", "keepAwake", "store"]);
}

/**
 * Throws for the first value of a config that TypeScript would have refused.
 *
 * @param config - The default export of `config.ts`.
 * @throws {Error} When `save` is not a save kind, a `system` name is not wired, or the title is empty.
 */
function checkConfig(config: GameConfig): void {
  if (config.save !== undefined && !saveKinds().has(config.save)) {
    throw new Error(`[game] config.save is "${config.save}".\n  Use "memory", "local" or "store".`);
  }

  const wired = systemNames();
  const unwired = config.system?.find(name => !wired.has(name));

  if (unwired !== undefined) {
    throw new Error(
      `[game] config.system names "${unwired}", which the game shell does not wire.\n  Use lifecycle, back, haptics, keepAwake or store.`
    );
  }

  if (config.page.title.trim() === "") {
    throw new Error("[game] config.page.title is empty.\n  Give the page a title in config.ts.");
  }
}

/**
 * Fills every default of a game's `config.ts`: `lang` `"en"`, `background` `"#000000"`,
 * `orientation` `"portrait"`, no icons, no head tags, no system plugin, the memory save, no asset
 * layers.
 *
 * @param config - The default export of `config.ts`.
 * @returns The config with every field set.
 * @throws {Error} When `save` is not a save kind, a `system` name is not wired, or the title is empty.
 * @example
 * ```ts
 * resolveConfig({ page: { title: "T" } }).save; // "memory"
 * ```
 */
export function resolveConfig(config: GameConfig): ResolvedGameConfig {
  checkConfig(config);

  return {
    page: {
      title: config.page.title,
      lang: config.page.lang ?? "en",
      background: config.page.background ?? "#000000",
      orientation: config.page.orientation ?? "portrait",
      icons: config.page.icons ?? {},
      head: config.page.head ?? []
    },
    native: config.native,
    system: config.system ?? [],
    save: config.save ?? "memory",
    assets: { layers: config.assets?.layers ?? {} }
  };
}
