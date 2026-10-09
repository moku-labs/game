# Events

Every event a plugin emits, and how a game listens.

One event is global: `ui:hot-swap`, so `effects` and `assets` can hook it with no `depends` on `ui`. Every other event belongs to a plugin. `time` and `clock` emit nothing.

| Event | Emitted by | Payload | When |
|---|---|---|---|
| `lifecycle:changed` | `lifecycle` | `{ reason: PauseReason; action: "push" \| "pop"; reasons: readonly PauseReason[]; paused: boolean; resumed: boolean }` | The pause stack really changed. `resumed` is true only on the change that emptied the stack |
| `model:committed` | `model` | `{ roots: readonly Root[]; cause: "edge" \| "rollback" \| "restore" \| "load" }` | Committed state changed. `Root` is `"player" \| "session" \| "rng"` |
| `flow:edge` | `flow` | `{ flow: string; node: string; outcome: string; payload: Json; next: string; patches: { doc: Patch[]; session: Patch[] }; index: number; now: number }` | After the commit of an edge |
| `flow:rest` | `flow` | `{ path: string; checkpoint: boolean }` | The graph entered a rest node. Also once when `flow.restore` enters the node of a bookmark, for a transit node too: `path` is then no rest node and `checkpoint` is false |
| `flow:error` | `flow` | `{ path: string; error: unknown; rolledBackTo: string; retry: boolean }` | A node failed and the graph rolled back |
| `world:reconciled` | `world` | counts per reconcile | Dev only, behind `reconciledEvent` |
| `renderer:device-lost` | `renderer` | `{ kind, reason }` | The GPU device or context was lost; `lifecycle` is pushed |
| `assets:bundle-loaded`, `assets:bundle-unloaded` | `assets` | `{ bundle, tier, mb, reason }` | A bundle entered or left memory |
| `assets:replaced` | `assets` | `{ bundle: string; keys: readonly string[] }` | Dev only: a hot swap replaced files of one loaded bundle. One event per bundle per swap. `keys` are the asset keys with new bytes: each answers a new texture, font or sound, and the old textures are destroyed. See [Hot swap](./hot-swap.md) |
| `scenes:changed` | `scenes` | `{ from, to, music }` | The scene switched on entering a node |
| `anim:mark` | `anim` | `{ animation, mark }` | A `mark` step was reached, or jumped by `finish()` |
| `anim:finished` | `anim` | `{ animation }` | A timeline ended or was finished. Never on `cancel()` |
| `i18n:locale-changed` | `i18n` | `{ locale }` | The module of the new locale is loaded, or `replace` swapped messages of the current locale or the fallback; `text` re-resolves. Never at start |
| `ui:hot-swap` | `ui`, global | `{ file: string; module: Readonly<Record<string, unknown>> }` | Dev only: a saved view module was swapped, `module` is its new exports. `effects` replaces its emitters. For `.moku/assets-stamp.ts` it is only forwarded, with no repaint: `module.default` is the `AssetStamps`, and `assets` replaces the changed files. See [Hot swap](./hot-swap.md) |

`text`, `audio`, `effects` and `platform` emit nothing, and `ui` only the dev `ui:hot-swap`; the `effects` budgets are log warnings.

```ts
import { createPlugin, flowPlugin } from "@moku-labs/game";

export const edgeLog = createPlugin("edgeLog", {
  depends: [flowPlugin],
  hooks: ctx => ({
    "flow:edge": payload => {
      ctx.log.info("edge", { node: payload.node, outcome: payload.outcome });
    }
  })
});
```
