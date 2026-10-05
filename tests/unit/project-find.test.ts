import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openProject } from "../../src/project";
import { loadTypeScript } from "../../src/project/typescript";

// ---------------------------------------------------------------------------
// Unit test: `find` answers lines read from the file on disk at the call. A
// tiny game is written into a temp folder; the test edits, breaks and links
// its files and checks what `find`, `changed` and `openProject` answer.
// ---------------------------------------------------------------------------

/** The kit of the tiny game. */
const KIT = `import { defineGame } from "@moku-labs/game";

export const { defineNode, defineFlow, defineScene, defineTextStyles } = defineGame<{ player: object }>();
`;

/** A node file: the declaration sits on line 3. */
const MERGE = `import { defineNode } from "../kit";

export const merge = defineNode({
  outcomes: {}
});
`;

/** The flow that names the node. */
const BOARD = `import { defineFlow } from "../kit";
import { merge } from "../nodes/merge";

export const boardFlow = defineFlow("board", {
  nodes: { merge },
  start: "merge",
  edges: {}
});
`;

/** Text styles: the key `ui.title` sits on line 4. */
const STYLES = `import { defineTextStyles } from "../../kit";

export const uiStyles = defineTextStyles({
  "ui.title": { size: 64 },
  "ui.body": { size: 32 }
});
`;

/** A settings screen: the Signboard element starts on line 3, its id prop is on line 4. */
const SETTINGS = `export function Settings() {
  return (
    <Signboard
      id="settingsBoard"
      title="Settings"
    >
      <row key="settingsTabs" />
    </Signboard>
  );
}
`;

/** The kit component the id prop feeds. */
const UI_KIT = `export function Signboard(props: { id: string; title: string }) {
  return (
    <panel key={props.id}>
      <button key={\`\${props.id}Close\`} />
    </panel>
  );
}

export function cardKey(slot: number): string {
  return \`card\${slot}\`;
}

export function Card(props: { slot: number }) {
  const id = cardKey(props.slot);

  return <stack key={\`\${id}Picture\`} />;
}
`;

/** The temp folders of this file, removed after each test. */
const made: string[] = [];

/**
 * Write a tiny game into a fresh temp folder.
 *
 * @param extra - More files, root-relative path to text.
 * @returns The game root.
 */
function writeGame(extra: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "moku-project-find-"));

  made.push(root);

  const files: Record<string, string> = {
    "kit.ts": KIT,
    "nodes/merge.ts": MERGE,
    "flows/board.ts": BOARD,
    "features/ui/styles.ts": STYLES,
    "features/ui/kit.tsx": UI_KIT,
    "features/settings/settings.tsx": SETTINGS,
    ...extra
  };

  for (const [file, text] of Object.entries(files)) put(root, file, text);

  return root;
}

/**
 * Write one file of a game, making its folder first.
 *
 * @param root - The game root.
 * @param file - The root-relative path.
 * @param text - The contents.
 */
function put(root: string, file: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("find", () => {
  it("answers the declaration of a node, the property of a text style and the hash of the bytes", async () => {
    const project = await openProject({ root: writeGame() });

    const [node] = await project.find("node:board/merge");
    const [style] = await project.find("textStyle:ui.title");

    expect(node).toEqual({
      path: "nodes/merge.ts",
      binding: "merge",
      line: 3,
      range: [3, 1, 5, 4],
      hash: project.index.files["nodes/merge.ts"]?.hash
    });
    expect(style).toMatchObject({
      path: "features/ui/styles.ts",
      key: "ui.title",
      line: 4,
      range: [4, 3, 4, 27]
    });
    expect(await project.find("flow:board")).toMatchObject([{ path: "flows/board.ts", line: 4 }]);
    project.close();
  });

  it("answers the attribute line of a JSX key with the element as the range", async () => {
    const project = await openProject({ root: writeGame() });

    expect(await project.find("jsx:settingsBoard")).toEqual([
      {
        path: "features/settings/settings.tsx",
        key: "settingsBoard",
        kind: "idProp",
        component: "Signboard",
        line: 4,
        range: [3, 5, 8, 17],
        hash: project.index.files["features/settings/settings.tsx"]?.hash
      },
      expect.objectContaining({ path: "features/ui/kit.tsx", key: "{id}", line: 3 })
    ]);
  });

  it("fills an {id} pattern with a literal id prop and matches * patterns as wildcards", async () => {
    const project = await openProject({ root: writeGame() });

    const close = await project.find("jsx:settingsBoardClose");
    const picture = await project.find("jsx:card2Picture");

    expect(close.map(found => `${found.path}:${found.line}:${found.kind}`)).toEqual([
      "features/ui/kit.tsx:4:template",
      "features/settings/settings.tsx:4:idProp"
    ]);
    expect(picture.map(found => `${found.path}:${found.line}:${found.stem}`)).toEqual([
      "features/ui/kit.tsx:16:card"
    ]);
    expect(await project.find("jsx:nothingClose")).toEqual([]);
  });

  it("answers [] for an unknown key", async () => {
    const project = await openProject({ root: writeGame() });

    expect(await project.find("node:board/nowhere")).toEqual([]);
    expect(await project.find("whatever")).toEqual([]);
  });

  it("reads the new line of a file edited after indexing, and leaves the index as it was", async () => {
    const root = writeGame();
    const project = await openProject({ root });
    const indexed = project.index.files["nodes/merge.ts"]?.hash;

    put(root, "nodes/merge.ts", `// one\n// two\n${MERGE}`);

    const [found] = await project.find("node:board/merge");

    expect(found?.line).toBe(5);
    expect(found?.hash).not.toBe(indexed);
    expect(project.index.files["nodes/merge.ts"]?.hash).toBe(indexed);
  });

  it("answers a broken file from its last good parse with broken: true", async () => {
    const root = writeGame();
    const project = await openProject({ root });

    put(root, "nodes/merge.ts", `// above\n${MERGE.replace("outcomes: {}", "outcomes: {")}`);

    const [fresh] = await project.find("node:board/merge");

    expect(fresh).toMatchObject({ path: "nodes/merge.ts", line: 3, broken: true });

    const index = await project.changed("nodes/merge.ts");

    expect(index.files["nodes/merge.ts"]).toMatchObject({ state: "broken" });
    expect(index.files["nodes/merge.ts"]?.error).toMatch(/^nodes\/merge\.ts:\d+:\d+ /);
    expect(index.symbols["node:board/merge"]).toBeDefined();
    expect(await project.find("node:board/merge")).toMatchObject([{ line: 3, broken: true }]);
  });

  it("drops the anchors of a file deleted after indexing", async () => {
    const root = writeGame();
    const project = await openProject({ root });

    rmSync(path.join(root, "nodes/merge.ts"));

    expect(await project.find("node:board/merge")).toEqual([]);
  });
});

describe("changed", () => {
  it("re-indexes one path now, and drops a deleted file", async () => {
    const root = writeGame();
    const project = await openProject({ root });

    put(
      root,
      "features/home/scene.ts",
      'import { defineScene } from "../../kit";\n\nexport const homeScene = defineScene("home", {});\n'
    );

    const added = await project.changed("features/home/scene.ts");

    expect(added.symbols["scene:home"]?.def).toEqual([
      { path: "features/home/scene.ts", binding: "homeScene" }
    ]);
    expect(project.index).toBe(added);

    rmSync(path.join(root, "features/home/scene.ts"));

    const removed = await project.changed("features/home/scene.ts");

    expect(removed.symbols["scene:home"]).toBeUndefined();
    expect(removed.revision).not.toBe(added.revision);
  });

  it("changes nothing for a path the index does not read, nor for bytes it already holds", async () => {
    const root = writeGame();
    const project = await openProject({ root });
    const before = project.index;

    put(root, "nodes/merge.ts", MERGE);

    expect(await project.changed("nodes/merge.ts")).toBe(before);

    put(root, "README.md", "# game\n");

    expect(await project.changed("README.md")).toBe(before);
    expect(await project.changed("generated/assets.ts")).toBe(before);
  });

  it("refuses a path that leaves the root, by .. or by a symlink", async () => {
    const root = writeGame();
    const outside = mkdtempSync(path.join(tmpdir(), "moku-project-outside-"));

    made.push(outside);
    put(outside, "secret.ts", "export const secret = 1;\n");
    symlinkSync(path.join(outside, "secret.ts"), path.join(root, "linked.ts"));

    const project = await openProject({ root });

    await expect(project.changed("../outside.ts")).rejects.toThrow(
      '[game] The path "../outside.ts" leaves the project root.'
    );
    await expect(project.changed("/etc/hosts.ts")).rejects.toThrow("leaves the project root");
    await expect(project.changed("linked.ts")).rejects.toThrow(
      '[game] The path "linked.ts" leaves the project root.'
    );
    expect(project.index.files["linked.ts"]).toBeUndefined();
  });

  it("reports a symlink loop instead of reading it", async () => {
    const root = writeGame();

    symlinkSync(path.join(root, "loop-b.ts"), path.join(root, "loop-a.ts"));
    symlinkSync(path.join(root, "loop-a.ts"), path.join(root, "loop-b.ts"));

    const project = await openProject({ root });

    await expect(project.changed("loop-a.ts")).rejects.toThrow();
    expect(project.index.files["loop-a.ts"]).toBeUndefined();
  });
});

describe("openProject", () => {
  it("rejects a root that is missing or not a directory, naming the path", async () => {
    const root = writeGame();

    await expect(openProject({ root: path.join(root, "kit.ts") })).rejects.toThrow(
      `[game] The project root "${path.join(root, "kit.ts")}" is not a directory.`
    );
    await expect(openProject({ root: path.join(root, "nope") })).rejects.toThrow(
      `[game] The project root "${path.join(root, "nope")}" does not exist.`
    );
  });

  it("sets the manifest only when the file exists", async () => {
    const root = writeGame({ "public/manifest.json": "{}" });

    const plain = await openProject({ root });
    const named = await openProject({ root, manifest: "public/manifest.json" });

    expect(plain.index.manifest).toBeUndefined();
    expect(named.index.manifest).toBe("public/manifest.json");
  });

  it("skips tests, generated files and the folders a game never edits", async () => {
    const root = writeGame({
      "generated/assets.ts": "export const a = 1;\n",
      "features/ui/__tests__/kit.test.ts": "export const t = 1;\n",
      "nodes/merge.spec.ts": "export const s = 1;\n",
      "node_modules/pkg/index.ts": "export const p = 1;\n",
      "dist/game.ts": "export const d = 1;\n",
      "tests/fixture.ts": "export const f = 1;\n",
      ".moku/editor.ts": "export const e = 1;\n"
    });
    const project = await openProject({ root });

    expect(Object.keys(project.index.files)).toEqual([
      "features/settings/settings.tsx",
      "features/ui/kit.tsx",
      "features/ui/styles.ts",
      "flows/board.ts",
      "kit.ts",
      "nodes/merge.ts"
    ]);
  });
});

describe("loadTypeScript", () => {
  it("rejects with the install hint when typescript cannot be loaded", async () => {
    await expect(
      loadTypeScript(() => Promise.reject(new Error("Cannot find package 'typescript'")))
    ).rejects.toThrow(
      '[game] The project index needs the "typescript" package.\n  Install it as a dev dependency of the game.'
    );
  });
});
