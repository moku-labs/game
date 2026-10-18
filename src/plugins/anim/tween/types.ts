/**
 * @file anim/tween — type definitions of the one track table: what a track holds while it runs
 * and the handle a caller drives it with.
 */
import type { AnyComponent } from "../../world/ecs/types";
import type { Ease, Entity, MotionHandle, TrackSegment } from "../../world/types";

/**
 * One running track: the numeric fields of one component of one entity moving from the values
 * read at the end of the delay to the exact target, straight or through keyframe segments. A
 * track with repeats walks again from its first segment each time a run ends.
 */
export type Track = {
  readonly id: number;
  readonly entity: Entity;
  readonly component: AnyComponent;
  /**
   * The target fields. Retarget deletes the fields a newer absolute track took over. A frame reads
   * the slots (`names`, `targets`, `live`) instead.
   */
  to: Record<string, number>;
  /**
   * The key of the owner, bases and offsets tables per field, built once when the track starts.
   * It keeps a field `to` lost, which nothing reads again.
   */
  readonly keys: Readonly<Record<string, string>>;
  readonly ms: number;
  readonly ease: Ease;
  readonly delayMs: number;
  /**
   * `[0]`: the milliseconds the track has run, its delay included; `[1]`: the normalised time of
   * the write that runs. Cells and not fields, so a frame writes them in place: a double stored in
   * an object field is a new heap number.
   */
  readonly clock: Float64Array;
  /** True once the start values are read, when the delay ends, never earlier. */
  begun: boolean;
  /** The target fields in slot order: every field `to` held when the track started. */
  readonly names: readonly string[];
  /** The key of each slot: the strings of `keys`, by slot. */
  readonly slotKeys: readonly string[];
  /** The target of each slot. */
  readonly targets: Float64Array;
  /** The start value of each slot, read when the delay ends. */
  readonly starts: Float64Array;
  /** `1` while the track drives the slot, `0` once a newer absolute track took its field. */
  readonly live: Uint8Array;
  /** `1` for a slot the frame that runs moved: a write of only some fields reads it. */
  readonly moved: Uint8Array;
  /**
   * Per slot, the numbers of the write that runs: first what the slot contributes, then what the
   * field reads, the base plus every offset. Kept here so no number crosses a call boxed.
   */
  readonly values: Float64Array;
  /**
   * Per slot, the value this track last left in the field or found there, `NaN` while unknown: at
   * the start and while another writer holds the field. A frame whose value moved off it writes
   * without reading the field back.
   */
  readonly seen: Float64Array;
  readonly muted: () => ReadonlySet<string>;
  readonly additive: boolean;
  /** True for a track a timeline step advances by hand; the frame step leaves it alone. */
  readonly driven: boolean;
  /** The frame step the track was born in. That step does not advance it a second time. */
  readonly bornFrame: number;
  ended: boolean;
  /**
   * The keyframe segments the track walks over `ms`, or `undefined` for a straight track. A
   * segment without an ease runs on the track's `ease`.
   */
  readonly segments: readonly TrackSegment[] | undefined;
  /**
   * The runs still to go after the one that plays: `0` for a track that runs once, `Infinity`
   * for a loop (`repeat: "forever"`), which never ends by itself.
   */
  repeatsLeft: number;
  /**
   * True while a loop stands on its first key and has written it: the hold writes once, and the
   * walk clears it, so the next hold writes the first key again.
   */
  held: boolean;
  /**
   * The fields an additive track skipped at its last write because another writer owned them.
   * When such a field is given back, the track adds to the value it finds there and not to the
   * base it kept. Empty for a track that owns its fields.
   */
  masked: Set<string>;
  /** Started with `reduced: "keep"`: reduced motion neither shortens nor holds it. */
  readonly keep: boolean;
  /**
   * What the track writes that could show its view again, handed to `renderer.sync.loopsHeld` by an endless track
   * (spec 26 R1.7.4): `"alpha"`, `"place"` (where the view is or how large), `"both"`, or `undefined` for a write
   * that cannot (a tint, a fill colour). Computed once when the track is made.
   */
  readonly reveals: "alpha" | "place" | "both" | undefined;
  /**
   * The patch the track writes, one per track with every field of `to` in it: a frame fills it in
   * place instead of building one. A field the frame leaves alone carries its stored value back.
   * Rebuilt when the track loses a field.
   */
  patch: Record<string, unknown>;
};

/**
 * A motion handle that can also be advanced by hand: what the timeline cursor needs, so a track
 * born inside a frame step still consumes the remainder of that step's delta.
 */
export type StepMotion = MotionHandle & {
  /**
   * Advances the track by one delta.
   *
   * @param deltaMs - Milliseconds of game time to consume.
   * @returns The milliseconds left over past the end of the track.
   */
  advance(deltaMs: number): number;
};
