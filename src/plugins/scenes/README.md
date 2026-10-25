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

Every scene gets `{ name: "ui", sort: "order" }` on top of the layers it declared, so the HUD and the popups always have a place to mount and a game never has to remember the line. A scene that declares `ui` itself keeps the place it wrote it in and gets no second one — that is how a game puts an `fx` layer over the HUD. The layer check runs after the append, so a projection may name `ui` as its `layer` or its `lift` without declaring it, and a name that is neither declared nor `ui` is still rejected, by the compiler and at run time.

```ts
defineScene("board", { bundle: "board", layers: { cells: {}, items: { sort: "y" } }, projections: [hudPanel] }).layers;
// [{ name: "cells", sort: "none" }, { name: "items", sort: "y" }, { name: "ui", sort: "order" }]
```

`sort` left out means `"none"`, except on a layer named `ui`, which sorts by `Order`: the roots of a scene draw there
in the order of its `projections`, and a popup over them. A scene that writes `ui: { sort: "none" }` keeps insertion
order. An integer-like layer name such as `"1"` throws: JavaScript lists integer keys first, so the draw order would not be the one that was written. The result is plain frozen data, so it is a helper and not an API member; `defineGame<Types>()` returns it typed as `DefineScene<AssetKey, BundleKey, Player, Session>`.

## The HUD layer: `{ above: "overlays" }`

A layer that says `above: "overlays"` is the scene's HUD layer: it is drawn above every overlay and is never part of the picture an overlay keeps (renderer, "Overlays and the HUD"). A scene that declares a HUD layer and no `ui` gets `ui` right under the HUD layer, not on top: popups are overlays and draw under the HUD. Layers declared after the HUD layer (a drag layer such as `lifted`) stay above it. The roots of the HUD layer never take the keyboard: Escape and the phone's Back press go to the top sheet under it (ui, "Keyboard focus"). A scene without `above` gives the same list as before.

```ts
defineScene("ward", { bundle: "ui", layers: { scene: {}, hud: { above: "overlays" } }, projections }).layers;
// [{ name: "scene", sort: "none" }, { name: "ui", sort: "order" }, { name: "hud", sort: "none", above: "overlays" }]
```

Three mistakes throw:

```
[game] Scene "ward": two layers say above "overlays" ("hud", "top").
  Keep one HUD layer.
[game] Scene "ward": the layer "ui" comes after the HUD layer "hud".
  Declare ui before it: popups are overlays and draw under the HUD.
[game] Scene "ward": the layer "hud" has above "ui".
  Use "overlays" or leave it out.
```

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
| 10 | Live mode only: `assets.warm` for every name at once, all awaited, raced against the abort. The textures go to the GPU `renderer.uploads` a drawn frame while the old scene is still on screen, so the frame that shows the new scene uploads nothing (F61: on a Galaxy A26 the first switch to a board took one frame of 284 ms with 8 uploads in it). Textures already on the GPU, headless, no device or `uploads: 0` answer at once. A warm that fails is a warning, never a rejection. A fast walk skips this step |
| 11 | Aborted, or the plugin stopped during the warm (a stop answers a waiting upload instead of rejecting it): return. Nothing was touched, the old scene is still there |
| 12 | Live mode, the world running live and a drawing renderer (`renderer.host.ready()`): the scene is built aside, see [The next scene built aside](#the-next-scene-built-aside). It ends in the block of step 13, with `projection.commit()` in the place of `mount` |
| 13 | One synchronous block: `setLayers` → `unmount` what only the old scene lists → `mount` the new scene's list (a projection both list stays, see below) → `current` → `world.ecs.setScene(id)` → `named` → `assets.sceneBundles(named)` → `time.wake()` → `time.sceneChanged()` → `scenes:changed` |

**The scene of the systems.** `world.ecs.setScene(id)` in the block of step 13 tells the world which scene is mounted, so a system with `scenes: ["board"]` runs while the board is mounted, and while it leaves: the world keeps the scene before as leaving until nothing carries `Exiting` any more (world README, "When a system runs"). A failed or aborted switch returns before the block, so the world keeps the old scene.

**The re-read.** At any other node (no target, or the mounted scene: a rest node, a live transit node, an over node) a mounted scene with `bundles` is read again from the committed state. The same list, in the same order: nothing happens. Another list: every name is awaited, then `named` is replaced and `assets.sceneBundles(named)` is told. No mount, no `scenes:changed`, no `time.wake()`, no `time.sceneChanged()`. An abort keeps the old list. A scene without `bundles` is never re-read, and a transit node of a fast walk neither switches nor re-reads.

| Case | Behaviour |
|---|---|
| Node without `scene` | The current scene lives on. A popup stands on the scene under it |
| `over` node | Takes the pending scene, whatever is mounted, and clears the record: a restore at a popup after `expect` builds the scene under it, whether the popup is a rest node or a transit node that waits for its answer. The pending scene is already mounted: nothing is built. Nothing pending: it never switches, and after it closes the node under it is active again on the same scene. An over transit node of a fast walk mounts nothing and keeps the record. A scene recorded by a fast walk at a transit node is taken by an over rest node too |
| Transit node in live mode, no `scene` | Mounts the pending scene and clears the record: a restore at a transit node on a fresh page builds the expected scene. Nothing pending: nothing happens, and no warning |
| Abort during the load | The callback returns. A rejection would be a node failure; `flow` handles the abort itself |
| Bundle load fails | The callback rejects. `flow` rolls back, emits `flow:error` and re-enters the rest node, whose scene is still mounted |
| `mount` throws | Same path as a failed load |
| A `view` throws in the build start of a live switch | Same path: the world drops what the build spawned first, so nothing is mounted |
| Shared projection in both scenes | Stays mounted when both declare its layers alike: the same entities, no exit and no enter, its motions run on, and its screen roots move to their place in the new list. Declared otherwise: unmounted and mounted again ("A projection both scenes list") |
| Fast walk | Transit nodes only record. The switch happens once per rest point, and a headless run really mounts |
| `restore`, rollback, deep link | Same path: the node is entered and the scene is built from the declaration. A restore target that names no scene keeps the current scene, so checkpoints name theirs |
| Restore at a scene with `bundles` | The store holds the bookmark's state before the node's stages run, so the switch reads `bundles` from the restored session: the ward of `ep02` is mounted once `location` and `ep02` are in, before the gate opens, and `ep01` is never fetched. `flow.restore` of a rest node resolves before the stages; `await app.flow.walk([])` returns with the scene standing |
| Safe-node recovery | The recovery edge is committed before the stages. A safe node that keeps the scene re-reads `bundles` from the recovered state and awaits what its `recover` named before the gate opens, without mounting again; one that mounts a scene reads it on the switch path. A `bundles` that throws at the safe node is fatal |
| Headless, plain Bun | Everything runs. Layers are stored, projections mount, entities exist per layer. No pixels, because `renderer` is inert |
| Leaving a scene | `unmount` flushes the motions and the despawn queue of every projection only the old scene lists, at once |

A load that fails after the abort is logged with `ctx.log.warn` and never thrown: nobody waits for it any more.

## The next scene built aside

A live switch with a drawing renderer builds the next scene while the old one stays current, drawn
and alive, and swaps it in one frame (spec 31, F61 S2). What a game sees:

- **The switch ends later.** The steps up to the warm are as before. Then the logic of the coming
  scene (its projections' `view`, the elements and the layout of its JSX) runs in one block, and the
  renderer makes its Pixi views over the next frames, `buildMs` of each frame (4 by default) after
  the live work, off the stage, and draws them once into a small target so their first real frame is
  cheap. On a phone the swap comes some frames later than the old one-block switch did, up to about
  0.15 s after the tap.
- **The old scene stays.** Until the swap `app.scenes.current()` answers the old scene, nothing of
  the new one is drawn, hit, found with `ui.find` or shown by the `ui`, `locate` and `render` doors,
  and its `enter` motions and hooks wait. The projections only the old scene lists keep what they
  showed when the switch began, as in a one-block switch: the state of the next node never reaches
  them, and they leave with the swap. The gate stays closed, as during the bundle wait: the
  first tap after the switch lands on a complete scene.
- **The swap.** The first frame `world.projection.built()` answers true, the `signals` callback of
  the build runs the block of step 13 with `projection.commit()` in the place of `mount`, in the same
  order, and `scenes:changed` is emitted there. The next frame is the swap frame: the old roots play
  their exit, the held enters of the new scene start and every view of it is hung in one block. A
  build with nothing left for `ui` and the renderer (a scene of kept projections only) commits at
  once, inside the switch, with no frame between.
- **The coming bundles are held** from the build start (`assets.sceneComing(named)`), so neither the
  budget nor a `"leave"` release takes them while the old scene is up; `assets.sceneBundles` stays at
  the swap, so the old scene's bundles stay held until its exit is over (F51b).
- **An abort** of the node during the build (a restore, the inbox, a stop of the runner) discards
  it: the world despawns what it made with no motion, the coming list is emptied and the switch
  returns. The current scene, the layers, the scene of the world's systems, the named bundles and
  the mounted projections were never touched. A stop of the plugin drops the frame callback and
  lets the switch return; `world.onStop` clears the rest.
- **One block instead.** A fast walk (a restore, a test walk), a world that runs fast or paused by
  the time the build would start (the restore of a repro enters its checkpoint live and walks its
  route fast), a renderer without a device (headless, a lost device) and a switch where a
  projection both scenes list is declared on other layer rules (the world answers `build` with
  false, see "A projection both scenes list") take the one-block path. The last one is warned in a
  dev build, `scenes:build-skipped` with the scene and its projections. A world that stops running
  live during a build skips its `layout` phase, where `ui` lays the coming scene out: the build is
  discarded and the scene mounted in one block, so a walk that waits for the gate never waits for
  good.

```ts
// A game on a slow phone gives the next scene 3 ms of each frame: the switch takes a frame or two more.
createApp({ plugins: [...screen, boardFeature], pluginConfigs: { scenes: { buildMs: 3 } } });
```

**Tests of a game.** A live-renderer test that steps a fixed number of frames after a switch, or
awaits the gate without stepping frames, sees the switch later: step frames until `scenes:changed`
or the gate opens. "Drawn in the first frame after the switch" reads "drawn in the first frame after
the commit". A headless test and a fast walk keep their timing.

**Known limit.** When a scene stays mounted and the committed state changes what `bundles` names (a restore of another episode while the ward is up), the projections reconcile on `model:committed` before the scene stage awaits the new bundle, so the new art may be missing for the frames of that load (the texture lookup of `assets` warns and loads it). A switch never shows a scene before its bundles are in.

## A projection both scenes list

A projection the leaving scene and the coming scene both list stays mounted when both declare its
`layer`, and its `lift` when it has one, alike: the same `sort`, the same `above`, every field of
the entry the same. A HUD the ward and the board share is not torn down and built again on every
change: its entities keep their ids, its elements play no exit and no enter (a `"mount"` motion
plays only for a view that comes or goes with its screen), its running motions run on, and its keys
answer the same entities. It is not reconciled by the switch either: it follows the commits as it
always does. The container of a layer both scenes declare stays with every view in it. Only its
place is written again, by `mount`. A projection whose layer the coming scene declares otherwise (a
`ui` layer sorted `"none"` on the ward and `"order"` on the board) is unmounted and mounted again,
as before: the renderer sorts a view under the rule of its layer when it builds it, and a kept view
would stand at its old place.

The order rules of a switch, settled with this change:

1. **The list decides the place.** Every projection of the coming scene draws its screen roots at
   `Order` k − n − 1, the k-th of n: −n … −1, in list order. A kept projection takes the place of its
   line in the new list, on its entity and in its rest pose; `ui` gives its root element that `Order`
   in the first layout phase that runs after the switch (one switch made while the world is paused
   lands when it runs again), so its focus ring and its hit test follow.
2. **The layers keep the scene's order.** `setLayers` comes first: a layer both scenes declare keeps
   its container and its views, and the containers stand in the coming scene's draw order.
3. **A layer sorted by `"order"` draws in list order.** The `ui` layer sorts by `Order` unless the
   scene says otherwise, so there the last listed root draws on top and is hit first, kept or not,
   exactly as before.
4. **The keyboard goes to the root listed last.** With no popup open, Escape and the phone's Back
   press go to the last screen root in draw order outside the HUD layer, read by layer and
   `Order`, never by the moment a root was mounted. "The root mounted last" of a game's notes is the
   root listed last: a kept root listed last takes the keyboard, one listed earlier gives it up to
   the root after it.
5. **A layer sorted by `"none"` draws in build order.** There the views draw in the order they were
   built: a kept projection keeps its place, and the views the switch builds come above it. Before
   this change every projection was built again in list order. A scene that needs the list order in
   such a layer sorts it by `"order"`; a world view draws at the `Order` its own view gives it.
6. **The rest is as before.** What only the leaving scene lists is unmounted first, its views
   despawned in the same call with the cause `"mount"`. What only the coming scene lists is mounted
   in list order and reconciled at once, direct, its views coming with the cause `"mount"`.

A label the coming scene spawns shows its string in its first frame (text, "The spawn frame"), so a
HUD that is not shared does not blink either.

## Static validation of scene ids

`flow` owns it and this plugin contributes nothing. `validateGraph` reads the scene ids from the `scenes` key of the registered feature descriptions, so a node whose `scene` is not among them, and an `over` node that names a scene, join the single `run()` error. It runs only when at least one feature brought a `scenes` key, so a `logicOnly` headless app is not checked. The throw of step 7 and the warning of step 1 are the second line of defence.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `buildMs` | `number` | `4` | Milliseconds per frame the next scene's building work may take on a live switch, after the live work: about half a 120 Hz frame. At 60 Hz the build takes a few more frames |

A value that is not a finite number above 0 throws in `onInit`, so `createApp` throws:

```
[game] scenes.buildMs is 0.
  Give the milliseconds a frame may spend on the next scene, a finite number above 0 such as 4.
```

A scene is data in a feature. A transition effect is V3 work of `anim`.

## Events

| Event | Payload | When |
|---|---|---|
| `scenes:changed` | `{ from, to, music }` | After the mounts, once per real switch; at the commit of a scene built aside |

`music` is the new scene's key, so `audio` needs no lookup API: it fades the old track out and the new one in straight from the payload. A scene without music carries `undefined`. Nobody answers the event.

## Dependencies

`flow`, `world`, `assets`, `time`, `model`, `renderer`. The layers go through `world.projection`, which `renderer.sync` reads; `renderer` tells whether it draws, which picks the path of a switch, and keeps the performance log.

| Plugin | Used for |
|---|---|
| `flow` | `onEnter("scene", fn)`, `features.all()` |
| `world` | `projection.setLayers`, `projection.mount` (which keeps a projection a scene before mounted), `projection.unmount` of what only the leaving scene lists; `projection.build`, `built`, `commit`, `discard` for a scene built aside, and `ecs.mode()`, which keeps a build to a world that runs live; `ecs.setScene` of the mounted scene |
| `assets` | `load(bundle)`; `warm(bundle)` before a live switch; `sceneComing(named)` at the start of a build and `sceneComing([])` on its discard; `sceneBundles(named)` after a switch and after a re-read that changed the list, so a bundle the mounted scene names is never a budget victim nor released on `"leave"`, and one the scene before named stays until its elements played their exit |
| `renderer` | `host.ready()`, which picks the path of a live switch; `monitor.event("scene:build", …)` at a build start and `monitor.event("scene", …)` at the swap, with `buildFrames` and `buildMs` for a scene built aside: the performance log of an agent build names the switch |
| `time` | `wake()` on a switch, so a scene built while the loop idles is drawn at the full frame rate; `sceneChanged()`, so the adaptive frame rate judges the new screen on its own frames with its back-off started over; `onFrame("signals", …)` while a build runs, removed at its commit or discard; `agentClock()`, the page clock of a build's `buildMs` in an agent build |
| `model` | `store.snapshot()`, the committed state `bundles` reads |

## Lifecycle

`onInit` checks `buildMs`. `onStart` reads the `scenes` key of every registered feature — a duplicate id throws and names both features — and registers the `onEnter("scene")` callback, keeping its remover. `onStop` runs that remover, drops a running build's frame callback and lets its switch return, and forgets the scenes, the pending scene and the named list. Nothing is unmounted at stop: a teardown context may not call another plugin's API, and `world.onStop` clears every entity and forgets the mounted scene.

## Not in V2

`flow.fx.handle("scene")`: no node needs a switch in the middle of its body. A transition effect between two scenes is later work.
