/**
 * @file renderer/kept — types of the kept-picture cache: what a filter lets it do, what it reports, and the records it
 * keeps.
 */
import type { Entity } from "../../world/types";
import type { FilterGlobals } from "../quad";
import type {
  FilterSlot,
  FilterSlotInputs,
  FilterSlotQuad,
  HiddenCtx,
  SyncWriters,
  View,
  WhyEntry
} from "../sync/types";
import type {
  DemandModule,
  HostModule,
  PixiContainer,
  PixiFilter,
  PixiMatrix,
  PixiMesh,
  PixiMeshGeometry,
  PixiModule,
  PixiRenderTexture,
  PixiShader,
  PixiSprite,
  PixiTextureSource,
  PixiUniformGroup,
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
 * const kept: KeptStats = { pictures: 2, mb: 9.6, retakes: 0, evicted: 0, refused: 0 }; // the memory screen at rest
 * ```
 */
export type KeptStats = {
  /** Views drawn as one texture in the last drawn frame. */
  pictures: number;
  /** The MiB the kept textures hold. */
  mb: number;
  /** Pictures taken in the last full second. */
  retakes: number;
  /**
   * Pictures the budget evicted in the last full second, to make room for a take. 0 while inert or with `keptMb: 0`.
   *
   * @example
   * ```ts
   * // A scene of 80 MiB of pictures under the default budget of 64: the oldest go, drawn live until they are taken.
   * app.renderer.stats().kept.evicted; // 3
   * ```
   */
  evicted: number;
  /**
   * Takes the budget refused in the last full second: a refusal that holds for many frames counts once. 0 while inert
   * or with `keptMb: 0`.
   *
   * @example
   * ```ts
   * // A full-screen picture that does not fit a budget of 8 MiB: the view stays live, and `why()` says `"budget"`.
   * app.renderer.stats().kept.refused; // 1
   * ```
   */
  refused: number;
};

/**
 * Why a filtered view is drawn live, as `sync.debug.why()` names it. Its checks in the order they are made: the switch
 * (`"off"`), the view's filters (`"backdrop"`, `"filter-blend"`, `"cache-false"`), its top (`"faded-out"`, `"top-blend"`,
 * `"hidden"`), its ancestors (`"ancestor-tint"`, `"ancestor-blend"`, `"ancestor-hidden"`, `"placed-under-filter"`),
 * then what the cache decided: `"blend-below"` (a node under the top blends otherwise), `"display"` (a `Display` without
 * `onDemand`), `"waiting"` (still frames, or the frame's first takes went to others), `"alpha-due"` (a stack of alphas
 * goes first), `"churn"` (it changed too often, calming down), `"budget"` (a take refused) and `"idle"` (a take had
 * nothing to render).
 *
 * @example
 * ```ts
 * app.renderer.sync.debug.why()[0]?.reason; // "churn"
 * ```
 */
export type WhyLive =
  | "off"
  | "backdrop"
  | "filter-blend"
  | "cache-false"
  | "hidden"
  | "faded-out"
  | "top-blend"
  | "ancestor-tint"
  | "ancestor-blend"
  | "ancestor-hidden"
  | "placed-under-filter"
  | "blend-below"
  | "display"
  | "waiting"
  | "alpha-due"
  | "churn"
  | "budget"
  | "idle";

/**
 * What a kept picture's last take was for, as `sync.debug.why()` names it: `"first"` (taken from live), `"mark"` (its
 * subtree changed), `"inner-first"` (a view inside it took its first picture, or was settled or refined: F114, F126),
 * `"resolution"`, `"settle"` (it came to rest off its picture's grid), `"scale-limit"` (a zoom past what a picture is drawn scaled), `"canvas"` (a picture
 * cut to the canvas moved or the canvas changed), `"filter"` (the filter output alone), `"chain"` (the filter's pre-pass
 * and output) and `"placed-move"` (a view drawn scaled that may not be: placed, or cut to the canvas).
 *
 * @example
 * ```ts
 * app.renderer.sync.debug.why()[0]?.retake; // { why: "mark", by: "Text#1048612 tags:timer" }
 * ```
 */
export type RetakeWhy =
  | "first"
  | "mark"
  | "inner-first"
  | "resolution"
  | "settle"
  | "scale-limit"
  | "canvas"
  | "filter"
  | "chain"
  | "placed-move";

/** The reasons a view is drawn live: a record stores `WHY_LIVE[why - 1]`'s index, 0 while kept. Appended only. */
export const WHY_LIVE: readonly WhyLive[] = [
  "off",
  "backdrop",
  "filter-blend",
  "cache-false",
  "hidden",
  "faded-out",
  "top-blend",
  "ancestor-tint",
  "ancestor-blend",
  "ancestor-hidden",
  "placed-under-filter",
  "blend-below",
  "display",
  "waiting",
  "alpha-due",
  "churn",
  "budget",
  "idle"
];

/** The reasons of a take: a record stores `RETAKE_WHY[retakeWhy - 1]`'s index, 0 before its first. Appended only. */
export const RETAKE_WHY: readonly RetakeWhy[] = [
  "first",
  "mark",
  "inner-first",
  "resolution",
  "settle",
  "scale-limit",
  "canvas",
  "filter",
  "chain",
  "placed-move"
];

/** The 1-based index of each reason of `WHY_LIVE` the step writes: a number on the record, no string per frame. */
export const WHY = {
  off: 1,
  backdrop: 2,
  filterBlend: 3,
  hidden: 5,
  fadedOut: 6,
  topBlend: 7,
  ancestorTint: 8,
  ancestorBlend: 9,
  ancestorHidden: 10,
  placedUnderFilter: 11,
  blendBelow: 12,
  display: 13,
  waiting: 14,
  alphaDue: 15,
  churn: 16,
  budget: 17,
  idle: 18
} as const;

/** The 1-based index of each reason of `RETAKE_WHY`: a number on the record, no string per frame. */
export const RETAKE = {
  first: 1,
  mark: 2,
  innerFirst: 3,
  resolution: 4,
  settle: 5,
  scaleLimit: 6,
  canvas: 7,
  filter: 8,
  chain: 9,
  placedMove: 10
} as const;

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
  /** Why every filtered view is drawn as it is: `sync.debug.why()`. Agent builds only, a frozen `[]` elsewhere. */
  why(): readonly WhyEntry[];
  /** The takes since the last call, the evictions and refusals with them; the monitor's window close. */
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

/** What draws a kept picture beside its top: a sprite of the picture, or the mesh of a shaded record. */
export type KeptQuad = PixiSprite | PixiMesh;

/**
 * What a shaded record draws through (F126 stage 2): made at its first entry and kept while the record lives, so an entry
 * after that makes nothing. While the record is not shaded the shader binds no texture of the record.
 */
export type KeptShade = {
  /** Runs the filter's program over the padded picture, on the state's unit quad; destroyed with the record. */
  mesh: PixiMesh;
  /** The program of `quad` and what it binds: `gfu`, the padded picture, its sampler, and `quad.fu` when there is one. */
  shader: PixiShader;
  /** The global filter uniforms a filter pass would hand the body; static, uploaded only when a value changed. */
  readonly gfu: PixiUniformGroup;
  /** The arrays `gfu` reads, typed. */
  readonly vectors: FilterGlobals;
  /** The sprite of the record's picture, out of the tree while the mesh draws. */
  sprite: PixiSprite;
  /** The slot's quad the shader was built from. */
  quad: FilterSlotQuad;
  /** The texture source the shader binds. */
  source: PixiTextureSource;
  /** The `s1Version` the padded picture in `s3` was copied from; -1 when `s3` holds no copy. */
  copied: number;
  /** The device width of that copy: resizing `s3` in place blanks it without moving `s1Version`. */
  copiedWidth: number;
  /** The device height of that copy. */
  copiedHeight: number;
};

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
  /** Sprite(stage 3), in the tree beside the top; the mesh of `shade` while the record is shaded. */
  quad: KeptQuad | undefined;
  /** What the record draws through while shaded; made at its first entry, kept while the record lives. */
  shade: KeptShade | undefined;
  /** The record draws through the mesh: `s3` holds the padded picture, not a filter output. */
  shaded: boolean;
  /** Drawn frames that owed stage 3 alone, without a gap of `CALM_AFTER` frames. */
  outputRuns: number;
  /** The `KeptState.frame` of the last of them. */
  outputAt: number;
  /** The `KeptState.frame` of the last shaded change. */
  shadedAt: number;
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
  /**
   * A take under the limit is owed: after a step of the renderer resolution the picture is coarser than the canvas
   * (P4.3), and the step must run also in a calm frame.
   */
  coarse: boolean;
  /** This step's change of the record was a refining take and nothing else: read by `dirtyAbove`, cleared with the dirty flags. */
  refined: boolean;
  /** This step changed what the mesh draws without a pass: read by `drawingChanged`, cleared with the dirty flags. */
  redrawn: boolean;
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
  /**
   * A take attempt found a view of kind `"Display"` under the top that it may not keep (no `onDemand`); `undefined` until
   * an attempt walked the subtree, and again after a change under the top. Read by the report alone.
   */
  displays: boolean | undefined;
  /**
   * A walk found a node under the top that blends otherwise than normally (F68): the record is not taken, and the walk
   * is not taken again until a frame that sets `dirtyS1` (a change under the top) clears it.
   */
  blended: boolean;
  /** The frame of the record's last take from live (F114): a picture that goes ineligible right after it churns. */
  takenAt: number;
  /** An inner record was first taken, settled or refined: the stage-1 retake this causes is not churn (F114, F126). */
  spared: boolean;
  /**
   * A take attempt rendered nothing (off the canvas, empty bounds, too big, a `Display` without `onDemand`): no take is
   * offered or attempted until a change under the top or a move of it clears it (F114).
   */
  idle: boolean;
  /**
   * A take rendered nothing since the last change under the top or the last take: `idle`, which a move clears to offer
   * the take again, as the report keeps saying it. Read by the report alone.
   */
  idleSeen: boolean;
  /** A stack drawn direct that may be taken in this flush: no other first take happens before it (F114). */
  alphaDue: boolean;
  /** It was due and did not end the flush kept: not due again until a change under the top (F114). */
  alphaMissed: boolean;
  /** Why it is drawn live: `WHY_LIVE[why - 1]`; 0 while kept, and for a record evicted until its next step. */
  why: number;
  /** Still frames left before a take; 0 when it waits for none. */
  calmIn: number;
  /** The entity whose mark set `dirtyS1` in this frame, or the inner record's whose drawing changed; 0 for none. */
  markBy: Entity;
  /** What the last take was for: `RETAKE_WHY[retakeWhy - 1]`; 0 before its first. */
  retakeWhy: number;
  /** The entity whose mark caused the last take; 0 for none. */
  retakeBy: Entity;
  /** The `KeptState.frame` of the last take. */
  retakeAt: number;
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
  /** The one unit quad every mesh of the run draws on: 3 GPU buffers, not 3 per view. Made on demand. */
  quadGeometry: PixiMeshGeometry | undefined;
  /** The one sprite that copies every padded picture, its texture set before the render. Made on demand. */
  quadCopy: PixiSprite | undefined;
  /**
   * The textures of records whose views left, reused by the next take of the same size (F119); counted in `bytes`,
   * destroyed first when a take needs room.
   */
  pool: PixiRenderTexture[];
  /** The bytes of `pool`, a part of `bytes`: a take may have them (P6.3). */
  poolBytes: number;
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
  /** Records the budget evicted since the monitor's last window close. */
  frameEvicted: number;
  /** Record takes the budget refused since the monitor's last window close. */
  frameRefused: number;
  /** The evictions of the last closed window: `stats().kept.evicted`. */
  evictedWindow: number;
  /** The refusals of the last closed window: `stats().kept.refused`. */
  refusedWindow: number;
  /** The first `frame` of the last closed window. */
  windowStart: number;
  /** The last `frame` of the last closed window; below `windowStart` before the first close. */
  windowEnd: number;
  /** The first `frame` of the open window. */
  windowNext: number;
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
  /** First takes in this flush (F114): every one counts; a stack drawn direct is never held back by the count. */
  firstTakes: number;
  /** The limited takes of this flush, refining and settle together (P4.3, `REFINE_TAKES`). */
  frameRefines: number;
  /** A record drawn direct is due in this flush: the first takes of the others wait for the next (F114). */
  alphaDue: boolean;
  /** Live records drawn live with a filter in this flush (F119): from `CROWD` on, their first takes do not wait. */
  liveWaiting: number;
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
