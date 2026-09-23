# model

> Very Complex plugin — the truth of the game: the `session` tree and the save document `{ player, rng }`, transactions committed on edges, rest-point rollback and persisted rng streams.

Everything in state is plain JSON. There are two trees. The save document `{ player, rng }` is
persisted through the provider. The `session` tree lives for one run of the game and is never saved.

Logic changes the trees only inside a transaction. `flow` opens one transaction per node run and
commits it on the edge. Only a rest point hands patches to the provider, so a kill between two rest
nodes loses a whole transition and never half of one.

Two modules do the work and the plugin root groups them:

| Module | Owns |
|---|---|
| `store` | Load, snapshot, transactions, rest points, rollback, restore, flush, the migration chain, the provider |
| `rng` | Deterministic integer streams. The module keeps no state: every stream lives in the save document |

```ts
app.model.store.snapshot(); // store
app.model.rng.peek("dice"); // rng
```

Randomness lives in the save document on purpose. A draw commits and rolls back together with the
transaction that drew it, so a kill of the app cannot re-roll a chest.

## API

### store

| Method | Behaviour |
|---|---|
| `load(): Promise<void>` | Reads the save through the provider. A new player gets a clone of `initialPlayer` and a seed. A stored save runs through the migration chain. Marks the first rest point, hands the whole document to `provider.commit()` when it was rewritten — a new player, a migrated save — and emits `model:committed` with cause `"load"`. Throws `SaveUnreadableError` when the save cannot be read. On a failure the state stays exactly as it was. Called by `flow.run()`, not by `onStart`. |
| `snapshot(): Snapshot` | The committed trees `{ player, session, rng }`, frozen. This is the only thing a view or a projection sees. Before `load()` it shows the initial player, never a half-read save. The same object comes back while the document and the session are unchanged, so the editor's `watch` compares identities instead of trees. |
| `begin(): Transaction` | Opens the drafts of one node run. One transaction at a time: a second `begin()` throws. |
| `markRest(): void` | Marks a rest node. The provider gets `commit(pending, schemaVersion)`, then the rest point moves and `pending` is emptied. A throwing provider leaves both untouched. |
| `markBarrier(txId: string): Promise<void>` | Marks a barrier node. The rest point moves first, because rollback cannot cross a barrier. Then the provider gets `commitDurable(pending, txId, schemaVersion)`. `pending` is emptied only after it resolves. |
| `rollback(): void` | Returns to the last rest point. It discards an open transaction, swaps the pointers to the frozen trees and empties `pending`. No inverse patch is replayed. Emits `model:committed` with cause `"rollback"`. |
| `restore(input: { player: Json; session?: Json; rng?: RngState }): void` | Replaces the trees: a bookmark, a repro, a dev restore. What is omitted stays. The restored trees become the new rest point. The provider gets the whole document at the next rest point. Throws while a transaction is open. Emits `model:committed` with cause `"restore"`. |
| `flush(): Promise<void>` | Asks the provider to write what it has accumulated. The pending patches stay: they are an unfinished transition. |

A failing provider is logged with `ctx.log.error("model:provider-failed", { method, error })` and the
error is thrown again. The runner treats persistence errors as fatal.

### Transaction

| Member | Meaning |
|---|---|
| `player: Json` | Mutable draft of the player tree |
| `session: Json` | Mutable draft of the session tree |
| `rng: RngView` | Rng view bound to the draft `rng` branch. Draws advance the draft |
| `commit(): CommitResult` | Finishes the drafts, swaps the frozen trees, appends the doc patches to `pending`, emits `model:committed` with cause `"edge"`. Returns `{ patches: { doc, session }, roots }` |
| `discard(): void` | Drops the drafts. Nothing changes and nothing is emitted |

A closed transaction throws on a second `commit()` or `discard()`.

### rng

| Method | Behaviour |
|---|---|
| `rng.peek(id: string): number \| undefined` | The committed uint32 state of one stream, or `undefined` when it was never drawn. For bookmarks, tools and tests. It never draws. |
| `view.stream(id: string): RngStream` | On an `RngView`: `transaction.rng`, or `rng` of a node context. Opens one stream. Use one id per source, for example `"chest:42"`. Opening without drawing leaves the branch untouched. |
| `stream.int(maxExclusive)` | An integer in `[0, maxExclusive)`. Throws when the bound is not a positive integer. |
| `stream.range(min, maxInclusive)` | An integer in `[min, maxInclusive]`. |
| `stream.pick(items)` | One element of an array. Throws on an empty array or a hole. |
| `stream.weighted(table)` | One entry of `{ weight: number }` entries by integer weight. Weight zero never wins. Throws when no weight is positive. |
| `stream.chance(numerator, denominator)` | True with a `numerator` in `denominator` chance. |

The first draw of a stream seeds it from the save's `seed` and the stream id. Every draw is one
`mulberry32` step on a uint32 state stored in `rng.streams[id]`. Integers only, so every JavaScript
engine produces the same numbers. The hash and the step are part of the save format.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `playerProvider` | `PlayerStateProvider \| undefined` | `undefined` | The save seam. `undefined` means the in-memory provider `memory()`: nothing is persisted. |
| `initialPlayer` | `Json` | `{}` | Player state of a new player. Deep-cloned. |
| `initialSession` | `Json` | `{}` | Session state at every start. Deep-cloned. |
| `seed` | `"from-save" \| number` | `"from-save"` | `"from-save"`: a new player gets a random seed once, then it is part of the save. A number fixes it, for tests. |
| `schemaVersion` | `number` | `1` | Version of the save schema written by this build. |
| `migrations` | `readonly Migration[]` | `[]` | Ordered chain. `up` of `from: n` produces version `n + 1`. |

```ts
createApp({ pluginConfigs: { model: { initialPlayer: { coins: 0 }, seed: 42 } } });
```

## Events

| Event | Payload | When |
|---|---|---|
| `model:committed` | `{ roots: readonly Root[]; cause: "edge" \| "rollback" \| "restore" \| "load" }` | Committed state changed. |

No engine plugin hooks this event in V1. It is for the game, for projections and for devtools.

`Root` is `"player" | "session" | "rng"`. With cause `"edge"` the list holds only the roots the
transaction touched, in the order `player`, `session`, `rng`. With `"load"`, `"rollback"` and
`"restore"` it holds all three, because a whole document was swapped. Projections reconcile from
`snapshot()`.

```ts
hooks: ctx => ({
  "model:committed": ({ roots, cause }) => {
    ctx.log.debug("model changed", { roots, cause });
  }
});
```

## The provider seam

The application layer implements `PlayerStateProvider`. `state` is the whole `SaveDoc`
`{ player, rng }`.

| Method | Called | Contract |
|---|---|---|
| `load(): Promise<{ state: Json; version: number } \| null>` | Once, by `store.load()` | `null` means a new player. |
| `commit(patches: Patch[], version: number): void` | At every rest node, by `markRest()` | The provider accumulates and debounces writes. |
| `commitDurable(patches: Patch[], txId: string, version: number): Promise<void>` | After a barrier node, by `markBarrier(txId)` | Resolves when the data is durable. |
| `flush(): Promise<void>` | On a `"background"` pause and on stop | Writes what was accumulated. |

A `Patch` is `{ op: "add" | "remove" | "replace"; path: (string | number)[]; value?: Json }`. Paths
start at the document root: `["player", "coins"]`, `["rng", "streams", "dice"]`. Session patches
never reach the provider.

When the provider has no base to apply patches to, the document is sent as one whole-document patch
`{ op: "replace", path: [], value: doc }`. That happens for a new player, for a migrated save and
after `restore()`. `load()` commits that patch itself, so a player who leaves on the first screen is
already saved; after `restore()` it waits in `pending` for the next rest node.

## Migrations

```ts
type Migration = { from: number; up(state: Json): Json };
```

`load()` compares the saved `version` with `schemaVersion` and runs one step per version. A step
gets the whole save document as the provider stored it and returns the next one. Each step is logged
with `ctx.log.info("model:migrated", { from, to })`. After the chain the result must have the shape
`{ player, rng: { seed: number, streams: Record<string, number> } }`.

## SaveUnreadableError

Thrown by `load()`, and so by `flow.run()`, when this build cannot read the save. The save stays
untouched, so the app can show a clear screen instead of overwriting it.

| Case | Cause carried in `error.cause` |
|---|---|
| The save is newer than `schemaVersion` | "The save was written by a newer build." |
| No migration has `from` equal to a version on the way | "No migration step leads away from save version n." |
| A migration's `up` throws | The error of the game's own code |
| The migrated save is not `{ player, rng }` | "The save is not a document of the shape { player, rng }." |

The error has `savedVersion: number` and `schemaVersion: number`. It is a root export:
`import { SaveUnreadableError } from "@moku-labs/game"`.

## Example

A game on schema version 2, with one migration and a screen for an unreadable save.

```ts
// game.ts
import type { Model } from "@moku-labs/game";
import { createApp, SaveUnreadableError } from "@moku-labs/game";
import { mainFlow } from "./flow";

// Version 1 saved `gold`. Version 2 calls it `coins`. A step works on the whole save document.
const renameGold: Model.Migration = {
  from: 1,
  up: state => {
    const doc = state as { player: { gold: number }; rng: Model.RngState };

    return { player: { coins: doc.player.gold, lastRoll: 0 }, rng: doc.rng };
  }
};

export const createGame = (playerProvider: Model.PlayerStateProvider) =>
  createApp({
    pluginConfigs: {
      model: {
        playerProvider,
        initialPlayer: { coins: 0, lastRoll: 0 },
        initialSession: { rolls: 0 },
        schemaVersion: 2,
        migrations: [renameGold]
      },
      flow: { mainFlow, safeNode: "home" }
    },
    onStart: ctx => {
      ctx.flow.run().catch((error: unknown) => {
        if (error instanceof SaveUnreadableError) {
          ctx.log.error("game: the save cannot be read", {
            savedVersion: error.savedVersion,
            schemaVersion: error.schemaVersion
          });
          return;
        }

        ctx.log.error("game: the graph failed", { error });
      });
    }
  });
```

Inside a node the model is never called. The node context carries the drafts and the rng view:

```ts
export const roll = defineNode({
  outcomes: { done: type() },
  run: ({ player, rng, out }) => {
    player.coins += rng.stream("dice").range(1, 6);
    return out.done();
  }
});
```

## Testing

`memory(fixture?)` and `saveOf(player, seed = 1)` are re-exported from `@moku-labs/game/testing`.
`memory()` persists nothing and records every call in `provider.calls`, in order. That list is the
whole persistence protocol of one run.

```ts
import { createHeadless, memory, saveOf } from "@moku-labs/game/testing";
import { expect } from "vitest";
import { createGame } from "./game";

const provider = memory({ state: saveOf({ gold: 7 }, 42), version: 1 });
const game = await createHeadless(createGame(provider));

await game.walk([{ at: "home", intent: "roll" }]);
await game.stop();

expect(provider.calls.map(call => call.method)).toEqual(["load", "commit", "flush"]);
```

## Lifecycle

- No `onStart`. The save is not loaded at start: loading can fail with a user-visible error, which
  belongs to the graph's boot, so `flow.run()` awaits `store.load()`.
- **onStop** is `({ state }) => state.store.provider.flush()`. `flow` stops before `model`, so
  unwritten patches still reach the provider. A rejecting flush makes `app.stop()` reject with that
  error.

## Doors

`inspect.ts` holds `game.model` (key `model` in `sources`) of the editor's read door,
`@moku-labs/game/inspect`, safe in a production build. No input. It reads `store.snapshot()` and
is read again on every commit (`changes: "commit"`): `watch` compares the snapshot by identity.

## Dependencies

None. The plugin declares no `depends`. `flow` is the caller of `begin`, `markRest`, `markBarrier`,
`rollback` and `restore`.
