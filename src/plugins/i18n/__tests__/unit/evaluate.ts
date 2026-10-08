/**
 * @file i18n plugin — the golden-test harness. Not a test file: the unit project only collects
 * `*.test.ts`. It compiles a message, emits the module the build would write, transpiles it with
 * Bun, and evaluates it. So the goldens assert the real generated code, casts and its import of
 * the engine's `messageArgument` and `messageDuration` included, not a second implementation.
 */
import { emitLocale } from "../../compile/emit";
import { type CompiledSource, compileMessage } from "../../compile/message";
import { createIntlKit, messageArgument, messageDuration } from "../../intl";
import type { CompiledMessage, CompiledMessages, IntlKit, Part } from "../../types";

/** The value exports of `@moku-labs/game` a generated locale module may import. */
const ENGINE: Readonly<Record<string, unknown>> = { messageArgument, messageDuration };

/** The one value import a generated locale module may have: the helpers, from the engine root. */
const ENGINE_IMPORT = /^import \{ ([^}]+) \} from "@moku-labs\/game";$/m;

/**
 * Reads the value import of a transpiled module: each local name and the engine export it binds.
 *
 * @param javascript - The transpiled module.
 * @returns The local names and their values, none for a module without the import.
 * @throws {Error} When the module imports a name the engine does not export.
 */
function importsOf(javascript: string): { names: string[]; values: unknown[] } {
  const specifiers = ENGINE_IMPORT.exec(javascript)?.[1]?.split(",") ?? [];
  const pairs = specifiers.map(specifier => {
    const [imported = "", local = imported] = specifier.trim().split(" as ");

    if (!(imported in ENGINE)) throw new Error(`@moku-labs/game exports no "${imported}"`);

    return [local, ENGINE[imported]] as const;
  });

  return { names: pairs.map(([local]) => local), values: pairs.map(([, value]) => value) };
}

/**
 * Evaluates a generated locale module. Its import of the engine is bound to the real functions,
 * so a helper the module calls without importing it fails here as it would in a game.
 *
 * @param source - The module text `emitLocale` wrote.
 * @returns The compiled messages of the module.
 */
export function evaluateModule(source: string): CompiledMessages {
  const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
  const { names, values } = importsOf(javascript);
  const body = javascript.replace(ENGINE_IMPORT, "").replace("export default", "return");

  return new Function(...names, body)(...values) as CompiledMessages;
}

/**
 * Emits one compiled message into a module and evaluates it.
 *
 * @param source - What the compiler produced for the message.
 * @returns The function the build would have written for it.
 */
export function evaluateCompiled(source: CompiledSource): CompiledMessage {
  const module = evaluateModule(emitLocale([{ key: "sample", compiled: source }]));
  const compiled = module.sample;

  if (compiled === undefined) throw new Error('the emitted module has no key "sample"');

  return compiled;
}

/**
 * Compiles one message and evaluates it.
 *
 * @param text - The ICU message.
 * @returns The function the build would have written for it.
 */
export function messageOf(text: string): CompiledMessage {
  return evaluateCompiled(compileMessage(text));
}

/**
 * Compiles one message and formats it in one locale.
 *
 * @param text - The ICU message.
 * @param locale - The locale to format in.
 * @param params - The parameters of the message.
 * @returns The parts the compiled function returned.
 */
export function partsOf(
  text: string,
  locale: string,
  params: Record<string, unknown> = {}
): Part[] {
  return messageOf(text)(params, createIntlKit(locale));
}

/**
 * Compiles one message and formats it in one locale, as text.
 *
 * @param text - The ICU message.
 * @param locale - The locale to format in.
 * @param params - The parameters of the message.
 * @returns The text parts joined.
 */
export function textOf(text: string, locale: string, params: Record<string, unknown> = {}): string {
  return partsOf(text, locale, params)
    .map(part => (part.kind === "text" ? part.text : ""))
    .join("");
}

/**
 * The kit of one locale, for a golden that compares against `Intl` itself.
 *
 * @param locale - The locale.
 * @returns The formatter kit.
 */
export function kitOf(locale: string): IntlKit {
  return createIntlKit(locale);
}
