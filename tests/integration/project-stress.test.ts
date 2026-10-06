import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Found,
  openProject,
  type ProjectApi,
  type ProjectChange,
  type ProjectIndex
} from "@moku-labs/game/project";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Integration: the project index under an agent burst, on a temp copy of the
// mini game (no dist). A scripted burst runs for PROJECT_STRESS_MS (10 s by
// default, 60 s locally when set): edits, lines inserted above definitions, a
// renamed binding, a node file moved to another folder, a deleted file, a file
// left broken then fixed, 20 files touched within 100 ms, and saves with the
// same bytes. After each step the index must match the disk, every key must
// answer a line that holds its binding or key, and the change must report the
// move and the delete; a save with the same bytes calls nobody.
// ---------------------------------------------------------------------------

/** The mini game, copied and never written. */
const FIXTURE = fileURLToPath(new URL("../fixtures/mini-game/", import.meta.url));

/** How long the burst runs. */
const STRESS_MS = Number(process.env.PROJECT_STRESS_MS ?? 10_000);

/** How much longer a slow box may take: every wait window and quiet period is multiplied by it. */
const TIMING_SLACK = Number(process.env.PROJECT_TIMING_SLACK ?? 1);

/** How long a step waits for its batch before it fails. */
const BATCH_TIMEOUT_MS = 5000 * TIMING_SLACK;

/** How long a step waits with no batch to be sure no other batch comes. */
const QUIET_MS = 300 * TIMING_SLACK;

/** The node file the burst moves to another folder and back: no other step touches it. */
const MOVED = "nodes/count.ts";

/** The folders the copy leaves out. */
const LEFT_OUT = /[/\\](?:dist|node_modules)(?:[/\\]|$)/;

/** One call of the watcher: the index and the change it brought. */
type Call = { index: ProjectIndex; change: ProjectChange };

let root = "";
let project: ProjectApi;
const calls: Call[] = [];

/**
 * The sha1 the editor uses as a file version.
 *
 * @param bytes - The file bytes.
 * @returns The hex digest.
 */
function sha1(bytes: Uint8Array | string): string {
  // eslint-disable-next-line sonarjs/hashing -- a file version, not a secret
  return createHash("sha1").update(bytes).digest("hex");
}

/**
 * A small seeded random source, so a failing burst can be run again.
 *
 * @param seed - The seed.
 * @returns A function that answers a number in [0, 1).
 */
function seeded(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;

    return state / 2_147_483_648;
  };
}

/**
 * The text of a file of the copy.
 *
 * @param file - The root-relative path.
 * @returns The text.
 */
function readText(file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}

/**
 * Writes a file of the copy, making its folder first.
 *
 * @param file - The root-relative path.
 * @param text - The text.
 */
function put(file: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

/**
 * Every source file of the copy the index reads, with the sha1 of its bytes.
 *
 * @param folder - The folder to list, root-relative.
 * @returns Path to hash.
 */
function diskHashes(folder = ""): Record<string, string> {
  const hashes: Record<string, string> = {};

  for (const entry of readdirSync(path.join(root, folder), { withFileTypes: true })) {
    const relative = folder === "" ? entry.name : `${folder}/${entry.name}`;
    const isSkipped = /^(?:node_modules|dist|generated|\.moku|\.git|__tests__|tests)$/.test(
      entry.name
    );

    if (entry.isDirectory() && !isSkipped) Object.assign(hashes, diskHashes(relative));

    const isSource =
      entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.(?:test|spec)\.tsx?$/.test(entry.name);

    if (isSource) hashes[relative] = sha1(readFileSync(path.join(root, relative)));
  }

  return hashes;
}

/**
 * Waits until the watcher was called more than a number of times, then until it is quiet.
 *
 * @param before - The number of calls before the step.
 * @returns The calls the step brought.
 */
async function settle(before: number): Promise<Call[]> {
  await vi.waitFor(() => expect(calls.length).toBeGreaterThan(before), {
    timeout: BATCH_TIMEOUT_MS
  });

  // More batches may follow the first one: wait until the calls stop.
  for (let seen = -1; seen !== calls.length; ) {
    seen = calls.length;
    await new Promise(resolve => setTimeout(resolve, QUIET_MS));
  }

  return calls.slice(before);
}

/**
 * The moves of a step as one: a walk can land between two writes of the step, so a move may come
 * in two batches (`a` to `b`, then `b` to `c`); a watcher reads them as `a` to `c`.
 *
 * @param brought - The calls of the step.
 * @returns One move per key, from its first file to its last.
 */
function netMoves(brought: readonly Call[]): ProjectChange["moved"] {
  const net = new Map<string, { from: string; to: string }>();

  for (const { key, from, to } of brought.flatMap(call => call.change.moved)) {
    net.set(key, { from: net.get(key)?.from ?? from, to });
  }

  return [...net].map(([key, move]) => ({ key, ...move })).filter(move => move.from !== move.to);
}

/**
 * Whether the line a key answers holds its binding or its key, on the bytes it was read from. A
 * style built in a function answers its style calls, so that line holds the call.
 *
 * @param key - The key asked for.
 * @param found - One answer of `find`.
 * @returns A problem, or `undefined` when the line is right.
 */
function lineProblem(key: string, found: Found): string | undefined {
  const bytes = readFileSync(path.join(root, found.path));
  const line = bytes.toString("utf8").split("\n")[found.line - 1] ?? "";
  const literals = (found.key ?? "").split(/\*|\{\w+\}/).filter(part => part !== "");
  const isJsx = found.kind !== undefined;
  const holdsJsx =
    (found.kind === "idProp" ? line.includes(`${found.prop ?? "id"}=`) : line.includes("key=")) &&
    literals.every(part => line.includes(part) || found.kind !== "literal");
  const holdsBinding = found.binding !== undefined && line.includes(found.binding);
  const holdsKey = found.key !== undefined && line.includes(found.key);
  const holdsStyleCall = key.startsWith("style:") && line.includes("defineStyle(");
  const holds = isJsx ? holdsJsx : holdsBinding || holdsKey || holdsStyleCall;

  if (sha1(bytes) !== found.hash) return `${found.path}: the bytes moved during the check`;

  return holds
    ? undefined
    : `${found.path}:${found.line} "${line.trim()}" holds no ${found.binding ?? found.key}`;
}

/**
 * Checks the index after a step: it matches the disk, and every key answers right lines.
 *
 * @returns The problems found, empty when all is right.
 */
async function verify(): Promise<string[]> {
  const problems: string[] = [];
  const index = project.index;
  const disk = diskHashes();
  const indexed = Object.fromEntries(
    Object.entries(index.files).map(([file, entry]) => [file, entry.hash])
  );

  if (
    JSON.stringify(indexed) !== JSON.stringify(Object.fromEntries(Object.entries(disk).toSorted()))
  ) {
    problems.push("the indexed hashes differ from the disk");
  }

  for (const key of Object.keys(index.symbols)) {
    for (const found of await project.find(key)) {
      const problem = found.broken === true ? undefined : lineProblem(key, found);

      if (problem !== undefined) problems.push(`${key}: ${problem}`);
    }
  }

  return problems;
}

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "moku-project-stress-"));
  cpSync(FIXTURE, root, {
    recursive: true,
    filter: source => !LEFT_OUT.test(source.slice(FIXTURE.length - 1))
  });
  project = await openProject({ root });
  project.watch((index, change) => calls.push({ index, change }));
});

afterAll(() => {
  project.close();
  rmSync(root, { recursive: true, force: true });
});

describe("the project index under an agent burst", () => {
  it(`keeps every key on the right line for ${STRESS_MS} ms`, {
    timeout: STRESS_MS + 30_000 * TIMING_SLACK
  }, async ({ annotate }) => {
    const random = seeded(7);
    // Every file of the game but the one that moves: twenty files.
    const pool = Object.keys(project.index.files).filter(file => file !== MOVED);
    const pick = (): string => pool[Math.floor(random() * pool.length)] ?? "kit.ts";
    const started = Date.now();
    let cycles = 0;
    let moves = 0;
    let removes = 0;

    while (Date.now() - started < STRESS_MS) {
      cycles += 1;

      // An edit at the end of a file.
      {
        const file = pick();
        const before = calls.length;

        put(file, `${readText(file)}// edit ${cycles}\n`);
        const brought = await settle(before);

        expect(brought.flatMap(call => call.change.files)).toContain(file);
        expect(await verify()).toEqual([]);
      }

      // Lines inserted above the definitions of a node and of the text styles.
      {
        const before = calls.length;

        put("nodes/home.ts", `// above ${cycles}\n// and again\n${readText("nodes/home.ts")}`);
        put(
          "features/home/styles.ts",
          `// above ${cycles}\n${readText("features/home/styles.ts")}`
        );
        await settle(before);

        const [home] = await project.find("node:main/home");

        expect(home?.line).toBe(8 + cycles * 2);
        expect(await verify()).toEqual([]);
      }

      // A binding renamed, in its file and in the one that imports it.
      {
        const before = calls.length;
        const from = cycles % 2 === 1 ? "homeScene" : "homeSceneRenamed";
        const to = cycles % 2 === 1 ? "homeSceneRenamed" : "homeScene";

        put(
          "features/home/scene.ts",
          readText("features/home/scene.ts").replace(`const ${from} =`, `const ${to} =`)
        );
        put("features/home/index.ts", readText("features/home/index.ts").replaceAll(from, to));
        await settle(before);

        expect(project.index.symbols["scene:home"]?.def).toEqual([
          { path: "features/home/scene.ts", binding: to }
        ]);
        expect(await verify()).toEqual([]);
      }

      // A node file moved to another folder, and its import in the flow.
      {
        const before = calls.length;
        const away = cycles % 2 === 1;
        const [from, to] = away ? [MOVED, "nodes/info/count.ts"] : ["nodes/info/count.ts", MOVED];
        const text = readText(from);
        const shifted = away
          ? text.replaceAll('from "../', 'from "../../')
          : text.replaceAll('from "../../', 'from "../');

        put(to, shifted);
        put(
          "flows/info.ts",
          readText("flows/info.ts").replace(`"../${from.slice(0, -3)}"`, `"../${to.slice(0, -3)}"`)
        );
        rmSync(path.join(root, from));

        const brought = await settle(before);

        expect(netMoves(brought)).toContainEqual({ key: "node:infoPopup/count", from, to });
        moves += 1;
        expect(await verify()).toEqual([]);
      }

      // A file deleted, then written back.
      {
        const file = "features/info/index.ts";
        const text = readText(file);
        const before = calls.length;

        rmSync(path.join(root, file));
        const deleted = await settle(before);

        expect(deleted.flatMap(call => call.change.removed)).toContain("feature:info");
        removes += 1;
        expect(await verify()).toEqual([]);

        const again = calls.length;

        put(file, text);
        await settle(again);
        expect(project.index.symbols["feature:info"]).toBeDefined();
      }

      // A file left broken, then fixed: its keys stay, find answers from its last good parse.
      {
        const file = "features/info/effects.ts";
        const text = readText(file);
        const keys = Object.keys(project.index.symbols).filter(key =>
          project.index.symbols[key]?.def.some(anchor => anchor.path === file)
        );
        const before = calls.length;

        put(
          file,
          text.replace(
            "export const spark = defineEmitter(",
            "export const spark = defineEmitter(("
          )
        );
        await settle(before);

        expect(project.index.files[file]?.state).toBe("broken");
        expect(keys.filter(key => project.index.symbols[key] === undefined)).toEqual([]);
        expect(await project.find("emitter:fx.spark")).toMatchObject([
          { path: file, broken: true }
        ]);

        const fixed = calls.length;

        put(file, text);
        await settle(fixed);
        expect(project.index.files[file]?.state).toBe("ok");
        expect(await verify()).toEqual([]);
      }

      // Twenty files touched within 100 ms.
      {
        const before = calls.length;
        const touched = pool.slice(0, 20);

        expect(touched).toHaveLength(20);

        for (const file of touched) put(file, `${readText(file)}// burst ${cycles}\n`);
        const brought = await settle(before);

        expect(new Set(brought.flatMap(call => call.change.files))).toEqual(new Set(touched));
        expect(await verify()).toEqual([]);
      }

      // A save with the same bytes: nobody is called.
      {
        const file = pick();
        const before = calls.length;
        const later = new Date(Date.now() + 1000);

        put(file, readText(file));
        utimesSync(path.join(root, file), later, later);
        await new Promise(resolve => setTimeout(resolve, QUIET_MS));

        expect(calls.length).toBe(before);
      }
    }

    // Every call came with a new revision and at least one changed file.
    const revisions = calls.map(call => call.change.revision);
    const repeats = revisions.filter((revision, at) => at > 0 && revisions[at - 1] === revision);

    expect(repeats).toEqual([]);
    expect(
      calls.every(
        call => call.change.files.length > 0 && call.index.revision === call.change.revision
      )
    ).toBe(true);

    await annotate(
      `${cycles} cycles, ${calls.length} batches, ${moves} moves, ${removes} deletes in ${Date.now() - started} ms`,
      "stress"
    );
  });
});
