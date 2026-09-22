# scenes

> Standard plugin — a scene is a declaration, not a manager. A bundle, named layers, a list of projections, optional music. A node names its scene; the switch runs inside `flow.onEnter("scene")`.

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

`sort` left out means `"none"`. An integer-like layer name such as `"1"` throws: JavaScript lists integer keys first, so the draw order would not be the one that was written. The result is plain frozen data, so it is a helper and not an API member; `defineGame<Types>()` returns it typed as `DefineScene<AssetKey, BundleKey>`.

## API

| Method | Behaviour |
|---|---|
| `current()` | Id of the mounted scene. `undefined` before the first switch and after stop |

Nothing else is public. A scene is switched by the graph, never by a call.

## The switch

`Stage` in `flow` is `"load"` then `"scene"`, each awaited before the node body, so the node preload of `assets` is done when the switch starts. The scene still awaits its own bundle, because `bundle` may not be in that preload.

| Step | What happens |
|---|---|
| 1 | `node.over`: return. An over node that names a scene is a `ctx.log.warn` |
| 2 | Fast mode on a transit node: record the scene as pending and return |
| 3 | On a rest node: the target is `node.scene` or what was recorded; the record is cleared |
| 4 | No target: return. A rest node with no scene and nothing mounted is a warning |
| 5 | The target is already mounted: return |
| 6 | No such scene: throw `[game] Scene "bord" is not registered.` The static check of `flow` normally catches it first |
| 7 | `await assets.load(scene.bundle)`, raced against the node's abort signal |
| 8 | Aborted: return. Nothing was touched, the old scene is still there |
| 9 | One synchronous block: `setLayers` → `unmount` old → `mount` new → `current` → `time.wake()` → `scenes:changed` |

| Case | Behaviour |
|---|---|
| Node without `scene` | The current scene lives on. A popup stands on the scene under it |
| `over` node | Never switches. After it closes, the node under it is active again on the same scene |
| Abort during the load | The callback returns. A rejection would be a node failure; `flow` handles the abort itself |
| Bundle load fails | The callback rejects. `flow` rolls back, emits `flow:error` and re-enters the rest node, whose scene is still mounted |
| `mount` throws | Same path as a failed load |
| Shared projection in both scenes | Unmounted and mounted again. A diff by name is a later optimisation |
| Fast walk | Transit nodes only record. The switch happens once per rest point, and a headless run really mounts |
| `restore`, rollback, deep link | Same path: the node is entered and the scene is built from the declaration. A restore target that names no scene keeps the current scene, so checkpoints name theirs |
| Headless, plain Bun | Everything runs. Layers are stored, projections mount, entities exist per layer. No pixels, because `renderer` is inert |
| Leaving a scene | `unmount` flushes motions and the despawn queue at once |

A load that fails after the abort is logged with `ctx.log.warn` and never thrown: nobody waits for it any more.

## Static validation of scene ids

`flow` owns it and this plugin contributes nothing. `validateGraph` reads the scene ids from the `scenes` key of the registered feature descriptions, so a node whose `scene` is not among them, and an `over` node that names a scene, join the single `run()` error. It runs only when at least one feature brought a `scenes` key, so a `logicOnly` headless app is not checked. The throw of step 6 and the warning of step 1 are the second line of defence.

## Configuration

None. A scene is data in a feature. A transition effect is V3 work of `anim`, so a key here would have no reader.

## Events

| Event | Payload | When |
|---|---|---|
| `scenes:changed` | `{ from, to, music }` | After the mounts, once per real switch |

`music` is the new scene's key, so `audio` needs no lookup API: it fades the old track out and the new one in straight from the payload. A scene without music carries `undefined`. Nobody answers the event.

## Dependencies

`flow`, `world`, `assets`, `time`. No edge to `renderer`: the layers go through `world.projection`, which `renderer.sync` reads.

| Plugin | Used for |
|---|---|
| `flow` | `onEnter("scene", fn)`, `features.all()` |
| `world` | `projection.setLayers`, `projection.mount`, `projection.unmount` |
| `assets` | `load(bundle)` |
| `time` | `wake()` on a switch, so a scene built while the loop idles is drawn at the full frame rate |

## Lifecycle

`onStart` reads the `scenes` key of every registered feature — a duplicate id throws and names both features — and registers the `onEnter("scene")` callback, keeping its remover. `onStop` runs that remover and forgets the scenes. Nothing is unmounted at stop: a teardown context may not call another plugin's API, and `world.onStop` clears every entity.

## Not in V2

`flow.fx.handle("scene")`: no node needs a switch in the middle of its body. A transition effect between two scenes, and a diff of the projections two scenes share, are later work.
