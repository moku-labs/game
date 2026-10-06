import { beforeAll, describe, expect, it } from "vitest";
import { buildIndex, createCatalog, putFile } from "../../src/project/catalog";
import { locate } from "../../src/project/locate";
import type { Anchor, ProjectIndex } from "../../src/project/types";
import { loadTypeScript, parseFile, type TypeScript } from "../../src/project/typescript";

// ---------------------------------------------------------------------------
// Unit test: the edges of reading a game. Module shapes a name is followed
// through (default and star exports, namespaces, cycles), key expressions the
// pattern reader gives up on, definers in odd places, JSX attribute forms, and
// anchors read back on a parse by `locate`.
// ---------------------------------------------------------------------------

/** A kit with the definers the tests call. */
const KIT = `import * as game from "@moku-labs/game";

export const { defineNode, defineFlow, defineFeature, defineScene, projection, defineTextStyles, defineStyle, ...rest } =
  game.defineGame<{ player: object }>();
`;

let ts: TypeScript;

beforeAll(async () => {
  ts = await loadTypeScript();
});

/**
 * Index a set of in-memory files.
 *
 * @param files - Root-relative path to source text.
 * @returns The index.
 */
function indexOf(files: Record<string, string>): ProjectIndex {
  const catalog = createCatalog(ts);

  for (const [path, text] of Object.entries(files)) putFile(catalog, path, Buffer.from(text));

  return buildIndex(catalog);
}

/**
 * Read an anchor on a parse of one text, as `line:startLine-endLine`.
 *
 * @param path - The path the text pretends to live at.
 * @param text - The source text.
 * @param anchor - The anchor, without its path.
 * @returns One entry per place.
 */
function placesOf(path: string, text: string, anchor: Omit<Anchor, "path">): string[] {
  const { source } = parseFile(ts, path, text);

  return locate(ts, source, { path, ...anchor }).map(
    place => `${place.line}:${place.range[0]}-${place.range[2]}`
  );
}

/**
 * A board flow file with some imports and some table entries.
 *
 * @param imports - The import lines.
 * @param entries - The entries of the nodes table.
 * @returns The source text.
 */
function flow(imports: string, entries: string): string {
  return `import { defineFlow } from "../kit";
${imports}

export const boardFlow = defineFlow("board", { nodes: { ${entries} }, start: "a", edges: {} });
`;
}

describe("module shapes a node is followed through", () => {
  it("follows a default export, a default function, a star export and a .js specifier", () => {
    const index = indexOf({
      "kit.ts": KIT,
      "nodes/toast.ts":
        'import { defineNode } from "../kit";\n\nconst toast = defineNode({});\n\nexport default toast;\n',
      "nodes/grant.ts": "export default function grant() {\n  return 1;\n}\n",
      "nodes/merge.ts": "export const merge = 1;\nexport class Picker {}\n",
      "nodes/all.ts":
        'export * from "./merge";\nexport * from "../outside/none";\nexport * as everything from "./merge";\n',
      "nodes/local.ts":
        "const hidden = 1;\n\nexport { hidden as shown };\nexport type { Hidden } from './types';\n",
      "flows/board.ts": flow(
        `import toast from "../nodes/toast";
import grant from "../nodes/grant.js";
import { merge, everything } from "../nodes/all";
import { Picker } from "../nodes/merge";
import { shown } from "../nodes/local";
import type { Typed } from "../nodes/merge";
import "../nodes/side-effect";`,
        "toast, grant, merge, picker: Picker, shown, typed: Typed, everything, method() {}"
      )
    });

    expect(index.symbols["node:board/toast"]?.def).toEqual([
      { path: "nodes/toast.ts", binding: "toast" }
    ]);
    expect(index.symbols["node:board/grant"]?.def).toEqual([
      { path: "nodes/grant.ts", binding: "grant" }
    ]);
    expect(index.symbols["node:board/merge"]?.def).toEqual([
      { path: "nodes/merge.ts", binding: "merge" }
    ]);
    expect(index.symbols["node:board/picker"]?.def).toEqual([
      { path: "nodes/merge.ts", binding: "Picker" }
    ]);
    expect(index.symbols["node:board/shown"]?.def).toEqual([
      { path: "nodes/local.ts", binding: "hidden" }
    ]);
    expect(index.symbols["node:board/method"]?.def).toEqual([
      { path: "flows/board.ts", binding: "boardFlow", key: "method" }
    ]);
    expect(index.unresolved.map(item => item.reason)).toEqual([
      'node "board/typed": "Typed" is not declared in a file of the root',
      'node "board/everything": "everything" is not declared in a file of the root'
    ]);
  });

  it("gives up on a cycle of re-exports and on a name the file never declares", () => {
    const index = indexOf({
      "kit.ts": KIT,
      "nodes/a.ts": 'export { loop } from "./b";\n',
      "nodes/b.ts": 'export { loop } from "./a";\n',
      "flows/board.ts": flow('import { loop } from "../nodes/a";', "loop, ghost")
    });

    expect(index.unresolved.map(item => item.reason)).toEqual([
      'node "board/loop": "loop" is not declared in a file of the root',
      'node "board/ghost": "ghost" is not declared in a file of the root'
    ]);
  });

  it("reads a kit through a namespace, and a flow that is not bound to a const", () => {
    const index = indexOf({
      "kit.ts": KIT,
      "game.ts": `import * as kit from "./kit";
import * as missing from "./nowhere";

export const flows = [kit.defineFlow("main", { nodes: { boot: missing.node }, start: "boot", edges: {} })];
`
    });

    expect(index.symbols["flow:main"]?.def).toEqual([{ path: "game.ts", key: "main" }]);
    expect(index.symbols["node:main/boot"]?.def).toEqual([{ path: "game.ts", key: "boot" }]);
  });
});

describe("definers in odd places", () => {
  it("anchors by id what is bound inside a function, and keys unbound text styles", () => {
    const index = indexOf({
      "kit.ts": KIT,
      "odd.ts": `import { defineScene, defineTextStyles, defineStyle, projection } from "./kit";

function build() {
  const inner = defineScene("inner", {});

  return inner;
}

export const all = [defineTextStyles({ "ui.odd": {}, plain: {}, 7: {} })];
defineStyle({ width: 1 });
export const noSpec = projection();
export const notObject = projection(spec);
export const noTable = defineTextStyles();
`
    });

    expect(index.symbols["scene:inner"]?.def).toEqual([{ path: "odd.ts", key: "inner" }]);
    expect(index.symbols["textStyle:ui.odd"]?.def).toEqual([{ path: "odd.ts", key: "ui.odd" }]);
    expect(index.symbols["textStyle:7"]?.def).toEqual([{ path: "odd.ts", key: "7" }]);
    expect(index.unresolved.map(item => item.reason)).toEqual([
      "defineStyle is not bound to a module-level const",
      "projection name is not a string literal",
      "projection name is not a string literal",
      "defineTextStyles argument is not an object literal"
    ]);
  });

  it("reads a flow spec held by a const, and refuses a flow without a nodes table", () => {
    const index = indexOf({
      "kit.ts": KIT,
      "flows.ts": `import { defineFlow } from "./kit";

const spec = { nodes: { boot: start }, start: "boot", edges: {} };

export const mainFlow = defineFlow("main", spec);
export const emptyFlow = defineFlow("empty", { start: "boot", edges: {}, nodes() {} });
`
    });

    expect(Object.keys(index.symbols)).toContain("node:main/boot");
    expect(index.unresolved.map(item => item.reason)).toEqual([
      'defineFlow "empty" nodes is not an object literal',
      'node "main/boot": "start" is not declared in a file of the root'
    ]);
  });
});

describe("key expressions the pattern reader gives up on", () => {
  it("reads * for what has no single literal answer", () => {
    const index = indexOf({
      "view.tsx": `function twice(flag: boolean): string {
  if (flag) return "a";

  return "b";
}

const silent = (value: string) => {
  value.trim();
};

const arrow = (slot: number) => \`slot\${slot}\`;
const first = second;
const second = first;
const holder = { id: "x" };

function Board({ id: name }: { id: string }) {
  return <row key={\`\${name}Row\`} />;
}

export function View(props: { id: string; flag: boolean }) {
  return (
    <stack key="view">
      <text key={\`\${twice(props.flag)}Twice\`} />
      <text key={\`\${silent("v")}Silent\`} />
      <text key={\`\${arrow()}Arrow\`} />
      <text key={\`\${first}Loop\`} />
      <text key={\`\${holder.id}Holder\`} />
      <text key={\`\${props.id.trim()}Method\`} />
      <text key={\`\${arrow(3)}Three\`} />
      <text key={\`\${7}Seven\`} />
      <text key />
      <text key={} />
      <text key={props.flag ? "on" : "off-with-a-much-longer-name-than-a-reason-should-quote-in-full"} />
      <Board {...props} id={"braced"} />
      <Board id={props.id} />
      <Board xml:lang="x" />
    </stack>
  );
}
`
    });
    const keys = Object.keys(index.symbols);

    expect(keys).toEqual(
      expect.arrayContaining([
        "jsx:*Twice",
        "jsx:*Silent",
        "jsx:slot*Arrow",
        "jsx:*Loop",
        "jsx:*Holder",
        "jsx:*Method",
        "jsx:slot3Three",
        "jsx:7Seven",
        "jsx:braced",
        "jsx:{id}Row"
      ])
    );
    expect(index.symbols["jsx:{id}Row"]?.def).toEqual([
      { path: "view.tsx", key: "{id}Row", kind: "template", component: "Board" }
    ]);
    expect(index.unresolved).toEqual([
      {
        path: "view.tsx",
        reason:
          'JSX key "props.flag ? "on" : "off-with-a-much-longer-name-than-a-reas…" on <text> resolves to "*"'
      }
    ]);
  });
});

describe("locate", () => {
  const text = `export const { first, second: renamed } = pair();

export function helper() {
  return 1;
}

export class Holder {}

export const flow = defineFlow("main", {
  nodes: {
    boot() {
      return 1;
    },
    "quoted.key": 2,
    7: 3
  },
  edges: { boot: "x" }
});

register("loose", 1);
const table = { loose: 2 };
console.info("bare" + "loose");
`;

  it("reads a destructured const, a function and a class at their statements", () => {
    expect(placesOf("a.ts", text, { binding: "first" })).toEqual(["1:1-1"]);
    expect(placesOf("a.ts", text, { binding: "renamed" })).toEqual(["1:1-1"]);
    expect(placesOf("a.ts", text, { binding: "helper" })).toEqual(["3:3-5"]);
    expect(placesOf("a.ts", text, { binding: "Holder" })).toEqual(["7:7-7"]);
    expect(placesOf("a.ts", text, { binding: "gone" })).toEqual([]);
  });

  it("reads a key inside a binding at its property, and falls back to the statement", () => {
    expect(placesOf("a.ts", text, { binding: "flow", key: "boot" })).toEqual(["11:11-13"]);
    expect(placesOf("a.ts", text, { binding: "flow", key: "quoted.key" })).toEqual(["14:14-14"]);
    expect(placesOf("a.ts", text, { binding: "flow", key: "7" })).toEqual(["15:15-15"]);
    expect(placesOf("a.ts", text, { binding: "flow", key: "missing" })).toEqual(["9:9-18"]);
  });

  it("reads a key without a binding where it is first written", () => {
    expect(placesOf("a.ts", text, { key: "main" })).toEqual(["9:9-18"]);
    expect(placesOf("a.ts", text, { key: "loose" })).toEqual(["20:20-20"]);
    expect(placesOf("a.ts", "const table = { loose: 2 };\n", { key: "loose" })).toEqual(["1:1-1"]);
    expect(placesOf("a.ts", 'const value = "loose";\n', { key: "loose" })).toEqual(["1:1-1"]);
    expect(placesOf("a.ts", text, { key: "absent" })).toEqual([]);
    expect(placesOf("a.ts", text, {})).toEqual([]);
  });
});

describe("locate on a style key", () => {
  it("answers a style function at its statement when it holds no known style call", () => {
    const { source } = parseFile(
      ts,
      "a.ts",
      "export function boardStyle() {\n  return { disc: 1 };\n}\n"
    );
    const linesOf = (anchor: Omit<Anchor, "path">): number[] =>
      locate(ts, source, { path: "a.ts", ...anchor }, { keyKind: "style" }).map(
        place => place.line
      );

    expect(linesOf({ binding: "boardStyle" })).toEqual([1]);
    expect(linesOf({ binding: "boardStyle", key: "missing" })).toEqual([1]);
    expect(linesOf({ binding: "boardStyle", key: "disc" })).toEqual([2]);
    expect(linesOf({ binding: "gone" })).toEqual([]);
  });
});

describe("parseFile and loadTypeScript", () => {
  it("takes the namespace when the module has no default, and reads a parse without errors", async () => {
    const namespace = { version: "6.0.3" } as unknown as TypeScript;
    const fake = {
      ScriptKind: { TS: 3, TSX: 4 },
      ScriptTarget: { Latest: 99 },
      createSourceFile: () => ({ fileName: "a.ts" })
    } as unknown as TypeScript;

    expect(await loadTypeScript(() => Promise.resolve(namespace))).toBe(namespace);
    expect(parseFile(fake, "a.ts", "")).toEqual({ source: { fileName: "a.ts" } });
  });
});
