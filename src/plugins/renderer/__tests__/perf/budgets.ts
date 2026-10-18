/**
 * @file renderer — the allocation budgets of the perf files: bytes per call, one line per case, measured on Node 24.21
 * (`bun run test:perf`). Each line says what it measured before its fix and what it holds now; a line above 0 names
 * its reason.
 */
/** The bytes per call the `alloc` helper itself tolerates (its own test of an empty function): every case adds it. */
export const NOISE = 1;

/** Bytes per call each case may keep allocated. */
export const BUDGET = {
  // R5: before 17 B (the clock reading of `begin` and `end` handed to the window as a boxed double, `lastStart` and
  // `frameStart` tagged fields). Now 0: measured 0.4 B, all of it the window's close once a second while V8 has not
  // optimized it yet (about 160 B a close), under the 1 B the helper tolerates.
  monitorCommitSteady: 0,
  // R5: before 16 B. A late frame's annotation and its pending slot allocate nothing.
  monitorCommitLate: 0,
  // N1/N2: every section on and timed, one clock read a lap (a browser's clock may box its own answer). Before: the
  // steady line, 17 B. Now 0, the window's close as `monitorCommitSteady`.
  monitorSectionsOn: 0,
  // N1: every section off. New.
  monitorSectionsOff: 0,
  // N1: `monitor.sections()` answers its one frozen object. New.
  monitorSectionsRead: 0,
  // R4: before 608 B (an empty array per change list, an iterator per walk, closures). Now the still pass returns first.
  syncPassStill: 0,
  // R4: before 824 B (the tree check's set of an agent build copied every pass). Now made only when the tree changed.
  syncPassStillAgent: 0,
  // R4: before 936 B (two closures per changed entity, a try per closure). Now one visitor made once per list.
  syncPassMove: 0,
  // R4: a move reads nothing of the tree check of an agent build. New case.
  syncPassMoveAgent: 0,
  // R2: before 1 344 B (a layout, its stretch, anchor and box objects, the texture answer, the cover answer, the hit
  // box, and the alpha boxed into its call). Now written into the view and one scratch layout.
  spriteAlphaTween: 0,
  // Audit row 20: before 2 720 B (six mark sets grown again every frame and given a new table at every `clear()`).
  // Now the marks sit in dense lists stamped with the decision's number, emptied by a new number.
  demandMarks: 0,
  // The same with `onDemand`, every mark judged for the decision. Before 2 720 B.
  demandMarksOnDemand: 0,
  // Q2: before 768 B (the filter table walked with entry arrays, a closure per view, every tree walked again). Now the
  // count is kept until a change moves `passesVersion`; a still read compares the filters' `enabled` and reads one number.
  renderPassesStill: 0,
  // Q2: before 128 B (the layer table walked with entry arrays for the HUD layer's name every step). Now the name is
  // kept with the layers.
  hudPartsStill: 0,
  // A26 heap profile: before 22 400 B (a new SDF shader made at every layout of a text and dropped by Pixi: its bind
  // groups, its resource accessors, its uniform group). Now the text keeps its shader; measured 2 819 B, all of it
  // Pixi laying the label out again (its graphics context's instructions and the layout), not the engine's.
  sdfTextUpdate: 2900,
  // `rootPoseInto` for effects' E2: `rootPoseOf` made 600 B through the same chain of three.
  rootPoseInto: 0
} as const;
