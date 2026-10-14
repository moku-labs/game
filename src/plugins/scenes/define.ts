/**
 * @file scenes plugin — the authoring helper. Pure: it turns a declaration into frozen data and
 * does the layer check twice, once in the type and once for a caller that has no types.
 */
import type { Json } from "../model/types";
import type { LayerSpec } from "../world/types";
import type {
  AnySceneProjection,
  DefineScene,
  LayerMap,
  SceneDefinition,
  SceneSpec
} from "./types";

/** The second line of both layer errors. */
const FIX_LAYER = "  Declare it in layers or fix the name.";

/** The layer every scene gets on top of its own, where popups and the HUD are mounted. */
const UI_LAYER = "ui";

/**
 * Tells whether a key is an array index, which JavaScript lists before every other key.
 *
 * @param name - The layer name the author wrote.
 * @returns True when the key would be reordered.
 * @example
 * ```ts
 * isIntegerKey("1"); // true
 * isIntegerKey("01"); // false: it keeps the place it was written in
 * ```
 */
function isIntegerKey(name: string): boolean {
  const index = Number(name);

  return Number.isInteger(index) && index >= 0 && String(index) === name;
}

/**
 * Turns the `layers` object into the draw-order list `world.projection.setLayers` takes, with
 * `ui` on top. A scene that declares `ui` itself keeps the place it wrote it in and gets no
 * second one, so the HUD can sit under the layers a game wants over it.
 *
 * @param id - Id of the scene, for the error.
 * @param layers - The layers the scene declared, in the order they were written.
 * @returns One frozen entry per layer, bottom first, `ui` among them.
 * @throws {Error} For an integer-like layer name, whose place JavaScript does not keep.
 */
function layersOf(id: string, layers: LayerMap): LayerSpec[] {
  const list: LayerSpec[] = [];

  for (const [name, spec] of Object.entries(layers)) {
    if (isIntegerKey(name)) {
      throw new Error(
        `[game] Scene "${id}": the layer name "${name}" is an integer.\n` +
          "  Rename it: JavaScript orders integer keys first, so the draw order would not be yours."
      );
    }

    list.push(Object.freeze({ name, sort: spec.sort ?? "none" }));
  }

  if (!list.some(layer => layer.name === UI_LAYER)) {
    list.push(Object.freeze({ name: UI_LAYER, sort: "none" }));
  }

  return list;
}

/**
 * Checks every projection against the layers of the scene and collects their names. It is the
 * same check the type does, for a caller that reaches `defineScene` without types.
 *
 * @param id - Id of the scene, for the error.
 * @param layers - The layers the scene declared.
 * @param projections - The projections the scene mounts.
 * @returns The projection names, in the order they were written.
 * @throws {Error} For a `layer` or a `lift` the scene does not declare.
 */
function namesOf(
  id: string,
  layers: readonly LayerSpec[],
  projections: readonly AnySceneProjection[]
): string[] {
  const declared = new Set(layers.map(layer => layer.name));
  const names: string[] = [];

  for (const spec of projections) {
    if (!declared.has(spec.layer)) {
      throw new Error(
        `[game] Scene "${id}": projection "${spec.name}" names layer "${spec.layer}".\n${FIX_LAYER}`
      );
    }

    if (spec.lift !== undefined && !declared.has(spec.lift)) {
      throw new Error(
        `[game] Scene "${id}": projection "${spec.name}" names lift layer "${spec.lift}".\n${FIX_LAYER}`
      );
    }

    names.push(spec.name);
  }

  return names;
}

/**
 * Declares a scene: a bundle, named layers in draw order, the projections it mounts and optional
 * music. A layer `ui` is appended for the HUD and the popups unless the scene declares one. The
 * layer names come from the keys of `layers` and that `ui`, so a projection whose `layer` or
 * `lift` is not among them does not compile — and throws here for a caller without types.
 * `bundles` names bundles that depend on the committed state: the scene is mounted once those
 * are in too.
 *
 * @param id - Id of the scene. A node names it with `defineNode({ scene: id })`.
 * @param scene - The bundle, the optional bundles of state, the layers, the projections and the
 *   optional music key.
 * @returns The scene as frozen data, ready for the `scenes` key of a feature.
 * @throws {Error} For an integer-like layer name, and for a `layer` or `lift` that is not declared.
 * @example
 * ```ts
 * // features/board/view/scene.ts of a game.
 * export const boardScene = defineScene("board", {
 *   bundle: "board",
 *   layers: { background: {}, cells: {}, items: { sort: "y" }, lifted: {} },
 *   projections: [boardCells, boardItems]
 * });
 *
 * boardScene.layers[2]; // { name: "items", sort: "y" }
 * boardScene.layers[4]; // { name: "ui", sort: "none" }, appended for the HUD
 *
 * // features/location/view/ward.ts: the room is the art of the episode the session plays.
 * export const wardScene = defineScene("ward", {
 *   bundle: "location",
 *   bundles: ({ session }) => [session.episode], // "ep01" | "ep02": bundle keys of the game
 *   layers: { room: {}, glow: {} },
 *   projections: [wardRoom, wardGlows]
 * });
 * wardScene.bundles?.({ player: {}, session: { episode: "ep02" } }); // ["ep02"]
 * ```
 */
export function defineScene<
  Layers extends LayerMap,
  const Projections extends readonly AnySceneProjection[],
  Player extends Json = Json,
  Session extends Json = Json
>(
  id: string,
  scene: SceneSpec<Layers, Projections, string, string, Player, Session>
): SceneDefinition {
  const layers = layersOf(id, scene.layers);
  const projections: readonly AnySceneProjection[] = scene.projections;

  return Object.freeze({
    id,
    bundle: scene.bundle,
    music: scene.music,
    layers: Object.freeze(layers),
    projections: Object.freeze(namesOf(id, layers, projections)),
    ...(scene.bundles === undefined ? {} : { bundles: scene.bundles })
  });
}

/**
 * Binds `defineScene` to one game's asset and bundle keys and to its `Player` and `Session`.
 * Type-only: the same function.
 *
 * @returns `{ defineScene }` whose `bundle`, `bundles` and textures are checked by the compiler.
 * @example
 * ```ts
 * const { defineScene } = scenesFor<"board.cell", "board" | "ep01", Player, { episode: "ep01" }>();
 * defineScene("ward", {
 *   bundle: "board",
 *   bundles: ({ session }) => [session.episode],
 *   layers: { items: {} },
 *   projections: []
 * }).id; // "ward"
 * ```
 */
export function scenesFor<
  Asset extends string,
  Bundle extends string,
  Player extends Json = Json,
  Session extends Json = Json
>(): {
  defineScene: DefineScene<Asset, Bundle, Player, Session>;
} {
  return { defineScene };
}
