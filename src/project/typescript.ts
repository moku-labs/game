/**
 * @file project — the one door to TypeScript. `typescript` is an optional peer of the package: it
 * is loaded here, by a dynamic import, the first time a project opens, and never reaches a game
 * bundle. The package is CommonJS, so the module is its `default` when the runtime wraps it and
 * the namespace itself when it does not. Every other file of the index gets the loaded module as
 * a parameter and imports only its types.
 */
import type ts from "typescript";

/** The TypeScript module as the index uses it: the parser and the syntax guards. */
export type TypeScript = typeof ts;

/** One parse of one file: the syntax tree, and the first parse error when there is one. */
export type Parsed = {
  /** The syntax tree, with parent links. */
  source: ts.SourceFile;
  /** The first parse error, as `path:line:col message`; unset for a file that parses. */
  error?: string;
};

/** The parse errors TypeScript keeps on a source file; not part of its published types. */
type WithParseErrors = ts.SourceFile & {
  readonly parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
};

/** The dynamic import of the peer, as a parameter so a test can make it fail. */
type ImportTypeScript = () => Promise<TypeScript & { default?: TypeScript }>;

/**
 * Loads the optional peer `typescript`.
 *
 * @param load - The import; the real dynamic import by default.
 * @returns The TypeScript module.
 * @throws {Error} When the package is not installed.
 */
export async function loadTypeScript(
  load: ImportTypeScript = () => import("typescript")
): Promise<TypeScript> {
  try {
    const loaded = await load();

    return loaded.default ?? loaded;
  } catch {
    throw new Error(
      '[game] The project index needs the "typescript" package.\n  Install it as a dev dependency of the game.'
    );
  }
}

/**
 * Formats the first parse error of a file as `path:line:col message`, 1-based.
 *
 * @param typescript - The TypeScript module.
 * @param source - The parsed file.
 * @param diagnostic - The parse error.
 * @returns The message.
 */
function describeError(
  typescript: TypeScript,
  source: ts.SourceFile,
  diagnostic: ts.DiagnosticWithLocation
): string {
  const { line, character } = source.getLineAndCharacterOfPosition(diagnostic.start);
  const message = typescript.flattenDiagnosticMessageText(diagnostic.messageText, " ");

  return `${source.fileName}:${line + 1}:${character + 1} ${message}`;
}

/**
 * Parses one file with parent links, as TSX for a `.tsx` path and as TS otherwise.
 *
 * @param typescript - The TypeScript module.
 * @param path - The root-relative path; it names the file in the error.
 * @param text - The source text.
 * @returns The tree and the first parse error.
 */
export function parseFile(typescript: TypeScript, path: string, text: string): Parsed {
  const kind = path.endsWith(".tsx") ? typescript.ScriptKind.TSX : typescript.ScriptKind.TS;
  const source = typescript.createSourceFile(
    path,
    text,
    typescript.ScriptTarget.Latest,
    true,
    kind
  ) as WithParseErrors;
  const [first] = source.parseDiagnostics ?? [];

  if (first === undefined) return { source };

  return { source, error: describeError(typescript, source, first) };
}
