# ui

The interface as one more projection. A screen is a projection whose `view` returns JSX; `world`
wraps that tree in `Tree` and `ui` reconciles it by identity into entities it owns, with a `Box`
rect from one Yoga solve per change.

| Module | Owns |
|---|---|
| `jsx` | the runtime, the intrinsic types, `defineComponent`, instances and their `local`, the reconcile, the `onTap` application of `LocalWrite`, `tree()`, `find()`, `lint()` |
| `styles` | `defineStyle`, `defineTokens`, the `is` and `when` flags, `resolve` |
| `layout` | Yoga load and node lifetime, the solve, `Box` writes, motion, exiting elements, scroll, the `popup` and `guide` handlers |

| Member | Answers |
|---|---|
| `app.ui.tree()` | the live screen as plain data: rect, style, state, local, children |
| `app.ui.find(key)` | the entity of a keyed element, live only |
| `app.ui.lint()` | tap targets under `tapTargetPt`, text that overflows in some locale, an absolute element with no `reason` |

Config: `{ tapTargetPt: 44, breakpoints: { tall: 2, wide: 1.5 } }`. Emits nothing, listens to
nothing. Depends on `time`, `flow`, `world`, `renderer`, `input`, `anim`, `i18n`, `text`.
Yoga arrives through `await import("yoga-layout/load")` in `onStart`; nothing solves before it.
