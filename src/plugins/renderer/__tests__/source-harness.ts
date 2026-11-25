/**
 * @file What the tests of the Sources share (F126 stage 5). Not a test. A room under a `Source` and frosted windows over
 * it, on the whole renderer over real Pixi, every frame drawn; readers of what the cache holds and of the renders it
 * made.
 */
import { vi } from "vitest";
import type { Entity } from "../../world/types";
import { Parent, Shape, Source, Transform } from "../components";
import type { KeptRecord, SourceRecord } from "../kept/types";
import type { FilterSlot } from "../types";
import { type Drawn, startDrawn } from "./demand-harness";
import { type BackSeam, backSeam, backSlot } from "./quad-harness";

/** The renderers a test started, stopped after it. */
const running: Drawn[] = [];

/** Stops every renderer a test started, its oracle checked: each test file runs it after each test. */
export function stopRunning(): void {
  for (const drawn of running.splice(0)) {
    drawn.oracle.expectNoMissedFrame();
    drawn.mock.stop();
  }

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

/**
 * Starts the renderer, every frame drawn unless `onDemand`, and keeps it for the teardown.
 *
 * @param options - The backend, the dev flag and the switch.
 * @param options.kind - The backend.
 * @param options.dev - A dev build.
 * @param options.onDemand - `config.onDemand`; off when left out.
 * @returns The running renderer.
 */
export async function openSources(
  options: { kind?: "webgpu" | "webgl"; dev?: boolean; onDemand?: boolean } = {}
): Promise<Drawn> {
  const drawn = await startDrawn({
    onDemand: options.onDemand ?? false,
    kind: options.kind ?? "webgpu",
    ...(options.dev === true ? { dev: true } : {})
  });

  running.push(drawn);

  return drawn;
}

/** A room under a Source with one child, and the entity of each. */
export type Room = { readonly room: Entity; readonly child: Entity };

/**
 * Spawns a 200 x 200 room carrying `Source`, with a 20 x 20 child inside it, and draws a frame.
 *
 * @param drawn - The running renderer.
 * @param scale - The Source's scale; the default when left out.
 * @returns The room and its child.
 */
export function spawnRoom(drawn: Drawn, scale?: number): Room {
  const room = drawn.spawn(
    Transform({ x: 0, y: 0 }),
    Shape({ w: 200, h: 200 }),
    // A JavaScript caller may pass any number: the invalid ones are tested.
    scale === undefined ? Source() : Source({ scale: scale as 0.25 })
  );
  const child = drawn.spawn(
    Parent({ entity: room }),
    Transform({ x: 10, y: 10 }),
    Shape({ w: 20, h: 20 })
  );

  drawn.frame();

  return { room, child };
}

/**
 * Spawns a 40 x 40 window drawn after everything before it, with a frosted slot, and draws a frame.
 *
 * @param drawn - The running renderer.
 * @param seam - The seam of its input.
 * @param at - Where it stands; at 50, 50 when left out.
 * @param at.x - Its x.
 * @param at.y - Its y.
 * @param fields - Other fields of the slot.
 * @returns The window.
 */
export function spawnWindow(
  drawn: Drawn,
  seam: BackSeam = backSeam(),
  at?: { x: number; y: number },
  fields: Partial<FilterSlot> = {}
): Entity {
  const window = drawn.spawn(Transform(at ?? { x: 50, y: 50 }), Shape({ w: 40, h: 40 }));

  drawn.frame();
  drawn.mock.api.sync.filters.set(window, [backSlot(seam, fields)]);
  drawn.frame();

  return window;
}

/**
 * The record of a window.
 *
 * @param drawn - The running renderer.
 * @param entity - The window.
 * @returns Its record.
 */
export function windowOf(drawn: Drawn, entity: Entity): KeptRecord {
  const record = drawn.mock.ctx.state.kept.byEntity.get(entity);

  if (record === undefined) throw new Error(`no record for ${entity}`);

  return record;
}

/**
 * The record of a Source.
 *
 * @param drawn - The running renderer.
 * @param entity - The Source's entity.
 * @returns Its record.
 */
export function sourceOf(drawn: Drawn, entity: Entity): SourceRecord {
  const record = drawn.mock.ctx.state.kept.sourceByEntity.get(entity);

  if (record === undefined) throw new Error(`no Source for ${entity}`);

  return record;
}

/**
 * The takes of a Source since a point of the render log: renders of its top into a texture.
 *
 * @param drawn - The running renderer.
 * @param source - The Source.
 * @param from - The log length to count from.
 * @returns How many.
 */
export function takesOf(drawn: Drawn, source: SourceRecord, from = 0): number {
  return drawn.stage
    .targets()
    .slice(from)
    .filter(call => call.container === source.top).length;
}

/**
 * The renders since a point.
 *
 * @param drawn - The running renderer.
 * @returns The log length now.
 */
export function rendersNow(drawn: Drawn): number {
  return drawn.stage.targets().length;
}
