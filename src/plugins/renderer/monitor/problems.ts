/* eslint-disable unicorn/no-null -- the log is JSON: a problem of the whole canvas has owner, view and filter `null`. */
/**
 * @file renderer/monitor — the problem rules of an agent build (U5): `filter-still`, `target-churn` and `retakes`.
 * Every frame adds to accumulators in typed arrays (no allocation); once a second the flush judges them and answers
 * the `problem` event details of the rules that crossed their line since the last judgment, and the `cleared` ones of
 * the rules that stopped: one line per crossing, never one per second.
 */
import type { FrameMeasure } from "../../time/types";
import type { KeptRecord } from "../kept/types";
import type { ProblemEventDetail } from "./log-types";
import { COUNT, OWNER_SLOTS, type PerfCtx, type ProblemState } from "./types";
import { cell, roundTo } from "./units";

/** Pixels per megapixel. */
const PIXELS_PER_MPX = 1_000_000;

/** Takes of a kept view in `RETAKES_SECONDS` that make a `retakes` problem. */
export const RETAKES_LIMIT = 3;

/** The window of the `retakes` rule, in seconds: two flushes. */
const RETAKES_SECONDS = 2;

/**
 * Adds one frame to the accumulators of the rules: for a drawn frame, each owner's run of drawn frames its filter
 * applied in (a drawn frame without an apply ends the run), its applies and pixels of the second; for every frame, the
 * render targets it made and dropped, a create in an idle frame and a create soon after a pool trim. Indexed stores
 * into the typed arrays of the perf state.
 *
 * @param pc - The perf context.
 * @param measure - What `time` measured of the frame.
 */
export function accumulateProblems(pc: PerfCtx, measure: Readonly<FrameMeasure>): void {
  if (pc.perf.drawn) accumulateOwners(pc, measure);

  accumulateTargets(pc, measure);
}

/**
 * Adds a drawn frame to each owner's run: a frame its filter applied in grows the run and the second's applies and
 * pixels, a frame without an apply ends the run.
 *
 * @param pc - The perf context.
 * @param measure - What `time` measured of the frame.
 */
function accumulateOwners(pc: PerfCtx, measure: Readonly<FrameMeasure>): void {
  const { problems } = pc.perf;
  const { owners } = pc.sinks;

  for (let slot = 0; slot < OWNER_SLOTS; slot += 1) {
    if (cell(owners.ids, slot) === 0) continue;

    if (cell(owners.applies, slot) === 0) {
      problems.run[slot] = 0;
      continue;
    }

    if (cell(problems.run, slot) === 0) problems.runSince[slot] = measure.frame;
    problems.run[slot] = cell(problems.run, slot) + 1;
    problems.secFrames[slot] = cell(problems.secFrames, slot) + 1;
    problems.secPixels[slot] = cell(problems.secPixels, slot) + cell(owners.pixels, slot);
  }
}

/**
 * Adds a frame's render targets to the second: the made and dropped ones, a create in an idle frame, a create within
 * `churnAfterTrimMs` after a pool trim.
 *
 * @param pc - The perf context.
 * @param measure - What `time` measured of the frame.
 */
function accumulateTargets(pc: PerfCtx, measure: Readonly<FrameMeasure>): void {
  const { problems } = pc.perf;
  const { counts } = pc.sinks;
  const created = cell(counts, COUNT.targetsCreated);

  problems.secTargets += created + cell(counts, COUNT.targetsDestroyed);

  if (created === 0) return;
  if (measure.idle && !problems.idleCreate) {
    problems.idleCreate = true;
    problems.createFrame = measure.frame;
  }
  if (
    !problems.trimCreate &&
    measure.at > problems.trimAt &&
    measure.at - problems.trimAt <= problems.thresholds.churnAfterTrimMs
  ) {
    problems.trimCreate = true;
    problems.createFrame = measure.frame;
  }
}

/**
 * The label of an entity's view now.
 *
 * @param pc - The perf context.
 * @param entity - The entity.
 * @returns The label of its view's display object, or `null` once the view left.
 */
export function viewLabel(pc: PerfCtx, entity: number): string | null {
  return pc.ctx.state.sync.views.get(entity)?.object.label ?? null;
}

/**
 * Tells whether a filtered view stands still unkept: its record is live while kept pictures are on, its subtree did
 * not change and its filter applied in the last `stillFrames` drawn frames, over `stillMpx` megapixels a frame.
 *
 * @param pc - The perf context.
 * @param slot - The owner's slot.
 * @param record - The owner's kept record, or `undefined` without one.
 * @returns True when the rule holds.
 */
function standsStill(pc: PerfCtx, slot: number, record: KeptRecord | undefined): boolean {
  const { problems } = pc.perf;
  const { stillFrames, stillMpx } = problems.thresholds;
  const kept = pc.ctx.state.kept;
  const frames = cell(problems.secFrames, slot);

  if (record === undefined || record.mode !== "live" || !kept.on || kept.bypassed) return false;
  if (frames === 0 || record.quiet < stillFrames || cell(problems.run, slot) < stillFrames) {
    return false;
  }

  return cell(problems.secPixels, slot) / frames / PIXELS_PER_MPX >= stillMpx;
}

/**
 * Judges `filter-still` for one owner: a crossing opens the problem with its reason, a stop clears it.
 *
 * @param pc - The perf context.
 * @param slot - The owner's slot.
 * @param owner - The owner.
 * @param out - The details written now.
 */
function judgeStillOwner(
  pc: PerfCtx,
  slot: number,
  owner: number,
  out: ProblemEventDetail[]
): void {
  const { problems } = pc.perf;
  const { owners, kindNames } = pc.sinks;
  const record = pc.ctx.state.kept.byEntity.get(owner);
  const still = standsStill(pc, slot, record);
  const open = cell(problems.stillOpen, slot) === 1;

  if (still && !open && record !== undefined) {
    const kind = cell(owners.kinds, slot);
    const frames = cell(problems.run, slot);

    problems.stillOpen[slot] = 1;
    out.push({
      rule: "filter-still",
      severity: "warn",
      owner,
      view: viewLabel(pc, owner),
      filter: kind === 0 ? null : (kindNames[kind - 1] ?? "other"),
      value: Math.min(frames, record.quiet),
      threshold: problems.thresholds.stillFrames,
      since: cell(problems.runSince, slot),
      frames,
      reason: record.refused > 0 ? "budget" : "not-eligible"
    });
  } else if (!still && open) {
    problems.stillOpen[slot] = 0;
    out.push({ rule: "filter-still", cleared: true, owner, view: viewLabel(pc, owner) });
  }
}

/**
 * Judges `filter-still` for every owner of the table: a crossing opens the problem with its reason (`"budget"` when
 * the kept budget refused the picture, `"not-eligible"` otherwise), a stop clears it; an owner whose filter applied in
 * no frame of the second leaves its slot.
 *
 * @param pc - The perf context.
 * @param out - The details written now.
 */
function judgeStill(pc: PerfCtx, out: ProblemEventDetail[]): void {
  const { problems } = pc.perf;
  const { owners } = pc.sinks;

  for (let slot = 0; slot < OWNER_SLOTS; slot += 1) {
    const owner = cell(owners.ids, slot);

    if (owner === 0) continue;

    judgeStillOwner(pc, slot, owner, out);

    // An owner that did not apply in this second leaves its slot: the table holds the owners that filter now.
    if (cell(problems.secFrames, slot) === 0) {
      owners.ids[slot] = 0;
      problems.run[slot] = 0;
    }

    problems.secFrames[slot] = 0;
    problems.secPixels[slot] = 0;
  }
}

/**
 * Judges `target-churn`: `churnPerSecond` targets made and dropped in each of `churnSeconds` seconds in a row, a
 * create in an idle frame, or a create within `churnAfterTrimMs` after a pool trim. One problem for the whole canvas.
 *
 * @param pc - The perf context.
 * @param out - The details written now.
 */
function judgeChurn(pc: PerfCtx, out: ProblemEventDetail[]): void {
  const { problems } = pc.perf;
  const { churnPerSecond, churnSeconds } = problems.thresholds;
  const busy = problems.secTargets >= churnPerSecond;

  if (busy && problems.churnRun === 0) problems.churnSince = pc.perf.frame;

  problems.churnRun = busy ? problems.churnRun + 1 : 0;

  const steady = problems.churnRun >= churnSeconds;
  const churns = steady || problems.idleCreate || problems.trimCreate;

  if (churns && !problems.churnOpen) {
    const since = steady ? problems.churnSince : problems.createFrame;
    let reason: "rate" | "idle" | "after-trim" = "rate";

    if (problems.trimCreate) reason = "after-trim";
    else if (problems.idleCreate) reason = "idle";

    problems.churnOpen = true;
    out.push({
      rule: "target-churn",
      severity: "warn",
      owner: null,
      view: null,
      filter: null,
      value: problems.secTargets,
      threshold: churnPerSecond,
      since,
      frames: Math.max(1, pc.perf.frame - since),
      reason
    });
  } else if (!churns && problems.churnOpen) {
    problems.churnOpen = false;
    out.push({ rule: "target-churn", cleared: true, owner: null, view: null });
  }

  problems.secTargets = 0;
  problems.idleCreate = false;
  problems.trimCreate = false;
}

/**
 * The stage-1 takes of a kept record in the last two seconds, its first take left out: the takes now less the ones of
 * two flushes back (one back for a record that came since, none for a record of this second).
 *
 * @param state - The problem state.
 * @param record - The record.
 * @returns Its retakes in the window.
 */
function retakesOf(state: ProblemState, record: KeptRecord): number {
  const before = state.takes[1].get(record.entity) ?? state.takes[0].get(record.entity) ?? 1;

  return Math.max(0, record.s1Version - Math.max(1, before));
}

/**
 * Judges `retakes`: a kept view taken again `RETAKES_LIMIT` times or more in two seconds. Its `value` is the takes per
 * second. A record that left clears its problem. The takes of every record are kept for the next two judgments.
 *
 * @param pc - The perf context.
 * @param out - The details written now.
 */
function judgeRetakes(pc: PerfCtx, out: ProblemEventDetail[]): void {
  const { problems } = pc.perf;
  const { records } = pc.ctx.state.kept;
  const now = new Map<number, number>();
  const since = problems.takesFrame[1];

  for (const record of records) {
    const { entity } = record;
    const count = retakesOf(problems, record);
    const open = problems.retakesOpen.has(entity);

    now.set(entity, record.s1Version);

    if (count >= RETAKES_LIMIT && !open) {
      problems.retakesOpen.add(entity);
      out.push({
        rule: "retakes",
        severity: "info",
        owner: entity,
        view: viewLabel(pc, entity),
        filter: record.slots[0]?.kind ?? null,
        value: roundTo(count / RETAKES_SECONDS, 2),
        threshold: RETAKES_LIMIT / RETAKES_SECONDS,
        since,
        frames: Math.max(1, pc.perf.frame - since)
      });
    } else if (count < RETAKES_LIMIT && open) {
      problems.retakesOpen.delete(entity);
      out.push({ rule: "retakes", cleared: true, owner: entity, view: viewLabel(pc, entity) });
    }
  }

  for (const entity of problems.retakesOpen) {
    if (now.has(entity)) continue;

    problems.retakesOpen.delete(entity);
    out.push({ rule: "retakes", cleared: true, owner: entity, view: viewLabel(pc, entity) });
  }

  problems.takes = [now, problems.takes[0]];
  problems.takesFrame = [pc.perf.frame, problems.takesFrame[0]];
}

/**
 * The once-a-second judgment of the three rules, at the flush: the details of the problems that opened or cleared.
 * Allocates: the flush is allowed to.
 *
 * @param pc - The perf context.
 * @returns The details, in rule order.
 */
export function judgeProblems(pc: PerfCtx): ProblemEventDetail[] {
  const out: ProblemEventDetail[] = [];

  judgeStill(pc, out);
  judgeChurn(pc, out);
  judgeRetakes(pc, out);

  return out;
}

/**
 * Forgets every accumulator and every open problem: the renderer stopped.
 *
 * @param pc - The perf context's sinks and perf state.
 * @param pc.perf - The perf state.
 * @param pc.sinks - The sinks.
 */
export function resetProblems(pc: Pick<PerfCtx, "perf" | "sinks">): void {
  const { problems } = pc.perf;

  pc.sinks.owners.ids.fill(0);
  problems.run.fill(0);
  problems.secFrames.fill(0);
  problems.secPixels.fill(0);
  problems.stillOpen.fill(0);
  problems.secTargets = 0;
  problems.idleCreate = false;
  problems.trimCreate = false;
  problems.trimAt = Number.NaN;
  problems.churnRun = 0;
  problems.churnOpen = false;
  problems.takes = [new Map(), new Map()];
  problems.takesFrame = [0, 0];
  problems.retakesOpen.clear();
}
