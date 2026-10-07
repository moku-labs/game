/**
 * @file The command line of `moku-game`: the arguments read per command with `node:util`
 * `parseArgs`, then one of `dev`, `build`, `native <verb>`, `keys`, `pack`, `visual` or `help`.
 * Every seam of the process (the console, the environment, spawning, signals, the watcher, the
 * asset scanner, native, Bun's resolver, the visual test runner) comes in as `deps`, so a test
 * runs a command with stubs. It returns the exit code and never exits itself. A plain function,
 * on no API.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import type { BrandConsole } from "@moku-labs/common/cli";
import type { HTMLBundle } from "bun";
import type { parseVisualArgv, runVisualTests } from "../visual";
import { keysArguments, packArguments, runBuild } from "./build";
import type { NativeVerb, NativeVerbOptions, NativeWhere } from "./native";
import { checkFiles, loadSettings, type ServeRun, serveChild, serveParent } from "./serve";
import type { ResolvedGameConfig } from "./types";
import { runVisual } from "./visual";

/** The part of the branded console the command line writes through. */
export type CliUi = Pick<BrandConsole, "info" | "warn" | "error" | "line">;

/** A signal the command line listens to or hands on. */
export type Signal = "SIGINT" | "SIGTERM" | "SIGHUP";

/** How a child process is started. `Bun.spawn` takes it. */
export type SpawnOptions = {
  /** The working directory; the parent's when left out. */
  cwd?: string;
  /** The whole environment of the child. */
  env: Readonly<Record<string, string | undefined>>;
  /** The child writes to the parent's terminal. */
  stdio: ["inherit", "inherit", "inherit"];
  /** True to run the child in its own process group, so Ctrl+C reaches the parent only. */
  detached?: boolean;
};

/** A started child process, the part the command line uses. Bun's `Subprocess` fits it. */
export type Child = {
  /** Resolves to the exit code. */
  readonly exited: Promise<number>;
  /**
   * Sends a signal.
   *
   * @param signal - The signal.
   */
  kill(signal?: Signal): void;
};

/** The visual test runner of `@moku-labs/game/visual`, the part `moku-game visual` calls. */
export type VisualRunner = {
  /** Reads the flags of the runner. */
  parseVisualArgv: typeof parseVisualArgv;
  /** Plays the tests and compares every checkpoint with its baselines. */
  runVisualTests: typeof runVisualTests;
};

/** A folder watcher. `fs.watch` gives one. */
export type Watcher = {
  /** Stops watching. */
  close(): void;
};

/** The process seams of the command line. `src/cli.ts` gives the real ones, a test gives stubs. */
export type CliDeps = {
  /** Where every line goes. */
  ui: CliUi;
  /** The environment the bin started with. `MOKU_GAME_CHILD=1` marks a re-run of the bin. */
  env: Readonly<Record<string, string | undefined>>;
  /** The working directory every relative path resolves against. */
  cwd: string;
  /** The Bun that runs the bin. */
  execPath: string;
  /** The arguments that run the bin again after the Bun: `[Bun.main]`. */
  self: readonly string[];
  /** Starts a child process. */
  spawn: (command: string[], options: SpawnOptions) => Child;
  /** Listens to a signal; the returned function stops listening. */
  onSignal: (signal: Signal, handler: () => void) => () => void;
  /** Watches a folder; the listener gets the event name, `"rename"` for an added or removed file. */
  watch: (folder: string, listener: (event: string) => void) => Watcher;
  /** Runs the asset scanner's command line with the string tools; answers its exit code. */
  assets: (argv: string[]) => Promise<number>;
  /** Runs one native verb through `@moku-labs/native`; answers whether it succeeded. */
  native: (
    verb: NativeVerb,
    settings: ResolvedGameConfig,
    where: NativeWhere,
    options: NativeVerbOptions
  ) => Promise<boolean>;
  /** Bun's resolver: the file a specifier gives from a folder. */
  resolve: (specifier: string, from: string) => string;
  /** Imports the written page; its default export is the bundle a Bun server serves. */
  loadPage: (file: string) => Promise<{ default: Response | HTMLBundle }>;
  /** Loads the visual test runner; only `moku-game visual` needs it. */
  visual: () => Promise<VisualRunner>;
};

/** The commands of the line that run something; `help` only prints. */
type Command = "dev" | "build" | "native" | "keys" | "pack" | "visual";

/** The flags every command takes. */
const GLOBAL_OPTIONS = ["root", "preload", "serve-plugin", "help"] as const;

/** Every flag of the line, as `parseArgs` reads it. */
const ALL_OPTIONS = {
  root: { type: "string" },
  preload: { type: "string", multiple: true },
  "serve-plugin": { type: "string", multiple: true },
  help: { type: "boolean", short: "h" },
  port: { type: "string" },
  packed: { type: "boolean" },
  out: { type: "string" },
  simulator: { type: "boolean" },
  check: { type: "boolean" },
  "no-cache": { type: "boolean" },
  tests: { type: "string" },
  url: { type: "string" },
  update: { type: "boolean" },
  only: { type: "string", multiple: true },
  "no-pixels": { type: "boolean" },
  pixels: { type: "boolean" },
  dir: { type: "string" },
  webgl: { type: "boolean" }
} as const;

/** The flags of `visual` that `parseVisualArgv` reads, in the runner's words. */
const VISUAL_FLAGS = /^(?:update|only|no-pixels|pixels|dir|webgl)$/;

/** The flags of one command besides the global ones. */
const COMMAND_OPTIONS: Readonly<Record<Command, readonly (keyof typeof ALL_OPTIONS)[]>> = {
  dev: ["port", "packed"],
  build: ["out"],
  native: ["simulator"],
  keys: ["check"],
  pack: ["no-cache"],
  visual: ["tests", "url", "update", "only", "no-pixels", "pixels", "dir", "webgl"]
};

/** The native verbs, in the order the messages name them. */
const NATIVE_VERBS: readonly NativeVerb[] = ["build", "dev", "doctor", "clean"];

/** The command words, in the order the messages name them. */
const COMMAND_NAMES = "dev, build, native, keys, pack, visual, help";

/** The tests module of a game, under the game folder. */
const VISUAL_TESTS = path.join("tests", "visual", "index.ts");

/** The port of `moku-game dev` without `--port`. */
const DEFAULT_PORT = "3000";

/** The highest port number. */
const MAX_PORT = 65_535;

/** The text of `moku-game help`. */
const USAGE = [
  "moku-game <command> [options]",
  "",
  "  dev [--port 3000] [--packed]          serve the game with hot reload",
  "  build [--out dist/web]                pack the assets and build the page",
  "  native build <target> [--simulator]   build the native app (ios, macos, android)",
  "  native dev <target>                   run the native shell on the dev server",
  "  native doctor | native clean          check or remove the native project",
  "  keys [--check]                        write generated/assets.ts and manifest.json",
  "  pack [--no-cache]                     pack the assets into dist/assets",
  "  visual [--update] [--only <name>]     run tests/visual/index.ts: headless, pixels on a Mac",
  "    [--no-pixels | --pixels] [--webgl] [--dir tests/visual/baselines]",
  "    [--tests tests/visual/index.ts] [--url <url>]",
  "  help                                  print this text",
  "",
  "Every command: --root <dir> (default .), --preload <path>, --serve-plugin <path>."
] as const;

/** The flags of a command, read and resolved. */
type Parsed = {
  /** The command. */
  command: Command;
  /** The arguments after the command word. */
  rest: readonly string[];
  /** The game folder, absolute. */
  root: string;
  /** The `--preload` files, absolute, in order. */
  preload: readonly string[];
  /** The `--serve-plugin` files, absolute, in order. */
  servePlugins: readonly string[];
  /** The values of the command's own flags. */
  values: ReturnType<typeof parseStrict>["values"];
};

/**
 * Tells whether a word is a command of the line that runs something.
 *
 * @param word - The first positional argument.
 * @returns True for `dev`, `build`, `native`, `keys`, `pack` and `visual`.
 */
function isCommand(word: string): word is Command {
  return Object.hasOwn(COMMAND_OPTIONS, word);
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
 * Reads the arguments without refusing anything, to find the command and the raw flags.
 *
 * @param argv - The arguments after the bin.
 * @returns The positionals, the values and the tokens.
 */
function parseLoose(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    options: ALL_OPTIONS,
    strict: false,
    allowPositionals: true,
    tokens: true
  });
}

/**
 * Reads the arguments of a command whose flags were checked.
 *
 * @param argv - The arguments after the bin.
 * @returns The values and the positionals.
 */
function parseStrict(argv: readonly string[]) {
  return parseArgs({ args: [...argv], options: ALL_OPTIONS, strict: true, allowPositionals: true });
}

/**
 * Refuses a flag the command does not take, a flag without its value, and a value given to a
 * switch.
 *
 * @param command - The command.
 * @param tokens - The tokens of the loose read.
 * @throws {Error} Naming the command and the flag.
 */
function checkTokens(command: Command, tokens: ReturnType<typeof parseLoose>["tokens"]): void {
  const names = new Set<string>([...GLOBAL_OPTIONS, ...COMMAND_OPTIONS[command]]);
  const allowed = new Map(
    Object.entries(ALL_OPTIONS)
      .filter(([name]) => names.has(name))
      .map(([name, option]) => [name, option.type])
  );

  for (const token of tokens) {
    if (token.kind !== "option") continue;

    const type = allowed.get(token.name);

    if (type === undefined) {
      throw new Error(`[game] ${command}: unknown option "${token.rawName}".`);
    }

    const missing =
      token.value === undefined || (token.inlineValue !== true && token.value.startsWith("-"));

    if (type === "string" && missing) {
      throw new Error(`[game] ${command}: "${token.rawName}" needs a value.`);
    }

    if (type === "boolean" && token.inlineValue === true) {
      throw new Error(`[game] ${command}: "${token.rawName}" takes no value.`);
    }
  }
}

/**
 * Reads the command line into one command with its flags, the paths resolved against the
 * working directory.
 *
 * @param argv - The arguments after the bin.
 * @param cwd - The working directory.
 * @returns The command, `"help"`, or `undefined` when no command is named.
 * @throws {Error} When the command is unknown or a flag is refused.
 */
function parseCommand(argv: readonly string[], cwd: string): Parsed | "help" | undefined {
  const loose = parseLoose(argv);
  const word = loose.positionals[0];

  if (loose.values.help === true || word === "help") return "help";
  if (word === undefined) return undefined;

  if (!isCommand(word)) {
    throw new Error(`[game] moku-game: no command "${word}". Name one of ${COMMAND_NAMES}.`);
  }

  checkTokens(word, loose.tokens);

  const { values, positionals } = parseStrict(argv);
  const resolveAll = (files: readonly string[] | undefined): string[] =>
    (files ?? []).map(file => path.resolve(cwd, file));

  return {
    command: word,
    rest: positionals.slice(1),
    root: path.resolve(cwd, values.root ?? "."),
    preload: resolveAll(values.preload),
    servePlugins: resolveAll(values["serve-plugin"]),
    values
  };
}

/**
 * Refuses arguments after the command word beyond the ones it takes.
 *
 * @param parsed - The command line.
 * @param count - How many positional arguments the command takes.
 * @throws {Error} Naming the first extra argument.
 */
function refuseExtra(parsed: Parsed, count: number): void {
  const extra = parsed.rest[count];

  if (extra !== undefined) {
    throw new Error(`[game] ${parsed.command}: unexpected argument "${extra}".`);
  }
}

/**
 * Reads `--port`: an integer 0-65535, 3000 when left out.
 *
 * @param given - The value of the flag.
 * @returns The port.
 * @throws {Error} When the value is not a port.
 * @example
 * ```ts
 * portOf(undefined); // 3000
 * ```
 */
function portOf(given: string | undefined): number {
  const text = given ?? DEFAULT_PORT;
  const port = Number(text);
  const isPort = /^\d+$/.test(text) && port <= MAX_PORT;

  if (!isPort) {
    throw new Error(`[game] dev: --port must be an integer 0-65535, got "${text}".`);
  }

  return port;
}

/**
 * Runs `moku-game dev`: the parent, or the server child the parent started.
 *
 * @param parsed - The command line.
 * @param deps - The process seams.
 * @returns The exit code.
 */
function runServe(parsed: Parsed, deps: CliDeps): Promise<number> {
  refuseExtra(parsed, 0);

  const run: ServeRun = {
    root: parsed.root,
    port: portOf(parsed.values.port),
    packed: parsed.values.packed === true,
    preload: parsed.preload,
    servePlugins: parsed.servePlugins
  };

  return deps.env.MOKU_GAME_CHILD === "1" ? serveChild(run, deps) : serveParent(run, deps);
}

/**
 * The command that runs `moku-game` again for native's web build and dev server, with the runner
 * flags, every word quoted.
 *
 * @param parsed - The command line.
 * @param deps - The Bun and the bin.
 * @returns The command text.
 */
function selfCommand(parsed: Parsed, deps: CliDeps): string {
  const runnerFlags = [
    ...parsed.preload.flatMap(file => ["--preload", file]),
    ...parsed.servePlugins.flatMap(file => ["--serve-plugin", file])
  ];

  return [deps.execPath, ...deps.self, "--root", parsed.root, ...runnerFlags]
    .map(word => JSON.stringify(word))
    .join(" ");
}

/**
 * Runs `moku-game native <verb> [<target>]` through native.
 *
 * @param parsed - The command line.
 * @param deps - The process seams.
 * @returns `0` when the verb succeeded, `1` when native reported a failure.
 * @throws {Error} When the verb is missing or unknown, or native refuses the config or target.
 */
async function runNativeVerb(parsed: Parsed, deps: CliDeps): Promise<number> {
  const [word, target] = parsed.rest;
  const verb = NATIVE_VERBS.find(name => name === word);

  if (word === undefined) {
    throw new Error("[game] native: name a verb: build, dev, doctor, clean.");
  }

  if (verb === undefined) {
    throw new Error(`[game] native: no verb "${word}". Name one of build, dev, doctor, clean.`);
  }

  refuseExtra(parsed, 2);

  const settings = await loadSettings(parsed.root);
  const where: NativeWhere = { cwd: parsed.root, command: selfCommand(parsed, deps) };
  const options: NativeVerbOptions = {
    ...(target === undefined ? {} : { target }),
    ...(verb === "build" && parsed.values.simulator === true ? { simulator: true } : {})
  };

  return (await deps.native(verb, settings, where, options)) ? 0 : 1;
}

/**
 * Runs `moku-game keys` or `pack` through the asset scanner, with the layers of `config.ts`.
 *
 * @param parsed - The command line.
 * @param deps - The process seams.
 * @returns The scanner's exit code.
 */
async function runScan(parsed: Parsed, deps: CliDeps): Promise<number> {
  refuseExtra(parsed, 0);

  const settings = await loadSettings(parsed.root);
  const argv =
    parsed.command === "keys"
      ? keysArguments(parsed.root, settings, parsed.values.check === true)
      : packArguments(parsed.root, settings, parsed.values["no-cache"] === true);

  return deps.assets(argv);
}

/**
 * The flags of `visual` that `parseVisualArgv` reads, in the order given, each value after its
 * flag: `--dir=shots` becomes `--dir shots`.
 *
 * @param argv - The arguments after the bin, their flags checked.
 * @returns The flags of the runner.
 */
function visualFlags(argv: readonly string[]): string[] {
  return parseLoose(argv).tokens.flatMap(token => {
    if (token.kind !== "option" || !VISUAL_FLAGS.test(token.name)) return [];

    return token.value === undefined ? [`--${token.name}`] : [`--${token.name}`, token.value];
  });
}

/**
 * Runs `moku-game visual` with the tests module and the baselines of the game.
 *
 * @param argv - The arguments after the bin.
 * @param parsed - The command line.
 * @param deps - The process seams.
 * @returns `0` when every checkpoint passed, else `1`.
 */
function runVisualCommand(argv: readonly string[], parsed: Parsed, deps: CliDeps): Promise<number> {
  refuseExtra(parsed, 0);

  const tests = parsed.values.tests ?? path.join(parsed.root, VISUAL_TESTS);
  const url = parsed.values.url;

  return runVisual(
    {
      argv,
      root: parsed.root,
      tests: path.resolve(deps.cwd, tests),
      ...(url === undefined ? {} : { url }),
      flags: visualFlags(argv),
      preload: parsed.preload,
      servePlugins: parsed.servePlugins
    },
    deps
  );
}

/**
 * Runs the bin once more with every `--preload` as a Bun preload, so the preload runs before the
 * engine loads. The re-run is marked, so it does not hop again.
 *
 * @param argv - The arguments after the bin.
 * @param parsed - The command line.
 * @param deps - The process seams.
 * @returns The exit code of the re-run.
 */
function hop(argv: readonly string[], parsed: Parsed, deps: CliDeps): Promise<number> {
  const child = deps.spawn(
    [deps.execPath, ...parsed.preload.map(file => `--preload=${file}`), ...deps.self, ...argv],
    { env: { ...deps.env, MOKU_GAME_CHILD: "1" }, stdio: ["inherit", "inherit", "inherit"] }
  );

  return child.exited;
}

/**
 * Runs one checked command.
 *
 * @param argv - The arguments after the bin.
 * @param parsed - The command line.
 * @param deps - The process seams.
 * @returns The exit code.
 */
async function runParsed(argv: readonly string[], parsed: Parsed, deps: CliDeps): Promise<number> {
  const usesPlugins = parsed.command !== "keys" && parsed.command !== "pack";

  checkFiles("--preload", parsed.preload);
  if (usesPlugins) checkFiles("--serve-plugin", parsed.servePlugins);

  // `dev` and `visual` run the bin again themselves, under the bunfig of their page.
  const hops =
    parsed.command !== "dev" &&
    parsed.command !== "visual" &&
    parsed.preload.length > 0 &&
    deps.env.MOKU_GAME_CHILD !== "1";

  if (hops) return hop(argv, parsed, deps);

  switch (parsed.command) {
    case "dev": {
      return runServe(parsed, deps);
    }
    case "build": {
      refuseExtra(parsed, 0);

      const out = parsed.values.out ?? path.join(parsed.root, "dist", "web");

      return runBuild(
        { root: parsed.root, out: path.resolve(deps.cwd, out), servePlugins: parsed.servePlugins },
        deps
      );
    }
    case "native": {
      return runNativeVerb(parsed, deps);
    }
    case "keys":
    case "pack": {
      return runScan(parsed, deps);
    }
    case "visual": {
      return runVisualCommand(argv, parsed, deps);
    }
  }
}

/**
 * Prints the usage text on stdout.
 *
 * @param ui - The console.
 */
function printUsage(ui: CliUi): void {
  for (const line of USAGE) ui.line(line);
}

/**
 * Runs one `moku-game` command line: reads the command and its flags, then runs `dev`, `build`,
 * `native <verb>`, `keys`, `pack`, `visual` or `help`. Every failure is printed through the
 * console as a `[game] …` message; nothing exits the process.
 *
 * @param argv - The arguments after the bin.
 * @param deps - The process seams.
 * @returns The exit code: `0` on success, the child's code for `dev`, else `1` or the scanner's.
 */
export async function runCommand(argv: readonly string[], deps: CliDeps): Promise<number> {
  try {
    const parsed = parseCommand(argv, deps.cwd);

    if (parsed === "help") {
      printUsage(deps.ui);

      return 0;
    }

    if (parsed === undefined) {
      printUsage(deps.ui);
      deps.ui.error(`[game] moku-game: name a command: ${COMMAND_NAMES}.`);

      return 1;
    }

    return await runParsed(argv, parsed, deps);
  } catch (error) {
    deps.ui.error(messageOf(error));

    return 1;
  }
}
