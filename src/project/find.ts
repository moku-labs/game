/**
 * @file project — `find`: the anchors of a key, read on the files as they are on disk now. A JSX
 * key the game reports at run time is matched in three tiers: the exact key, then the `{id}` and
 * `{amountKey}` patterns filled with a literal prop of the same name on the same component (the
 * pattern and the prop both answer), then the `*` patterns as wildcards. A file whose bytes moved
 * since the index was built is parsed again into the cache; one that does not parse answers from
 * its last good parse.
 */
import type ts from "typescript";
import { type Catalog, parseCached } from "./catalog";
import { collectJsx, type JsxHit } from "./extract/jsx";
import type { Definer, ModuleFacts } from "./extract/module";
import { ANY, HOLE, hasHole, holeOf } from "./extract/pattern";
import { definersOf } from "./extract/resolve";
import { sha1 } from "./hash";
import { type JsxHitsOf, locate } from "./locate";
import { readInside } from "./paths";
import type { Session } from "./session";
import { JSX, type JsxShapes, jsxShapes } from "./shapes";
import type { Anchor, Found } from "./types";
import type { TypeScript } from "./typescript";

/** The parse a file answers from, the hash of the bytes it came from, and its JSX hits. */
type View = {
  readonly source: ts.SourceFile;
  readonly hash: string;
  readonly broken: boolean;
  /** The JSX hits of the parse, collected on the first JSX anchor of the call. */
  readonly jsx: JsxHitsOf;
};

/**
 * Whether a key matches a pattern whose `*` holes stand for any text.
 *
 * @param pattern - A pattern, its prop holes already filled.
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

/**
 * The JSX shapes of the current index, read once per index: an index is frozen, and an update
 * replaces it with a new object.
 *
 * @param session - The open project.
 * @returns The shapes of `session.index`.
 */
function shapesOf(session: Session): JsxShapes {
  const cached = session.shapes.get(session.index);

  if (cached !== undefined) return cached;

  const shapes = jsxShapes(session.index);

  session.shapes.set(session.index, shapes);

  return shapes;
}

/**
 * Whether a literal prop fills the holes of its name in a pattern into the wanted key: `id=` fills
 * `{id}`, `amountKey=` fills `{amountKey}`. A pattern written in a component takes only the props
 * of that component; one written in a helper takes any.
 *
 * @param pattern - The anchor of the pattern.
 * @param filler - The anchor of the prop: an `idProp` anchor.
 * @param wanted - The runtime key, without its prefix.
 * @returns True when the filled pattern reads as the key.
 */
function fills(pattern: Anchor, filler: Anchor, wanted: string): boolean {
  if (pattern.component !== undefined && pattern.component !== filler.component) return false;

  const key = pattern.key ?? "";
  const hole = holeOf(filler.prop ?? "id");

  if (!key.includes(hole)) return false;

  return matchesPattern(key.replaceAll(hole, filler.key ?? ""), wanted);
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
  return (anchor.key ?? "").replaceAll(HOLE, "").replaceAll(ANY, "").length;
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
 * The anchors a runtime JSX key reaches through patterns: each prop-hole pattern filled with a
 * literal prop of its name (the pattern, then the prop), then each `*` pattern as a wildcard.
 * Within each tier the pattern with more literal text comes first: `card*Picture` before `card*`.
 *
 * @param shapes - The JSX shapes of the index.
 * @param wanted - The runtime key, without its prefix.
 * @returns The anchors, in that order.
 */
function patternAnchors(shapes: JsxShapes, wanted: string): Anchor[] {
  const { holePatterns, wildPatterns, idProps } = shapes;
  const reached: Anchor[] = [];

  for (const pattern of holePatterns.toSorted(bySpecificity)) {
    for (const filler of idProps.filter(item => fills(pattern, item, wanted))) {
      reached.push(pattern, filler);
    }
  }

  const wild = wildPatterns.filter(pattern => matchesPattern(pattern.key ?? "", wanted));

  reached.push(...wild.toSorted(bySpecificity));

  return reached;
}

/**
 * The anchors of a key, in the order `find` answers them: the exact key, then, for a JSX key as
 * the game reports it (no `*`, no prop hole), the patterns that read as it.
 *
 * @param session - The open project.
 * @param key - The key.
 * @returns The anchors, each once.
 */
export function anchorsOf(session: Session, key: string): Anchor[] {
  const exact = session.index.symbols[key]?.def ?? [];
  const isRuntimeJsx = key.startsWith(JSX) && !key.includes(ANY) && !hasHole(key);
  const reached = isRuntimeJsx ? patternAnchors(shapesOf(session), key.slice(JSX.length)) : [];

  return [...new Set([...exact, ...reached])];
}

/**
 * The JSX hits of one parse, collected on the first call and kept for the next ones.
 *
 * @param typescript - The TypeScript module.
 * @param source - The parse.
 * @returns A function that answers the hits.
 */
function jsxHitsOnce(typescript: TypeScript, source: ts.SourceFile): JsxHitsOf {
  let hits: readonly JsxHit[] | undefined;

  return () => {
    hits ??= collectJsx(typescript, source);

    return hits;
  };
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

  if (fresh.error === undefined) {
    return {
      source: fresh.source,
      hash,
      broken: false,
      jsx: jsxHitsOnce(catalog.typescript, fresh.source)
    };
  }

  // Else the last good parse, if the file ever had one.
  if (good === undefined) return undefined;

  const { source } = parseCached(catalog, file, good.hash, good.text);

  return { source, hash: good.hash, broken: true, jsx: jsxHitsOnce(catalog.typescript, source) };
}

/**
 * The definers a file can call, recognised by binding on the module facts of the catalog, as
 * extraction does.
 *
 * @param catalog - The catalog of the project.
 * @param file - The root-relative path.
 * @returns The callee text to the definer.
 */
function definersAt(catalog: Catalog, file: string): ReadonlyMap<string, Definer> {
  const modules = new Map<string, ModuleFacts>();

  for (const [path, record] of catalog.records) {
    if (record.good !== undefined) modules.set(path, record.good.module);
  }

  return definersOf(modules, file);
}

/**
 * The kind of a key: the text before its first colon.
 *
 * @param key - A key.
 * @returns The kind, or the whole key when it has no colon.
 * @example
 * ```ts
 * kindOf("style:features/ui/kit.tsx#boardStyle"); // "style"
 * ```
 */
function kindOf(key: string): string {
  const colon = key.indexOf(":");

  return colon === -1 ? key : key.slice(0, colon);
}

/**
 * The identity of an answer: two anchors that land on the same element with the same key answer
 * once.
 *
 * @param answer - One answer of `find`.
 * @returns The path, the range, the kind and the key, joined.
 * @example
 * ```ts
 * identityOf({ path: "a.tsx", key: "row", kind: "literal", line: 3, range: [3, 1, 3, 9], hash: "h" }); // "a.tsx|3,1,3,9|literal|row"
 * ```
 */
function identityOf(answer: Found): string {
  return `${answer.path}|${answer.range.join(",")}|${answer.kind ?? ""}|${answer.key ?? ""}`;
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
  const seen = new Set<string>();
  const found: Found[] = [];
  const keyKind = kindOf(key);

  for (const anchor of anchorsOf(session, key)) {
    // Read each anchor's file once per call.
    if (!views.has(anchor.path)) views.set(anchor.path, await viewOf(session, anchor.path));

    const view = views.get(anchor.path);

    if (view === undefined) continue;

    // Turn each place of the anchor into an answer.
    const places = locate(session.catalog.typescript, view.source, anchor, {
      keyKind,
      jsxHits: view.jsx,
      definers: () => definersAt(session.catalog, anchor.path)
    });
    const answers = places.map(
      (place): Found => ({
        ...anchor,
        ...place,
        hash: view.hash,
        ...(view.broken ? { broken: true } : {})
      })
    );

    // Drop the answers already seen: two anchors of one file can read the same element.
    for (const answer of answers) {
      const identity = identityOf(answer);

      if (seen.has(identity)) continue;

      seen.add(identity);
      found.push(answer);
    }
  }

  return found;
}
