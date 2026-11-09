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

// ---------------------------------------------------------------------------
// F159: a pair's third element, `when`, is a predicate on the item, typed from `from`. The field
// checks of F91 hold next to it, through the root helper and through a game's kit.
// ---------------------------------------------------------------------------

type Part = { id: string; role: "bolt" | "restHand"; x: number };
type Clock = { parts: Part[] };

// Bug: `when` gets `unknown` or `any` for its item, so a game cannot read a field, or reads a wrong one unchecked.
const hands = projection({
  name: "board.clock",
  layer: "marks",
  from: (player: Clock) => player.parts,
  key: part => part.id,
  view: part => [Transform({ x: part.x })],
  initialOnly: [
    [Shape, ["sweep"]],
    [
      Transform,
      ["rotation"],
      part => {
        expectTypeOf(part).toEqualTypeOf<Part>();

        return part.role === "restHand";
      }
    ]
  ]
});

// Bug: a spec with a `when` no longer reaches the world's register, which takes the erased form.
expectTypeOf(hands).toExtend<AnyProjectionSpec>();

projection({
  name: "board.clock",
  layer: "marks",
  from: (player: Clock) => player.parts,
  key: (part: Part) => part.id,
  view: () => [Transform()],
  // @ts-expect-error — Transform has no field "rotatoin", with a `when` as without one
  initialOnly: [[Transform, ["rotatoin"], part => part.role === "restHand"]]
});

projection({
  name: "board.clock",
  layer: "marks",
  from: (player: Clock) => player.parts,
  key: part => part.id,
  view: () => [Transform()],
  // @ts-expect-error — a Part has no field "kind": `when` reads the item `from` gives
  initialOnly: [[Transform, ["rotation"], part => part.kind === "hand"]]
});

projection({
  name: "board.clock",
  layer: "marks",
  from: (player: Clock) => player.parts,
  key: (part: Part) => part.id,
  view: () => [Transform()],
  initialOnly: [
    [Transform, ["x"]],
    // @ts-expect-error — "rotation" is a field of Transform, not of Arc, also in a pair with a `when`
    [Arc, ["rotation"], part => part.role === "restHand"]
  ]
});

// The kit of a game binds the same helper: the item of `when` is the game's, and the pairs are checked.
const clockKit = defineGame<{
  player: Clock;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, never>;
}>();

const kitHands = clockKit.projection({
  name: "board.clock",
  layer: "marks",
  from: player => player.parts,
  key: part => part.id,
  view: () => [Transform()],
  initialOnly: [
    [
      Transform,
      ["rotation"],
      part => {
        expectTypeOf(part).toEqualTypeOf<Part>();

        return part.role === "restHand";
      }
    ]
  ]
});

expectTypeOf(kitHands).toExtend<AnyProjectionSpec>();

clockKit.projection({
  name: "board.clock",
  layer: "marks",
  from: player => player.parts,
  key: (part: Part) => part.id,
  view: () => [Transform()],
  // @ts-expect-error — Transform has no field "rotatoin"
  initialOnly: [[Transform, ["rotatoin"], part => part.role === "restHand"]]
});

clockKit.projection({
  name: "board.clock",
  layer: "marks",
  from: player => player.parts,
  key: part => part.id,
  view: () => [Transform()],
  // @ts-expect-error — a Part has no field "kind"
  initialOnly: [[Transform, ["rotation"], part => part.kind === "hand"]]
});

clockKit.projection({
  name: "board.clock",
  layer: "marks",
  from: player => player.parts,
  key: (part: Part) => part.id,
  view: () => [Transform()],
  initialOnly: [
    [Transform, ["x"]],
    // @ts-expect-error — "rotation" is a field of Transform, not of Arc
    [Arc, ["rotation"], part => part.role === "restHand"]
  ]
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
