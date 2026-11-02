/**
 * @file The `#scene` token of the page address: `#slope-4-mask&k=12`, `#glow&n=24`,
 * `#arms=slope-0,slope-2&every=2&k=12`, `#rows&hold=500`. Pure.
 */

/** The seconds of one arm when the address names none. */
export const DEFAULT_EVERY = 2;

/** The scene of an address that names none. */
const DEFAULT_SCENE = "ballast";

/** What an address asks for. */
export type Token = {
  /** The scene; with arms, the first of them. */
  scene: string;
  /** The full-screen sprites of the ballast. */
  k?: number;
  /** The count of a scene that takes one. */
  n?: number;
  /** The scene's time held at this many milliseconds, for a compare of pixels at one value. */
  hold?: number;
  /** The arms to turn through; empty for one scene. */
  arms: string[];
  /** The seconds of one arm. */
  every: number;
};

/**
 * A whole number of 0 or above from a word.
 *
 * @param word - The word, or nothing.
 * @returns The number, or `undefined` for anything else.
 * @example
 * ```ts
 * wholeOf("12"); // 12
 * ```
 */
function wholeOf(word: string | undefined): number | undefined {
  if (word === undefined || !/^\d+$/.test(word)) return undefined;

  return Number(word);
}

/**
 * Reads the token of an address.
 *
 * @param hash - `location.hash`.
 * @returns What it asks for.
 * @example
 * ```ts
 * parseToken("#full&k=4"); // { scene: "full", k: 4, arms: [], every: 2 }
 * ```
 */
export function parseToken(hash: string): Token {
  const [first = "", ...rest] = hash.replace(/^#/, "").split("&");
  const fields = new Map(
    [first, ...rest].map(part => {
      const [name = "", value = ""] = part.split("=");

      return [name, value];
    })
  );
  const arms = fields.get("arms")?.split(",").filter(Boolean) ?? [];
  const k = wholeOf(fields.get("k"));
  const n = wholeOf(fields.get("n"));
  const hold = wholeOf(fields.get("hold"));
  const every = wholeOf(fields.get("every")) || DEFAULT_EVERY;

  return {
    scene: arms[0] ?? (first === "" || first.includes("=") ? DEFAULT_SCENE : first),
    ...(k === undefined ? {} : { k }),
    ...(n === undefined ? {} : { n }),
    ...(hold === undefined ? {} : { hold }),
    arms,
    every
  };
}
