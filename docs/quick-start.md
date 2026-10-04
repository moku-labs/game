# Quick start

The full dice game, step by step. The short version is in the [README](../README.md#quick-start).

A tiny dice game: one rest node, two transit nodes, one flow.

**1. Bind the helpers to the types of the game.** `defineNode` and `defineFlow` come from `defineGame`. They are not root exports.

```ts
// state.ts
import { defineGame } from "@moku-labs/game";

export type Player = { coins: number; lastRoll: number };
export type Session = { rolls: number };

export const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();
```

**2. Write the nodes.** A rest node without a body is a pure wait. The intent of the answer names the outcome.

```ts
// nodes.ts
import { type } from "@moku-labs/game";
import { defineNode } from "./state";

export const home = defineNode({
  outcomes: { roll: type(), reset: type() },
  rest: true,
  checkpoint: true
});

export const roll = defineNode({
  outcomes: { done: type() },
  run: ({ player, session, rng, out }) => {
    const face = rng.stream("dice").range(1, 6);

    player.coins += face;
    player.lastRoll = face;
    session.rolls += 1;
    return out.done();
  }
});

export const reset = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.coins = 0;
    return out.done();
  }
});
```

**3. Wire the flow.** The edge table is checked by the compiler. A missing edge or an unknown target is a compile error with a sentence.

```ts
// flow.ts
import { defineFlow } from "./state";
import { home, reset, roll } from "./nodes";

export const mainFlow = defineFlow("main", {
  nodes: { home, roll, reset },
  start: "home",
  edges: {
    home: { roll: "roll", reset: "reset" },
    roll: { done: "home" },
    reset: { done: "home" }
  }
});
```

**4. Create the app.** The graph is started by the game, never by the plugin.

```ts
// game.ts
import { createApp } from "@moku-labs/game";
import { mainFlow } from "./flow";

export const createGame = (seed: "from-save" | number = "from-save") =>
  createApp({
    pluginConfigs: {
      model: { initialPlayer: { coins: 0, lastRoll: 0 }, initialSession: { rolls: 0 }, seed },
      flow: { mainFlow, safeNode: "home" }
    },
    onStart: ctx => {
      ctx.flow.run().catch((error: unknown) => {
        ctx.log.error("game: the graph failed", { error });
      });
    }
  });
```

A hook that throws never stops the game. The engine writes it to the log as the error entry `"game: a hook failed"`; read it with `app.log.trace()`. A game can add its own `onError: (error, ctx) => …` to `createApp`; the kernel calls both.

**5. Play it headless.** `createHeadless` returns a game object once the graph rests at its first
rest node. Its `walk` method plays a route.

```ts
// game.test.ts
import type { Flow } from "@moku-labs/game";
import { createHeadless } from "@moku-labs/game/testing";
import { expect, it } from "vitest";
import { createGame } from "./game";

const rollOnce: Flow.RouteStep = { at: "home", intent: "roll" };

it("plays two rolls and a reset without a screen", async () => {
  const app = createGame(42);
  const game = await createHeadless(app);

  const state = await game.walk([rollOnce, rollOnce]);

  expect(state.path).toBe("home");
  expect(app.model.store.snapshot().session).toEqual({ rolls: 2 });

  await game.walk([{ at: "home", intent: "reset" }]);

  expect(app.model.store.snapshot().player).toMatchObject({ coins: 0 });

  await game.stop();
});
```

In a live game the same answer comes from the screen: `app.flow.gate.answer({ intent: "roll" })`.

> [!TIP]
> Types reach a game through one namespace per plugin: `import type { Flow, Model, Clock, Lifecycle, Time } from "@moku-labs/game"`, then `Flow.RouteStep`, `Model.PlayerStateProvider`, `Time.Phase`. The screen and interface plugins follow the same rule: `World`, `Renderer`, `Input`, `Assets`, `Scenes`, `Anim`, `I18n`, `TextTypes`, `Ui`, `Audio`, `Effects`, `Platform`. `Text` is the component, so its type namespace is `TextTypes`.

> [!TIP]
> A larger worked example lives in [`tests/integration/merge-game/`](../tests/integration/merge-game). It is a small game written on the public API only, with sub-flows, a slot, a feature and timers. It is an internal test fixture and is not published. Its scenario is [`tests/integration/template-merge.test.ts`](../tests/integration/template-merge.test.ts).

## A screen: the body font and the asset keys

A game with a screen keeps its files in `src/features/<feature>/assets/`. The scanner of `@moku-labs/game/assets` turns them into typed keys, the feature name, a dot, then the path inside `assets/`. The package ships it as the bin `moku-game-assets`. It runs under bun; with node only, run `bun node_modules/@moku-labs/game/dist/assets.mjs`. Add the script to the game's `package.json`:

```json
{
  "scripts": {
    "assets:keys": "moku-game-assets --root src --manifest public/assets/manifest.json --keys src/generated/assets.ts"
  }
}
```

The same bin takes `--check`, which fails when an output is out of date, and `--pack <dir>` for the production build.

The package also ships one MSDF body font, Pangolin Regular under the SIL Open Font License 1.1. Copy it into the game, do not reference it: the scanner reads keys only from `features/<feature>/assets/`. The licence goes next to `assets/`, not inside it.

```bash
mkdir -p src/features/ui/assets
cp node_modules/@moku-labs/game/fonts/font-body.* src/features/ui/assets/
cp node_modules/@moku-labs/game/fonts/LICENSE.txt src/features/ui/LICENSE-fonts.txt
bun run assets:keys
```

The font gets the key `ui.font-body`. That is the default of `text` config `fonts.body`, so the built-in style `body` works with no config.

## The contract

Every term of the graph, in full.

| Term | Meaning |
|---|---|
| Node | `defineNode({ input?, outcomes, run })`. The body gets one context object and returns `out.name(data)`. |
| Node context | `{ input, player, session, rng, fx, out, signal, now }`. `player` and `session` are drafts. `now` is `clock.now()` read once at node entry. |
| Rest node | `rest: true`. The graph waits here. Without `run` it is a pure wait for a gate answer or an inbox event. Entering it marks a rest point. |
| `checkpoint` | A rest node where the journal is compacted. `safeNode` points at one. |
| `barrier` | After the edge of this node the save is written durably with `commitDurable`. Rollback cannot cross it. Every edge of a barrier node leads to a rest node of the same flow. |
| `over` | The node waits while a pointer is down, so a popup never appears in the middle of a drag. |
| `inbox` | Outcome names of a rest node that a world event of the same type may produce. |
| Flow | `defineFlow(id, { nodes, start, edges, input?, outcomes? })`. A flow with `outcomes` is used as a node of another flow. |
| Edge target | A node name, `exit("outcome")` to leave a sub-flow, or `to("node", payload => input)` to adapt the payload. |
| Slot | `slot("name")`. An extension point. Features contribute sub-flows to it with an `order`. |
| Feature | `defineFeature(name, { nodes?, flows?, contribute? })`. An ordinary plugin that registers into `flow.features`. `feature.logicOnly` is the headless twin. |
| Effect | `await fx(descriptor)` for awaited effects, `fx.emit(hint(kind, payload))` for cosmetic ones. Hints are released after the commit and dropped in fast mode. |
| Transition | Rest node to rest node. It is a transaction. An error rolls back to the last rest point, retries, then enters `safeNode`. |
