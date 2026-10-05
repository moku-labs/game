# Hot swap

A save of a view file swaps the module in the running page. Same state, same node, no reload.

You open the Settings popup over Home, change `settings/styles.ts` and save. The popup repaints on the next frame. The flow, the model and the `local` of every component stay as they were.

## Setup

One line in the `bunfig.toml` of the game:

```toml
[serve.static]
plugins = ["@moku-labs/game/hot"]
```

- **Run the dev server in the game root.** The plugin reads paths relative to the working directory. A file outside it, such as the engine source or a linked package, loads unchanged.
- **A dev build only.** `ui` installs the swap handler only when `__MOKU_GAME_DEV__` is `true`, see [Turn the dev build on](./doors.md#turn-the-dev-build-on).
- **Production never loads it.** `[serve.static]` is read by the dev server only. `Bun.build` of a production build never runs the plugin.

The plugin appends a short footer to every view module it loads. The footer accepts the module's own update and hands the new exports to `ui`. Game code never writes `import.meta.hot`.

## What swaps and what reloads

A view module is a `.tsx` file, `styles.ts`, `view.ts`, `animations.ts`, `effects.ts` or a generated `generated/strings.<locale>.ts`. Anything under `node_modules/`, `web/`, `generated/`, `__tests__/` or `tests/`, and `.test` or `.spec` files, never swap. The generated strings files are the one exception in `generated/`.

| Saved | What happens |
|---|---|
| Styles, tokens, motions, plain functions | Swap. Bun gives the importers the new binding; every ui root lays out again |
| Components (`defineComponent`) | Swap. The registry takes the new definition; an open instance keeps its `local` |
| Function components | Swap, as plain functions |
| Projections of a registered name | Swap through `world.projection.replace`. A mounted one runs its new `view` for every item |
| Animations | Swap through `anim.replace`. The next `play` builds the new tree; a running timeline keeps its own |
| Text styles (`defineTextStyles`) | Swap through `text.replaceStyles`. Every label is redrawn with the new style |
| Emitters (`defineEmitter`) | Swap. `effects` takes them from the `ui:hot-swap` event; live particles keep their old config |
| Generated strings | Swap through `i18n.replace`. Every label resolves its message again |
| Logic: `rules/`, `nodes/`, `flows/`, `state.ts`, `tables.ts`, `kit.ts`, a feature `index.ts` | Reload and restore. These files never get the footer |
| Scenes, systems, ECS components, filters, features, flows, nodes, plugins | Reload and restore. They are registered by value at start |
| A new projection or a new animation | Reload and restore. A scene mounts a projection, a feature registers an animation |

Strings come from `features/*/strings/<locale>.json`. After a JSON edit, run `bun run assets:keys`. It writes `generated/strings.<locale>.ts`, and that save is what swaps. The bin has no watch mode.

## A refusal

A view module that exports something from the reload rows is refused:

1. `ui` logs `ui:hot-refused` at info with `{ file, reason }`.
2. It throws `[game] Hot swap refused for <file>: <reason>.` A refused module changes no component and no style.
3. Bun turns the throw into a full page reload.
4. In the editor, its checkpoint restores the game where it stood. The `game.restore` door mounts the bookmark's scene first, so a popup comes back with its scene under it.

A save of a logic file takes the same path from step 3: no module accepts it, so the update reaches the page root.

A swap that worked logs `ui:hot-swap` at info with `{ file, components, projections, animations, emitters, strings, textStyles }`. The global event `ui:hot-swap` carries `{ file, module }` with the new exports. A game plugin can hook it with no `depends`. The full sorting rules are in the [ui README](../src/plugins/ui/README.md#hot-swap-dev).

## Another folder layout

The default filters fit the usual layout: `features/<name>/view.tsx`, `animations.ts` and the rest. A game that keeps its views elsewhere exports its own plugin and lists that file instead:

```ts
// hot.ts in the game root
import { hot } from "@moku-labs/game/hot";

export default hot({ include: /\/look\/.*\.ts$/ });
```

```toml
[serve.static]
plugins = ["./hot.ts"]
```

| Option | Default | Tested on |
|---|---|---|
| `include` | `.tsx`, `styles.ts`, `view.ts`, `animations.ts`, `effects.ts`, `generated/strings.<locale>.ts` | The absolute path. Do not anchor it at the start |
| `exclude` | `node_modules/`, `web/`, `generated/`, `__tests__/`, `tests/`, `.test` and `.spec` files | The path relative to the game root, with a leading `/`: `/features/home/view.tsx` |

## Keep view helpers next to their projection

Bun swaps bindings, not values another module already copied. A function that another module stored into an object at load time keeps the old version.

```ts
// features/board/cell.tsx: saved
export const cellView = (cell: Cell) => <image key={cell.id} texture={cell.texture} />;

// features/board/view.ts: not saved
import { cellView } from "./cell";

export const board = projection({
  name: "board",
  layer: "board",
  from: player => player.cells,
  key: cell => cell.id,
  view: cellView
});
// `board` holds the old `cellView`. The save of cell.tsx swaps nothing on screen.
```

Keep a view helper in the same module as the projection that uses it. Then a save of that module builds a new projection spec, and `world.projection.replace` takes it.
