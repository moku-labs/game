/**
 * @file project — the public types of the project index: the options of `openProject`, the index
 * it holds, the anchors of a key, the fresh lines `find` answers and the handle itself. The index
 * maps every engine id of a game (flows, nodes, features, scenes, projections, emitters, text
 * styles, styles, components and JSX keys) to anchors: a path plus a binding, a key or a component. It never
 * holds a line number; `find` reads the line from the file as it is on disk at the call. Names are
 * followed through relative imports and the tsconfig `paths` of the game. No type here names a
 * `typescript` type, so the shipped declarations need no TypeScript.
 */

/**
 * What `openProject` reads. Paths are root-relative POSIX; the root itself is resolved against the
 * working directory once and never inferred.
 *
 * @example
 * ```ts
 * // The editor opens the mini game with the default manifest and a slower debounce.
 * const options: ProjectOptions = { root: "tests/fixtures/mini-game", debounceMs: 120 };
 * // A v15 game whose aliases live in a second tsconfig.
 * const game: ProjectOptions = { root: "games/orders", tsconfig: "tsconfig.game.json" };
 * ```
 */
export type ProjectOptions = {
  /** The folder of the game. A path that is not a directory rejects `openProject`. */
  root: string;
  /** The asset manifest, root-relative. Default `generated/manifest.json`, where `moku-game keys` writes it. */
  manifest?: string;
  /**
   * The tsconfig whose `paths` the index follows, root-relative. Default `tsconfig.json`. A path
   * that leaves the root or a file that does not parse rejects `openProject`.
   */
  tsconfig?: string;
  /** The quiet period, in milliseconds, that closes a batch of file events. Default 75. */
  debounceMs?: number;
};

/**
 * How a JSX key is written: a string literal `key="hudRow"`, a template `` key={`${id}Picture`} ``,
 * any other expression `key={id}`, or a literal key-carrying prop on a component: `id=`, or a prop
 * whose name ends in `Key` (`id="settingsBoard"`, `amountKey="giftReward"`).
 *
 * @example
 * ```ts
 * const kind: JsxKind = "idProp"; // id="infoPanel" on <Panel>
 * ```
 */
export type JsxKind = "literal" | "template" | "idProp" | "ident";

/**
 * Where a key is defined or used, without a line: the file and what in it holds the key. `find`
 * turns an anchor into a line on the file as it is now.
 *
 * @example
 * ```ts
 * // node:infoPopup/count, defined by the const `count` of nodes/count.ts.
 * const anchor: Anchor = { path: "nodes/count.ts", binding: "count" };
 * ```
 */
export type Anchor = {
  /** The file, root-relative POSIX. */
  path: string;
  /** The const, function or export the definition is bound to. */
  binding?: string;
  /**
   * The property or attribute key: a text style key, the `name` of a projection, a JSX key, or
   * the property a style function builds a style under (`icon` of `roundStylesOf`).
   */
  key?: string;
  /**
   * JSX: the component a key-carrying prop sits on, or the component a `{id}` or `{amountKey}`
   * pattern is written in.
   */
  component?: string;
  /** JSX only: how the key is written. */
  kind?: JsxKind;
  /** JSX templates and identifiers: the literal head of the pattern, `card` for `card*Picture`. */
  stem?: string;
  /** JSX idProp: the prop the value sits on, `id` or `amountKey`. */
  prop?: string;
};

/**
 * The index of one game at one moment: every key with its anchors, every indexed file with its
 * hash, and what could not be read without guessing. Computed on demand, never written to disk.
 *
 * @example
 * ```ts
 * index.symbols["flow:infoPopup"]; // { def: [{ path: "flows/info.ts", binding: "infoFlow" }] }
 * index.files["nodes/count.ts"]?.state; // "ok"
 * // A game whose tsconfig.json holds paths, such as tests/fixtures/layout-game.
 * index.tsconfig; // "tsconfig.json"
 * ```
 */
export type ProjectIndex = {
  /** The shape of this object. A change of shape bumps it. */
  schemaVersion: 1;
  /** sha1 hex over the sorted lines `${path}\0${hash}\n` of every indexed file. */
  revision: string;
  /** The asset manifest, root-relative, when that file exists. */
  manifest?: string;
  /** The tsconfig, root-relative, when that file exists and holds `paths` the index follows. */
  tsconfig?: string;
  /**
   * Every key: where it is defined (`def`), where its binding is used (`uses`, nodes, styles and
   * components, one level), and `conflict` when a key other than `jsx:` is defined twice.
   */
  symbols: Record<string, { def: Anchor[]; uses?: Anchor[]; conflict?: true }>;
  /** Every indexed file: the sha1 of its bytes, and `broken` with the first parse error. */
  files: Record<string, { hash: string; state: "ok" | "broken"; error?: string }>;
  /** What a definer or a JSX key holds that cannot be read without running the game. */
  unresolved: { path: string; reason: string }[];
};

/**
 * What one watch batch changed: the new revision, the files whose bytes changed, the keys that
 * left one file for another, and the keys gone from every file.
 *
 * @example
 * ```ts
 * // An agent moved nodes/count.ts to nodes/info/count.ts and fixed the import of the info flow.
 * change.files; // ["flows/info.ts", "nodes/count.ts", "nodes/info/count.ts"]
 * change.moved; // [{ key: "node:infoPopup/count", from: "nodes/count.ts", to: "nodes/info/count.ts" }]
 * change.removed; // []
 * ```
 */
export type ProjectChange = {
  /** The revision of the index after the batch. */
  revision: string;
  /** The root-relative paths whose bytes changed, appeared or vanished, sorted. */
  files: string[];
  /** A key that left one file and appeared in another in the same batch. */
  moved: { key: string; from: string; to: string }[];
  /** Keys gone from every file. */
  removed: string[];
};

/**
 * One answer of `find`: the anchor with its line read from the file now. Lines and columns are
 * 1-based; the end column is exclusive. A binding answers its declaration statement, a text style
 * key its property, a style built in a function each of its style calls, a JSX key the line of its
 * attribute with the whole element as the range.
 *
 * @example
 * ```ts
 * // The editor opens the Home scene of the mini game.
 * const [found] = await project.find("scene:home");
 * [found?.path, found?.line, found?.range]; // ["features/home/scene.ts", 8, [8, 1, 12, 4]]
 * ```
 */
export type Found = Anchor & {
  /** The line, 1-based. */
  line: number;
  /** Start line, start column, end line, end column; 1-based, the end column exclusive. */
  range: [startLine: number, startColumn: number, endLine: number, endColumn: number];
  /** sha1 hex of the bytes the line was read from. */
  hash: string;
  /** The file does not parse now; the line comes from its last good parse. */
  broken?: true;
};

/**
 * The handle `openProject` returns: one index of one game root, kept fresh by one watcher, and
 * the lines of a key read from disk at the call. Close it when the game closes.
 */
export type ProjectApi = {
  /**
   * The current index. A watch batch or `changed` replaces it with a new frozen object.
   *
   * @example
   * ```ts
   * // The editor checks a node file before it opens it.
   * project.index.files["nodes/count.ts"]?.state; // "ok"
   * ```
   */
  readonly index: ProjectIndex;

  /**
   * Answers where a key is defined, with lines read from the file on disk now. A name is followed
   * through relative imports and the tsconfig aliases, so `@features/home` reaches the file that
   * declares the node. A file whose bytes changed since the index was built is parsed again for
   * the answer; the index itself stays as it is until the next watch batch. A JSX key the game
   * reports at run time also finds the patterns it was built from: exact keys first, then `{id}`
   * and `{amountKey}` patterns filled with a literal prop of the same name on their component
   * (both the pattern and the prop come back), then `*` patterns. An unknown key answers `[]`.
   *
   * @param key - An engine id: `node:infoPopup/count`, `flow:main`, `textStyle:ui.counter`, `jsx:infoPanelSpark`.
   * @returns One entry per place, in the order above; `broken` when the file does not parse now.
   * @example
   * ```ts
   * // The editor jumps to the node the flow view clicked, and to the spark of the info panel.
   * (await project.find("node:infoPopup/count"))[0]?.line; // 7, in "nodes/count.ts"
   * (await project.find("jsx:infoPanelSpark")).map(found => `${found.path}:${found.line}`);
   * // ["features/info/popup.tsx:65", "features/info/popup.tsx:79"]
   * ```
   */
  find(key: string): Promise<Found[]>;

  /**
   * Calls back once per batch of file changes that changed the index, with the new index and
   * what changed. Events only start a batch: when the quiet period ends, the root is walked and
   * every file whose size or time stamp moved is hashed; a save with the same bytes changes
   * nothing and calls nobody. The handle also walks once when watching starts and every two
   * seconds after, for what the platform watcher missed. Every caller shares the one watcher of
   * the handle. An error thrown by a callback is dropped, so the other callers still hear the
   * batch.
   *
   * @param onIndex - Gets the new index and the change of the batch.
   * @returns Removes this caller; the watcher stops with the last one.
   * @throws {Error} When the handle is closed.
   * @example
   * ```ts
   * // The editor refreshes its flow pages when an agent saves a game file.
   * const stop = project.watch((index, change) => pages.refresh(index.revision, change.moved));
   * stop(); // this caller hears no more batches
   * ```
   */
  watch(onIndex: (index: ProjectIndex, change: ProjectChange) => void): () => void;

  /**
   * Re-indexes one root-relative path now, for a caller that watches files itself. A deleted
   * file drops its entries. The tsconfig, or a file it extends, reads the aliases again, and the
   * index is rebuilt when names now follow them elsewhere. Any other path that is not a `.ts` or
   * `.tsx` source of the index changes nothing. The watch callers are not called.
   *
   * @param path - The root-relative POSIX path of the file.
   * @returns The index after the file was read.
   * @throws {Error} When the path leaves the root, by `..` or by a symlink.
   * @example
   * ```ts
   * // The editor saved nodes/count.ts through its own file layer.
   * const index = await project.changed("nodes/count.ts");
   * index.files["nodes/count.ts"]?.state; // "ok"
   * // It added a paths block to tsconfig.json: the keys behind the aliases join the index.
   * (await project.changed("tsconfig.json")).tsconfig; // "tsconfig.json"
   * ```
   */
  changed(path: string): Promise<ProjectIndex>;

  /**
   * Stops the watcher and drops every watch caller. `find` and `changed` keep working.
   *
   * @example
   * ```ts
   * // The editor closes the game.
   * project.close(); // no more batches; project.watch(...) now throws
   * ```
   */
  close(): void;
};

/**
 * The part of the branded console the `moku-game-index` command line writes through. A
 * `BrandConsole` of `@moku-labs/common/cli` fits it; a test passes a recorder.
 *
 * @example
 * ```ts
 * // A test records what the command printed.
 * const lines: string[] = [];
 * const ui: IndexUi = {
 *   line: text => lines.push(text),
 *   info: text => lines.push(text),
 *   error: text => lines.push(text)
 * };
 * ```
 */
export type IndexUi = {
  /** Writes one line as it is: a `where` answer, the JSON of `--json`. */
  line(text: string): void;
  /** Writes one neutral line of the `--check` report. */
  info(message: string): void;
  /** Writes one error line: a broken file, a conflict, an unknown key, a bad flag. */
  error(message: string): void;
};
