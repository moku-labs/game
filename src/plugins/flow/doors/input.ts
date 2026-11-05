/**
 * @file flow/doors — the input of a call: the one a call left out, and the check of a given one
 * against its schema (F154).
 */
import type { InputKind, InputOf, InputSchema } from "./types";

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
  return input === undefined ? (noInput as InputOf<S>) : input;
}

/**
 * Tells whether a value is of an input kind: a string, a finite number, a boolean, or for `json`
 * anything but `undefined`. Pure.
 *
 * @param kind - The kind, without its `?`.
 * @param value - The value, not `undefined`.
 * @returns True when the value fits the kind.
 * @example
 * ```ts
 * fitsKind("number", Number.NaN); // false
 * ```
 */
function fitsKind(kind: InputKind, value: unknown): boolean {
  if (kind === "number") return typeof value === "number" && Number.isFinite(value);
  if (kind === "json") return true;

  return typeof value === kind;
}

/**
 * Shows a given value in a message: a number as it prints, so `NaN` stays `NaN`, anything else as
 * JSON. Pure.
 *
 * @param value - The value.
 * @returns The value as text.
 * @example
 * ```ts
 * shown(Number.NaN); // "NaN"
 * ```
 */
function shown(value: unknown): string {
  return typeof value === "number" ? String(value) : (JSON.stringify(value) ?? String(value));
}

/**
 * Names a kind in a message. Pure.
 *
 * @param kind - The kind.
 * @returns The kind with its article.
 * @example
 * ```ts
 * kindName("number"); // "a finite number"
 * ```
 */
function kindName(kind: InputKind): string {
  return kind === "number" ? "a finite number" : `a ${kind}`;
}

/**
 * Lists the fields a schema takes, for a message: `key (string), to (number)`. Pure.
 *
 * @param schema - The schema.
 * @returns The fields with their kinds, or `nothing` for an empty schema.
 * @example
 * ```ts
 * fieldList({ key: "string", to: "number" }); // "key (string), to (number)"
 * ```
 */
function fieldList(schema: InputSchema): string {
  const fields = Object.keys(schema).map(name => `${name} (${schema[name] ?? ""})`);

  return fields.length === 0 ? "nothing" : fields.join(", ");
}

/**
 * Builds the error of an input that does not fit the schema of its command.
 *
 * @param id - The id of the command.
 * @param problem - What is wrong, one clause.
 * @param schema - The schema, for the fix.
 * @returns The error, ready to throw.
 */
function inputError(id: string, problem: string, schema: InputSchema): TypeError {
  return new TypeError(
    `[game] The command ${id} got ${problem}.\n  It takes ${fieldList(schema)}; a field ending in ? may be left out.`
  );
}

/**
 * Splits a declared kind into its kind and whether it is optional. Pure.
 *
 * @param declared - The kind as the schema writes it.
 * @returns The kind without its `?`, and whether it had one.
 * @example
 * ```ts
 * splitKind("number?"); // { kind: "number", optional: true }
 * ```
 */
function splitKind(declared: InputKind | `${InputKind}?`): { kind: InputKind; optional: boolean } {
  const optional = declared.endsWith("?");
  const kind = (optional ? declared.slice(0, -1) : declared) as InputKind;

  return { kind, optional };
}

/**
 * Checks one field of the schema against its given value.
 *
 * @param id - The id of the command, for the message.
 * @param schema - The schema of the command.
 * @param name - The field.
 * @param value - Its given value, `undefined` when left out.
 * @throws {TypeError} When a field without `?` is left out, or the value is of another kind.
 */
function checkField(id: string, schema: InputSchema, name: string, value: unknown): void {
  const { kind, optional } = splitKind(schema[name] ?? "json?");

  if (value === undefined && optional) return;
  if (value === undefined) throw inputError(id, `no "${name}", which it needs`, schema);

  if (!fitsKind(kind, value)) {
    throw inputError(id, `${shown(value)} for "${name}", not ${kindName(kind)}`, schema);
  }
}

/**
 * Checks a given input against the schema of its command before the command runs: an object, no
 * field the schema does not name, every field without `?` given, and every given value of its
 * kind. A field with `?` may be left out or be `undefined`. A door call, never a frame path.
 *
 * @param id - The id of the command, for the message.
 * @param schema - The schema of the command.
 * @param input - The input of the call, as it came: an editor or a visual test sends plain JSON.
 * @throws {TypeError} Naming the first field that does not fit, and the fields the command takes.
 * @example
 * ```ts
 * checkInput("game.scroll", { key: "string", to: "number" }, { key: "strip", to: 318 }); // passes
 * checkInput("game.scroll", { key: "string", to: "number" }, { key: "strip", dy: 10 });
 * // throws '[game] The command game.scroll got the field "dy", which it does not take.\n  It takes key (string), to (number); …'
 * ```
 */
export function checkInput(id: string, schema: InputSchema, input: unknown): void {
  // The input is a plain object.
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw inputError(id, "an input that is not an object", schema);
  }

  const given: Readonly<Record<string, unknown>> = input as Readonly<Record<string, unknown>>;

  // No field outside the schema.
  for (const name of Object.keys(given)) {
    if (!Object.hasOwn(schema, name)) {
      throw inputError(id, `the field "${name}", which it does not take`, schema);
    }
  }

  // Every field of the schema given when it needs one, and of its kind.
  for (const name of Object.keys(schema)) checkField(id, schema, name, given[name]);
}
