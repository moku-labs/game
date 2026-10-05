/**
 * @file project, extract — following a name across files with the module facts only: an import
 * to the module it names, a re-export to the module behind it, a star export to the first module
 * that has the name, until the name is declared, handed out by the kit, or comes from a package.
 * This is how a definer is recognised by binding (a renamed import still is the definer) and how
 * a node of a flow table reaches the file that declares it.
 */
import path from "node:path";
import {
  DEFINERS,
  type Definer,
  GAME_PACKAGE,
  type ImportReference,
  isDefiner,
  type ModuleFacts
} from "./module";

/** The module facts of every file that parsed, by root-relative path. */
export type Modules = ReadonlyMap<string, ModuleFacts>;

/** Where a name ends up. */
export type Target =
  | { readonly kind: "declared"; readonly path: string; readonly binding: string }
  | { readonly kind: "definer"; readonly definer: Definer }
  | { readonly kind: "package"; readonly specifier: string; readonly imported: string };

/** How many imports and re-exports a name is followed through before giving up. */
const MAX_HOPS = 12;

/** The extensions a TypeScript import may name instead of the source file. */
const SCRIPT_EXTENSION = /\.(?:[cm]?js|jsx)$/;

/**
 * Whether a module specifier is relative to the importing file.
 *
 * @param specifier - The module specifier.
 * @returns True for `./…` and `../…`.
 * @example
 * ```ts
 * isRelative("../kit"); // true
 * ```
 */
function isRelative(specifier: string): boolean {
  return (
    specifier === "." ||
    specifier === ".." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../")
  );
}

/**
 * Resolves a relative module specifier to an indexed file, the way a bundler does: the path as
 * written, then with `.ts`, `.tsx`, `/index.ts` and `/index.tsx`.
 *
 * @param modules - The module facts by path.
 * @param from - The importing file.
 * @param specifier - The module specifier.
 * @returns The root-relative path, or `undefined` for a package or a file the index does not hold.
 */
export function resolveModulePath(
  modules: Modules,
  from: string,
  specifier: string
): string | undefined {
  if (!isRelative(specifier)) return undefined;

  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  const stem = base.replace(SCRIPT_EXTENSION, "");
  const candidates = [base, `${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`];

  return candidates.find(candidate => modules.has(candidate));
}

/**
 * Follows an imported name into the module that the specifier names.
 *
 * @param modules - The module facts by path.
 * @param from - The importing file.
 * @param ref - The specifier and the name.
 * @param hops - How many hops were taken so far.
 * @returns Where the name ends up.
 */
function followImport(
  modules: Modules,
  from: string,
  ref: ImportReference,
  hops: number
): Target | undefined {
  if (!isRelative(ref.specifier)) return { kind: "package", ...ref };
  if (ref.imported === "*") return undefined;

  const target = resolveModulePath(modules, from, ref.specifier);

  return target === undefined ? undefined : resolveExport(modules, target, ref.imported, hops + 1);
}

/**
 * Follows an exported name of a module: a local binding, a re-export, or a star export.
 *
 * @param modules - The module facts by path.
 * @param file - The module.
 * @param name - The exported name.
 * @param hops - How many hops were taken so far.
 * @returns Where the name ends up.
 */
export function resolveExport(
  modules: Modules,
  file: string,
  name: string,
  hops = 0
): Target | undefined {
  const facts = modules.get(file);

  if (facts === undefined || hops > MAX_HOPS) return undefined;

  const ref = facts.exports.get(name);

  if (ref !== undefined && "local" in ref)
    return resolveBinding(modules, file, ref.local, hops + 1);
  if (ref !== undefined) return followImport(modules, file, ref, hops);

  for (const specifier of facts.stars) {
    const found = followImport(modules, file, { specifier, imported: name }, hops);

    if (found !== undefined) return found;
  }

  return undefined;
}

/**
 * Follows a name used in a file to where it ends up: the kit hands it out, the file declares it,
 * or an import brings it.
 *
 * @param modules - The module facts by path.
 * @param file - The file that uses the name.
 * @param local - The name as the file writes it.
 * @param hops - How many hops were taken so far.
 * @returns Where the name ends up, or `undefined` when it cannot be followed.
 */
export function resolveBinding(
  modules: Modules,
  file: string,
  local: string,
  hops = 0
): Target | undefined {
  const facts = modules.get(file);

  if (facts === undefined || hops > MAX_HOPS) return undefined;

  const definer = facts.kit.get(local);

  if (definer !== undefined) return { kind: "definer", definer };
  if (facts.declared.has(local)) return { kind: "declared", path: file, binding: local };

  const ref = facts.imports.get(local);

  return ref === undefined ? undefined : followImport(modules, file, ref, hops);
}

/**
 * The definer a target is, if any: one the kit hands out, or one imported from the engine.
 *
 * @param target - Where a name ends up.
 * @returns The definer, or `undefined`.
 * @example
 * ```ts
 * definerOf({ kind: "package", specifier: "@moku-labs/game", imported: "defineStyle" }); // "defineStyle"
 * ```
 */
function definerOf(target: Target | undefined): Definer | undefined {
  if (target?.kind === "definer") return target.definer;
  if (target?.kind !== "package" || target.specifier !== GAME_PACKAGE) return undefined;

  return isDefiner(target.imported) ? target.imported : undefined;
}

/**
 * Adds the definers a namespace import reaches as `ns.name`.
 *
 * @param modules - The module facts by path.
 * @param file - The importing file.
 * @param namespace - The local name of the namespace.
 * @param specifier - The module it imports.
 * @param definers - The map to add to.
 */
function addNamespace(
  modules: Modules,
  file: string,
  namespace: string,
  specifier: string,
  definers: Map<string, Definer>
): void {
  // The engine itself: every definer is a member.
  if (specifier === GAME_PACKAGE) {
    for (const definer of DEFINERS) definers.set(`${namespace}.${definer}`, definer);
    return;
  }

  // A module of the game, the kit most of all: each export that is a definer.
  const target = resolveModulePath(modules, file, specifier);
  const names = target === undefined ? [] : [...(modules.get(target)?.exports.keys() ?? [])];

  for (const name of names) {
    const definer = definerOf(resolveExport(modules, target ?? "", name));

    if (definer !== undefined) definers.set(`${namespace}.${name}`, definer);
  }
}

/**
 * The definers a file can call, by the callee as the file writes it: `defineFlow`, a renamed
 * `scene`, or `kit.defineScene` through a namespace.
 *
 * @param modules - The module facts by path.
 * @param file - The file.
 * @returns The callee text to the definer.
 */
export function definersOf(modules: Modules, file: string): ReadonlyMap<string, Definer> {
  const facts = modules.get(file);
  const definers = new Map<string, Definer>(facts?.kit);

  for (const [local, ref] of facts?.imports ?? []) {
    if (ref.imported === "*") {
      addNamespace(modules, file, local, ref.specifier, definers);
      continue;
    }

    const definer = definerOf(resolveBinding(modules, file, local));

    if (definer !== undefined) definers.set(local, definer);
  }

  return definers;
}
