/**
 * @file project, extract — what a name means inside one file: a `const` with its initializer, a
 * function, or a parameter of an enclosing function. The lookup walks up from the place the name
 * is used, block by block, as the language does; shadowing inside a block is not modelled.
 */
import type ts from "typescript";
import type { TypeScript } from "../typescript";

/** A function whose body can be read: a declaration, an arrow or a function expression. */
export type FunctionNode = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

/** What a name means where it is used. */
export type Meaning =
  | { readonly kind: "const"; readonly initializer: ts.Expression }
  | { readonly kind: "function"; readonly node: FunctionNode }
  | { readonly kind: "param"; readonly property?: string };

/** A node that holds statements a name can be declared in. */
type StatementHolder = ts.Node & { readonly statements: ts.NodeArray<ts.Statement> };

/**
 * Unwraps the expressions that change no value: parentheses, `as`, `satisfies`, `!` and `<T>`.
 *
 * @param typescript - The TypeScript module.
 * @param node - An expression.
 * @returns The expression inside.
 */
export function unwrap(typescript: TypeScript, node: ts.Expression): ts.Expression {
  let inner = node;

  while (
    typescript.isParenthesizedExpression(inner) ||
    typescript.isAsExpression(inner) ||
    typescript.isSatisfiesExpression(inner) ||
    typescript.isNonNullExpression(inner) ||
    typescript.isTypeAssertionExpression(inner)
  ) {
    inner = inner.expression;
  }

  return inner;
}

/**
 * Whether a node holds statements: a block, a source file, a module block or a case clause.
 *
 * @param node - A node.
 * @returns True when it has a `statements` list.
 */
function holdsStatements(node: ts.Node): node is StatementHolder {
  return "statements" in node && Array.isArray(node.statements);
}

/**
 * Whether a node is a function whose parameters a name can be.
 *
 * @param typescript - The TypeScript module.
 * @param node - A node.
 * @returns True for function declarations, expressions, arrows and methods.
 */
function isFunctionScope(typescript: TypeScript, node: ts.Node): node is ts.SignatureDeclaration {
  return (
    typescript.isFunctionDeclaration(node) ||
    typescript.isFunctionExpression(node) ||
    typescript.isArrowFunction(node) ||
    typescript.isMethodDeclaration(node)
  );
}

/**
 * The meaning of a `const` declarator: a function when its initializer is one.
 *
 * @param typescript - The TypeScript module.
 * @param initializer - The initializer of the const.
 * @returns The meaning.
 */
function constMeaning(typescript: TypeScript, initializer: ts.Expression): Meaning {
  const inner = unwrap(typescript, initializer);
  const isFunction = typescript.isArrowFunction(inner) || typescript.isFunctionExpression(inner);

  return isFunction ? { kind: "function", node: inner } : { kind: "const", initializer };
}

/**
 * Looks for a name among the statements of one block.
 *
 * @param typescript - The TypeScript module.
 * @param holder - The block.
 * @param name - The name.
 * @returns What the name means there, or `undefined`.
 */
function declaredIn(
  typescript: TypeScript,
  holder: StatementHolder,
  name: string
): Meaning | undefined {
  for (const statement of holder.statements) {
    if (typescript.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return { kind: "function", node: statement };
    }

    if (!typescript.isVariableStatement(statement)) continue;

    const isConst = (statement.declarationList.flags & typescript.NodeFlags.Const) !== 0;
    const declaration = statement.declarationList.declarations.find(
      item => typescript.isIdentifier(item.name) && item.name.text === name
    );

    if (isConst && declaration?.initializer !== undefined) {
      return constMeaning(typescript, declaration.initializer);
    }
  }

  return undefined;
}

/**
 * Looks for a name among the names of a destructured parameter (`({ id }) => …`).
 *
 * @param typescript - The TypeScript module.
 * @param pattern - The destructure.
 * @param name - The name.
 * @returns The parameter meaning with the property it takes, or `undefined`.
 */
function destructuredIn(
  typescript: TypeScript,
  pattern: ts.BindingPattern,
  name: string
): Meaning | undefined {
  for (const element of pattern.elements) {
    const isMatch =
      typescript.isBindingElement(element) &&
      typescript.isIdentifier(element.name) &&
      element.name.text === name;

    if (!isMatch) continue;

    const property = element.propertyName;
    const key = property !== undefined && typescript.isIdentifier(property) ? property.text : name;

    return { kind: "param", property: key };
  }

  return undefined;
}

/**
 * Looks for a name among the parameters of one function: a plain parameter, or a property of a
 * destructured one.
 *
 * @param typescript - The TypeScript module.
 * @param scope - The function.
 * @param name - The name.
 * @returns The parameter meaning, or `undefined`.
 */
function parameterIn(
  typescript: TypeScript,
  scope: ts.SignatureDeclaration,
  name: string
): Meaning | undefined {
  for (const parameter of scope.parameters) {
    const binding = parameter.name;

    if (typescript.isIdentifier(binding) && binding.text === name) return { kind: "param" };
    if (typescript.isIdentifier(binding)) continue;

    const meaning = destructuredIn(typescript, binding, name);

    if (meaning !== undefined) return meaning;
  }

  return undefined;
}

/**
 * Says what a name means at the place it is used, walking up from there.
 *
 * @param typescript - The TypeScript module.
 * @param identifier - The name where it is used.
 * @returns What it means, or `undefined` when the file does not declare it.
 */
export function meaningOf(typescript: TypeScript, identifier: ts.Identifier): Meaning | undefined {
  const name = identifier.text;

  for (let node: ts.Node | undefined = identifier.parent; node !== undefined; node = node.parent) {
    const parameter = isFunctionScope(typescript, node)
      ? parameterIn(typescript, node, name)
      : undefined;

    if (parameter !== undefined) return parameter;

    const declared = holdsStatements(node) ? declaredIn(typescript, node, name) : undefined;

    if (declared !== undefined) return declared;
  }

  return undefined;
}

/**
 * The name of the top-level declaration a node sits in: the function, class or first const of
 * the statement directly under the file.
 *
 * @param typescript - The TypeScript module.
 * @param node - Any node.
 * @returns The declared name, or `undefined` for a statement that declares none.
 */
export function enclosingName(typescript: TypeScript, node: ts.Node): string | undefined {
  let statement: ts.Node = node;

  while (statement.parent !== undefined && !typescript.isSourceFile(statement.parent)) {
    statement = statement.parent;
  }

  if (typescript.isFunctionDeclaration(statement) || typescript.isClassDeclaration(statement)) {
    return statement.name?.text;
  }

  if (!typescript.isVariableStatement(statement)) return undefined;

  const [first] = statement.declarationList.declarations;

  return first !== undefined && typescript.isIdentifier(first.name) ? first.name.text : undefined;
}
