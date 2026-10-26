import { expectTypeOf } from "vitest";
import { defineGame, Shape, Transform } from "../../../../index";
import { component } from "../../ecs/define";
import { projection } from "../../projection/define";
import type { AnyProjectionSpec, ProjectionSpec } from "../../projection/types";

// ---------------------------------------------------------------------------
// `initialOnly` (F91): every pair is checked against its own component, so a field the component
// does not have is a compile error, through the root helper and through a game's kit.
// ---------------------------------------------------------------------------

type Timer = { id: string; x: number };
type Player = { timers: Timer[] };

const Arc = component("Arc", { sweep: 1, alpha: 1 });

// Bug: the list is typed against one component for every pair, so a second component's field fails.
const marks = projection({
  name: "board.marks",
  layer: "marks",
  from: (player: Player) => player.timers,
  key: timer => timer.id,
  view: timer => [Shape({ kind: "arc", sweep: 1 }), Transform({ x: timer.x })],
  initialOnly: [
    [Shape, ["sweep", "alpha"]],
    [Transform, ["rotation"]]
  ]
});

// Bug: a spec with the option no longer reaches the world's register, which takes the erased form.
expectTypeOf(marks).toExtend<AnyProjectionSpec>();

projection({
  name: "board.arcs",
  layer: "marks",
  from: (player: Player) => player.timers,
  key: timer => timer.id,
  view: () => [Arc()],
  // @ts-expect-error — Arc has no field "swep"
  initialOnly: [[Arc, ["swep"]]]
});

projection({
  name: "board.arcs",
  layer: "marks",
  from: (player: Player) => player.timers,
  key: timer => timer.id,
  view: () => [Arc()],
  initialOnly: [
    [Transform, ["x"]],
    // @ts-expect-error — "rotation" is a field of Transform, not of Arc: each pair checks its own
    [Arc, ["rotation"]]
  ]
});

// The kit of a game binds the same helper: its pairs are checked too.
const kit = defineGame<{
  player: Player;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, never>;
}>();

kit.projection({
  name: "board.marks",
  layer: "marks",
  from: player => player.timers,
  key: timer => timer.id,
  view: () => [Shape({ kind: "arc" })],
  initialOnly: [[Shape, ["sweep"]]]
});

kit.projection({
  name: "board.marks",
  layer: "marks",
  from: player => player.timers,
  // A call the compiler refuses infers no item, so the key names its parameter type here.
  key: (timer: Timer) => timer.id,
  view: () => [Shape({ kind: "arc" })],
  // @ts-expect-error — Shape has no field "swep"
  initialOnly: [[Shape, ["swep"]]]
});

// An annotated spec that names no value types still takes a list, unchecked, as the erased form.
export const annotated: ProjectionSpec<Timer, "marks", never, Player, Record<string, never>> = {
  name: "board.marks",
  layer: "marks",
  from: player => player.timers,
  key: timer => timer.id,
  view: () => [],
  initialOnly: [[Arc, ["sweep"]]]
};
