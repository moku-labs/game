/**
 * @file flow/doors — the dev session of one app: whether a cheat or a raw write tainted it, and
 * the journal of those commands. Kept per app object, so two apps in one process never share it.
 */
import type { Json } from "../../model/types";
import type { CheatEntry } from "./types";

/** Cheat entries kept per app; the oldest is dropped above it. */
const cheatLimit = 500;

/** The session of one app. `cheats` is replaced, never mutated, so a reader holds a stable list. */
type DoorSession = { tainted: boolean; cheats: readonly CheatEntry[] };

/** The journal of an app that ran no cheat. */
const noCheats: readonly CheatEntry[] = Object.freeze([]);

// eslint-disable-next-line no-restricted-syntax -- keyed by the app: each app has its own entry, which is what L5 protects.
const sessions = /*#__PURE__*/ new WeakMap<object, DoorSession>();

/**
 * Tells whether a cheat or a raw command ran on this app.
 *
 * @param app - The app.
 * @returns True once a `cheat` or `raw` command ran.
 * @example
 * ```ts
 * // After run(app, commands.restore, { repro }): a restore is raw.
 * isTainted(app); // true
 * ```
 */
export function isTainted(app: object): boolean {
  return sessions.get(app)?.tainted ?? false;
}

/**
 * Reads the journal of cheat and raw commands of this app, oldest first.
 *
 * @param app - The app.
 * @returns The frozen journal, the same list until the next cheat.
 * @example
 * ```ts
 * // After run(app, commands.restore, { bookmark }) on frame 96.
 * cheatsOf(app); // [{ id: "game.restore", input: { bookmark: { path: "home", ... } }, frame: 96 }]
 * ```
 */
export function cheatsOf(app: object): readonly CheatEntry[] {
  return sessions.get(app)?.cheats ?? noCheats;
}

/**
 * Taints the session of this app and journals the command. The input is copied, so the caller
 * cannot rewrite the journal afterwards.
 *
 * @param app - The app.
 * @param id - The command id.
 * @param input - The input the command got.
 * @param frame - The frame it runs on.
 */
export function recordCheat(
  app: object,
  id: string,
  input: Readonly<Record<string, Json | undefined>>,
  frame: number
): void {
  const session = sessions.get(app) ?? { tainted: true, cheats: noCheats };
  const entry: CheatEntry = Object.freeze({ id, input: structuredClone(input), frame });

  session.tainted = true;
  session.cheats = Object.freeze([...session.cheats.slice(1 - cheatLimit), entry]);
  sessions.set(app, session);
}
