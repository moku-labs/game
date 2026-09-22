/**
 * @file scenes plugin — the authoring helper. Pure: it turns a declaration into frozen data and
 * does the layer check twice, once in the type and once for a caller that has no types.
 */
import type { LayerSpec } from "../world/types";
import type { AnySceneProjection, LayerMap, SceneDefinition, SceneSpec } from "./types";

/** The second line of both layer errors. */
const FIX_LAYER = "  Declare it in layers or fix the name.";

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
 * Turns the `layers` object into the draw-order list `world.projection.setLayers` takes.
 *
 * @param id - Id of the scene, for the error.
 * @param layers - The layers the scene declared, in the order they were written.
 * @returns One frozen entry per layer, bottom first.
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
 * music. The layer names come from the keys of `layers`, so a projection whose `layer` or `lift`
 * is not among them does not compile — and throws here for a caller without types.
 *
 * @param id - Id of the scene. A node names it with `defineNode({ scene: id })`.
 * @param scene - The bundle, the layers, the projections and the optional music key.
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
 * ```
 */
export function defineScene<
  Layers extends LayerMap,
  const Projections extends readonly AnySceneProjection[]
>(id: string, scene: SceneSpec<Layers, Projections, string, string>): SceneDefinition {
  const layers = layersOf(id, scene.layers);
  const projections: readonly AnySceneProjection[] = scene.projections;

  return Object.freeze({
    id,
    bundle: scene.bundle,
    music: scene.music,
    layers: Object.freeze(layers),
    projections: Object.freeze(namesOf(id, layers, projections))
  });
}
