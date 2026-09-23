/**
 * @file flow/doors — the input a call left out.
 */
import type { InputOf, InputSchema } from "./types";

/** The input of a call that passed none. */
const noInput = Object.freeze({});

/**
 * Hands the given input on, or an empty one. `InputArguments` and `WatchInput` let a call leave
 * the input out only when every field of the schema is optional, so `{}` is an input of that
 * schema.
 *
 * @param input - The input of the call, if any.
 * @returns The input to pass to the descriptor.
 * @example
 * ```ts
 * inputOrEmpty<{ last: "number?" }>(undefined); // {}
 * ```
 */
export function inputOrEmpty<S extends InputSchema>(input: InputOf<S> | undefined): InputOf<S> {
  // `{}` fits here: InputArguments and WatchInput omit input only when every field is optional.
  return input ?? (noInput as InputOf<S>);
}
