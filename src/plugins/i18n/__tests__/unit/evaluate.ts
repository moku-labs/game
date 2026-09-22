/**
 * @file i18n plugin — the golden-test harness. Not a test file: the unit project only collects
 * `*.test.ts`. It compiles a message, emits the module the build would write, transpiles it with
 * the TypeScript the repository already ships, and evaluates it. So the goldens assert the real
 * generated code, casts and `argument` helper included, not a second implementation of it.
 */
import ts from "typescript";
import { emitLocale } from "../../compile/emit";
import { compileMessage } from "../../compile/message";
import { createIntlKit } from "../../intl";
import type { CompiledMessage, CompiledMessages, IntlKit, Part } from "../../types";

/**
 * Evaluates a generated locale module.
 *
 * @param source - The module text `emitLocale` wrote.
 * @returns The compiled messages of the module.
 */
export function evaluateModule(source: string): CompiledMessages {
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText;
  const body = javascript.replace("export default", "return");

  return new Function(body)() as CompiledMessages;
}

/**
 * Compiles one message and evaluates it.
 *
 * @param text - The ICU message.
 * @returns The function the build would have written for it.
 */
export function messageOf(text: string): CompiledMessage {
  const module = evaluateModule(emitLocale([{ key: "sample", compiled: compileMessage(text) }]));
  const compiled = module.sample;

  if (compiled === undefined) throw new Error('the emitted module has no key "sample"');

  return compiled;
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
