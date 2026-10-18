/**
 * @file world plugin — the heap budgets of the perf tests, in bytes per call. Each line says what
 * the call kept before its fix (change 2026-10-18-cheap-idle-tick, Node 24.21 on the Mac) and why
 * a line above 0 stays there.
 */

/** What a measurement of a call that keeps nothing may read: the agreement of `alloc` itself. */
export const NOISE_BYTES = 1;

/**
 * Headroom of a query budget over its rows and walks: the size of a fresh row moves with V8's
 * array growth from run to run, so a query budget is relative and carries this margin. The 0 B
 * budgets stay strict.
 */
export const QUERY_MARGIN = 256;

/** Bytes per call each fixture may keep allocated. */
export const BUDGET = {
  /**
   * W1, W2, W5: an idle frame of 40 systems over 300 entities, 30 matching. Was 118 964 B: a walk,
   * an entity list and a closure per system, a row per match, new change sets, a context per phase.
   */
  worldWalkIdle: 0,
  /** W1: the same frame with 300 matching. Was 1 180 196 B: 12 000 rows. */
  worldWalkAllMatch: 0,
  /** W5: 4 phases of 40 empty-query systems. Was 578 B: a context and a `res` closure per phase, a walk per system. */
  runPhaseFrame: 0,
  /** W2: 100 marks and the clear. Was 5 393 B: a new `Set` per component per frame, and its growth. */
  changesMarkClear: 0,
  /** W2: `changed()` with nothing marked, walked. Was 32 B: a new empty array per call. */
  changedIdle: 0,
  /** W4: a sweep over 300 resting views. Was 2 848 B: copies of the queue and the live views, a filtered track table, map iterators. */
  sweepIdle: 0,
  /** W4: the same sweep with 10 tracks ending. Was 2 788 B. */
  sweepTracksEnding: 0,
  /** W3: 50 unmuted tracks asking for their muted fields. Was 7 605 B: a new `Set` per ask. */
  mutedUnmuted: 0,
  /** W3: 50 muted tracks of a type with an owned field. Was 29 212 B: a joined `Set` per ask. */
  mutedOwned: 0,
  /** W6: `ecs.get`. Was 0 B. */
  ecsGet: 0,
  /**
   * W6: `ecs.set` of one double field. Was 16 B, and stays 16 B: V8 boxes a double it reads out
   * of a patch field of double representation (a literal like `{ x: 0.5 }`), with `Object.assign`
   * as with an own-key loop (both measured, 2026-10-18). The write into the stored field is in
   * place: a patch that holds its doubles in tagged fields costs 0 B.
   */
  ecsSet: 16,
  /** W6: `ecs.set` of three double fields. Was 48 B, stays 48 B: 16 B per double field, as `ecsSet`. */
  ecsSetThree: 48,
  /** W6: `ecs.set` of one integer field. Was 0 B. */
  ecsSetInteger: 0,
  /**
   * Q1: `ecs.query()` outside a phase, bytes per walk besides its rows. The rows stay fresh by
   * contract (games keep and spread them), so a query's budget is the rows measured in the same
   * process plus this per walk plus `QUERY_MARGIN`. 170 B: the walk object and the call's rest
   * array of terms (167 B measured). Before Q1 a 300-entity query over 30 matches kept 3 010 B
   * besides its rows: a new plan, a copy of the 300 keys, the walk and its step (5 177 B in all).
   */
  queryWalk: 170,
  /** W6: `ecs.has`. Was 0 B. */
  ecsHas: 0,
  /** W6: `ecs.resource(Now)`, the read behind `res(Now)`. Was 0 B. */
  ecsRes: 0,
  /**
   * Spec 28: a frame whose 40 systems of an inactive feature (`systemsRun: "active"`) sleep. Before
   * spec 28 they ran: 0 B, every walk reused, but 40 walks and 1 200 marks a frame.
   */
  scopeInactive: 0,
  /** Spec 28: a frame whose flow moved, so the stack is read and 20 features are evaluated again, plus one `isActive`. */
  scopeCheck: 0
} as const;
