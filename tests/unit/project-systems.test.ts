import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openProject } from "../../src/project";
import { openSession, syncWithDisk } from "../../src/project/session";

// ---------------------------------------------------------------------------
// Unit test: the `system:` keys of the project index. A tiny game is written
// into a temp folder; the test reads the keys a `system({ name })` call makes,
// the lines `find` answers for them, and how a renamed name follows the disk.
// ---------------------------------------------------------------------------

/** The kit of the tiny game: `system` comes out of the `defineGame` destructure. */
const KIT = `import { defineGame } from "@moku-labs/game";

export const { system } = defineGame<{ player: object; session: object }>();
`;

/** Two systems: `drift` bound to a const (its name on line 4), `fade` inline in a list (line 11). */
const SYSTEMS = `import { system } from "../kit";

export const drift = system({
  name: "drift",
  phase: "animate",
  query: [],
  run: () => {}
});

export const boardSystems = [
  system({ name: "fade", phase: "animate", query: [], run: () => {} })
];
`;

/** The temp folders of this file, removed after each test. */
const made: string[] = [];

/**
 * Write a tiny game into a fresh temp folder.
 *
 * @param systems - The text of `features/systems.ts`.
 * @returns The game root.
 */
function writeGame(systems: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "moku-project-systems-"));

  made.push(root);
  put(root, "kit.ts", KIT);
  put(root, "features/systems.ts", systems);

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

describe("system keys", () => {
  it("records one key per literal system name, and find answers its name property", async () => {
    const project = await openProject({ root: writeGame(SYSTEMS) });

    expect(project.index.symbols["system:drift"]).toEqual({
      def: [{ path: "features/systems.ts", binding: "drift", key: "name" }]
    });
    expect(project.index.symbols["system:fade"]).toEqual({
      def: [{ path: "features/systems.ts", key: "fade" }]
    });
    expect(await project.find("system:drift")).toMatchObject([
      { path: "features/systems.ts", line: 4 }
    ]);
    expect(await project.find("system:fade")).toMatchObject([
      { path: "features/systems.ts", line: 11 }
    ]);
    expect(project.index.unresolved).toEqual([]);
    project.close();
  });

  it("moves the key to the new name when the literal is renamed on disk", async () => {
    const root = writeGame(SYSTEMS);
    const session = await openSession({ root });

    put(root, "features/systems.ts", SYSTEMS.replace('"fade"', '"fadeOut"'));

    const change = await syncWithDisk(session);

    expect(change?.removed).toEqual(["system:fade"]);
    expect(session.index.symbols["system:fadeOut"]).toEqual({
      def: [{ path: "features/systems.ts", key: "fadeOut" }]
    });
  });

  it("sends a computed name or a spec it cannot read to unresolved, with no key", async () => {
    const project = await openProject({
      root: writeGame(`import { system } from "../kit";
import { spec } from "./spec";

const prefix = "board";
export const computed = system({ name: \`\${prefix}.tick\`, phase: "animate", query: [], run: () => {} });
export const named = system({ name: prefix, phase: "animate", query: [], run: () => {} });
export const imported = system(spec);
`)
    });

    expect(Object.keys(project.index.symbols).filter(key => key.startsWith("system:"))).toEqual([]);
    expect(project.index.unresolved).toEqual([
      { path: "features/systems.ts", reason: "system name is not a string literal" },
      { path: "features/systems.ts", reason: "system name is not a string literal" },
      { path: "features/systems.ts", reason: "system name is not a string literal" }
    ]);
    project.close();
  });
});
