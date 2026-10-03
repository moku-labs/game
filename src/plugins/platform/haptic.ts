/**
 * @file platform plugin — the handler of the effect kind `haptic`. `anim` builds the descriptor,
 * a node awaits it or a timeline reaches it, and this file hands the kind to the provider.
 */
import { HAPTIC_KINDS } from "../anim/timeline/steps";
import { isDev } from "../flow/doors/dev";
import type { Descriptor, Hint } from "../flow/types";
import { safely } from "./provider";
import type { HapticKind, KernelSlice, PlatformProvider } from "./types";

/**
 * Reads the kind out of a `haptic` descriptor. The payload is plain JSON, so a missing or
 * non-string kind is named by its text and takes the unknown-kind path.
 *
 * @param descriptor - The descriptor the handler was called with.
 * @returns The kind, as text.
 * @example
 * ```ts
 * kindOf({ kind: "haptic", payload: { kind: "light" } }); // "light"
 * ```
 */
export function kindOf(descriptor: Descriptor | Hint): string {
  const payload = descriptor.payload;
  const kind =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? payload.kind
      : undefined;

  return typeof kind === "string" ? kind : String(kind);
}

/**
 * Checks a kind against the seven `anim` lists.
 *
 * @param kind - The kind a descriptor named.
 * @returns True for one of `HAPTIC_KINDS`.
 * @example
 * ```ts
 * isHapticKind("buzz"); // false
 * ```
 */
function isHapticKind(kind: string): kind is HapticKind {
  const known: readonly string[] = HAPTIC_KINDS;

  return known.includes(kind);
}

/**
 * Plays one tick: the handler of the kind `"haptic"`. A known kind goes to the provider; an
 * unknown one warns once per kind in a dev build and plays nothing.
 *
 * @param ctx - Kernel context of the platform plugin.
 * @param provider - The provider of the game.
 * @param kind - The kind the descriptor named.
 */
export function playHaptic(ctx: KernelSlice, provider: PlatformProvider, kind: string): void {
  if (isHapticKind(kind)) {
    safely(ctx.log, "haptic", () => provider.haptic(kind));

    return;
  }

  if (!isDev() || ctx.state.warned.has(kind)) return;

  ctx.state.warned.add(kind);
  ctx.log.warn("platform: unknown haptic kind", { kind });
}
