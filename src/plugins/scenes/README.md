# scenes

> Standard plugin — a scene is a declaration, not a manager. A bundle, the bundles of state it names, named layers, a list of projections, optional music. A node names its scene; the switch runs inside `flow.onEnter("scene")`.

There is no scene life cycle to learn. The four mechanisms already exist: bundles in `assets`, layers and projections in `world`, the switch moment in `flow`. This plugin is the sentence that joins them.

```ts
// features/board/view/scene.ts
export const boardScene = defineScene("board", {
  bundle: "board",
  layers: { background: {}, cells: {}, items: { sort: "y" }, lifted: {}, fx: {} },
  projections: [boardCells, boardItems, boardGenerators]
});

// features/board/nodes/await-intent.ts — the node names the scene
export const awaitIntent = defineNode({ scene: "board", rest: true, outcomes: { merge: type() } });

// features/board/index.ts — the feature lists it
export const boardFeature = defineFeature("board", {
  flows: [boardFlow],
  scenes: [boardScene],
  projections: [boardCells, boardItems, boardGenerators],
  assets: boardAssets
});
```

## `defineScene(id, scene)`

| Key | Type | Meaning |
|---|---|---|
| `bundle` | `BundleKey` | The bundle the scene needs. Awaited before anything is mounted |
| `bundles` | `(state: SceneState<Player, Session>) => BundleKey[]` | Optional. The bundles that depend on the committed state, such as the episode the session plays. Awaited with `bundle`, every time a node enters the scene |
| `layers` | `Record<string, { sort? }>` | Layer name to its sort rule. The order of the lines is draw order, bottom first. A layer `ui` is appended |
| `projections` | `ProjectionSpec[]` | The projections the scene mounts. Their `layer` and `lift` are checked against the keys of `layers` and `ui` |
| `music` | `AudioKey` | Optional. The audio keys of the game (`G["assets"]`). Carried in `scenes:changed`, so `audio` needs no lookup |

The layer names are inferred from the keys of `layers`, and `NoInfer` keeps `projections` out of that inference: a wrong `layer` or `lift` is an error on the projection that is wrong, with no generic at the call site. The same check runs at run time for a caller without types:

```
[game] Scene "board": projection "board.items" names layer "itemz".
  Declare it in layers or fix the name.
```

## The appended `ui` layer

Every scene gets `{ name: "ui", sort: "none" }` on top of the layers it declared, so the HUD and the popups always have a place to mount and a game never has to remember the line. A scene that declares `ui` itself keeps the place it wrote it in and gets no second one — that is how a game puts an `fx` layer over the HUD. The layer check runs after the append, so a projection may name `ui` as its `layer` or its `lift` without declaring it, and a name that is neither declared nor `ui` is still rejected, by the compiler and at run time.

```ts
defineScene("board", { bundle: "board", layers: { cells: {}, items: { sort: "y" } }, projections: [hudPanel] }).layers;
// [{ name: "cells", sort: "none" }, { name: "items", sort: "y" }, { name: "ui", sort: "none" }]
```

`sort` left out means `"none"`. An integer-like layer name such as `"1"` throws: JavaScript lists integer keys first, so the draw order would not be the one that was written. The result is plain frozen data, so it is a helper and not an API member; `defineGame<Types>()` returns it typed as `DefineScene<AssetKey, BundleKey, Player, Session>`.

## Bundles of state: `bundles`

A scene may name bundles that depend on the committed state. `bundles` receives `SceneState`: the frozen `player` and `session` of `model.store.snapshot()`, in a frozen wrapper, never the draft of the node being entered. Through `defineGame` it is typed with the game's `Player` and `Session` and must return the game's bundle keys, so `() => ["ep03"]` and `session.level` do not compile. The loose `defineScene` reads the state as `Json`; annotate the parameter (`({ session }: SceneState<Json, { episode: string }>) => …`) and the session type is inferred from it.

```ts
// features/location/view/ward.ts: the room is the art of the episode the session plays.
export const wardScene = defineScene("ward", {
  bundle: "location",
  bundles: ({ session }) => [session.episode], // "ep01" | "ep02"
  layers: { room: {}, glow: {} },
  projections: [wardRoom, wardGlows]
});
```

`bundles` is pure and cheap: it runs at every node of the scene. A throw rejects the node, so `flow` rolls it back with the world untouched. A result that is not a list of names throws:

```
[game] Scene "ward": bundles() must return a list of bundle names.
  Return the bundle keys the scene needs, such as ["ep01"].
```

The list the scene names is its `bundle` first, then what `bundles` returns, in order, each name once (`namedBundles` in `bundles.ts`, which `assets` reads the same way). A scene without `bundles` names its `bundle` alone and has no `bundles` key: a flat game's scene objects are the same as before.

## API

| Method | Behaviour |
|---|---|
| `current()` | Id of the mounted scene. `undefined` before the first switch and after stop |
| `expect(id)` | The scene the next node without its own `scene` mounts: a rest node, or a transit node in live mode. The restore door calls it with the scene of a bookmark. An id no feature declared throws `[game] Scene "<id>" is not registered.` |

Nothing else is public. A scene is switched by the graph, never by a call: the plugin answers one question and takes one order, for the restore door.

```ts
// A fresh page restores a bookmark taken at the Settings popup over Home.
app.scenes.expect("home");
await app.flow.restore(bookmark); // resolves when the popup's gate is open
app.scenes.current(); // "home"
```

## The switch

`Stage` in `flow` is `"load"` then `"scene"`, each awaited before the node body, so the node preload of `assets` is done when the switch starts. The scene still awaits its own bundles, because they may not be in that preload. There are two paths: the **switch** to another scene, and the **re-read** at a node that keeps the mounted scene.

| Step | What happens |
|---|---|
| 1 | `node.over`: the target is the pending scene, whatever is mounted, and the record is cleared. Nothing pending: return. An over transit node in fast mode always returns and leaves the record alone. An over node that names a scene is a `ctx.log.warn` |
| 2 | Fast mode on a transit node: record the scene as pending and return |
| 3 | Live mode on a transit node: the target is `node.scene`, and the record is left alone. Without a scene of its own the target is what was recorded or expected, and the record is cleared |
| 4 | On a rest node: the target is `node.scene` or what was recorded or expected; the record is cleared |
| 5 | No target: return. A rest node with no scene and nothing mounted is a warning |
| 6 | The target is already mounted: return |
| 7 | No such scene: throw `[game] Scene "bord" is not registered.` The static check of `flow` normally catches it first |
| 8 | `named` = the scene's `bundle` and its `bundles` of the committed state. A throw rejects before any load |
| 9 | `assets.load` for every name at once, all awaited, raced against the node's abort signal. The first failure rejects |
| 10 | Aborted: return. Nothing was touched, the old scene is still there |
| 11 | One synchronous block: `setLayers` → `unmount` old → `mount` new → `current` and `named` → `assets.sceneBundles(named)` → `time.wake()` → `scenes:changed` |

**The re-read.** At any other node (no target, or the mounted scene: a rest node, a live transit node, an over node) a mounted scene with `bundles` is read again from the committed state. The same list, in the same order: nothing happens. Another list: every name is awaited, then `named` is replaced and `assets.sceneBundles(named)` is told. No mount, no `scenes:changed`, no `time.wake()`. An abort keeps the old list. A scene without `bundles` is never re-read, and a transit node of a fast walk neither switches nor re-reads.

| Case | Behaviour |
|---|---|
| Node without `scene` | The current scene lives on. A popup stands on the scene under it |
| `over` node | Takes the pending scene, whatever is mounted, and clears the record: a restore at a popup after `expect` builds the scene under it, whether the popup is a rest node or a transit node that waits for its answer. The pending scene is already mounted: nothing is built. Nothing pending: it never switches, and after it closes the node under it is active again on the same scene. An over transit node of a fast walk mounts nothing and keeps the record. A scene recorded by a fast walk at a transit node is taken by an over rest node too |
| Transit node in live mode, no `scene` | Mounts the pending scene and clears the record: a restore at a transit node on a fresh page builds the expected scene. Nothing pending: nothing happens, and no warning |
| Abort during the load | The callback returns. A rejection would be a node failure; `flow` handles the abort itself |
| Bundle load fails | The callback rejects. `flow` rolls back, emits `flow:error` and re-enters the rest node, whose scene is still mounted |
| `mount` throws | Same path as a failed load |
| Shared projection in both scenes | Unmounted and mounted again. A diff by name is a later optimisation |
| Fast walk | Transit nodes only record. The switch happens once per rest point, and a headless run really mounts |
| `restore`, rollback, deep link | Same path: the node is entered and the scene is built from the declaration. A restore target that names no scene keeps the current scene, so checkpoints name theirs |
| Restore at a scene with `bundles` | The store holds the bookmark's state before the node's stages run, so the switch reads `bundles` from the restored session: the ward of `ep02` is mounted once `location` and `ep02` are in, before the gate opens, and `ep01` is never fetched. `flow.restore` of a rest node resolves before the stages; `await app.flow.walk([])` returns with the scene standing |
| Safe-node recovery | The recovery edge is committed before the stages. A safe node that keeps the scene re-reads `bundles` from the recovered state and awaits what its `recover` named before the gate opens, without mounting again; one that mounts a scene reads it on the switch path. A `bundles` that throws at the safe node is fatal |
| Headless, plain Bun | Everything runs. Layers are stored, projections mount, entities exist per layer. No pixels, because `renderer` is inert |
| Leaving a scene | `unmount` flushes motions and the despawn queue at once |

A load that fails after the abort is logged with `ctx.log.warn` and never thrown: nobody waits for it any more.

**Known limit.** When a scene stays mounted and the committed state changes what `bundles` names (a restore of another episode while the ward is up), the projections reconcile on `model:committed` before the scene stage awaits the new bundle, so the new art may be missing for the frames of that load (the texture lookup of `assets` warns and loads it). A switch never shows a scene before its bundles are in.

## Static validation of scene ids

`flow` owns it and this plugin contributes nothing. `validateGraph` reads the scene ids from the `scenes` key of the registered feature descriptions, so a node whose `scene` is not among them, and an `over` node that names a scene, join the single `run()` error. It runs only when at least one feature brought a `scenes` key, so a `logicOnly` headless app is not checked. The throw of step 7 and the warning of step 1 are the second line of defence.

## Configuration

None. A scene is data in a feature. A transition effect is V3 work of `anim`, so a key here would have no reader.

## Events

| Event | Payload | When |
|---|---|---|
| `scenes:changed` | `{ from, to, music }` | After the mounts, once per real switch |

`music` is the new scene's key, so `audio` needs no lookup API: it fades the old track out and the new one in straight from the payload. A scene without music carries `undefined`. Nobody answers the event.

## Dependencies

`flow`, `world`, `assets`, `time`, `model`. No edge to `renderer`: the layers go through `world.projection`, which `renderer.sync` reads.

| Plugin | Used for |
|---|---|
| `flow` | `onEnter("scene", fn)`, `features.all()` |
| `world` | `projection.setLayers`, `projection.mount`, `projection.unmount` |
| `assets` | `load(bundle)`; `sceneBundles(named)` after a switch and after a re-read that changed the list, so a bundle the mounted scene names is never a budget victim nor released on `"leave"` |
| `time` | `wake()` on a switch, so a scene built while the loop idles is drawn at the full frame rate |
| `model` | `store.snapshot()`, the committed state `bundles` reads |

## Lifecycle

`onStart` reads the `scenes` key of every registered feature — a duplicate id throws and names both features — and registers the `onEnter("scene")` callback, keeping its remover. `onStop` runs that remover and forgets the scenes, the pending scene and the named list. Nothing is unmounted at stop: a teardown context may not call another plugin's API, and `world.onStop` clears every entity.

## Not in V2

`flow.fx.handle("scene")`: no node needs a switch in the middle of its body. A transition effect between two scenes, and a diff of the projections two scenes share, are later work.
