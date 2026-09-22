/**
 * @file i18n plugin — the pure message helpers: the merge of the modules one locale was brought
 * by, the fallback chain a key is looked up through, the parts a missing key shows, and the
 * merge of adjacent text parts. Nothing here touches the context or the log.
 */
import type {
  CompiledMessage,
  CompiledMessages,
  ElementNode,
  Part,
  ResolvedModule,
  State
} from "./types";

/**
 * Wraps a duplicate key in the message shape of the framework.
 *
 * @param key - The key two features carry.
 * @param first - The feature that declared it first.
 * @param second - The feature that declared it again.
 * @returns The error to throw.
 */
function duplicate(key: string, first: string, second: string): Error {
  return new Error(
    `[game] i18n: key "${key}" is defined by features "${first}" and "${second}".\n` +
      "  Keep it in one feature."
  );
}

/**
 * Creates the table of which feature declared which key. Its own function because lint rule L5
 * refuses a collection built inside an exported declaration.
 *
 * @returns An empty table.
 */
function emptyOwners(): Map<string, string> {
  return new Map();
}

/**
 * Merges the modules registered for one locale into one table. Every feature owns its keys, so
 * the same key in two features is an error that names both of them.
 *
 * @param entries - What every feature and the config brought for the locale.
 * @returns One table of key to compiled message.
 * @throws {Error} When two features carry the same key.
 * @example
 * ```ts
 * mergeLocales([{ from: "hud", messages: { "hud.title": () => [] } }]); // { "hud.title": … }
 * ```
 */
export function mergeLocales(entries: readonly ResolvedModule[]): CompiledMessages {
  const merged: CompiledMessages = {};
  const owner = emptyOwners();

  for (const entry of entries) {
    for (const [key, message] of Object.entries(entry.messages)) {
      const first = owner.get(key);

      if (first !== undefined) throw duplicate(key, first, entry.from);

      owner.set(key, entry.from);
      merged[key] = message;
    }
  }

  return merged;
}

/**
 * Finds one message through the fallback chain: the locale asked for, then the fallback.
 *
 * @param state - The plugin state.
 * @param key - The message key.
 * @param locale - The locale to read first.
 * @param fallback - The locale to read next.
 * @returns The compiled message, or `undefined` when neither locale has the key.
 */
export function resolve(
  state: State,
  key: string,
  locale: string,
  fallback: string
): CompiledMessage | undefined {
  return state.loaded.get(locale)?.[key] ?? state.loaded.get(fallback)?.[key];
}

/**
 * The parts a missing key shows: the key in corner brackets, so it is visible on the screen and
 * in a snapshot without crashing the sentence around it.
 *
 * @param key - The message key.
 * @returns One text part.
 * @example
 * ```ts
 * missingParts("hud.hint"); // [{ kind: "text", text: "⟦hud.hint⟧" }]
 * ```
 */
export function missingParts(key: string): Part[] {
  return [{ kind: "text", text: `⟦${key}⟧` }];
}

/**
 * Tells whether a parameter is an interface element rather than a word or a number. Structural,
 * the way `world` writes a description node: `type`, `props` and `children`.
 *
 * @param value - The parameter.
 * @returns True when the parameter should become an element part.
 * @example
 * ```ts
 * isElement({ type: "icon", props: {}, children: [] }); // true
 * ```
 */
export function isElement(value: unknown): value is ElementNode {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "type" in value &&
    "props" in value &&
    "children" in value
  );
}

/**
 * Merges adjacent text parts, so a message with no elements is one part and a consumer never
 * sees a sentence cut at an argument boundary.
 *
 * @param parts - What a compiled message returned.
 * @returns The same parts with the text runs joined.
 * @example
 * ```ts
 * mergeParts([{ kind: "text", text: "3" }, { kind: "text", text: " заказа" }]);
 * // [{ kind: "text", text: "3 заказа" }]
 * ```
 */
export function mergeParts(parts: readonly Part[]): Part[] {
  const merged: Part[] = [];

  for (const part of parts) {
    const last = merged.at(-1);

    if (part.kind === "text" && last?.kind === "text") {
      merged[merged.length - 1] = { kind: "text", text: last.text + part.text };
      continue;
    }

    merged.push(part);
  }

  return merged;
}
