/**
 * @file flow plugin — reads route steps, bookmarks and repros out of the JSON the editor sends
 * to the `/control` commands. Each reader checks the shape and builds a typed value, or throws
 * a house error that names what to pass.
 */
import type { Json, RngState } from "../model/types";
import type { Repro } from "./headless";
import type { Bookmark, RouteStep } from "./types";

/** A JSON object. */
type JsonRecord = { [key: string]: Json };

/**
 * Tells whether a JSON value is an object.
 *
 * @param value - The value.
 * @returns True for an object that is neither null nor an array.
 * @example
 * ```ts
 * isRecord({ at: "home" }); // true
 * ```
 */
function isRecord(value: Json | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Builds the error of a route that is not a list of steps.
 *
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * invalidRoute().message.startsWith("[game] The route is not a list of route steps."); // true
 * ```
 */
function invalidRoute(): Error {
  return new Error(
    '[game] The route is not a list of route steps.\n  Pass steps like { at: "home", intent: "play" } or { at: "board", result: { outcome: "left" } }.'
  );
}

/**
 * Reads the result of a skipped sub-flow.
 *
 * @param result - The `result` field of a step.
 * @returns The outcome and its payload, if any.
 * @throws {Error} When the result has no outcome name.
 * @example
 * ```ts
 * readResult({ outcome: "won", payload: { stars: 3 } }); // { outcome: "won", payload: { stars: 3 } }
 * ```
 */
function readResult(result: Json | undefined): { outcome: string; payload?: Json } {
  if (!isRecord(result) || typeof result.outcome !== "string") throw invalidRoute();

  const { outcome, payload } = result;

  return payload === undefined ? { outcome } : { outcome, payload };
}

/**
 * Reads one step: an answer at a rest node, or a substituted sub-flow result.
 *
 * @param step - One element of the route.
 * @returns The step.
 * @throws {Error} When the step has no `at`, or neither an intent nor a result.
 * @example
 * ```ts
 * readStep({ at: "home", intent: "play" }); // { at: "home", intent: "play" }
 * ```
 */
function readStep(step: Json): RouteStep {
  if (!isRecord(step) || typeof step.at !== "string") throw invalidRoute();

  const { at, intent, payload, result } = step;

  if (typeof intent === "string")
    return payload === undefined ? { at, intent } : { at, intent, payload };
  if (result !== undefined) return { at, result: readResult(result) };

  throw invalidRoute();
}

/**
 * Reads a route out of JSON.
 *
 * @param value - The JSON the editor sent.
 * @returns The route steps, in order.
 * @throws {Error} When the value is not a list of steps.
 * @example
 * ```ts
 * readRoute([{ at: "home", intent: "play" }]); // [{ at: "home", intent: "play" }]
 * ```
 */
export function readRoute(value: Json | undefined): RouteStep[] {
  if (!Array.isArray(value)) throw invalidRoute();

  return value.map(step => readStep(step));
}

/**
 * Reads an rng state: a seed and a number per stream.
 *
 * @param value - The JSON value.
 * @returns The rng state, or `undefined` when the value is not one.
 * @example
 * ```ts
 * readRng({ seed: 42, streams: { chest: 3 } }); // { seed: 42, streams: { chest: 3 } }
 * ```
 */
function readRng(value: Json | undefined): RngState | undefined {
  if (!isRecord(value) || typeof value.seed !== "number" || !isRecord(value.streams)) {
    return undefined;
  }

  const streams: Record<string, number> = {};

  for (const [name, draws] of Object.entries(value.streams)) {
    if (typeof draws !== "number") return undefined;

    streams[name] = draws;
  }

  return { seed: value.seed, streams };
}

/**
 * Builds the error of a value that is not a bookmark.
 *
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * invalidBookmark().message.startsWith("[game] The bookmark is not"); // true
 * ```
 */
function invalidBookmark(): Error {
  return new Error(
    "[game] The bookmark is not a flow.bookmark() value.\n  Pass the JSON that game.bookmark returned."
  );
}

/**
 * Reads a bookmark out of JSON, the value `flow.bookmark()` made and the editor kept.
 *
 * @param value - The JSON the editor sent.
 * @returns The bookmark.
 * @throws {Error} When a field is missing or has the wrong type.
 * @example
 * ```ts
 * readBookmark(JSON.parse(saved)).path; // "board/awaitIntent"
 * ```
 */
export function readBookmark(value: Json): Bookmark {
  if (!isRecord(value)) throw invalidBookmark();

  const { path, input, player, session, graph } = value;
  const rng = readRng(value.rng);
  const complete = input !== undefined && player !== undefined && session !== undefined;

  if (typeof path !== "string" || typeof graph !== "string" || !complete || rng === undefined) {
    throw invalidBookmark();
  }

  return { path, input, player, session, rng, graph };
}

/**
 * Builds the error of a value that is not a repro.
 *
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * invalidRepro().message.startsWith("[game] The repro is not a Repro."); // true
 * ```
 */
function invalidRepro(): Error {
  return new Error(
    "[game] The repro is not a Repro.\n  Pass { player, route } with an optional session, rng and checkpoint."
  );
}

/**
 * Reads the optional fields of a repro onto it.
 *
 * @param value - The JSON object of the repro.
 * @param repro - The repro with its player and route.
 * @returns The repro with its session, rng and checkpoint.
 * @throws {Error} When the rng or the checkpoint has the wrong type.
 */
function readReproOptions(value: JsonRecord, repro: Repro): Repro {
  const { session, checkpoint } = value;

  if (session !== undefined) repro.session = session;

  if (value.rng !== undefined) {
    const rng = readRng(value.rng);

    if (rng === undefined) throw invalidRepro();

    repro.rng = rng;
  }

  if (checkpoint !== undefined) {
    if (typeof checkpoint !== "string") throw invalidRepro();

    repro.checkpoint = checkpoint;
  }

  return repro;
}

/**
 * Reads a repro out of JSON: the `/testing` repro of a bug report.
 *
 * @param value - The JSON the editor sent.
 * @returns The repro.
 * @throws {Error} When the player is missing, a field has the wrong type or the route is broken.
 * @example
 * ```ts
 * readRepro({ player: { coins: 7 }, checkpoint: "home", route: [] }).checkpoint; // "home"
 * ```
 */
export function readRepro(value: Json): Repro {
  if (!isRecord(value) || value.player === undefined) throw invalidRepro();

  return readReproOptions(value, { player: value.player, route: readRoute(value.route) });
}
