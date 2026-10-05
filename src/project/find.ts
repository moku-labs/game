/**
 * @file project — `find`: the anchors of a key, read on the files as they are on disk now. A JSX
 * key the game reports at run time is matched in three tiers: the exact key, then the `{id}`
 * patterns filled with a literal `id=` prop of the same component (the pattern and the prop both
 * answer), then the `*` patterns as wildcards. A file whose bytes moved since the index was built
 * is parsed again into the cache; one that does not parse answers from its last good parse.
 */
import type ts from "typescript";
import { parseCached } from "./catalog";
import { ANY, ID } from "./extract/pattern";
import { sha1 } from "./hash";
import { locate } from "./locate";
import { readInside } from "./paths";
import type { Session } from "./session";
import type { Anchor, Found, ProjectIndex } from "./types";

/** The parse a file answers from, and the hash of the bytes it came from. */
type View = {
  readonly source: ts.SourceFile;
  readonly hash: string;
  readonly broken: boolean;
};

/** The prefix of a JSX key. */
const JSX = "jsx:";

/**
 * Whether a key matches a pattern whose `*` holes stand for any text.
 *
 * @param pattern - A pattern, `{id}` already filled.
 * @param key - The key without its prefix.
 * @returns True when the key reads as the pattern.
 * @example
 * ```ts
 * matchesPattern("card*Picture", "card2Picture"); // true
 * ```
 */
export function matchesPattern(pattern: string, key: string): boolean {
  if (!pattern.includes(ANY)) return pattern === key;

  const parts = pattern
    .split(ANY)
    .map(part => part.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`));

  return new RegExp(`^${parts.join(".*")}$`).test(key);
}

/** The JSX anchors of an index by shape. */
type Shapes = { idPatterns: Anchor[]; wildPatterns: Anchor[]; idAttributes: Anchor[] };

/**
 * The anchors of the JSX patterns and of the literal `id=` props of an index.
 *
 * @param index - The index.
 * @returns The `{id}` patterns, the `*` patterns and the `id=` props.
 */
function jsxShapes(index: ProjectIndex): Shapes {
  const shapes: Shapes = { idPatterns: [], wildPatterns: [], idAttributes: [] };

  for (const [key, entry] of Object.entries(index.symbols)) {
    if (!key.startsWith(JSX)) continue;

    for (const anchor of entry.def) {
      const pattern = anchor.key ?? "";

      if (anchor.kind === "idProp") shapes.idAttributes.push(anchor);
      else if (pattern.includes(ID)) shapes.idPatterns.push(anchor);
      else if (pattern.includes(ANY)) shapes.wildPatterns.push(anchor);
    }
  }

  return shapes;
}

/**
 * Whether an `id=` prop fills an `{id}` pattern into the wanted key. A pattern written in a
 * component takes only the props of that component; one written in a helper takes any.
 *
 * @param pattern - The anchor of the `{id}` pattern.
 * @param idAttribute - The anchor of the `id=` prop.
 * @param wanted - The runtime key, without its prefix.
 * @returns True when the filled pattern reads as the key.
 */
function fills(pattern: Anchor, idAttribute: Anchor, wanted: string): boolean {
  const isSameComponent =
    pattern.component === undefined || pattern.component === idAttribute.component;
  const filled = (pattern.key ?? "").replaceAll(ID, idAttribute.key ?? "");

  return isSameComponent && matchesPattern(filled, wanted);
}

/**
 * How much literal text a pattern holds: a pattern with more of it says more about a key.
 *
 * @param anchor - The anchor of a pattern.
 * @returns The length of the pattern without its holes.
 * @example
 * ```ts
 * specificityOf({ path: "strip.tsx", key: "card*Picture" }); // 11
 * ```
 */
function specificityOf(anchor: Anchor): number {
  return (anchor.key ?? "").replaceAll(ID, "").replaceAll(ANY, "").length;
}

/**
 * Orders patterns from the most specific to the least, keeping their order otherwise.
 *
 * @param first - One pattern anchor.
 * @param second - The other.
 * @returns A negative number when the first holds more literal text.
 */
function bySpecificity(first: Anchor, second: Anchor): number {
  return specificityOf(second) - specificityOf(first);
}

/**
 * The anchors a runtime JSX key reaches through patterns: each `{id}` pattern filled with an `id=`
 * prop (the pattern, then the prop), then each `*` pattern as a wildcard. Within each tier the
 * pattern with more literal text comes first: `card*Picture` before `card*`.
 *
 * @param index - The index.
 * @param wanted - The runtime key, without its prefix.
 * @returns The anchors, in that order.
 */
function patternAnchors(index: ProjectIndex, wanted: string): Anchor[] {
  const { idPatterns, wildPatterns, idAttributes } = jsxShapes(index);
  const reached: Anchor[] = [];

  for (const pattern of idPatterns.toSorted(bySpecificity)) {
    for (const idAttribute of idAttributes.filter(item => fills(pattern, item, wanted))) {
      reached.push(pattern, idAttribute);
    }
  }

  const wild = wildPatterns.filter(pattern => matchesPattern(pattern.key ?? "", wanted));

  reached.push(...wild.toSorted(bySpecificity));

  return reached;
}

/**
 * The anchors of a key, in the order `find` answers them: the exact key, then, for a JSX key as
 * the game reports it (no `*`, no `{id}`), the patterns that read as it.
 *
 * @param index - The index.
 * @param key - The key.
 * @returns The anchors, each once.
 */
export function anchorsOf(index: ProjectIndex, key: string): Anchor[] {
  const exact = index.symbols[key]?.def ?? [];
  const isRuntimeJsx = key.startsWith(JSX) && !key.includes(ANY) && !key.includes(ID);
  const reached = isRuntimeJsx ? patternAnchors(index, key.slice(JSX.length)) : [];

  return [...new Set([...exact, ...reached])];
}

/**
 * The parse a file answers from now: the bytes on disk when they parse, else the last good parse
 * of the file, marked broken.
 *
 * @param session - The open project.
 * @param file - The root-relative path.
 * @returns The view, or `undefined` when the file is gone or never parsed.
 */
async function viewOf(session: Session, file: string): Promise<View | undefined> {
  const { catalog } = session;
  const good = catalog.records.get(file)?.good;
  const bytes = await readInside(session.root, file);

  if (bytes === undefined) return undefined;

  // The bytes on disk, when they parse.
  const hash = sha1(bytes);
  const text = hash === good?.hash ? good.text : new TextDecoder().decode(bytes);
  const fresh = parseCached(catalog, file, hash, text);

  if (fresh.error === undefined) return { source: fresh.source, hash, broken: false };

  // Else the last good parse, if the file ever had one.
  if (good === undefined) return undefined;

  return {
    source: parseCached(catalog, file, good.hash, good.text).source,
    hash: good.hash,
    broken: true
  };
}

/**
 * Answers where a key is defined, with lines read from the files on disk now.
 *
 * @param session - The open project.
 * @param key - The key.
 * @returns One entry per place; `[]` for an unknown key.
 */
export async function findKey(session: Session, key: string): Promise<Found[]> {
  const views = new Map<string, View | undefined>();
  const found: Found[] = [];
  const seen = new Set<string>();

  for (const anchor of anchorsOf(session.index, key)) {
    // Each file is read once per call.
    if (!views.has(anchor.path)) views.set(anchor.path, await viewOf(session, anchor.path));

    const view = views.get(anchor.path);

    if (view === undefined) continue;

    for (const place of locate(session.catalog.typescript, view.source, anchor)) {
      const answer: Found = {
        ...anchor,
        ...place,
        hash: view.hash,
        ...(view.broken ? { broken: true } : {})
      };
      const identity = `${answer.path}|${answer.range.join(",")}|${answer.kind ?? ""}|${answer.key ?? ""}`;

      if (seen.has(identity)) continue;

      seen.add(identity);
      found.push(answer);
    }
  }

  return found;
}
