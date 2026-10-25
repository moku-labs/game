/**
 * @file renderer/kept — types of the kept-picture cache: what a filter lets it do, what it reports, and the records it
 * keeps.
 */
import type { Entity } from "../../world/types";
import type { FilterSlot, FilterSlotInputs, HiddenCtx, SyncWriters, View } from "../sync/types";
import type {
  DemandModule,
  HostModule,
  PixiContainer,
  PixiFilter,
  PixiMatrix,
  PixiModule,
  PixiRenderTexture,
  PixiSprite,
  RendererCtx
} from "../types";

/**
 * What a slot's filter lets the cache do with it: `"local"` (kept anywhere), `"placed"` (kept with its canvas origin
 * through `canvasPixel`), `"screen"` (drawn live).
 *
 * @example
 * ```ts
 * Tint.filter.cache; // "local"
 * ```
 */
export type FilterCache = "local" | "placed" | "screen";

/**
 * The numbers `stats().kept` reports.
 *
 * @example
 * ```ts
 * const kept: KeptStats = { pictures: 2, mb: 9.6, retakes: 0 }; // the memory screen at rest
 * ```
 */
export type KeptStats = { pictures: number; mb: number; retakes: number };

/**
 * One picture of an overlay's range, as spec 22 hands it over.
 */
export type KeptRange = {
  readonly id: Entity;
  readonly entries: readonly PixiContainer[];
  readonly others: readonly PixiContainer[];
  readonly slot: { readonly container: PixiContainer; readonly before: PixiContainer };
};

/**
 * The kept module: slots, the filter target of a view, the frame steps, the range seam of spec 22, stats and switches.
 * Internal. `KeptModule` of the renderer's types is the same type (O18).
 */
export type KeptInternal = {
  /** `setFilters` handed a new list: a record is made, refreshed or dropped. */
  slots(entity: Entity, slots: readonly FilterSlot[]): void;
  /** Where the filters of a view hang now: the stand-in while kept, its top otherwise. */
  filterTarget(view: View): PixiContainer;
  /** The view is leaving: its record goes at once. */
  forget(entity: Entity): void;
  /** Turns this decision's marks into dirty flags, before the decision clears them. */
  collect(): void;
  /** Every stage owed in a drawn frame, before the stage pass. */
  flush(): void;
  /** After the stage pass of a drawn frame: the pixel leg of the oracle. */
  after(): void;
  /** Whether a node is a kept top drawn through its quad. */
  shownThrough(node: PixiContainer): boolean;
  /** The padding the record of a kept top holds; 0 for any other node. */
  padOf(node: PixiContainer): number;
  /** Spec 22: keeps a picture of a range; false when it cannot. */
  take(range: KeptRange): boolean;
  /** Spec 22: renders the picture of a range again in this frame's flush. */
  retake(id: Entity): void;
  /** Spec 22: places the picture of a range in another slot. */
  move(id: Entity, slot: KeptRange["slot"]): void;
  /** Spec 22: the picture of a range goes. */
  release(id: Entity): void;
  /** Spec 22: whether a range has a picture. */
  kept(id: Entity): boolean;
  /** Spec 22: the sprite that shows a range's picture. */
  sprite(id: Entity): PixiContainer | undefined;
  /** The numbers `stats().kept` reports. */
  stats(): KeptStats;
  /** The takes since the last call; the monitor's window close. */
  drainTakes(): number;
  /** The stage-3-only redos since the last call. */
  drainRefreshes(): number;
  /** Dev and agent builds only: every record and range drawn live for one extract, and back. */
  bypass(on: boolean): void;
  /**
   * Dev and agent builds only: runs `draw` with every kept record drawn live and every range's entries lifted (its
   * sprite hidden), then puts every picture back: the live render of the pixel leg and of the overdraw map.
   */
  live<Result>(draw: () => Result): Result;
  /** The debug switch: false draws every view live from the next drawn frame. */
  enabled(on: boolean): void;
  /** Whether the switch is on (and `keptMb` above 0). */
  isOn(): boolean;
  /** Every record back to live, every texture destroyed: device loss, rebuild, stop. */
  reset(): void;
};

/** The two lives of a record. */
export type KeptMode = "live" | "kept";

/** One filtered view the cache watches. */
export type KeptRecord = {
  readonly entity: Entity;
  /** The view's top (`view.wrapper ?? view.object`) when the record was made; another top resets the record. */
  top: PixiContainer;
  /** True when the top was a render group before the cache rendered it (then it stays one at release). */
  wasGroup: boolean;
  mode: KeptMode;
  /** The slots last handed over by effects (sync/filters), the record's own copy of the reference. */
  slots: readonly FilterSlot[];
  /** "local" or "placed": the worst category of the enabled slots; a "screen" slot makes no record (P4.1). */
  category: "local" | "placed";
  /** Sprite(stage 1): carries the filters while kept (P3.3). */
  standIn: PixiSprite | undefined;
  /** A second Sprite(stage 1) whose filters are [keeper] only (P3.2). */
  keeperStandIn: PixiSprite | undefined;
  /** Sprite(stage 3), in the tree beside the top. */
  quad: PixiSprite | undefined;
  /** The filter that runs stage 2 (P3.4). */
  keeper: PixiFilter | undefined;
  s1: PixiRenderTexture | undefined;
  /** One per input of the first enabled filter with inputs, else []. */
  s2: PixiRenderTexture[];
  s3: PixiRenderTexture | undefined;
  /** Versions: s1 grows at every stage-1 take; the s2 pair is (inputs.version(), s1) of the held results. */
  s1Version: number;
  s2InputsVersion: number;
  s2PictureVersion: number;
  /** The inputs the held results were drawn by; another first filter with inputs redoes stage 2. */
  s2Of: FilterSlotInputs | undefined;
  /** Dirty flags set by collect (P10.3) and by the key compare of the flush. */
  dirtyS1: boolean;
  dirtyS2: boolean;
  dirtyS3: boolean;
  /** Keys of the last take and of the last drawn frame (P2.6), indices `KEY`. */
  key: Float64Array;
  /** Scratch matrix for getGlobalTransform, made once. */
  readonly matrix: PixiMatrix;
  /** Drawn frames without a stage-1 change (live), stage-1 retakes in a row (kept), and whether calm is needed. */
  still: number;
  churn: number;
  calm: boolean;
  /**
   * Drawn frames in a row its subtree did not change (no stage-1 mark), whether it may be kept or not: the monitor's
   * `filter-still` rule reads it.
   */
  quiet: number;
  /** Drawn-frame number of the last frame its quad was drawn; the LRU key of P6. */
  lastDrawn: number;
  /** Depth of the top under the stage, for the inner-first order (P5.2). */
  depth: number;
  /** Bytes of s1, s2, s3 (estimate, P6.1). */
  bytes: number;
  /** A settle retake is owed: the view came to rest off its picture's grid (P2.5). */
  settle: boolean;
  /** Bytes a refused take asked for; the record is not offered again until they fit (P6.3). */
  refused: number;
  /**
   * The picture was cut to the canvas at its take (F53): a move or another canvas size would show what it left out,
   * so either takes it again.
   */
  cut: boolean;
  /**
   * The quad draws the subtree picture itself at the stack's alpha, with no stage 3 (F54): every enabled filter is an
   * `AlphaFilter` at the canvas resolution.
   */
  direct: boolean;
  /** A view of kind `"Display"` hangs in the subtree; `undefined` until a take attempt walks it (P4.1). */
  displays: boolean | undefined;
  /**
   * A walk found a node under the top that blends otherwise than normally (F68): the record is not taken, and the walk
   * is not taken again until a frame that sets `dirtyS1` (a change under the top) clears it.
   */
  blended: boolean;
};

/** One picture of an overlay's range (P7), keyed by the owner overlay's entity. */
export type RangeRecord = {
  readonly id: Entity;
  /** A copy of the entries spec 22 handed over (bottom first), refreshed at every take. */
  readonly entries: PixiContainer[];
  /** A copy of the nodes the picture's one render hides (P7.2), refreshed with the entries. */
  readonly others: PixiContainer[];
  slot: { container: PixiContainer; before: PixiContainer };
  picture: PixiRenderTexture | undefined;
  /** The sprite that shows the picture; never a view. */
  sprite: PixiSprite | undefined;
  /** A render is owed in this frame's flush (take or retake). */
  due: boolean;
  /** The sprite was placed again (`move`) and is checked in the flush. */
  moved: boolean;
  lastDrawn: number;
  bytes: number;
  /** The local transform last written on the sprite (compared before a write); NaN before the first. */
  readonly local: Float64Array;
};

/** kept module state, `ctx.state.kept`. */
export type KeptState = {
  /** Inner first (P5.2); re-sorted only when a depth changed. */
  records: KeptRecord[];
  byEntity: Map<Entity, KeptRecord>;
  byTop: Map<PixiContainer, KeptRecord>;
  ranges: Map<Entity, RangeRecord>;
  /** A canvas-sized texture a released range left, reused by the next take of the same size (LRU-evictable, P6). */
  spare: PixiRenderTexture | undefined;
  /**
   * Containers the cache made render groups; a pooled object leaves one (P9.3). The stage root a range picture makes
   * one stays one (P7.5).
   */
  madeGroups: WeakSet<PixiContainer>;
  /** Drawn frames since start: the clock of the policy (never time: deterministic, headless-safe). */
  frame: number;
  /** Sorting needed after a structural change. */
  unsorted: boolean;
  /** Total bytes held; the budget of P6. */
  bytes: number;
  /** The budget in bytes: `keptMb` MiB. */
  budget: number;
  /** Stage-1 and range takes and retakes since the monitor's last window close (P12). */
  takesOpen: number;
  /** The takes of the last closed window: `stats().kept.retakes`. */
  takesWindow: number;
  /** Stage-3-only redos since the last window close (agent log only). */
  refreshesOpen: number;
  /** Stage-1 and range takes of the frame running now: the ring's `retakes` column. */
  frameTakes: number;
  /** Quads drawn in the last drawn frame (stats().kept.pictures). */
  drawnPictures: number;
  /** Debug switch `debug.kept` (P14); config `keptMb: 0` forces it off. */
  on: boolean;
  /** `keptMb > 0`: the switch can be turned on. */
  allowed: boolean;
  /** One warning per run for a budget refusal. */
  warnedBudget: boolean;
  /** The labels of the tops already warned for a blended node under them (`renderer:kept-blend`), once each per run. */
  warnedBlend: Set<string>;
  /** The pixel leg of the oracle (P13.2): frames skipped for being off-grid, for the verify log. */
  verifySkipped: number;
  /** True while `bypass(true)` draws everything live for an extract. */
  bypassed: boolean;
  /** Render passes the last flush cost: the estimate `sync.renderPasses()` adds (P9.2). */
  flushPasses: number;
  /**
   * The frame `collect` read had no mark and no whole-frame reason: nothing a kept picture reads changed, so a kept
   * record that owes nothing is drawn from its picture as it stands, without its step (E5). Set by `collect`, spent by
   * the next flush.
   */
  calm: boolean;
};

/** The scratch matrices of the module, made once from the Pixi module. */
export type KeptMatrices = {
  /** The stage-1 render transform (M1). */
  readonly m1: PixiMatrix;
  /** The stage-3 render transform (M3). */
  readonly m3: PixiMatrix;
  /** A parent's world transform, inverted in place. */
  readonly parent: PixiMatrix;
  /** A local transform written on a quad or a range sprite. */
  readonly local: PixiMatrix;
};

/** What every function of the module works with. */
export type KeptCtx = {
  readonly ctx: RendererCtx;
  readonly host: HostModule;
  readonly demand: DemandModule;
  /** The hidden writers' context: the renderer context and `demand`. */
  readonly hidden: HiddenCtx;
  /** The writers of `sync` it draws through. */
  readonly sync: SyncWriters;
  /** Gives a bare view its wrapper before its first take (D4), without a mark; `sync.wrapForPicture`. */
  readonly wrap: (entity: Entity) => PixiContainer | undefined;
  readonly state: KeptState;
  /** Made at the first flush with a Pixi module. */
  matrices: KeptMatrices | undefined;
  /** The Pixi module of the matrices. */
  pixi: PixiModule | undefined;
};
