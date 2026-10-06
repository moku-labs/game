import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AliasMap } from "../../src/project/aliases";
import { buildIndex, createCatalog, dropFile, putFile } from "../../src/project/catalog";
import type { ProjectIndex } from "../../src/project/types";
import { loadTypeScript, type TypeScript } from "../../src/project/typescript";

// ---------------------------------------------------------------------------
// Unit test: what the project index reads out of game sources, in memory. Each
// test lays out a few files of a tiny game and reads the symbols, the files and
// the unresolved list the catalog builds from them.
// ---------------------------------------------------------------------------

/** The kit of the tiny game: every definer comes out of one `defineGame` destructure. */
const KIT = `import { defineGame } from "@moku-labs/game";

export const {
  defineNode,
  defineFlow,
  defineFeature,
  defineScene,
  projection,
  defineEmitter,
  defineTextStyles,
  defineStyle,
  defineComponent
} = defineGame<{ player: object; session: object; assets: string; strings: object }>();
`;

let ts: TypeScript;

beforeAll(async () => {
  ts = await loadTypeScript();
});

/**
 * The sha1 the editor uses as a file version, computed here on its own.
 *
 * @param text - The text.
 * @returns The hex digest.
 */
function sha1(text: string): string {
  // eslint-disable-next-line sonarjs/hashing -- a file version, not a secret
  return createHash("sha1").update(text).digest("hex");
}

/**
 * Index a set of in-memory files.
 *
 * @param files - Root-relative path to source text.
 * @param aliases - The tsconfig aliases, when the game declares some.
 * @returns The index.
 */
function indexOf(files: Record<string, string>, aliases?: AliasMap): ProjectIndex {
  const catalog = createCatalog(ts);

  for (const [path, text] of Object.entries(files)) putFile(catalog, path, Buffer.from(text));

  return buildIndex(catalog, undefined, aliases);
}

/**
 * The alias map of an in-memory `paths` block whose targets are already root-relative, as
 * `readAliases` reads it from a root `tsconfig.json`.
 *
 * @param paths - Key to targets, one `*` at most in each.
 * @returns The alias map.
 */
function aliasesOf(paths: Record<string, string[]>): AliasMap {
  const patterns = Object.entries(paths).map(([key, targets]) => {
    const star = key.indexOf("*");

    return star === -1
      ? { prefix: key, targets }
      : { prefix: key.slice(0, star), suffix: key.slice(star + 1), targets };
  });

  return { file: "tsconfig.json", sources: ["tsconfig.json"], patterns };
}

/**
 * The keys of an index that start with a prefix, sorted.
 *
 * @param index - The index.
 * @param prefix - `flow:`, `node:`, `jsx:` and so on.
 * @returns The matching keys.
 */
function keysOf(index: ProjectIndex, prefix: string): string[] {
  return Object.keys(index.symbols).filter(key => key.startsWith(prefix));
}

describe("definers", () => {
  it("indexes every definer the kit hands out, bound to its const", () => {
    const index = indexOf({
      "kit.ts": KIT,
      "game.ts": `import { defineFeature, defineScene, projection, defineEmitter, defineFlow } from "./kit";

export const homeFeature = defineFeature("home", {});
export const homeScene = defineScene("home", { bundle: "home" });
export const boardItems = projection({
  name: "board.items",
  layer: "items"
});
export const stars = defineEmitter("fx.stars", { burst: 14 });
export const mainFlow = defineFlow("main", { nodes: {}, start: "boot", edges: {} });
`
    });

    expect(index.symbols["feature:home"]).toEqual({
      def: [{ path: "game.ts", binding: "homeFeature" }]
    });
    expect(index.symbols["scene:home"]).toEqual({
      def: [{ path: "game.ts", binding: "homeScene" }]
    });
    expect(index.symbols["projection:board.items"]).toEqual({
      def: [{ path: "game.ts", binding: "boardItems", key: "name" }]
    });
    expect(index.symbols["emitter:fx.stars"]).toEqual({
      def: [{ path: "game.ts", binding: "stars" }]
    });
    expect(index.symbols["flow:main"]).toEqual({ def: [{ path: "game.ts", binding: "mainFlow" }] });
    expect(index.unresolved).toEqual([]);
  });

  it("follows renamed imports, a renamed destructure, a namespace import and a barrel", () => {
    const index = indexOf({
      "kit.ts": `import { defineGame as game } from "@moku-labs/game";

export const { defineScene: scene, defineFeature } = game<{ player: object }>();
`,
      "barrel.ts": `export { defineFeature as feature } from "./kit";\n`,
      "features/home/scene.ts": `import { scene as makeScene } from "../../kit";

export const homeScene = makeScene("home", {});
`,
      "features/home/index.ts": `import * as kit from "../../kit";
import { feature } from "../../barrel";

export const boardScene = kit.scene("board", {});
export const homeFeature = feature("home", {});
`
    });

    expect(keysOf(index, "scene:")).toEqual(["scene:board", "scene:home"]);
    expect(index.symbols["scene:home"]?.def).toEqual([
      { path: "features/home/scene.ts", binding: "homeScene" }
    ]);
    expect(index.symbols["feature:home"]?.def).toEqual([
      { path: "features/home/index.ts", binding: "homeFeature" }
    ]);
  });

  it("takes the definers a file imports from @moku-labs/game directly", () => {
    const index = indexOf({
      "styles.ts": `import * as game from "@moku-labs/game";
import { defineTextStyles, defineStyle } from "@moku-labs/game";

export const uiStyles = defineTextStyles({ "ui.title": { size: 64 }, body: { size: 32 } });
export const card = defineStyle({ width: 10 });
export const hudScene = game.defineScene("hud", {});
`
    });

    expect(keysOf(index, "textStyle:")).toEqual(["textStyle:body", "textStyle:ui.title"]);
    expect(index.symbols["textStyle:ui.title"]?.def).toEqual([
      { path: "styles.ts", binding: "uiStyles", key: "ui.title" }
    ]);
    expect(index.symbols["style:styles.ts#card"]?.def).toEqual([
      { path: "styles.ts", binding: "card" }
    ]);
    expect(index.symbols["scene:hud"]?.def).toEqual([{ path: "styles.ts", binding: "hudScene" }]);
  });

  it("ignores a call whose callee is not a definer binding", () => {
    const index = indexOf({
      "kit.ts": KIT,
      "other.ts": `function defineFlow(id: string): string {
  return id;
}

export const notAFlow = defineFlow("main");
export const alsoNot = other.defineScene("home");
`
    });

    expect(keysOf(index, "flow:")).toEqual([]);
    expect(keysOf(index, "scene:")).toEqual([]);
  });

  it("sends a definer with a non-literal id to unresolved and guesses nothing", () => {
    const index = indexOf({
      "kit.ts": KIT,
      "flows/dynamic.ts": `import { defineFlow, defineScene, projection, defineTextStyles } from "../kit";

const id = "board";
export const boardFlow = defineFlow(id, { nodes: {}, start: "a", edges: {} });
export const scene = defineScene(\`scene\${id}\`, {});
export const items = projection({ name: id });
export const styles = defineTextStyles(table);
export const more = defineTextStyles({ [id]: {}, ...other });
`
    });

    expect(keysOf(index, "flow:")).toEqual([]);
    expect(index.unresolved).toEqual([
      { path: "flows/dynamic.ts", reason: "defineFlow id is not a string literal" },
      { path: "flows/dynamic.ts", reason: "defineScene id is not a string literal" },
      { path: "flows/dynamic.ts", reason: "projection name is not a string literal" },
      { path: "flows/dynamic.ts", reason: "defineTextStyles argument is not an object literal" },
      { path: "flows/dynamic.ts", reason: "defineTextStyles key is not a literal" },
      { path: "flows/dynamic.ts", reason: "defineTextStyles key is not a literal" }
    ]);
  });

  it("anchors a definer that is not bound to a module const by its id", () => {
    const index = indexOf({
      "kit.ts": KIT,
      "features/index.ts": `import { defineFeature } from "../kit";

export const features = [defineFeature("gift", {})];
`
    });

    expect(index.symbols["feature:gift"]?.def).toEqual([
      { path: "features/index.ts", key: "gift" }
    ]);
  });
});

describe("node tables", () => {
  const files = {
    "kit.ts": KIT,
    "nodes/merge.ts": `import { defineNode } from "../kit";

export const merge = defineNode({ outcomes: {}, run: () => undefined });
`,
    "nodes/select.ts": `import { defineNode } from "../kit";

export const pick = defineNode({ outcomes: {} });
`,
    "nodes/index.ts": `export { merge as mergeNode } from "./merge";\n`,
    "features/settings/nodes.ts": `import { defineNode } from "../../kit";

export const confirmReset = defineNode({ outcomes: {} });
`,
    "features/settings/flow.ts": `import { defineFlow } from "../../kit";
import { confirmReset } from "./nodes";

export const settingsFlow = defineFlow("settingsPopup", {
  nodes: { confirm: confirmReset },
  start: "confirm",
  edges: {}
});
`,
    "flows/board.ts": `import { slot } from "@moku-labs/game";
import { toast } from "@acme/nodes";
import { settingsFlow } from "../features/settings/flow";
import { defineFlow, defineNode } from "../kit";
import { mergeNode } from "../nodes";
import { merge } from "../nodes/merge";
import { pick as select } from "../nodes/select";

const local = defineNode({ outcomes: {} });

export const boardFlow = defineFlow("board", {
  nodes: {
    merge,
    select,
    again: mergeNode,
    local,
    settings: settingsFlow,
    afterOrder: slot("afterOrder"),
    toast
  },
  start: "merge",
  edges: {}
});
`
  };

  it("keys every entry of a nodes table by flow id and entry name", () => {
    const index = indexOf(files);

    expect(keysOf(index, "node:")).toEqual([
      "node:board/afterOrder",
      "node:board/again",
      "node:board/local",
      "node:board/merge",
      "node:board/select",
      "node:board/settings",
      "node:board/toast",
      "node:settingsPopup/confirm"
    ]);
  });

  it("follows a shorthand, a renamed import and a barrel to the declaration", () => {
    const index = indexOf(files);
    const use = { path: "flows/board.ts", binding: "boardFlow" };

    expect(index.symbols["node:board/merge"]).toEqual({
      def: [{ path: "nodes/merge.ts", binding: "merge" }],
      uses: [{ ...use, key: "merge" }]
    });
    expect(index.symbols["node:board/select"]?.def).toEqual([
      { path: "nodes/select.ts", binding: "pick" }
    ]);
    expect(index.symbols["node:board/again"]?.def).toEqual([
      { path: "nodes/merge.ts", binding: "merge" }
    ]);
    expect(index.symbols["node:settingsPopup/confirm"]?.def).toEqual([
      { path: "features/settings/nodes.ts", binding: "confirmReset" }
    ]);
  });

  it("anchors a sub-flow at its defineFlow, a slot at the table and a local node at its const", () => {
    const index = indexOf(files);

    expect(index.symbols["node:board/settings"]?.def).toEqual([
      { path: "features/settings/flow.ts", binding: "settingsFlow" }
    ]);
    expect(index.symbols["node:board/afterOrder"]).toEqual({
      def: [{ path: "flows/board.ts", binding: "boardFlow", key: "afterOrder" }]
    });
    expect(index.symbols["node:board/local"]?.def).toEqual([
      { path: "flows/board.ts", binding: "local" }
    ]);
  });

  it("anchors a node from outside the root at the table and lists it as unresolved", () => {
    const index = indexOf(files);

    expect(index.symbols["node:board/toast"]?.def).toEqual([
      { path: "flows/board.ts", binding: "boardFlow", key: "toast" }
    ]);
    expect(index.unresolved).toEqual([
      {
        path: "flows/board.ts",
        reason: 'node "board/toast": "toast" is not declared in a file of the root'
      }
    ]);
  });

  it("reads a nodes table held by a const, and refuses one it cannot read", () => {
    const index = indexOf({
      "kit.ts": KIT,
      "flows/main.ts": `import { defineFlow } from "../kit";

const nodes = { boot: slot("boot") };
const steps = makeNodes();

export const mainFlow = defineFlow("main", { nodes, start: "boot", edges: {} });
export const otherFlow = defineFlow("other", { nodes: steps, start: "boot", edges: {} });
export const spreadFlow = defineFlow("spread", { nodes: { ...nodes, ["x"]: a }, start: "boot", edges: {} });
`
    });

    expect(keysOf(index, "node:")).toEqual(["node:main/boot"]);
    expect(index.unresolved).toEqual([
      { path: "flows/main.ts", reason: 'defineFlow "other" nodes is not an object literal' },
      { path: "flows/main.ts", reason: 'defineFlow "spread" nodes has a spread' },
      { path: "flows/main.ts", reason: 'defineFlow "spread" node name is not a literal' }
    ]);
  });
});

describe("text styles and styles", () => {
  it("keys every literal key of defineTextStyles at its property", () => {
    const index = indexOf({
      "kit.ts": KIT,
      "features/ui/styles.ts": `import { defineTextStyles } from "../../kit";

export const uiStyles = defineTextStyles({
  "ui.title": { size: 64 },
  "ui.button": { size: 54 }
});
`
    });

    expect(keysOf(index, "textStyle:")).toEqual(["textStyle:ui.button", "textStyle:ui.title"]);
    expect(index.symbols["textStyle:ui.title"]?.def).toEqual([
      { path: "features/ui/styles.ts", binding: "uiStyles", key: "ui.title" }
    ]);
  });

  it("keys local and exported styles by path and binding, with the files that import them", () => {
    const index = indexOf({
      "kit.ts": KIT,
      "features/ui/popup.tsx": `import { defineStyle } from "../../kit";

const popupScreen = defineStyle({ width: 1 });
export const popupBoard = defineStyle({ width: 2 }) as const;

function built(size: number) {
  return defineStyle({ width: size });
}

export const table = { disc: defineStyle({ width: 3 }) };
`,
      "features/home/view.tsx": `import { popupBoard as board } from "../ui/popup";

export const look = board;
`
    });

    expect(keysOf(index, "style:")).toEqual([
      "style:features/ui/popup.tsx#built",
      "style:features/ui/popup.tsx#popupBoard",
      "style:features/ui/popup.tsx#popupScreen"
    ]);
    expect(index.symbols["style:features/ui/popup.tsx#popupBoard"]).toEqual({
      def: [{ path: "features/ui/popup.tsx", binding: "popupBoard" }],
      uses: [{ path: "features/home/view.tsx", binding: "board" }]
    });
    expect(index.unresolved).toEqual([
      {
        path: "features/ui/popup.tsx",
        reason: 'defineStyle in "table" is not bound to a module-level const'
      }
    ]);
  });
});

describe("style factories", () => {
  /** Styles built inside module-level functions, and two that are not. */
  const LOOKS = `import { defineStyle } from "../../kit";

function plankStyle(size: number) {
  return defineStyle({ width: size });
}

export const pillStyle = (width: number) => defineStyle({ width });

function roundStylesOf(size: number) {
  return {
    disc: defineStyle({ width: size }),
    icon: defineStyle({ width: size / 2 }) as const
  };
}

function boardStyle(hung: boolean) {
  if (!hung) return defineStyle({ width: 1 });

  return defineStyle({ width: 2 });
}

const ropeStyles = function (count: number) {
  return Array.from({ length: count }, (_, at) => defineStyle({ top: at }));
};

export const table = { disc: defineStyle({ width: 3 }) };

register(defineStyle({ width: 4 }));
`;

  /** The path the looks are indexed at. */
  const LOOKS_PATH = "features/ui/looks.ts";

  it("keys a style a function returns by the function, and one under a property by both", () => {
    const index = indexOf({ "kit.ts": KIT, [LOOKS_PATH]: LOOKS });

    expect(keysOf(index, "style:")).toEqual([
      `style:${LOOKS_PATH}#boardStyle`,
      `style:${LOOKS_PATH}#pillStyle`,
      `style:${LOOKS_PATH}#plankStyle`,
      `style:${LOOKS_PATH}#ropeStyles`,
      `style:${LOOKS_PATH}#roundStylesOf.disc`,
      `style:${LOOKS_PATH}#roundStylesOf.icon`
    ]);
    expect(index.symbols[`style:${LOOKS_PATH}#plankStyle`]).toEqual({
      def: [{ path: LOOKS_PATH, binding: "plankStyle" }]
    });
    expect(index.symbols[`style:${LOOKS_PATH}#roundStylesOf.icon`]).toEqual({
      def: [{ path: LOOKS_PATH, binding: "roundStylesOf", key: "icon" }]
    });
  });

  it("gives two calls of one function one key and one anchor, with no conflict", () => {
    const index = indexOf({ "kit.ts": KIT, [LOOKS_PATH]: LOOKS });

    expect(index.symbols[`style:${LOOKS_PATH}#boardStyle`]).toEqual({
      def: [{ path: LOOKS_PATH, binding: "boardStyle" }]
    });
  });

  it("resolves a call inside an inner arrow of a module-level function", () => {
    const index = indexOf({ "kit.ts": KIT, [LOOKS_PATH]: LOOKS });

    expect(index.symbols[`style:${LOOKS_PATH}#ropeStyles`]?.def).toEqual([
      { path: LOOKS_PATH, binding: "ropeStyles" }
    ]);
  });

  it("leaves a call in an object const and a call at module scope unresolved", () => {
    const index = indexOf({ "kit.ts": KIT, [LOOKS_PATH]: LOOKS });

    expect(index.symbols[`style:${LOOKS_PATH}#table`]).toBeUndefined();
    expect(index.symbols[`style:${LOOKS_PATH}#table.disc`]).toBeUndefined();
    expect(index.unresolved).toEqual([
      {
        path: LOOKS_PATH,
        reason: 'defineStyle in "table" is not bound to a module-level const'
      },
      { path: LOOKS_PATH, reason: "defineStyle is not bound to a module-level const" }
    ]);
  });

  it("leaves a call in a class, a let function and a top-level IIFE unresolved", () => {
    const index = indexOf({
      "kit.ts": KIT,
      [LOOKS_PATH]: `import { defineStyle } from "../../kit";

export class Looks {
  card() {
    return defineStyle({ width: 1 });
  }
}

let later = () => defineStyle({ width: 2 });

export const once = (() => defineStyle({ width: 3 }))();

export default function () {
  return defineStyle({ width: 4 });
}
`
    });

    expect(keysOf(index, "style:")).toEqual([]);
    expect(index.unresolved.map(item => item.reason)).toEqual([
      'defineStyle in "Looks" is not bound to a module-level const',
      'defineStyle in "later" is not bound to a module-level const',
      'defineStyle in "once" is not bound to a module-level const',
      "defineStyle is not bound to a module-level const"
    ]);
  });
});

describe("JSX keys", () => {
  const files = {
    "features/orders/strip.tsx": `import { Signboard } from "../ui/kit";

export function cardKey(slot: number): string {
  return \`card\${slot}\`;
}

function CardPicture(props: { card: { slot: number } }) {
  const card = props.card;
  const id = cardKey(card.slot);

  return (
    <stack key={\`\${id}Picture\`}>
      <image key={id} />
      <text key="stripTitle" />
      <text key={"quoted"} />
      <text key={cardKey(2) + "Label"} />
    </stack>
  );
}

export function Strip(props: { cards: { slot: number; key: string }[] }) {
  return (
    <Signboard id="stripBoard" title="Orders">
      {props.cards.map(card => (
        <row key={card.key} />
      ))}
      <row key="stripTitle" />
      <panel id="lowercase" />
    </Signboard>
  );
}
`,
    "features/ui/kit.tsx": `export function Signboard(props: { id: string; title: string }) {
  return (
    <panel key={props.id}>
      <button key={\`\${props.id}Close\`} />
      {rows(props)}
    </panel>
  );
}

function rows(props: { id: string }) {
  const key = \`\${props.id}Row\`;

  return <row key={key} />;
}

export const Badge = ({ id }: { id: string }) => <text key={\`\${id}Badge\`} />;
`
  };

  it("keeps a literal key and a literal id= prop on a component", () => {
    const index = indexOf(files);

    expect(index.symbols["jsx:stripTitle"]).toEqual({
      def: [{ path: "features/orders/strip.tsx", key: "stripTitle", kind: "literal" }]
    });
    expect(index.symbols["jsx:quoted"]?.def).toEqual([
      { path: "features/orders/strip.tsx", key: "quoted", kind: "literal" }
    ]);
    expect(index.symbols["jsx:stripBoard"]?.def).toEqual([
      {
        path: "features/orders/strip.tsx",
        key: "stripBoard",
        kind: "idProp",
        component: "Signboard",
        prop: "id"
      }
    ]);
    expect(index.symbols["jsx:lowercase"]).toBeUndefined();
  });

  it("reduces templates and identifiers through same-file initializers and functions", () => {
    const index = indexOf(files);

    expect(index.symbols["jsx:card*Picture"]?.def).toEqual([
      { path: "features/orders/strip.tsx", key: "card*Picture", kind: "template", stem: "card" }
    ]);
    expect(index.symbols["jsx:card*"]?.def).toEqual([
      { path: "features/orders/strip.tsx", key: "card*", kind: "ident", stem: "card" }
    ]);
    expect(index.symbols["jsx:card2Label"]?.def).toEqual([
      { path: "features/orders/strip.tsx", key: "card2Label", kind: "ident", stem: "card2Label" }
    ]);
  });

  it("turns props.id into {id} and names the component the pattern is written in", () => {
    const index = indexOf(files);

    expect(index.symbols["jsx:{id}"]?.def).toEqual([
      { path: "features/ui/kit.tsx", key: "{id}", kind: "ident", component: "Signboard" }
    ]);
    expect(index.symbols["jsx:{id}Close"]?.def).toEqual([
      { path: "features/ui/kit.tsx", key: "{id}Close", kind: "template", component: "Signboard" }
    ]);
    expect(index.symbols["jsx:{id}Row"]?.def).toEqual([
      { path: "features/ui/kit.tsx", key: "{id}Row", kind: "ident" }
    ]);
    expect(index.symbols["jsx:{id}Badge"]?.def).toEqual([
      { path: "features/ui/kit.tsx", key: "{id}Badge", kind: "template", component: "Badge" }
    ]);
  });

  it("turns props.<name>Key into a {<name>Key} hole and keeps any other prop a *", () => {
    const index = indexOf({
      "features/ui/popup.tsx": `export function Amount(props: { id: string; amountKey: string; tab: string }) {
  return (
    <row key={props.id}>
      <text key={props.amountKey} />
      <text key={\`\${props.amountKey}Unit\`} />
      <text key={props.tab} />
    </row>
  );
}

export const Coin = ({ coinKey }: { coinKey: string }) => <icon key={coinKey} />;
`
    });

    expect(index.symbols["jsx:{amountKey}"]?.def).toEqual([
      { path: "features/ui/popup.tsx", key: "{amountKey}", kind: "ident", component: "Amount" }
    ]);
    expect(index.symbols["jsx:{amountKey}Unit"]?.def).toEqual([
      {
        path: "features/ui/popup.tsx",
        key: "{amountKey}Unit",
        kind: "template",
        component: "Amount"
      }
    ]);
    expect(index.symbols["jsx:{coinKey}"]?.def).toEqual([
      { path: "features/ui/popup.tsx", key: "{coinKey}", kind: "ident", component: "Coin" }
    ]);
    expect(index.unresolved).toEqual([
      { path: "features/ui/popup.tsx", reason: 'JSX key "props.tab" on <text> resolves to "*"' }
    ]);
  });

  it("indexes a literal key-carrying prop on a component with its prop, and no other prop", () => {
    const index = indexOf({
      "features/gift/gift.tsx": `export function Gift() {
  return (
    <Amount id="giftAmount" amountKey="giftReward" title="Gift" picture="ui.gift">
      <panel unitKey="lowercase" />
    </Amount>
  );
}
`
    });

    expect(index.symbols["jsx:giftReward"]?.def).toEqual([
      {
        path: "features/gift/gift.tsx",
        key: "giftReward",
        kind: "idProp",
        component: "Amount",
        prop: "amountKey"
      }
    ]);
    expect(index.symbols["jsx:giftAmount"]?.def).toEqual([
      {
        path: "features/gift/gift.tsx",
        key: "giftAmount",
        kind: "idProp",
        component: "Amount",
        prop: "id"
      }
    ]);
    expect(keysOf(index, "jsx:")).toEqual(["jsx:giftAmount", "jsx:giftReward"]);
  });

  it("repeats a JSX key without a conflict and sends a bare * to unresolved", () => {
    const index = indexOf(files);

    expect(index.symbols["jsx:stripTitle"]?.conflict).toBeUndefined();
    expect(index.unresolved).toEqual([
      { path: "features/orders/strip.tsx", reason: 'JSX key "card.key" on <row> resolves to "*"' }
    ]);
  });
});

describe("components", () => {
  it("keys a module-level upper-case function or function-valued const of a .tsx file", () => {
    const index = indexOf({
      "features/ui/kit.tsx": `export const ROUND_SIZE = 120;
const TAP = { width: 10 };

export function RoundButton(props: { id: string }) {
  return <button key={props.id} />;
}

export const Badge = (props: { id: string }) => <text key={props.id} />;
export const Plaque = function (props: { id: string }) {
  return <panel key={props.id} />;
};
function Rope() {
  return <rope />;
}

export function roundStyle() {
  return TAP;
}
const helper = () => <row />;
`
    });

    expect(keysOf(index, "component:")).toEqual([
      "component:Badge",
      "component:Plaque",
      "component:Rope",
      "component:RoundButton"
    ]);
    expect(index.symbols["component:RoundButton"]).toEqual({
      def: [{ path: "features/ui/kit.tsx", binding: "RoundButton" }]
    });
    expect(index.symbols["component:Rope"]?.def).toEqual([
      { path: "features/ui/kit.tsx", binding: "Rope" }
    ]);
    expect(index.unresolved).toEqual([]);
  });

  it("ignores a plain upper-case function of a .ts file and an overload signature", () => {
    const index = indexOf({
      "features/ui/size.ts":
        "export function Measure(width: number): number {\n  return width;\n}\n",
      "features/ui/pill.tsx": `export function Pill(props: { id: string }): unknown;
export function Pill(props: { id: string }) {
  return <row key={props.id} />;
}
`
    });

    expect(keysOf(index, "component:")).toEqual(["component:Pill"]);
    expect(index.symbols["component:Pill"]).toEqual({
      def: [{ path: "features/ui/pill.tsx", binding: "Pill" }]
    });
  });

  it("keys defineComponent by its literal id, bound to its const, under a renamed import", () => {
    const index = indexOf({
      "kit.ts": KIT,
      "features/settings/settings.ts": `import { defineComponent as component } from "../../kit";

export const SettingsPanel = component("Settings", { view: () => undefined });
`,
      "features/settings/view.tsx": `import { SettingsPanel } from "./settings";

export function SettingsScreen() {
  return <SettingsPanel />;
}
`
    });

    expect(index.symbols["component:Settings"]).toEqual({
      def: [{ path: "features/settings/settings.ts", binding: "SettingsPanel" }],
      uses: [{ path: "features/settings/view.tsx", binding: "SettingsPanel" }]
    });
    expect(index.symbols["component:SettingsPanel"]).toBeUndefined();
  });

  it("sends a defineComponent with a non-literal id to unresolved", () => {
    const index = indexOf({
      "kit.ts": KIT,
      "features/leave/leave.tsx": `import { defineComponent } from "../../kit";

const id = "Leave";
export const Leave = defineComponent(id, { view: () => undefined });
`
    });

    expect(keysOf(index, "component:")).toEqual([]);
    expect(index.unresolved).toEqual([
      { path: "features/leave/leave.tsx", reason: "defineComponent id is not a string literal" }
    ]);
  });

  it("lists one use per file that renders the binding, member tags too, sorted by path", () => {
    const index = indexOf({
      "features/ui/kit.tsx": `export function RoundButton(props: { id: string }) {
  return <button key={props.id} />;
}

export function Bar() {
  return (
    <row>
      <RoundButton id="a" />
      <RoundButton id="b">x</RoundButton>
    </row>
  );
}
`,
      "features/hud/row.tsx": `import * as ui from "../ui/kit";

export function HudRow() {
  return <ui.RoundButton id="hud" />;
}
`,
      "features/home/view.tsx": `import { RoundButton } from "../ui/kit";

export function Home() {
  return <RoundButton id="play"></RoundButton>;
}
`,
      "features/home/text.tsx": `export function Words() {
  return <roundButton key="lower" />;
}
`
    });

    expect(index.symbols["component:RoundButton"]?.uses).toEqual([
      { path: "features/home/view.tsx", binding: "RoundButton" },
      { path: "features/hud/row.tsx", binding: "RoundButton" },
      { path: "features/ui/kit.tsx", binding: "RoundButton" }
    ]);
    expect(index.symbols["component:Bar"]?.uses).toBeUndefined();
  });

  it("reads the last name of a namespaced tag and no name from a this tag", () => {
    const index = indexOf({
      "features/ui/kit.tsx": "export function Badge() {\n  return <row />;\n}\n",
      "features/hud/badge.tsx": `export function HudBadge() {
  return (
    <row>
      <ui:Badge />
      <this />
    </row>
  );
}
`
    });

    expect(index.symbols["component:Badge"]?.uses).toEqual([
      { path: "features/hud/badge.tsx", binding: "Badge" }
    ]);
    expect(index.unresolved).toEqual([]);
  });

  it("marks one name declared in two files as a conflict and keeps both anchors", () => {
    const index = indexOf({
      "kit.ts": KIT,
      "features/a.tsx": "export function Panel() {\n  return <row />;\n}\n",
      "features/b.tsx": `import { defineComponent } from "../kit";

export const Box = defineComponent("Panel", { view: () => undefined });
`
    });

    expect(index.symbols["component:Panel"]).toEqual({
      def: [
        { path: "features/a.tsx", binding: "Panel" },
        { path: "features/b.tsx", binding: "Box" }
      ],
      conflict: true
    });
  });
});

describe("conflicts, broken files and the revision", () => {
  it("marks a key defined twice as a conflict and keeps both anchors", () => {
    const index = indexOf({
      "kit.ts": KIT,
      "a.ts": `import { defineScene } from "./kit";\n\nexport const one = defineScene("home", {});\n`,
      "b.ts": `import { defineScene } from "./kit";\n\nexport const two = defineScene("home", {});\n`
    });

    expect(index.symbols["scene:home"]).toEqual({
      def: [
        { path: "a.ts", binding: "one" },
        { path: "b.ts", binding: "two" }
      ],
      conflict: true
    });
  });

  it("gives a file broken from its first parse no entries and one unresolved item", () => {
    const index = indexOf({
      "kit.ts": KIT,
      "broken.ts": `import { defineScene } from "./kit";\n\nexport const s = defineScene("home", {;\n`
    });

    expect(index.files["broken.ts"]).toEqual({
      hash: expect.stringMatching(/^[\da-f]{40}$/),
      state: "broken",
      error: "broken.ts:3:39 Property assignment expected."
    });
    expect(keysOf(index, "scene:")).toEqual([]);
    expect(index.unresolved).toEqual([
      { path: "broken.ts", reason: "broken.ts:3:39 Property assignment expected." }
    ]);
  });

  it("keeps the last good entries of a file that breaks later", () => {
    const catalog = createCatalog(ts);

    putFile(catalog, "kit.ts", Buffer.from(KIT));
    putFile(
      catalog,
      "scene.ts",
      Buffer.from(
        `import { defineScene } from "./kit";\n\nexport const s = defineScene("home", {});\n`
      )
    );
    putFile(
      catalog,
      "scene.ts",
      Buffer.from(
        `import { defineScene } from "./kit";\n\nexport const s = defineScene("home", {;\n`
      )
    );

    const index = buildIndex(catalog, "manifest.json");

    expect(index.symbols["scene:home"]?.def).toEqual([{ path: "scene.ts", binding: "s" }]);
    expect(index.files["scene.ts"]?.state).toBe("broken");
    expect(index.unresolved).toEqual([]);
    expect(index.manifest).toBe("manifest.json");
  });

  it("re-reads the files of a kit whose definers changed", () => {
    const catalog = createCatalog(ts);
    const scene = `import { defineScene } from "./kit";\n\nexport const s = defineScene("home", {});\n`;

    putFile(catalog, "kit.ts", Buffer.from(KIT));
    putFile(catalog, "scene.ts", Buffer.from(scene));

    expect(Object.keys(buildIndex(catalog, undefined).symbols)).toContain("scene:home");

    putFile(catalog, "kit.ts", Buffer.from(KIT.replace("defineScene,", "")));

    expect(Object.keys(buildIndex(catalog, undefined).symbols)).not.toContain("scene:home");

    dropFile(catalog, "kit.ts");

    expect(buildIndex(catalog, undefined).files["kit.ts"]).toBeUndefined();
  });

  it("hashes the sorted path and hash lines into the revision", () => {
    const index = indexOf({ "b.ts": "export const b = 2;\n", "a.ts": "export const a = 1;\n" });
    const lines = `a.ts\0${sha1("export const a = 1;\n")}\nb.ts\0${sha1("export const b = 2;\n")}\n`;

    expect(index.revision).toBe(sha1(lines));
    expect(index.schemaVersion).toBe(1);
    expect(Object.isFrozen(index.symbols)).toBe(true);
  });
});

/**
 * The root flow of a v15 game, naming the node `homeNode` through one import.
 *
 * @param specifier - The module the node is imported from.
 * @returns The source of `game.ts`.
 */
function mainFlowOf(specifier: string): string {
  return `import { defineFlow } from "@core/kit";
import { homeNode } from "${specifier}";

export const mainFlow = defineFlow("main", { nodes: { home: homeNode }, start: "home", edges: {} });
`;
}

describe("tsconfig aliases", () => {
  /** The v15 aliases, targets root-relative. */
  const v15 = aliasesOf({
    "@core/*": ["core/*"],
    "@shared": ["shared/index.ts"],
    "@shared/rules": ["shared/rules/index.ts"],
    "@features": ["features/index.ts"],
    "@features/*": ["features/*/index.ts"],
    "@plugins": ["plugins/index.ts"],
    "@generated/*": ["generated/*"],
    "@tests/*": ["tests/*"]
  });

  /** A node declared in a feature folder, from the kit at `core/kit.ts`. */
  const HOME_NODE = `import { defineNode } from "@core/kit";

export const homeNode = defineNode({ outcomes: {} });
`;

  it("takes the definers of a kit at core/kit.ts imported as @core/kit", () => {
    const files = {
      "core/kit.ts": KIT,
      "features/home/flow/home.ts": HOME_NODE,
      "features/home/index.ts": `import { defineFeature, defineFlow, defineTextStyles, projection } from "@core/kit";
import { homeNode } from "./flow/home";

export const homeFeature = defineFeature("home", {});
export const homeFlow = defineFlow("home", { nodes: { home: homeNode }, start: "home", edges: {} });
export const homeScreen = projection({ name: "home.screen", layer: "ui" });
export const styles = defineTextStyles({ "ui.body": { size: 12 } });
`
    };
    const index = indexOf(files, v15);

    expect(Object.keys(index.symbols)).toEqual([
      "feature:home",
      "flow:home",
      "node:home/home",
      "projection:home.screen",
      "textStyle:ui.body"
    ]);
    expect(index.unresolved).toEqual([]);
    expect(Object.keys(indexOf(files).symbols)).toEqual([]);
  });

  it("follows a node through the door of a feature to its declaration, the table its use", () => {
    const index = indexOf(
      {
        "core/kit.ts": KIT,
        "game.ts": mainFlowOf("@features/home"),
        "features/home/index.ts": `export { homeNode } from "./flow/home";\n`,
        "features/home/flow/home.ts": HOME_NODE
      },
      v15
    );

    expect(index.symbols["node:main/home"]).toEqual({
      def: [{ path: "features/home/flow/home.ts", binding: "homeNode" }],
      uses: [{ path: "game.ts", binding: "mainFlow", key: "home" }]
    });
    expect(index.unresolved).toEqual([]);
  });

  it("maps a deep @features spelling to the index.ts of its folder, and names the alias that reaches no file", () => {
    const deep = mainFlowOf("@features/home/flow/home");
    const found = indexOf(
      {
        "core/kit.ts": KIT,
        "game.ts": deep,
        "features/home/flow/home/index.ts": HOME_NODE
      },
      v15
    );
    const missed = indexOf(
      { "core/kit.ts": KIT, "game.ts": deep, "features/home/flow/home.ts": HOME_NODE },
      v15
    );

    expect(found.symbols["node:main/home"]?.def).toEqual([
      { path: "features/home/flow/home/index.ts", binding: "homeNode" }
    ]);
    expect(missed.symbols["node:main/home"]?.def).toEqual([
      { path: "game.ts", binding: "mainFlow", key: "home" }
    ]);
    expect(missed.unresolved).toEqual([
      {
        path: "game.ts",
        reason:
          'node "main/home": "homeNode" is imported from "@features/home/flow/home", which names no file of the root'
      }
    ]);
  });

  it("prefers an exact key over a `*` key, then the longest prefix", () => {
    const index = indexOf(
      {
        "kit.ts": KIT,
        "game.ts": `import { defineFlow } from "./kit";
import { pick } from "@shared/rules";
import { panel } from "@shared/views";
import { tiny } from "@sx";

export const mainFlow = defineFlow("main", { nodes: { pick, panel, tiny }, start: "pick", edges: {} });
`,
        "shared/rules/main.ts": "export const pick = 1;\n",
        "shared/rules/index.ts": "export const pick = 2;\n",
        "shared/views/index.ts": "export const panel = 1;\n",
        "s/hared/views.ts": "export const panel = 2;\n",
        "s/x.ts": "export const tiny = 1;\n"
      },
      aliasesOf({
        "@s*": ["s/*.ts"],
        "@shared/*": ["shared/*/index.ts"],
        "@shared/rules": ["shared/rules/main.ts"]
      })
    );

    expect(index.symbols["node:main/pick"]?.def).toEqual([
      { path: "shared/rules/main.ts", binding: "pick" }
    ]);
    expect(index.symbols["node:main/panel"]?.def).toEqual([
      { path: "shared/views/index.ts", binding: "panel" }
    ]);
    expect(index.symbols["node:main/tiny"]?.def).toEqual([{ path: "s/x.ts", binding: "tiny" }]);
  });

  it("keeps the engine a package when the paths map it: its definers count, its names are not followed", () => {
    const index = indexOf(
      {
        "engine/index.ts": "export const defineScene = () => ({});\n",
        "engine/testing.ts": "export const isolate = 1;\n",
        "home.ts": `import { defineScene } from "@moku-labs/game";

export const homeScene = defineScene("home", {});
`,
        "flows/test.ts": `import { defineFlow } from "@moku-labs/game";
import { isolate } from "@moku-labs/game/testing";

export const testFlow = defineFlow("test", { nodes: { isolate }, start: "isolate", edges: {} });
`
      },
      aliasesOf({
        "@moku-labs/game": ["engine/index.ts"],
        "@moku-labs/game/*": ["engine/*.ts"]
      })
    );

    expect(index.symbols["scene:home"]?.def).toEqual([{ path: "home.ts", binding: "homeScene" }]);
    expect(index.symbols["node:test/isolate"]?.def).toEqual([
      { path: "flows/test.ts", binding: "testFlow", key: "isolate" }
    ]);
    expect(index.unresolved).toEqual([
      {
        path: "flows/test.ts",
        reason: 'node "test/isolate": "isolate" is not declared in a file of the root'
      }
    ]);
  });

  it("follows a namespace import, a re-export and a star export written as aliases", () => {
    const index = indexOf(
      {
        "core/kit.ts": KIT,
        "features/home/index.ts": `import * as kit from "@core/kit";

export const homeScene = kit.defineScene("home", {});
export const homeNode = kit.defineNode({ outcomes: {} });
`,
        "features/info/index.ts": HOME_NODE.replaceAll("homeNode", "infoNode"),
        "features/index.ts": `export { homeNode } from "@features/home";
export * from "@features/info";
`,
        "game.ts": `import { defineFlow } from "@core/kit";
import { homeNode, infoNode } from "@features";

export const mainFlow = defineFlow("main", { nodes: { home: homeNode, info: infoNode }, start: "home", edges: {} });
`
      },
      v15
    );

    expect(index.symbols["scene:home"]?.def).toEqual([
      { path: "features/home/index.ts", binding: "homeScene" }
    ]);
    expect(index.symbols["node:main/home"]?.def).toEqual([
      { path: "features/home/index.ts", binding: "homeNode" }
    ]);
    expect(index.symbols["node:main/info"]?.def).toEqual([
      { path: "features/info/index.ts", binding: "infoNode" }
    ]);
    expect(index.unresolved).toEqual([]);
  });

  it("names the tsconfig in the index, and re-reads the files whose definers an alias change moved", () => {
    const catalog = createCatalog(ts);
    const scene = `import { defineScene } from "@core/kit";\n\nexport const s = defineScene("home", {});\n`;

    putFile(catalog, "core/kit.ts", Buffer.from(KIT));
    putFile(catalog, "scene.ts", Buffer.from(scene));

    const aliased = buildIndex(catalog, undefined, v15);

    expect(aliased.tsconfig).toBe("tsconfig.json");
    expect(Object.keys(aliased.symbols)).toEqual(["scene:home"]);

    const plain = buildIndex(catalog, "manifest.json", undefined);

    expect(plain.tsconfig).toBeUndefined();
    expect(Object.keys(plain)).toEqual([
      "schemaVersion",
      "revision",
      "manifest",
      "symbols",
      "files",
      "unresolved"
    ]);
    expect(plain.symbols).toEqual({});
    expect(Object.keys(buildIndex(catalog, undefined, v15).symbols)).toEqual(["scene:home"]);
  });
});
