/**
 * @file i18n plugin — state factory.
 */
import type { CompiledMessages, IntlKit, RegisteredModule, State } from "./types";

/**
 * Creates the table of modules per locale. Its own function because lint rule L5 refuses a
 * collection built inside an exported declaration.
 *
 * @returns An empty registry.
 */
function emptyRegistry(): Map<string, RegisteredModule[]> {
  return new Map();
}

/**
 * Creates the table of merged modules per locale.
 *
 * @returns An empty table.
 */
function emptyLoaded(): Map<string, CompiledMessages> {
  return new Map();
}

/**
 * Creates the table of formatter kits per locale.
 *
 * @returns An empty table.
 */
function emptyKits(): Map<string, IntlKit> {
  return new Map();
}

/**
 * Creates the set of keys already reported missing.
 *
 * @returns An empty set.
 */
function emptyWarned(): Set<string> {
  return new Set();
}

/**
 * Creates the initial i18n state: nothing registered, nothing loaded, no load in flight. The
 * registry is filled in `onStart` from the feature descriptions and the config.
 *
 * @returns A fresh state, owned by one app.
 */
export function createI18nState(): State {
  return {
    locale: "",
    registered: emptyRegistry(),
    loaded: emptyLoaded(),
    intl: emptyKits(),
    warned: emptyWarned(),
    loading: undefined
  };
}
