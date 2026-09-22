# P5 result

Question: does "a new move touches an entity that still animates: its animation finishes instantly, then the new one starts" look even at five merges per second? If not, which policy does?

Answer: changes. Policy B (retarget) replaces policy A (finish-then-start).

## Evidence

Headless, `bun measure.ts`, seed 20260922, 80 case blocks (8 cases × 10), fixed 60 Hz step, motions 350 ms. Full numbers: `metrics.json`.

| Policy | Easing | Moves/s | Overlaps | Snaps | Snaps / overlaps | Max jump px | Max scale jump | Speed jump p99 px/s | Lag from last commit p95 / max ms | Converged |
|---|---|---|---|---|---|---|---|---|---|---|
| A | spec | 5 | 68 | 30 | 0.44 | 604 | 0.33 | 2203 | 350 / 350 | yes |
| B | spec | 5 | 68 | 0 | 0 | 0 | 0 | 1471 | 350 / 350 | yes |
| C | spec | 5 | 76 | 0 | 0 | 0 | 0 | 1281 | 500 / 650 | yes |
| A | linear | 5 | 68 | 63 | 0.93 | 318 | 0.48 | 8465 | 350 / 350 | yes |
| B | linear | 5 | 68 | 0 | 0 | 0 | 0 | 2109 | 350 / 350 | yes |
| C | linear | 5 | 76 | 0 | 0 | 0 | 0 | 2120 | 500 / 650 | yes |
| A | spec | 8 | 85 | 68 | 0.80 | 701 | 0.39 | 5288 | 350 / 350 | yes |
| B | spec | 8 | 85 | 0 | 0 | 0 | 0 | 2150 | 350 / 350 | yes |
| C | spec | 8 | 112 | 0 | 0 | 0 | 0 | 1281 | 583 / 900 | yes |
| A | spec | 1 (floor, no overlap) | 0 | 0 | 0 | 0 | 0 | 1260 | 350 / 350 | yes |

Where the snaps of policy A come from (spec easing, 5 per second):

| Finished motion | Times finished | Snaps | Largest jump |
|---|---|---|---|
| levelUp | 32 | 0 | 0.11 scale |
| defaultExit | 5 | 0 | 0.09 scale |
| slide | 20 | 10 | 58 px |
| enterArc | 16 | 15 | 42 px, 0.11 scale |
| exitInto (key returns, case 5) | 5 | 5 | 604 px, 0.33 scale |

Browser: Pixi 8.21.0 on WebGPU, 120 Hz display. While the script plays: frame delta p95 9.1 ms, core + sync work p95 0.2 ms, 3000 frames. Performance is not a factor.

Strips (`shots/`, 12 frames 50 ms apart, cases 1, 3, 5 for A, B, C). Read by the orchestrator: `case1-A`, `case1-C`, `case3-B`, `case5-A`, `case5-B`. The other four were saved and not read.
- Case 1, A: the level bump restarts cleanly, no visible jump. C: the number on the item stays old for 150 ms after the commit.
- Case 5, A: the flying item vanishes in mid-flight and a new one grows from zero in its cell. B: the same item turns around and glides home.
- Case 3, B: A flies to the cell where B was and fades there, while B flies into C. Readable, no jump.

Not verified: no human looked at the page in motion. The strips and the numbers agree, so the result does not wait for it.

## The decision rule of the spec, applied honestly

- `snapCount(A) / overlapCount` = 0.44 (needs ≤ 0.05). A does not stand. At 3 moves per second A is at 0.07; from 5 per second up it breaks on every moving view.
- The rule then asks `lagMs p95 < 400` for B. As the spec defined `lagMs` (one unbroken interval of difference) B has p95 550 ms. That threshold was wrong by construction: a key touched by two moves 200 ms apart cannot converge before 200 + 350 = 550 ms under any policy without a snap. A has the same 550. The metric that separates the policies is lag from the LAST commit that touched the key: A 350, B 350, C 500 p95 and 650 max (900 at 8 per second).
- `cutMotions / overlapCount` for B: 0.15 at 5 per second (passes ≤ 0.25). At 8 per second it is 0.93, because every overlap lands before half of the motion. That number counts cut motions, not visible damage: snaps stay 0.
- C is never needed, and it shows stale numbers on items, which is the one thing the fast cycle must not do.

Written reason for overruling the letter of the rule: the `lagMs < 400` threshold is unreachable for every policy, including the accepted one. By the metric that can separate them B equals A, and B has zero snaps.

## What changes in the plan

1. **Policy.** `world.projection` uses retarget: a new motion on a view that still animates cancels the running motions and starts from the current visual values. "Finish then start" of page 8 becomes "cancel then start from where it is". The invariant of page 8 stays: when nothing animates, the picture equals the projected state (convergence held in all 13 runs). Overlap per view is enough; 5 to 9 cross-field overlaps per run (a slide arriving during a levelUp) were handled by rule 2 with no jump, so per-field bookkeeping is not needed.

2. **Motion hook signature.** What the cases needed:
   - `enter(view, item, hint?)`, `exit(view, item, hint?)`, `change[field](view, prev, next, hint?)`, each returning a handle with `finish()` and `cancel()`. `cancel()` is the one used on overlap; `finish()` is used by load, restore, unmount and the fast walk.
   - **New: a rest pose.** Every motion must start from the current values, never from `prev`. After a cancel, fields that the new motion does not drive are off their rest values (scale 1.18 after a cut levelUp). The projection owns a rest pose per view (what `spawn`/`update` wrote) and adds a settle motion for every loose field. Without this B does not converge. So the projection needs one more optional hook: `settle(view, fields)`, with a built-in default (350 ms ease-out to the rest pose).
   - **Case 8, drop with no commit:** there is no diff, so no `change` hook fires. The same `settle` plays it: `world.projection.settle(key)` is called by the drag system on release. While a view is held, position tracks do not write; the other fields follow the policy.
   - `change[field]` receives `prev` and `next`, so a rollback that lowers a level can choose another motion than levelUp. The spike played levelUp on a decrease and it reads wrong in the `case5` strips.
   - **How a hint finds its key:** by a key in its payload. `merged { from, into }` goes to the exit of `from`; `spawned { key, generatorCell }` goes to the enter of `key`. Hints are buffered between the commit and the reconcile, which runs once at the start of the next frame. A hint whose key has no diff entry is dropped silently (case 7: two commits in one frame, a key that never had a view). A lost hint plays the default motion (case 6). Both ran 10 times with no error and full convergence.
   - **Which cause plays motions:** `edge` and `rollback` play them. `load` and `restore` set the picture directly and flush the despawn queue.

3. **Despawn queue rules.**
   - An exited view leaves `live`, stays drawn, and is removed when its last motion ends. Longest queue seen: 3 (4 at 8 per second).
   - Key returns while its exit plays (case 5), same fields or other fields (the id counter rolls back, so a new item can reuse an id): the SAME view is revived. Its exit is cancelled, it takes the new item and level, and one settle motion over all fields brings it home. No second view for one key ever exists.
   - The exit target is gone (case 3): the target of `exit` is a position, read once when the motion starts, from the target's cell in the new state, else in the old state. The flying view never holds a reference to another view.
   - `unmount`, or the owner leaves, while exits play: flush. All motions are finished and the queue is emptied in the same frame. A scene change has its own transition; waiting would leak views across scenes. The spike uses the same flush for `load` and `restore`.
   - A view in the despawn queue takes no part in hit tests.

4. **What V3 `anim` must provide** so these motions move to it with no change in `world.projection`: a handle with `finish()` and `cancel()`; tracks that read their start value from the component at start time (no stored `from`); an exact write of the end value on the last frame (convergence is checked with `===`); position tracks that can be muted while another writer (the hand) owns the field.

5. **Spec sections to edit:** only the future `06-world.md`, module `projection`: overlap policy, hook signatures with `settle` and the rest pose, hint routing, cause table, despawn queue rules. `context-puzzle-engine.md` line 99 and page 8 say "finish instantly"; the `world` spec records the change in `decisions.md`. No V1 spec changes.

Open risk, one line: the judgement "looks even" rests on numbers and on five strips read by the orchestrator, not on a person watching the page.
