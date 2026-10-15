import { afterAll, describe, expect, it } from "vitest";
import { component, mut, system } from "../../ecs/define";
import type { Owner } from "../../ecs/types";
import { createMockWorld } from "../unit/mock-world";

// ---------------------------------------------------------------------------
// Integration: what the query walk allocates a frame (spec 26 W1.6). The heap
// sampler of the runtime records 600 frames of a fixture world: 40 systems, each
// with a two-term query over a store of 300 entities of which 30 match, ten of
// them with a mut term. The bytes sampled under the walk stay within 1.5 times
// the rows it yields, the size of a row measured in the same run. Bun's
// inspector has no HeapProfiler domain: there the test is skipped with a
// message; it runs under Node (`bunx vitest run <this file>`).
// ---------------------------------------------------------------------------

/** A node of a sampled heap profile. */
type ProfileNode = {
  callFrame: { functionName: string; url: string };
  selfSize: number;
  children: ProfileNode[];
};

/** An inspector session. */
type Session = { post(method: string, params?: object): Promise<unknown> };

const Cell = component("Cell", { x: 0 });
const Lit = component("Lit", { glow: 0 });
const owner: Owner = { kind: "plugin", name: "fixture" };

const ENTITIES = 300;
const MATCHING = 30;
const SYSTEMS = 40;
const MUT_SYSTEMS = 10;
const WARM_FRAMES = 200;
const FRAMES = 600;
/** Frames per recording: one profile of today's walk over 600 frames would not fit a string. */
const CHUNK = 20;
const ROWS_PER_FRAME = MATCHING * SYSTEMS;

/** The query module: every function of it with a name is the walk. */
const WALK = /src\/plugins\/world\/ecs\/query\.ts/;

/**
 * Opens an inspector session with a heap sampler.
 *
 * @returns The session, or `undefined` where the runtime has none.
 */
async function heapSession(): Promise<Session | undefined> {
  try {
    const inspector = await import("node:inspector/promises");
    const session = new inspector.Session();

    session.connect();
    await session.post("HeapProfiler.enable");

    return session;
  } catch {
    return undefined;
  }
}

const session = await heapSession();

afterAll(async () => {
  await session?.post("HeapProfiler.disable");
});

/**
 * Sums the bytes sampled in the subtrees whose root matches: everything allocated while such a
 * function was on the stack. Vite's anonymous export accessors are not the engine's code.
 *
 * @param node - A node of the profile.
 * @param under - Tells whether a node starts a counted subtree.
 * @returns The bytes.
 */
function bytesUnder(node: ProfileNode, under: (node: ProfileNode) => boolean): number {
  if (under(node)) return subtreeBytes(node);

  return node.children.reduce((sum, child) => sum + bytesUnder(child, under), 0);
}

/**
 * Sums every self size of a subtree.
 *
 * @param node - The root of the subtree.
 * @returns The bytes.
 */
function subtreeBytes(node: ProfileNode): number {
  return node.children.reduce((sum, child) => sum + subtreeBytes(child), node.selfSize);
}

/**
 * Records runs under the heap sampler, the collected objects included (a per-frame allocation is
 * garbage by the end of the run), and sums the bytes under the matching functions.
 *
 * @param open - The session.
 * @param chunks - How many recordings.
 * @param run - What one recording runs.
 * @param under - Tells whether a node starts a counted subtree.
 * @returns The bytes of every recording together.
 */
async function sampledBytes(
  open: Session,
  chunks: number,
  run: () => void,
  under: (node: ProfileNode) => boolean
): Promise<number> {
  let bytes = 0;

  for (let chunk = 0; chunk < chunks; chunk += 1) {
    await open.post("HeapProfiler.startSampling", {
      samplingInterval: 128,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true
    });
    run();

    const answer = (await open.post("HeapProfiler.stopSampling")) as {
      profile: { head: ProfileNode };
    };

    bytes += bytesUnder(answer.profile.head, under);
  }

  return bytes;
}

/** Where the fixtures put what they make, so no allocation can be optimised away. */
const sink: { row: unknown; entity: number } = { row: undefined, entity: 0 };

/**
 * The yardstick: allocates exactly the rows the walk yields, three-entry arrays, and nothing else.
 *
 * @param count - How many rows.
 * @param first - The value of the first term.
 * @param second - The value of the second term.
 */
function rowsOnly(count: number, first: object, second: object): void {
  for (let index = 0; index < count; index += 1) sink.row = [index, first, second];
}

describe("the query walk's allocation", () => {
  it("stays within 1.5 x the rows it yields (skipped without a HeapProfiler, as in Bun)", async ({
    skip,
    annotate
  }) => {
    if (session === undefined) {
      skip("the runtime's inspector has no HeapProfiler domain: run this file under Node");

      return;
    }

    const world = createMockWorld();

    for (let index = 0; index < ENTITIES; index += 1) {
      world.api.ecs.spawn(owner, index % (ENTITIES / MATCHING) === 0 ? [Cell(), Lit()] : [Cell()]);
    }

    for (let index = 0; index < SYSTEMS; index += 1) {
      world.api.ecs.system(
        system({
          name: `fixture.walk${index}`,
          phase: "animate",
          query: index < MUT_SYSTEMS ? [Cell, mut(Lit)] : [Cell, Lit],
          run: rows => {
            for (const row of rows) sink.entity = row[0];
          }
        })
      );
    }

    world.start();
    for (let frame = 0; frame < WARM_FRAMES; frame += 1) world.frame();
    rowsOnly(FRAMES * ROWS_PER_FRAME, Cell().value, Lit().value);

    const chunks = FRAMES / CHUNK;
    const rowsBytes =
      (await sampledBytes(
        session,
        chunks,
        () => rowsOnly(CHUNK * ROWS_PER_FRAME, Cell().value, Lit().value),
        node => node.callFrame.functionName === "rowsOnly"
      )) / FRAMES;
    const walkBytes =
      (await sampledBytes(
        session,
        chunks,
        () => {
          for (let frame = 0; frame < CHUNK; frame += 1) world.frame();
        },
        node => WALK.test(node.callFrame.url) && node.callFrame.functionName !== ""
      )) / FRAMES;
    const report = `walk ${Math.round(walkBytes)} B a frame, rows ${Math.round(rowsBytes)} B a frame (${ROWS_PER_FRAME} rows)`;

    await annotate(report);
    expect(rowsBytes, report).toBeGreaterThan(0);
    expect(walkBytes, report).toBeLessThanOrEqual(rowsBytes * 1.5);
  }, 180_000);
});
