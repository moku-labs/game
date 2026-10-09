# Hot swap

A save of a view file swaps the module in the running page. Same state, same node, no reload.

You open the Settings popup over Home, change `settings/styles.ts` and save. The popup repaints on the next frame. The flow, the model and the `local` of every component stay as they were.

## Setup

None. `moku-game dev` writes `.moku/bunfig.toml` with the hot plugin first, resolved from the game, and runs the dev server under it in the game folder:

```toml
# Written by moku-game dev. Do not edit.

[serve.static]
plugins = ["/abs/game/node_modules/@moku-labs/game/dist/hot.mjs"]
define = { "__MOKU_GAME_DEV__" = "true" }
```

The game keeps no `bunfig.toml`. `--serve-plugin <path>` adds a Bun plugin after the hot one, `--preload <path>` a `preload` line.

- **The dev server runs in the game root.** The plugin reads paths relative to the working directory. A file outside it, such as the engine source or a linked package, loads unchanged.
- **A dev build only.** `ui` installs the swap handler only when `__MOKU_GAME_DEV__` is `true`, see [Turn the dev build on](./doors.md#turn-the-dev-build-on).
- **Production never loads it.** `[serve.static]` is read by the dev server only. `moku-game build` bundles without the plugin.

A game without the shell, with a page and a Bun server of its own, lists the plugin in its own `bunfig.toml`:

```toml
[serve.static]
plugins = ["@moku-labs/game/hot"]
```

The plugin appends a short footer to every view module it loads. The footer accepts the module's own update and hands the new exports to `ui`. Game code never writes `import.meta.hot`.

## What swaps and what reloads

A view module is a `.tsx` file, `styles.ts`, `view.ts`, `animations.ts`, `effects.ts` or a generated `generated/strings.<locale>.ts`. On the layered layout it is also any `.ts` directly in a kind folder: `styles/`, `motion/`, `effects/`, `views/`, `world/projections/` and `world/layout/`, in a feature or in `shared/`. A file one folder deeper, such as `views/deep/x.ts`, is not. Anything under `node_modules/`, `web/`, `generated/`, `__tests__/` or `tests/`, and `.test` or `.spec` files, never swap. The generated strings files are the one exception in `generated/`.

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
| Logic: `rules/`, `nodes/`, `flows/`, `state.ts`, `tables.ts`, `kit.ts`, a feature `index.ts`, `world/components/`, `world/systems/` | Reload and restore. These files never get the footer. A `world/layout/` module gets it: plain functions swap and repaint, but one that exports an object with its own `name` or `id` is refused and reloads |
| Scenes, systems, ECS components, filters, features, flows, nodes, plugins | Reload and restore. They are registered by value at start |
| A new projection or a new animation | Reload and restore. A scene mounts a projection, a feature registers an animation |
| A string value in `strings/<locale>.json` | Swap. The keys watch writes `generated/strings.<locale>.ts`, and `i18n.replace` takes it |
| A new string key | Swap, the same way: the message is new in `generated/strings.<locale>.ts`. `generated/strings.ts` gets the key as a type only, and a type reloads nothing |
| An asset file saved with new bytes: a texture, a bitmap font `.fnt` or its page, a sound | Swap. The keys watch writes `.moku/assets-stamp.ts`, and `assets` reads the changed files again. See [An asset file](#an-asset-file) |
| An asset file that is new, removed or renamed, also a changed nine-slice tag in the file name | Reload and restore. The manifest the page booted with is not true any more. The page fetches it again, and the dev server answers files with `no-store` |

Strings come from `features/*/strings/<locale>.json` and the `strings/` of every layer. The last four rows need the keys watch: `moku-game dev` on the raw files runs it, and the editor starts it with `watchKeys`. See [dev keeps generated/ fresh](./shell.md#dev-keeps-generated-fresh). A game with a server of its own runs `bun run assets:keys` after a JSON edit: it writes `generated/strings.<locale>.ts`, and that save is what swaps. The bin `moku-game-assets` has no watch mode.

### An asset file

A save with new bytes travels in three steps. The keys watch writes `.moku/assets-stamp.ts`: `files` names every asset file with its size and time, `changed` the ones this save changed. `main.ts` imports that module and the hot plugin gives it the footer, so the page accepts it with no reload. `assets` hooks `ui:hot-swap`, reads the changed files of the loaded bundles again, stores each under its old key and emits `assets:replaced` `{ bundle, keys }`, once per bundle. `text`, `effects` and `audio` hook that event. The stamp itself is under [The stamp module](./shell.md#the-stamp-module).

- **Dev on the raw files only.** `--packed` watches nothing, and a built game has no hot plugin.
- **A bundle that is not loaded gets nothing.** Its next load reads the new bytes.
- **A failed replace keeps the old asset.** A file that cannot be fetched or decoded is logged as `assets:replace-failed`. Its bundle keeps the old textures, fonts and bytes, and the page does not reload. The next good save of the file swaps. A `.fnt` that `text` cannot read still reloads: `text` logs `text:font-replace-failed`.
- **A `.fnt` that starts naming another page file** is seen only when that page file is new, which reloads.
- **A sound that is playing plays on** with the old bytes. The next play takes the new ones.
- **A running particle effect of a replaced texture starts again**, so a burst plays again.
- **An image outside every `assets/` folder**, such as a favicon or `features/home/outside.webp`, is ignored. A new file in the `assets/` of a feature or of a layer reloads the page, also the first file of a folder that had none.

## A refusal

A view module that exports something from the reload rows is refused:

1. `ui` logs `ui:hot-refused` at info with `{ file, reason }`.
2. It throws `[game] Hot swap refused for <file>: <reason>.` A refused module changes no component and no style.
3. Bun turns the throw into a full page reload.
4. In the editor, its checkpoint restores the game where it stood. The `game.restore` door mounts the bookmark's scene first, so a popup comes back with its scene under it.

A save of a logic file takes the same path from step 3: no module accepts it, so the update reaches the page root.

A swap that worked logs `ui:hot-swap` at info with `{ file, components, projections, animations, emitters, strings, textStyles }`. The global event `ui:hot-swap` carries `{ file, module }` with the new exports. A game plugin can hook it with no `depends`. The full sorting rules are in the [ui README](../src/plugins/ui/README.md#hot-swap-dev).

## Another folder layout

The default filters fit the usual layouts: `features/<name>/view.tsx`, `animations.ts` and the rest, and the kind folders of the layered layout (`features/board/world/projections/cells.ts`, `shared/styles/text.ts`). A game that keeps its views elsewhere exports its own plugin and lists that file in a `bunfig.toml` of its own, on a server of its own: `moku-game dev` always lists the default `hot()`.

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
| `include` | `.tsx`, `styles.ts`, `view.ts`, `animations.ts`, `effects.ts`, `generated/strings.<locale>.ts`, and any `.ts` directly in `styles/`, `motion/`, `effects/`, `views/`, `world/projections/` or `world/layout/` | The absolute path. Do not anchor it at the start |
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
