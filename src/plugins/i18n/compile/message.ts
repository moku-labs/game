/**
 * @file i18n plugin, build time — one ICU MessageFormat 1 message into one function source and
 * the types of its parameters. The parser runs here and nowhere else: what ships to the browser
 * is the function this file writes. Node and Bun only.
 */
import {
  type MessageFormatElement,
  type PluralOrSelectOption,
  parse,
  type Skeleton,
  TYPE
} from "@formatjs/icu-messageformat-parser";

/**
 * What one parameter of a message is typed as. `select` carries its option names, which become
 * the union a game may pass.
 */
export type ParameterType =
  | { kind: "argument" }
  | { kind: "number" }
  | { kind: "date" }
  | { kind: "select"; options: readonly string[] };

/**
 * What one compiled message carries: the arrow source the build writes, the parameters it reads
 * and whether it needs the `argument` helper of the generated module.
 */
export type CompiledSource = {
  /** The arrow function source, as it appears in the generated module. */
  source: string;
  /** The parameters the message reads, by name. */
  params: Record<string, ParameterType>;
  /** True when the message uses a plain argument, so the module needs the `argument` helper. */
  usesArgument: boolean;
};

/** One piece of a message while it is being compiled. */
type Piece =
  | { kind: "literal"; text: string }
  | { kind: "expr"; code: string }
  | { kind: "part"; code: string }
  | { kind: "parts"; code: string };

/** A piece that renders as text rather than as an element. */
type TextPiece = Extract<Piece, { kind: "literal" } | { kind: "expr" }>;

/** One branch of a plural or a select while it is being compiled. */
type Branch = { test: string; value: string };

/** What the walk collects while it writes the source. */
type Scan = {
  params: Record<string, ParameterType>;
  usesArgument: boolean;
  usesParams: boolean;
  usesIntl: boolean;
};

/** The style a `{d, date}` with no style means. */
const DEFAULT_DATE_STYLE = "medium";

/** A parameter name that can be read with a dot. */
const PLAIN_NAME = /^[A-Za-z_$][\w$]*$/;

/** The TypeScript cast keyword, kept apart so this file writes one and holds none. */
const CAST = "as";

/**
 * Writes a cast into the generated source.
 *
 * @param expression - What is being cast.
 * @param type - The type it is cast to.
 * @returns The expression with its cast.
 */
function cast(expression: string, type: string): string {
  return `${expression} ${CAST} ${type}`;
}

/**
 * Wraps a compile problem. The caller adds the key and the file.
 *
 * @param reason - One sentence naming what the message asked for.
 * @returns The error to throw.
 */
function problem(reason: string): Error {
  return new Error(reason);
}

/**
 * Reads the message of anything the parser threw.
 *
 * @param error - What the `catch` caught.
 * @returns The message.
 */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Parses one message, turning a parser failure into a compile problem.
 *
 * @param text - The message as the game wrote it.
 * @returns The elements of the message.
 * @throws {Error} When the message does not parse.
 */
function parseMessage(text: string): MessageFormatElement[] {
  try {
    return parse(text, { ignoreTag: true });
  } catch (error) {
    throw problem(detailOf(error));
  }
}

/**
 * Tells whether a style is one of the four ICU date and time names.
 *
 * @param style - The style the message asked for.
 * @returns True for "short", "medium", "long" and "full".
 */
function isDateStyle(style: string): boolean {
  return style === "short" || style === "medium" || style === "long" || style === "full";
}

/**
 * Names one style for a problem message, whether it arrived as text or as a parsed skeleton.
 *
 * @param style - What the parser read after the argument type.
 * @returns The style as the game wrote it.
 */
function styleName(style: string | Skeleton | null | undefined): string {
  if (typeof style === "string") return style;
  if (style === null || style === undefined) return "";
  if ("pattern" in style) return style.pattern;

  return style.tokens.map(token => token.stem).join(" ");
}

/**
 * Reads one parameter of `p`.
 *
 * @param name - The parameter name.
 * @returns The access expression.
 */
function access(name: string): string {
  return PLAIN_NAME.test(name) ? `p.${name}` : `p[${JSON.stringify(name)}]`;
}

/**
 * Records the type of one parameter, refusing a name used with two argument kinds.
 *
 * @param scan - What the walk collects.
 * @param name - The parameter name.
 * @param type - What this use of the parameter needs.
 * @throws {Error} When the same name is used with two kinds in one message.
 */
function addParameter(scan: Scan, name: string, type: ParameterType): void {
  const known = scan.params[name];

  scan.usesParams = true;

  if (known === undefined) {
    scan.params[name] = type;

    return;
  }

  if (known.kind !== type.kind) {
    throw problem(`the parameter "${name}" is used as ${known.kind} and as ${type.kind}`);
  }

  if (known.kind === "select" && type.kind === "select") {
    scan.params[name] = {
      kind: "select",
      options: unique([...known.options, ...type.options])
    };
  }
}

/**
 * Sorts option names and drops the repeats. Its own function because lint rule L5 refuses a
 * collection built inside an exported declaration.
 *
 * @param options - The option names of one select, from any number of uses.
 * @returns The names, unique and sorted.
 * @example
 * ```ts
 * unique(["language", "audio", "audio"]); // ["audio", "language"]
 * ```
 */
function unique(options: readonly string[]): string[] {
  return [...new Set(options)].toSorted();
}

/**
 * Escapes a literal so it is safe between backticks.
 *
 * @param text - The literal.
 * @returns The literal, escaped.
 */
function escapeTemplate(text: string): string {
  return text
    .replaceAll("\\", String.raw`\\`)
    .replaceAll("`", String.raw`\``)
    .replaceAll("${", "\\${");
}

/**
 * Reads the code of one piece.
 *
 * @param piece - The piece.
 * @returns Its expression.
 */
function codeOf(piece: Piece): string {
  return piece.kind === "literal" ? JSON.stringify(piece.text) : piece.code;
}

/**
 * Tells whether a piece is text rather than an element.
 *
 * @param piece - The piece.
 * @returns True for a literal or a string expression.
 */
function isText(piece: Piece): piece is TextPiece {
  return piece.kind === "literal" || piece.kind === "expr";
}

/**
 * Joins text pieces into one string expression: a quoted literal when nothing varies, else a
 * template literal.
 *
 * @param pieces - The pieces, all of them text.
 * @returns The string expression.
 */
function joinText(pieces: readonly Piece[]): string {
  const only = pieces.length === 1 ? pieces[0] : undefined;

  if (pieces.length === 0) return '""';
  if (only !== undefined) return codeOf(only);

  const body = pieces
    .map(piece => (piece.kind === "literal" ? escapeTemplate(piece.text) : `\${${codeOf(piece)}}`))
    .join("");

  return `\`${body}\``;
}

/**
 * Turns the pieces of a message into a `Part[]` expression. Runs of text become one text part;
 * an element keeps its place.
 *
 * @param pieces - The pieces of the message.
 * @returns The array expression.
 */
function toParts(pieces: readonly Piece[]): string {
  if (pieces.every(piece => isText(piece))) return `[{ kind: "text", text: ${joinText(pieces)} }]`;

  const items: string[] = [];
  const run: Piece[] = [];
  const flush = (): void => {
    if (run.length > 0) items.push(`{ kind: "text", text: ${joinText(run)} }`);

    run.length = 0;
  };

  for (const piece of pieces) {
    if (isText(piece)) {
      run.push(piece);
      continue;
    }

    flush();
    items.push(piece.kind === "parts" ? `...${piece.code}` : piece.code);
  }

  flush();

  return `[${items.join(", ")}]`;
}

/**
 * Writes a chain of conditions, parenthesised so it nests safely.
 *
 * @param tests - The condition and the value of each branch, in order.
 * @param otherwise - The value of the last branch.
 * @returns The chain expression.
 */
function chain(tests: readonly Branch[], otherwise: string): string {
  if (tests.length === 0) return otherwise;

  const body = tests.map(entry => `${entry.test} ? ${entry.value} : `).join("");

  return `(${body}${otherwise})`;
}

/**
 * Compiles the branches of a plural or a select. When every branch is text the whole argument is
 * one string expression; as soon as one branch holds an element it becomes a `Part[]` expression.
 *
 * @param options - The branches the parser read.
 * @param scan - What the walk collects.
 * @param pound - What `#` stands for inside these branches.
 * @returns The code of each branch and whether they are all text.
 */
function branchesOf(
  options: Record<string, PluralOrSelectOption>,
  scan: Scan,
  pound: string | undefined
): { code: Record<string, string>; allText: boolean } {
  const pieces: Record<string, Piece[]> = {};

  for (const [name, option] of Object.entries(options)) {
    pieces[name] = piecesOf(option.value, scan, pound);
  }

  const allText = Object.values(pieces).every(list => list.every(piece => isText(piece)));
  const code: Record<string, string> = {};

  for (const [name, list] of Object.entries(pieces)) {
    code[name] = allText ? joinText(list) : toParts(list);
  }

  return { code, allText };
}

/**
 * Builds the piece one plural or select argument becomes.
 *
 * @param tests - The condition and the value of each branch.
 * @param otherwise - The value of the `other` branch, when the argument declared one.
 * @param allText - Whether every branch is text.
 * @returns The piece.
 * @throws {Error} When the argument has no `other` branch.
 */
function branchPiece(
  tests: readonly Branch[],
  otherwise: string | undefined,
  allText: boolean
): Piece {
  if (otherwise === undefined) throw problem("MISSING_OTHER_CLAUSE");

  const code = chain(tests, otherwise);

  if (allText) return { kind: "expr", code };

  // The array literals of the branches sit behind a conditional, where the contextual type of
  // the module's `satisfies` no longer reaches them. This puts it back, so `kind` stays literal.
  return { kind: "parts", code: `(${code} satisfies I18n.Part[])` };
}

/**
 * Compiles a `plural` or `selectordinal` argument. The exact matches are tested first, then the
 * plural category of the value minus the offset.
 *
 * @param element - The argument the parser read.
 * @param scan - What the walk collects.
 * @returns The piece it becomes.
 * @throws {Error} When the argument has no `other` branch.
 */
function pluralPiece(
  element: Extract<MessageFormatElement, { type: TYPE.plural }>,
  scan: Scan
): Piece {
  addParameter(scan, element.value, { kind: "number" });
  scan.usesIntl = true;

  const number = `(${cast(access(element.value), "number")})`;
  const value = element.offset === 0 ? number : `(${number} - ${element.offset})`;
  const rules =
    element.pluralType === "ordinal" ? 'intl.plural({ type: "ordinal" })' : "intl.plural()";
  const { code, allText } = branchesOf(element.options, scan, `intl.number().format(${value})`);
  const exact: Branch[] = [];
  const categories: Branch[] = [];

  for (const [name, branch] of Object.entries(code)) {
    if (name === "other") continue;

    if (name.startsWith("=")) exact.push({ test: `${value} === ${name.slice(1)}`, value: branch });
    else {
      categories.push({
        test: `${rules}.select(${value}) === ${JSON.stringify(name)}`,
        value: branch
      });
    }
  }

  return branchPiece([...exact, ...categories], code.other, allText);
}

/**
 * Compiles a `select` argument.
 *
 * @param element - The argument the parser read.
 * @param scan - What the walk collects.
 * @param pound - What `#` stands for inside these branches.
 * @returns The piece it becomes.
 * @throws {Error} When the argument has no `other` branch.
 */
function selectPiece(
  element: Extract<MessageFormatElement, { type: TYPE.select }>,
  scan: Scan,
  pound: string | undefined
): Piece {
  addParameter(scan, element.value, {
    kind: "select",
    options: Object.keys(element.options)
      .filter(name => name !== "other")
      .toSorted()
  });

  const subject = `String(${access(element.value)})`;
  const { code, allText } = branchesOf(element.options, scan, pound);
  const tests: Branch[] = [];

  for (const [name, branch] of Object.entries(code)) {
    if (name === "other") continue;

    tests.push({ test: `${subject} === ${JSON.stringify(name)}`, value: branch });
  }

  return branchPiece(tests, code.other, allText);
}

/**
 * Writes the `Intl.NumberFormat` options one ICU number style asks for.
 *
 * @param style - The style the message named, empty for none.
 * @returns The options as source, empty for the plain format.
 * @example
 * ```ts
 * numberOptions("percent"); // '{ style: "percent" }'
 * ```
 */
function numberOptions(style: string): string {
  if (style === "integer") return "{ maximumFractionDigits: 0 }";
  if (style === "percent") return '{ style: "percent" }';

  return "";
}

/**
 * Compiles a `number` argument.
 *
 * @param element - The argument the parser read.
 * @param scan - What the walk collects.
 * @returns The piece it becomes.
 * @throws {Error} When the style is not one this engine supports.
 */
function numberPiece(
  element: Extract<MessageFormatElement, { type: TYPE.number }>,
  scan: Scan
): Piece {
  const style = styleName(element.style);

  if (style !== "" && style !== "integer" && style !== "percent") {
    throw problem(`the number style "${style}" is not supported`);
  }

  addParameter(scan, element.value, { kind: "number" });
  scan.usesIntl = true;

  return {
    kind: "expr",
    code: `intl.number(${numberOptions(style)}).format(${cast(access(element.value), "number")})`
  };
}

/**
 * Compiles a `date` or a `time` argument.
 *
 * @param element - The argument the parser read.
 * @param scan - What the walk collects.
 * @param field - Which half of `Intl.DateTimeFormat` the argument names.
 * @returns The piece it becomes.
 * @throws {Error} When the style is not one of the four ICU names.
 */
function datePiece(
  element: Extract<MessageFormatElement, { type: TYPE.date | TYPE.time }>,
  scan: Scan,
  field: "dateStyle" | "timeStyle"
): Piece {
  const named = styleName(element.style);
  const style = named === "" ? DEFAULT_DATE_STYLE : named;

  if (!isDateStyle(style)) throw problem(`the ${field} "${named}" is not supported`);

  addParameter(scan, element.value, { kind: "date" });
  scan.usesIntl = true;

  const argument = cast(access(element.value), "Date | number");

  return { kind: "expr", code: `intl.date({ ${field}: "${style}" }).format(${argument})` };
}

/**
 * Compiles one run of message elements into pieces.
 *
 * @param elements - What the parser read.
 * @param scan - What the walk collects.
 * @param pound - What `#` stands for here, when a plural is open.
 * @returns The pieces, in order.
 * @throws {Error} When the run holds a feature this engine does not support.
 */
function piecesOf(elements: readonly MessageFormatElement[], scan: Scan, pound?: string): Piece[] {
  const pieces: Piece[] = [];

  for (const element of elements) {
    switch (element.type) {
      case TYPE.literal: {
        pieces.push({ kind: "literal", text: element.value });
        break;
      }
      case TYPE.argument: {
        addParameter(scan, element.value, { kind: "argument" });
        scan.usesArgument = true;
        scan.usesIntl = true;
        pieces.push({ kind: "part", code: `argument(${access(element.value)}, intl)` });
        break;
      }
      case TYPE.number: {
        pieces.push(numberPiece(element, scan));
        break;
      }
      case TYPE.date: {
        pieces.push(datePiece(element, scan, "dateStyle"));
        break;
      }
      case TYPE.time: {
        pieces.push(datePiece(element, scan, "timeStyle"));
        break;
      }
      case TYPE.select: {
        pieces.push(selectPiece(element, scan, pound));
        break;
      }
      case TYPE.plural: {
        pieces.push(pluralPiece(element, scan));
        break;
      }
      case TYPE.pound: {
        if (pound === undefined) throw problem('"#" is only allowed inside a plural');

        pieces.push({ kind: "expr", code: pound });
        break;
      }
      default: {
        // `parse` runs with `ignoreTag: true`, so a tag is literal text and never arrives here.
        throw problem("the message holds an element this engine cannot read");
      }
    }
  }

  return pieces;
}

/**
 * Writes the head of the arrow, naming only the arguments the body reads.
 *
 * @param scan - What the walk collected.
 * @returns The parameter list.
 */
function headOf(scan: Scan): string {
  if (scan.usesIntl) return "(p, intl)";

  return scan.usesParams ? "p" : "()";
}

/**
 * Compiles one ICU message into the arrow the build writes into `generated/strings.<locale>.ts`.
 *
 * @param text - The message as the game wrote it.
 * @returns The arrow source, the parameter types and whether the module needs the helper.
 * @throws {Error} When the message does not parse or uses an unsupported ICU feature.
 * @example
 * ```ts
 * compileMessage("Заказы").source; // '() => [{ kind: "text", text: "Заказы" }]'
 * ```
 */
export function compileMessage(text: string): CompiledSource {
  const scan: Scan = { params: {}, usesArgument: false, usesParams: false, usesIntl: false };
  const pieces = piecesOf(parseMessage(text), scan);

  return {
    source: `${headOf(scan)} => ${toParts(pieces)}`,
    params: scan.params,
    usesArgument: scan.usesArgument
  };
}
