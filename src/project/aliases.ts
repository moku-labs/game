/**
 * @file project — the tsconfig `paths` of a game, the one alias resolver of the index. A v15 game
 * imports across its layers through aliases (`@core/kit`, `@features/home`, `@shared`). The
 * tsconfig is read with TypeScript, so JSONC and the `extends` chain are TypeScript's own; a
 * specifier is matched the way TypeScript matches it: an exact key first, then the `*` key with
 * the longest prefix. The engine is a package by definition and is never matched. Paths in and
 * out are root-relative POSIX.
 */
import path from "node:path";
import type ts from "typescript";
import { GAME_PACKAGE } from "./extract/module";
import { readInside, toPosix } from "./paths";
import type { TypeScript } from "./typescript";

/** One key of `compilerOptions.paths`. */
export type AliasPattern = {
  /** The text before the `*`, or the whole key when it has none. */
  readonly prefix: string;
  /** The text after the `*`. A key without `*` has none and matches only itself. */
  readonly suffix?: string;
  /** Where the key points, root-relative POSIX, `*` kept, in the order of the tsconfig. */
  readonly targets: readonly string[];
};

/** The aliases of one tsconfig, and the files they were read from. */
export type AliasMap = {
  /** The tsconfig, root-relative. */
  readonly file: string;
  /** Every file inside the root TypeScript read for it, the tsconfig first: what the stamps watch. */
  readonly sources: readonly string[];
  /** The keys of `paths` with one `*` at most, in the order of the tsconfig; none without `paths`. */
  readonly patterns: readonly AliasPattern[];
};

/** A key of `paths` with its `*`: the text after the `*` is always there. */
type StarPattern = AliasPattern & { readonly suffix: string };

/** What TypeScript makes of a tsconfig: the merged options, and every file it read for them. */
type TsconfigParse = {
  /** The options of the tsconfig, its `extends` chain merged. */
  readonly options: ts.CompilerOptions;
  /** The absolute paths TypeScript asked for, in order. */
  readonly read: readonly string[];
};

/** A specifier relative to the importing file, or an absolute path: never an alias. */
const NOT_BARE = /^(?:\.{1,2}(?:\/|$)|\/)/;

/** The hint under a tsconfig that does not parse. */
const PARSE_HINT = "Fix the file, or name another one with the tsconfig option or --tsconfig.";

/** TypeScript numbers its syntax diagnostics from 1000 to 1999. */
const SYNTAX_CODES = { from: 1000, below: 2000 } as const;

/**
 * Whether a specifier names the engine, which is a package even when the paths map it.
 *
 * @param specifier - A module specifier.
 * @returns True for `@moku-labs/game` and its subpaths.
 * @example
 * ```ts
 * isEngine("@moku-labs/game/testing"); // true
 * ```
 */
function isEngine(specifier: string): boolean {
  return specifier === GAME_PACKAGE || specifier.startsWith(`${GAME_PACKAGE}/`);
}

/**
 * How many `*` a key or a target holds.
 *
 * @param text - A key or a target of `paths`.
 * @returns The count.
 * @example
 * ```ts
 * starsOf("@features/*"); // 1
 * ```
 */
function starsOf(text: string): number {
  return text.split("*").length - 1;
}

/**
 * Whether a diagnostic of a tsconfig says a file does not parse: a syntax error in the tsconfig
 * or in a file it extends. TypeScript also reports an unknown option, a missing `extends` and
 * the empty file list of a read that lists no files; none of them hides the `paths`.
 *
 * @param diagnostic - A diagnostic of the read.
 * @returns True for a syntax error of a file.
 */
function isSyntaxError(diagnostic: ts.Diagnostic): boolean {
  return (
    diagnostic.file !== undefined &&
    diagnostic.code >= SYNTAX_CODES.from &&
    diagnostic.code < SYNTAX_CODES.below
  );
}

/**
 * The error of a tsconfig that does not parse, naming the file and the place as
 * `path:line:col message`.
 *
 * @param typescript - The TypeScript module.
 * @param root - The real root.
 * @param file - The tsconfig, root-relative.
 * @param diagnostic - The syntax error.
 * @returns The error to throw.
 */
function doesNotParse(
  typescript: TypeScript,
  root: string,
  file: string,
  diagnostic: ts.Diagnostic
): Error {
  const text = typescript.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  const message = text.endsWith(".") ? text : `${text}.`;
  const source = diagnostic.file;
  let place = "";

  if (source !== undefined) {
    const { line, character } = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);

    place = `${toPosix(path.relative(root, source.fileName))}:${line + 1}:${character + 1} `;
  }

  return new Error(
    `[game] The tsconfig "${file}" does not parse: ${place}${message}\n  ${PARSE_HINT}`
  );
}

/**
 * The targets of one key of `paths`, root-relative: each string target with one `*` at most,
 * resolved against the base folder. TypeScript does not check the shape of `paths`, so the value
 * is read as the JSON it is.
 *
 * @param root - The real root.
 * @param base - The absolute folder the targets are relative to.
 * @param value - The value of the key.
 * @returns The targets, `*` kept.
 */
function targetsOf(root: string, base: string, value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((target): target is string => typeof target === "string" && starsOf(target) <= 1)
    .map(target => toPosix(path.relative(root, path.resolve(base, target))));
}

/**
 * The patterns of a `paths` block: one per key with one `*` at most and a target. A key or a
 * target with two `*` never matches in TypeScript, so it is dropped here.
 *
 * @param root - The real root.
 * @param base - The absolute folder the targets are relative to.
 * @param paths - The `paths` of the merged options.
 * @returns The patterns, in the order of the keys.
 */
function patternsOf(
  root: string,
  base: string,
  paths: Readonly<Record<string, unknown>>
): AliasPattern[] {
  const patterns: AliasPattern[] = [];

  for (const [key, value] of Object.entries(paths)) {
    const targets = targetsOf(root, base, value);
    const star = key.indexOf("*");

    if (targets.length === 0 || starsOf(key) > 1) continue;

    patterns.push(
      star === -1
        ? { prefix: key, targets }
        : { prefix: key.slice(0, star), suffix: key.slice(star + 1), targets }
    );
  }

  return patterns;
}

/**
 * The files TypeScript read for a tsconfig that lie inside the root, outside `node_modules`,
 * root-relative and each once. A file it tried and did not find is kept: its arrival changes the
 * aliases.
 *
 * @param root - The real root.
 * @param read - The absolute paths TypeScript asked for, in order.
 * @returns The root-relative paths.
 */
function sourcesInside(root: string, read: readonly string[]): string[] {
  const inside = read
    .map(file => toPosix(path.relative(root, file)))
    .filter(file => !file.startsWith("../") && !path.isAbsolute(file))
    .filter(file => !file.split("/").includes("node_modules"));

  return [...new Set(inside)];
}

/**
 * Parses a tsconfig with TypeScript: comments and trailing commas included, its `extends` chain
 * merged, and every file TypeScript reads for that chain noted. No file is listed, so the parse
 * stays cheap.
 *
 * @param typescript - The TypeScript module.
 * @param root - The real root.
 * @param file - The tsconfig, root-relative POSIX.
 * @param text - The text of the tsconfig.
 * @returns The merged options and the files TypeScript read.
 * @throws {Error} When the tsconfig or a file it extends does not parse.
 */
function parseTsconfigOptions(
  typescript: TypeScript,
  root: string,
  file: string,
  text: string
): TsconfigParse {
  // The text itself first: JSONC, its syntax error named by place.
  const absolute = path.join(root, file);
  const parsed = typescript.parseConfigFileTextToJson(absolute, text);

  if (parsed.error !== undefined) throw doesNotParse(typescript, root, file, parsed.error);

  // Every file TypeScript reads for the `extends` chain is noted for the stamps.
  const read: string[] = [];
  const host: ts.ParseConfigHost = {
    ...typescript.sys,
    readDirectory: () => [],
    readFile: name => {
      read.push(name);
      return typescript.sys.readFile(name);
    }
  };
  const { options, errors } = typescript.parseJsonConfigFileContent(
    parsed.config,
    host,
    path.dirname(absolute),
    undefined,
    absolute
  );

  // Only a syntax error hides the `paths`; an unknown option or no inputs do not.
  const syntax = errors.find(diagnostic => isSyntaxError(diagnostic));

  if (syntax !== undefined) throw doesNotParse(typescript, root, file, syntax);

  return { options, read };
}

/**
 * The folder TypeScript resolves `paths` against when no `baseUrl` is set: the folder of the
 * config that declares them, which may be a file the tsconfig extends. TypeScript keeps it on the
 * merged options as `pathsBasePath`, outside its published types.
 *
 * @param options - The merged options.
 * @returns The absolute folder, or `undefined` when no config declares `paths`.
 */
function pathsBaseOf(options: ts.CompilerOptions): string | undefined {
  const base = options.pathsBasePath;

  return typeof base === "string" ? base : undefined;
}

/**
 * Reads the tsconfig `paths` of a game. TypeScript parses the file and merges its `extends`
 * chain. The targets resolve against `baseUrl` when one is set, else against the folder of the
 * config that declares `paths`, as TypeScript resolves them: the folder of the tsconfig, or of the
 * file it extends that holds the block.
 *
 * @param typescript - The TypeScript module.
 * @param root - The real root.
 * @param file - The tsconfig, root-relative POSIX.
 * @returns The aliases, or `undefined` when the file is missing. A tsconfig without `paths` has
 *   no patterns and still lists its sources, so a `paths` block added to a file it extends is seen.
 * @throws {Error} When the tsconfig or a file it extends does not parse.
 */
export async function readAliases(
  typescript: TypeScript,
  root: string,
  file: string
): Promise<AliasMap | undefined> {
  // A missing tsconfig has no aliases; the stamp of its path sees it arrive.
  const bytes = await readInside(root, file);

  if (bytes === undefined) return undefined;

  const text = new TextDecoder().decode(bytes);
  const { options, read } = parseTsconfigOptions(typescript, root, file, text);

  // The targets resolve where TypeScript resolves them.
  const base = options.baseUrl ?? pathsBaseOf(options) ?? path.dirname(path.join(root, file));
  const patterns = patternsOf(root, base, options.paths ?? {});

  // The sources stay even without patterns: their stamps see `paths` arrive.
  return { file, sources: [...new Set([file, ...sourcesInside(root, read)])], patterns };
}

/**
 * Whether a `*` key matches a specifier.
 *
 * @param pattern - A key with `*`.
 * @param suffix - Its suffix.
 * @param specifier - The module specifier.
 * @returns True when the specifier starts with the prefix and ends with the suffix.
 * @example
 * ```ts
 * matchesStar({ prefix: "@core/", suffix: "", targets: ["core/*"] }, "", "@core/kit"); // true
 * ```
 */
function matchesStar(pattern: AliasPattern, suffix: string, specifier: string): boolean {
  return (
    specifier.length >= pattern.prefix.length + suffix.length &&
    specifier.startsWith(pattern.prefix) &&
    specifier.endsWith(suffix)
  );
}

/**
 * Whether a specifier is never an alias: a path relative to the importing file, an absolute path,
 * or the engine.
 *
 * @param specifier - The module specifier as written.
 * @returns True when no key of `paths` may match it.
 * @example
 * ```ts
 * isNeverAlias("@moku-labs/game/testing"); // true
 * ```
 */
function isNeverAlias(specifier: string): boolean {
  return NOT_BARE.test(specifier) || isEngine(specifier);
}

/**
 * Whether a key of `paths` is a `*` key that matches a specifier with a longer prefix than the
 * best match so far.
 *
 * @param pattern - A key of `paths`.
 * @param best - The best `*` match so far, if any.
 * @param specifier - The module specifier.
 * @returns True when the key is the better match.
 * @example
 * ```ts
 * isBetterMatch({ prefix: "@core/", suffix: "", targets: ["core/*"] }, undefined, "@core/kit"); // true
 * ```
 */
function isBetterMatch(
  pattern: AliasPattern,
  best: StarPattern | undefined,
  specifier: string
): pattern is StarPattern {
  const isLonger = best === undefined || pattern.prefix.length > best.prefix.length;

  return (
    pattern.suffix !== undefined && isLonger && matchesStar(pattern, pattern.suffix, specifier)
  );
}

/**
 * The targets a specifier maps to, the way TypeScript maps it: a key without `*` equal to the
 * specifier wins; else the `*` key with the longest prefix, its `*` filled into every target. A
 * relative or absolute specifier, the engine (`@moku-labs/game` and its subpaths) and a specifier
 * no key matches map to nothing.
 *
 * @param aliases - The aliases of the game, if it declares some.
 * @param specifier - The module specifier as written.
 * @returns The root-relative targets in the order of the tsconfig; `[]` for no match.
 * @example
 * ```ts
 * // map: the aliases of tests/fixtures/layout-game/tsconfig.json
 * aliasTargets(map, "@features/orders"); // ["features/orders/index.ts"]
 * aliasTargets(map, "@moku-labs/game/testing"); // []
 * ```
 */
export function aliasTargets(aliases: AliasMap | undefined, specifier: string): string[] {
  if (aliases === undefined || isNeverAlias(specifier)) return [];

  // A key without `*` equal to the specifier wins outright.
  const exact = aliases.patterns.find(
    pattern => pattern.suffix === undefined && pattern.prefix === specifier
  );

  if (exact !== undefined) return [...exact.targets];

  // Else the `*` key with the longest prefix that matches.
  let best: StarPattern | undefined;

  for (const pattern of aliases.patterns) {
    if (isBetterMatch(pattern, best, specifier)) best = pattern;
  }

  if (best === undefined) return [];

  // What the `*` stood for fills the `*` of every target.
  const hole = specifier.slice(best.prefix.length, specifier.length - best.suffix.length);

  return best.targets.map(target => target.replace("*", () => hole));
}

/**
 * Whether two keys of `paths` are the same key with the same targets.
 *
 * @param first - One pattern.
 * @param second - The other, if any.
 * @returns True when prefix, suffix and targets are equal.
 * @example
 * ```ts
 * samePattern({ prefix: "@kit", targets: ["kit.ts"] }, { prefix: "@kit", targets: ["kit.ts"] }); // true
 * ```
 */
function samePattern(first: AliasPattern, second: AliasPattern | undefined): boolean {
  return (
    second !== undefined &&
    first.prefix === second.prefix &&
    first.suffix === second.suffix &&
    first.targets.length === second.targets.length &&
    first.targets.every((target, at) => target === second.targets[at])
  );
}

/**
 * Whether two reads of the aliases resolve alike: the same tsconfig and the same patterns in the
 * same order. The sources are left out: they feed the stamps, not the resolution.
 *
 * @param first - The aliases before, or `undefined` for none.
 * @param second - The aliases after, or `undefined` for none.
 * @returns True when the index built with either is the same.
 * @example
 * ```ts
 * sameAliases(undefined, undefined); // true
 * ```
 */
export function sameAliases(first: AliasMap | undefined, second: AliasMap | undefined): boolean {
  if (first === undefined || second === undefined) return first === second;

  return (
    first.file === second.file &&
    first.patterns.length === second.patterns.length &&
    first.patterns.every((pattern, at) => samePattern(pattern, second.patterns[at]))
  );
}
