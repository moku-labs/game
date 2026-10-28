import { expectTypeOf } from "vitest";
import type { SceneSwitch as GameSceneSwitch, World } from "../../../../index";
import type { Json } from "../../../model/types";
import { projection } from "../../projection/define";
import type {
  AnyProjectionSpec,
  ProjectionApi,
  ProjectionSpec,
  SceneSwitch
} from "../../projection/types";

type Player = { coins: number };
type Session = { sheet?: string };
type Coins = { coins: number };

// A game reads the switch from the root and from the `World` namespace: the one type of the world.
expectTypeOf<GameSceneSwitch>().toEqualTypeOf<SceneSwitch>();
expectTypeOf<World.SceneSwitch>().toEqualTypeOf<SceneSwitch>();

// A `from` with two parameters, as every game wrote it before the switch, is still a `from`: of a typed spec, of the
// helper and of the spec the world stores.
const typed: ProjectionSpec<Coins, "ui", never, Player, Session> = {
  name: "board.coins",
  layer: "ui",
  from: (player: Player, _session: Session) => ({ coins: player.coins }),
  view: () => []
};
const helper = projection({
  name: "board.coins",
  layer: "ui",
  from: (player: Player, _session: Session) => ({ coins: player.coins }),
  view: coins => {
    expectTypeOf(coins).toEqualTypeOf<Coins>();

    return [];
  }
});
const stored: AnyProjectionSpec["from"] = (_player: Json, _session: Json) => [];

expectTypeOf(typed.layer).toEqualTypeOf<"ui">();
expectTypeOf(helper.layer).toEqualTypeOf<"ui">();
expectTypeOf(stored).returns.toEqualTypeOf<unknown>();

// A `from` with three parameters gets the switch last fed, or `undefined` for a projection never fed.
projection({
  name: "screens.loading",
  layer: "veil",
  from: (_player: Player, _session: Session, sw) => {
    expectTypeOf(sw).toEqualTypeOf<SceneSwitch | undefined>();

    return { to: sw?.to ?? "", progress: sw?.progress ?? 0 };
  },
  view: loader => {
    expectTypeOf(loader).toEqualTypeOf<{ to: string; progress: number }>();

    return [];
  }
});

projection({
  name: "screens.loading",
  layer: "veil",
  // @ts-expect-error — the switch is `undefined` until something feeds the projection
  from: (_player: Player, _session: Session, sw) => ({ to: sw.to }),
  view: () => []
});

declare const projectionApi: ProjectionApi;

projectionApi.feed("screens.loading", { from: "ward", to: "board", progress: 0.5 });

// @ts-expect-error — a switch carries its progress
projectionApi.feed("screens.loading", { from: "ward", to: "board" });
