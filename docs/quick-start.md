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

**4. Define the game.** `index.ts` is the whole game as one data object. `defineGameApp` creates no app: the page and the tests do, with `game.screen()` and `game.headless()`. The graph is run by the page or the test, never by the game.

```ts
// index.ts
import { defineGameApp } from "@moku-labs/game/app";
import { mainFlow } from "./flow";

export default defineGameApp({
  flow: mainFlow,
  safeNode: "home",
  player: { coins: 0, lastRoll: 0 },
  session: { rolls: 0 }
});
```

A hook that throws never stops the game. The engine writes it to the log as the error entry `"game: a hook failed"`; read it with `app.log.trace()`.

**5. Name the page.** `config.ts` is plain data: the page, and later the native app, the system plugins and the save. Every field but the title has a default.

```ts
// config.ts
import type { GameConfig } from "@moku-labs/game/app";

export default {
  page: { title: "Dice", background: "#10161d" }
} satisfies GameConfig;
```

**6. Play it headless.** `game.headless()` makes the logic app, not started, on a fake clock and an in-memory save. `createHeadless` starts it and resolves once the graph rests at its first rest node. Its `walk` method plays a route.

```ts
// game.test.ts
import type { Flow } from "@moku-labs/game";
import { createHeadless } from "@moku-labs/game/testing";
import { expect, it } from "vitest";
import game from "./index";

const rollOnce: Flow.RouteStep = { at: "home", intent: "roll" };

it("plays two rolls and a reset without a screen", async () => {
  const { app } = game.headless();
  const run = await createHeadless(app);

  const state = await run.walk([rollOnce, rollOnce]);

  expect(state.path).toBe("home");
  expect(app.model.store.snapshot().session).toEqual({ rolls: 2 });

  await run.walk([{ at: "home", intent: "reset" }]);

  expect(app.model.store.snapshot().player).toMatchObject({ coins: 0 });

  await run.stop();
});
```

In a live game the same answer comes from the screen: `app.flow.gate.answer({ intent: "roll" })`.

**7. Serve it.** The engine bin `moku-game` serves the folder with hot reload. Add the scripts and ignore what it writes:

```json
{
  "scripts": {
    "dev": "moku-game dev",
    "build": "moku-game build"
  }
}
```

```sh
echo ".moku/" >> .gitignore
bun run dev     # http://localhost:3000/
bun run build   # the production page in dist/web
```

The page, the save kinds, `?player=` scenarios, the system plugins and the native build are in [The game shell](./shell.md).

> [!TIP]
> Types reach a game through one namespace per plugin: `import type { Flow, Model, Clock, Lifecycle, Time } from "@moku-labs/game"`, then `Flow.RouteStep`, `Model.PlayerStateProvider`, `Time.Phase`. The screen and interface plugins follow the same rule: `World`, `Renderer`, `Input`, `Assets`, `Scenes`, `Anim`, `I18n`, `TextTypes`, `Ui`, `Audio`, `Effects`, `Platform`. `Text` is the component, so its type namespace is `TextTypes`.

> [!TIP]
> A larger worked example is the merge game in [moku-labs/demos](https://github.com/moku-labs/demos). It is written on the public API only, with sub-flows, a slot, features, timers and its own e2e and visual tests. The engine keeps a small fixture of its own, [`tests/fixtures/mini-game/`](../tests/fixtures/mini-game): one rest node, one popup flow and two features. It is not published.

## A screen: the body font and the asset keys

A game with a screen keeps its files in `features/<feature>/assets/`. The scanner of `@moku-labs/game/assets` turns them into typed keys, the feature name, a dot, then the path inside `assets/`. `moku-game keys` runs it on the game folder: it writes `generated/assets.ts`, the compiled strings and the dev manifest `generated/manifest.json`. `moku-game keys --check` fails when an output is out of date, and `moku-game pack` writes the production build into `dist/assets`.

A game on the layered layout names its layers in `config.ts`, `assets: { layers: { shared: "ui" } }`, so `shared/assets/*` keeps the `ui.*` keys.

The package also ships one MSDF body font, Pangolin Regular under the SIL Open Font License 1.1. Copy it into the game, do not reference it: the scanner reads keys only from `features/<feature>/assets/` and from the layers. The licence goes next to `assets/`, not inside it.

```bash
mkdir -p features/ui/assets
cp node_modules/@moku-labs/game/fonts/font-body.* features/ui/assets/
cp node_modules/@moku-labs/game/fonts/LICENSE.txt features/ui/LICENSE-fonts.txt
bunx moku-game keys
```

The font gets the key `ui.font-body`. That is the default of `text` config `fonts.body`, so the built-in style `body` works with no config.

The bin `moku-game-assets` is the scanner on its own, for a game without `config.ts`. It takes the same flags: `--root`, `--keys`, `--manifest`, `--layer`, `--check`, `--pack <dir>`.

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
