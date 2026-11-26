/**
 * @file Stress plugin — the walk: what the driver does in one frame of each scene, as a fast finger and a busy
 * board would. It answers the gate of the rest node for every commit and writes the components a drag, a slide and
 * an idle loop write. It allocates nothing per frame but what the engine's own calls do.
 */
import {
  type Flow,
  Shape,
  type Time,
  Transform,
  type Ui,
  type World
} from "../../../../src/index.ts";
import { PITCH } from "../../features/stress/views";
import type { Session } from "../../state";
import { KIND, type StressState } from "./types";

/** What the walk drives. */
export type Driven = {
  /** Writes a mark into the monitor's log: one per commit of the walk. */
  mark: (label: string) => void;
  world: Pick<World.Api, "ecs" | "projection">;
  flow: Pick<Flow.Api, "gate">;
  ui: Pick<Ui.UiApi, "find" | "scroll">;
};

/** The mark each commit of the walk writes, by its kind. */
const KIND_LABELS: readonly string[] = [
  "rest",
  "drag",
  "slide",
  "stress: peek",
  "stress: turn",
  "stress: popup open",
  "stress: popup close",
  "stress: merge",
  "scroll"
];

/**
 * The JS heap of the page in MB; 0 where the browser does not say.
 *
 * @returns The used heap.
 */
function heapMb(): number {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;

  return memory === undefined ? 0 : memory.usedJSHeapSize / 1_048_576;
}

/**
 * The board's frame: every item moves (a bob, a turn, a pulse), the rings step every sixth frame, and once a walk a
 * merge is asked for.
 *
 * @param state - The driver's state.
 * @param driven - What the walk drives.
 * @param at - The frame of the walk.
 * @param mergeAt - The frame of the walk a merge is asked at.
 * @returns The kind of the frame.
 */
function boardFrame(state: StressState, driven: Driven, at: number, mergeAt: number): number {
  const { ecs, projection } = driven.world;

  if (state.stale) {
    state.pictures = projection.entitiesOf("board.pictures");
    state.rings = projection.entitiesOf("board.rings");
    state.stale = false;
  }

  const phase = state.step * 0.21;

  for (let index = 0; index < state.pictures.length; index += 1) {
    ecs.set(state.pictures[index] ?? 0, Transform, {
      rotation: Math.sin(phase + index) * 0.12,
      scale: 1 + Math.sin(phase * 1.3 + index * 0.7) * 0.06
    });
  }

  if (state.step % 6 === 0) {
    for (let index = 0; index < state.rings.length; index += 1) {
      ecs.set(state.rings[index] ?? 0, Shape, { sweep: ((state.step / 6 + index) % 60) / 60 });
    }
  }

  if (at === mergeAt && driven.flow.gate.answer({ intent: "merge" })) {
    state.stale = true;

    return KIND.merge;
  }

  return KIND.drag;
}

/**
 * The album's frame: a peek at the first frame of the walk, a drag of the strip 60 % of the way, a turn, a slide of
 * the new page from 40 % off to its place, then rest.
 *
 * @param driven - What the walk drives.
 * @param at - The frame of the walk.
 * @param third - A third of the walk: the drag, the slide and the rest take one each.
 * @returns The kind of the frame.
 */
function albumFrame(driven: Driven, at: number, third: number): number {
  const { ecs } = driven.world;
  const strip = driven.ui.find("pages");
  let kind: number = KIND.rest;

  if (at === 0 && driven.flow.gate.answer({ intent: "peek" })) kind = KIND.peek;
  else if (at === third && driven.flow.gate.answer({ intent: "turn" })) kind = KIND.turn;
  else if (at < third) kind = KIND.drag;
  else if (at < 2 * third) kind = KIND.slide;

  if (strip === undefined) return kind;

  let x = 0;

  if (at < third) x = -PITCH * 0.6 * ((at + 1) / third);
  else if (at < 2 * third) x = PITCH * 0.4 * (1 - (at - third + 1) / third);

  if (ecs.get(strip, Transform)?.x !== x) ecs.set(strip, Transform, { x });

  return kind;
}

/**
 * The popup's frame: an open early in the walk and a close a third later, so a fade of 250 ms is cut by the next
 * commit; the popup scene opens a second one over the first on every other walk.
 *
 * @param state - The driver's state.
 * @param driven - What the walk drives.
 * @param session - The session of the page.
 * @param at - The frame of the walk.
 * @param third - A third of the walk.
 * @returns The kind of the frame, `rest` when it asked for nothing.
 */
function popupFrame(
  state: StressState,
  driven: Driven,
  session: Session,
  at: number,
  third: number
): number {
  const stacks = session.scene === "popup" && state.step % (2 * session.cycle) < session.cycle;
  const opens = at === 1 || (stacks && at === 4);
  const closes = at === third + 1 || (stacks && at === third + 4);

  if (opens && driven.flow.gate.answer({ intent: "open" })) return KIND.open;
  if (closes && driven.flow.gate.answer({ intent: "close" })) return KIND.close;

  return KIND.rest;
}

/**
 * One frame of the walk of the page's scene: it marks the frame's kind and its heap, and drives the scene.
 *
 * @param state - The driver's state.
 * @param driven - What the walk drives.
 * @param session - The session of the page: its scene and its walk.
 * @param time - The frame's time.
 */
export function walkFrame(
  state: StressState,
  driven: Driven,
  session: Session,
  time: Readonly<Time.Time>
): void {
  const mark = time.frame & 0xff_ff;

  state.heap[mark] = heapMb();
  state.kinds[mark] = KIND.rest;

  if (!state.running) return;

  state.step += 1;

  const { scene, cycle } = session;
  const at = state.step % cycle;
  const third = Math.floor(cycle / 3);
  let kind: number = KIND.rest;

  if (scene === "board" || scene === "worst") kind = boardFrame(state, driven, at, third + 2);

  if (scene === "scroll" && state.step > 30) {
    driven.ui.scroll("overviewScroll", Math.abs(((state.step * 24) % 2400) - 1200));
    kind = KIND.scroll;
  }

  if (scene === "album" || scene === "worst") kind = Math.max(kind, albumFrame(driven, at, third));

  if (scene === "popup" || scene === "worst") {
    kind = Math.max(kind, popupFrame(state, driven, session, at, third));
  }

  state.kinds[mark] = kind;

  // A commit is marked in the monitor's log, so a spike line of the stream reads against what the walk did.
  if (kind >= KIND.peek && kind <= KIND.merge) driven.mark(KIND_LABELS[kind] ?? "commit");
}
