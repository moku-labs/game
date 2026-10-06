/**
 * @file project — the command line `moku-game-index`. It opens the project of `--root` and runs one
 * command: `--json` prints the index, `where <key>` prints one `path:line` per place, `--check`
 * reports broken files and conflicts (exit 1), names the tsconfig aliases and lists the
 * unresolved items as info. A run answers once and watches nothing, so it opens a session, not a
 * handle. Output goes through the branded console of `@moku-labs/common`; `runCli` returns the
 * exit code instead of taking it.
 */
import { createBrandConsole } from "@moku-labs/common/cli";
import { findKey } from "./find";
import { openSession, type Session } from "./session";
import type { Found, IndexUi, ProjectOptions } from "./types";

/** One command of the line. */
type Command =
  | { readonly kind: "json" }
  | { readonly kind: "check" }
  | { readonly kind: "where"; readonly key: string };

/** What the flags asked for. */
type Options = {
  readonly root: string;
  readonly manifest?: string;
  readonly tsconfig?: string;
  readonly command: Command;
};

/** The flags as they were read. */
type Flags = { root?: string; manifest?: string; tsconfig?: string; commands: Command[] };

/** The usage line under every flag error. */
const USAGE =
  "Run: moku-game-index --root <dir> [--manifest <path>] [--tsconfig <path>] --json | --check | where <key>.";

/** Pretty JSON indent of `--json`. */
const JSON_INDENT = 2;

/**
 * Wraps a command line problem in the message shape of the framework.
 *
 * @param message - One sentence naming the flag.
 * @returns The error to throw.
 */
function problem(message: string): Error {
  return new Error(`[game] index: ${message}\n  ${USAGE}`);
}

/**
 * Reads the message of anything that was thrown.
 *
 * @param failure - What the `catch` caught.
 * @returns The message.
 */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * The value after a flag that takes one.
 *
 * @param argv - The arguments.
 * @param at - The index of the flag.
 * @param what - What the flag needs, for the error.
 * @returns The value.
 * @throws {Error} When the value is missing.
 */
function valueAfter(argv: readonly string[], at: number, what: string): string {
  const flag = argv[at] ?? "";
  const value = argv[at + 1];

  if (value === undefined || value.startsWith("--")) throw problem(`"${flag}" needs ${what}.`);

  return value;
}

/**
 * Reads one flag or command into the flags.
 *
 * @param argv - The arguments.
 * @param at - The index of the flag.
 * @param flags - The flags so far.
 * @returns How many arguments the flag took.
 * @throws {Error} When the flag is unknown or misses its value.
 */
function readFlag(argv: readonly string[], at: number, flags: Flags): number {
  const flag = argv[at];

  switch (flag) {
    case "--json": {
      flags.commands.push({ kind: "json" });
      return 1;
    }
    case "--check": {
      flags.commands.push({ kind: "check" });
      return 1;
    }
    case "where": {
      flags.commands.push({
        kind: "where",
        key: valueAfter(argv, at, "a key, such as node:board/merge")
      });
      return 2;
    }
    case "--root": {
      flags.root = valueAfter(argv, at, "a path");
      return 2;
    }
    case "--manifest": {
      flags.manifest = valueAfter(argv, at, "a path");
      return 2;
    }
    case "--tsconfig": {
      flags.tsconfig = valueAfter(argv, at, "a path");
      return 2;
    }
    default: {
      throw problem(`unknown option "${String(flag)}".`);
    }
  }
}

/**
 * Reads the arguments.
 *
 * @param argv - The arguments after the script name.
 * @returns The root, the manifest, the tsconfig and the one command.
 * @throws {Error} When a flag is unknown, a value is missing, `--root` is missing or the commands
 *   are not exactly one.
 */
function parseArgv(argv: readonly string[]): Options {
  const flags: Flags = { commands: [] };

  for (let at = 0; at < argv.length; ) at += readFlag(argv, at, flags);

  if (flags.root === undefined) {
    throw new Error(
      '[game] index: "--root" is required.\n  Name the game folder: moku-game-index --root <dir> where <key>.'
    );
  }

  const [command] = flags.commands;

  if (command === undefined || flags.commands.length > 1) {
    throw problem("name one command: --json, --check or where <key>.");
  }

  return {
    root: flags.root,
    command,
    ...(flags.manifest === undefined ? {} : { manifest: flags.manifest }),
    ...(flags.tsconfig === undefined ? {} : { tsconfig: flags.tsconfig })
  };
}

/**
 * One line of a `where` answer.
 *
 * @param found - One place of the key.
 * @returns `path:line`, with ` (broken)` when the line comes from the last good parse.
 * @example
 * ```ts
 * whereLine({ path: "nodes/merge.ts", line: 17, range: [17, 1, 38, 4], hash: "ab" }); // "nodes/merge.ts:17"
 * ```
 */
export function whereLine(found: Found): string {
  return `${found.path}:${found.line}${found.broken === true ? " (broken)" : ""}`;
}

/**
 * Counts a thing in words, so the summary reads as a sentence.
 *
 * @param count - How many.
 * @param word - The singular.
 * @returns The count and the word.
 * @example
 * ```ts
 * plural(1, "key"); // "1 key"
 * ```
 */
function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * The line of `--check` that names the aliases: the tsconfig and how many keys of `paths` it
 * holds, or `none` for a tsconfig without them. A root with no tsconfig gets no line.
 *
 * @param session - The open project.
 * @returns The line, or `undefined`.
 */
function aliasesLine(session: Session): string | undefined {
  const { aliases } = session;

  if (aliases !== undefined) {
    return `aliases: ${aliases.file}, ${plural(aliases.patterns.length, "pattern")}`;
  }

  const hasTsconfig = session.configStamps.get(session.tsconfig) !== undefined;

  return hasTsconfig ? "aliases: none (no tsconfig paths)" : undefined;
}

/**
 * The `--check` report: a summary, the aliases, every broken file and conflict as an error, every
 * unresolved item as info.
 *
 * @param session - The open project.
 * @param ui - Where the lines go.
 * @returns `1` when a file is broken or a key is in conflict, else `0`.
 */
function printCheck(session: Session, ui: IndexUi): number {
  const { index } = session;
  const aliases = aliasesLine(session);
  const files = Object.entries(index.files);
  const symbols = Object.entries(index.symbols);
  const broken = files.filter(([, file]) => file.state === "broken");
  const conflicts = symbols.filter(([, symbol]) => symbol.conflict === true);

  ui.info(
    `${plural(files.length, "file")}, ${plural(symbols.length, "key")}: ` +
      `${broken.length} broken, ${conflicts.length} in conflict, ${index.unresolved.length} unresolved.`
  );

  if (aliases !== undefined) ui.info(aliases);

  for (const [file, entry] of broken) ui.error(`broken ${file}: ${entry.error ?? ""}`);
  for (const [key, symbol] of conflicts) {
    ui.error(`conflict ${key}: ${symbol.def.map(anchor => anchor.path).join(", ")}`);
  }
  for (const item of index.unresolved) ui.info(`unresolved ${item.path}: ${item.reason}`);

  return broken.length + conflicts.length > 0 ? 1 : 0;
}

/**
 * The `where` answer: one line per place of the key.
 *
 * @param session - The open project.
 * @param key - The key.
 * @param root - The root as given, for the message.
 * @param ui - Where the lines go.
 * @returns `1` when the key is unknown, else `0`.
 */
async function printWhere(
  session: Session,
  key: string,
  root: string,
  ui: IndexUi
): Promise<number> {
  const found = await findKey(session, key);

  if (found.length === 0) {
    ui.error(
      `[game] The key "${key}" is not in the index of "${root}".\n  Run "moku-game-index --root ${root} --json" to list the keys.`
    );

    return 1;
  }

  for (const place of found) ui.line(whereLine(place));

  return 0;
}

/**
 * Runs the one command of the line on an open project.
 *
 * @param session - The open project.
 * @param options - What the flags asked for.
 * @param ui - Where the lines go.
 * @returns The exit code.
 */
async function runCommand(session: Session, options: Options, ui: IndexUi): Promise<number> {
  const { command } = options;

  if (command.kind === "where") return printWhere(session, command.key, options.root, ui);
  if (command.kind === "check") return printCheck(session, ui);

  ui.line(JSON.stringify(session.index, undefined, JSON_INDENT));

  return 0;
}

/**
 * Runs `moku-game-index`: opens the project of `--root` and runs one command. Nothing here calls
 * `process.exit`; the caller does.
 *
 * @param argv - The arguments after the script name.
 * @param ui - Where the lines go. The branded console by default.
 * @returns The exit code: `1` for a bad flag, a root that cannot be opened, an unknown key, or a
 *   `--check` that found a broken file or a conflict; else `0`.
 * @example
 * ```ts
 * // An agent asks where a node of the mini game lives.
 * await runCli(["--root", "tests/fixtures/mini-game", "where", "node:infoPopup/count"]);
 * // 0, and the console printed "nodes/count.ts:7"
 * ```
 */
export async function runCli(
  argv: readonly string[],
  ui: IndexUi = createBrandConsole()
): Promise<number> {
  try {
    const options = parseArgv(argv);
    const projectOptions: ProjectOptions = {
      root: options.root,
      ...(options.manifest === undefined ? {} : { manifest: options.manifest }),
      ...(options.tsconfig === undefined ? {} : { tsconfig: options.tsconfig })
    };

    return await runCommand(await openSession(projectOptions), options, ui);
  } catch (error) {
    ui.error(messageOf(error));

    return 1;
  }
}
