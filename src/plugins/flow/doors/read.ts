/**
 * @file flow/doors — `read` and `watch`, the `/inspect` side. Neither changes the game.
 */
import { inputOrEmpty } from "./input";
import type { Changes, InputArguments, InputSchema, Source, WatchApp, WatchInput } from "./types";

/**
 * Reads a source once.
 *
 * @param app - The app the source reads.
 * @param source - The source.
 * @param input - Its input; left out when every field of its schema is optional.
 * @returns What the source reads.
 * @example
 * ```ts
 * // An e2e script checks where the game rests after a tap on Play.
 * read(app, sources.position); // { path: "board/awaitIntent", flow: "board", node: "awaitIntent", waiting: ["tap", "leave"] }
 * read(app, sources.history, { last: 1 }); // [{ path: "home", outcome: "play", next: "board/awaitIntent", ... }]
 * ```
 */
export function read<S extends InputSchema, O, App>(
  app: App,
  source: Source<S, O, App>,
  ...input: InputArguments<S>
): O {
  const [given] = input;

  return source.read(app, inputOrEmpty<S>(given));
}

/**
 * The change test of a `frame` source: it is read on every frame.
 *
 * @returns Always true.
 */
const everyFrame = (): boolean => true;

/**
 * Builds the per-frame test of a change key. `commit` and `edge` compare the identity of the
 * memoised `store.snapshot()` and `flow.state()`, so an unchanged frame allocates nothing.
 *
 * @param app - The watched app.
 * @param changes - The source's change key.
 * @returns A test that is true on the first frame and whenever the key moved.
 */
function changeTest(app: WatchApp, changes: Changes): () => boolean {
  if (changes === "frame") return everyFrame;

  const identity = changes === "commit" ? () => app.model.store.snapshot() : () => app.flow.state();
  let last: object | undefined;

  return () => {
    const current = identity();

    if (current === last) return false;

    last = current;

    return true;
  };
}

/**
 * Watches a source: reads it on the first frame, then again whenever its change key moved,
 * in the `signals` phase of the frame loop.
 *
 * @param app - The app the source reads.
 * @param source - The source.
 * @param input - Its input, or `undefined` when every field of its schema is optional.
 * @param fn - Called with each value read.
 * @returns Stops watching.
 * @example
 * ```ts
 * // An editor panel follows the position; it redraws only after the graph moved.
 * const stop = watch(app, sources.position, undefined, position => panel.show(position.path));
 * // next frame: panel shows "home"; a tap on Play: panel shows "board/awaitIntent"
 * stop();
 * ```
 */
export function watch<S extends InputSchema, O, App extends WatchApp>(
  app: App,
  source: Source<S, O, App>,
  input: WatchInput<S>,
  fn: (value: O) => void
): () => void {
  const given = inputOrEmpty<S>(input);
  const changed = changeTest(app, source.changes);

  return app.time.onFrame("signals", () => {
    if (changed()) fn(source.read(app, given));
  });
}
