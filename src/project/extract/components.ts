/**
 * @file project, extract — the components of one file and the components it renders. In a `.tsx`
 * file a module-level `function Name(…)`, `const Name = (…) => …` or `const Name = function …`
 * whose name starts upper-case is a component, exported or not; `defineComponent` calls are read
 * with the other definers. The tags a file renders are kept by name, so the cross-file pass can
 * list the files that render a component's binding.
 */
import type ts from "typescript";
import type { Anchor } from "../types";
import type { TypeScript } from "../typescript";
import { COMPONENT_TAG } from "./jsx";
import { declaredFunctions } from "./scope";

/** The prefix of a component key. */
export const COMPONENT = "component:";

/** The extension of the files whose plain functions can be components. */
const JSX_FILE = ".tsx";

/**
 * Reads the plain components of a file: the module-level upper-case functions of a `.tsx` file.
 *
 * @param typescript - The TypeScript module.
 * @param source - The parsed file.
 * @param path - The root-relative path of the file.
 * @returns One `component:<Name>` definition per component, bound to its name, in source order.
 */
export function readComponents(
  typescript: TypeScript,
  source: ts.SourceFile,
  path: string
): { readonly key: string; readonly anchor: Anchor }[] {
  if (!path.endsWith(JSX_FILE)) return [];

  return source.statements
    .flatMap(statement => declaredFunctions(typescript, statement).map(item => item.name))
    .filter(name => COMPONENT_TAG.test(name))
    .map(binding => ({ key: `${COMPONENT}${binding}`, anchor: { path, binding } }));
}

/**
 * The component name a tag renders: an upper-case identifier, or the last segment of a member
 * or namespaced tag. A lower-case identifier is an element of the engine, not a component.
 *
 * @param typescript - The TypeScript module.
 * @param tag - The tag name of an element.
 * @returns The name, or `undefined` for an element of the engine and for `this`.
 */
function renderedName(typescript: TypeScript, tag: ts.JsxTagNameExpression): string | undefined {
  if (typescript.isIdentifier(tag)) return COMPONENT_TAG.test(tag.text) ? tag.text : undefined;
  if (typescript.isPropertyAccessExpression(tag) || typescript.isJsxNamespacedName(tag)) {
    return tag.name.text;
  }

  return undefined;
}

/**
 * The component names a file renders, each once.
 *
 * @param typescript - The TypeScript module.
 * @param source - The parsed file.
 * @returns The names, sorted; none for a file without JSX.
 */
export function renderedOf(typescript: TypeScript, source: ts.SourceFile): string[] {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    const isOpening =
      typescript.isJsxOpeningElement(node) || typescript.isJsxSelfClosingElement(node);
    const name = isOpening ? renderedName(typescript, node.tagName) : undefined;

    if (name !== undefined) names.add(name);
    typescript.forEachChild(node, visit);
  };

  if (source.languageVariant === typescript.LanguageVariant.JSX) visit(source);

  return [...names].toSorted();
}
