/**
 * @file effects/filters — the bodies of a scene transition (spec 36). A member of the effect set that carries a
 * transition mark (`set/transition-mark.ts`) and is listed in a feature's `filters` is also the body of a transition
 * kind: once its quad check settled, a warm filter of it is built and handed to `renderer.sync.leave.body` with its
 * kind and export name. The renderer draws the transition's picture on that quad. A game that lists none hands nothing.
 */
import type {
  FilterSlotQuad,
  PixiGpuProgram,
  PixiModule,
  PixiUniformGroup
} from "../../renderer/types";
import { type TransitionMark, transitionMarkOf } from "../set/transition-mark";
import type { EffectsCtx } from "../types";
import { createWarmFilter, quadProgramOf } from "./instance";
import type { FilterDefinition } from "./types";

/** A listed definition that is the body of a transition kind, with its mark. */
type MarkedBody = { readonly definition: FilterDefinition; readonly mark: TransitionMark };

/** A number V8 cannot keep as a small integer: the first store of a field in double form. */
const DOUBLE_SEED = 0.5;

/**
 * Moves the number fields of a uniform group to V8's double form, so a write of a changing number lands in the field in
 * place. The renderer writes the uniforms of a body by name in every frame of a transition (`uniforms.progress = e`),
 * and Pixi's upload reads them by name. A number field in tagged form (what `tagNumbers` gives the values of an
 * instance, for its keyed reads) holds a pointer to a box, and each write of a new double makes a new box: 16 B a
 * frame and uniform. The values are copied to a new object whose fields are added in the reverse order, a shape no
 * instance of the filter has, so what `tagNumbers` did to the shape of the instances stays out of it: the shape, not
 * the object, holds the form. The vectors and every other field are the same ones as before. Once, at hand-over.
 *
 * @param group - The uniform group of the body's warm filter. Its `uniforms` object is replaced.
 */
function holdNumbersAsDoubles(group: PixiUniformGroup): void {
  const held = group.uniforms;
  const names = Object.keys(held).toReversed();
  const fresh: PixiUniformGroup["uniforms"] = {};

  for (const name of names) fresh[name] = typeof held[name] === "number" ? DOUBLE_SEED : held[name];
  for (const name of names) if (typeof held[name] === "number") fresh[name] = held[name];

  group.uniforms = fresh;
}

/** A body of a transition: the quad the renderer draws the picture on, and what frees it. */
export type TransitionBody = {
  readonly quad: FilterSlotQuad;
  destroy(): void;
};

/**
 * Builds the body of a transition from a definition whose quad program compiled: a warm filter of it, its uniform group
 * in double form, and the quad over that group. The renderer writes the group's numbers by name in every frame.
 *
 * @param pixi - The module the renderer loaded.
 * @param definition - The definition of a member that carries a transition mark.
 * @param program - Its quad program.
 * @returns The quad and its teardown.
 */
export function createTransitionBody(
  pixi: PixiModule,
  definition: FilterDefinition,
  program: PixiGpuProgram
): TransitionBody {
  const warm = createWarmFilter(pixi, definition, program);
  const fu = warm.quad?.fu;

  if (fu !== undefined) holdNumbersAsDoubles(fu);

  return { quad: { program, fu }, destroy: warm.destroy };
}

/**
 * Builds a warm filter of each marked body whose quad program compiled and hands it to the renderer, and keeps the
 * take-back and the filter's teardown in `state.removers`. A body whose quad check failed, or that no quad was checked
 * for (WebGL, no device), hands nothing: the renderer plays its kind as a fade. So does a renderer that has no Pixi any
 * more (its context was lost since). The checks of a run that stopped never settle, so a stopped run hands nothing.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param bodies - The listed definitions that carry a transition mark.
 */
function handBodies(ectx: EffectsCtx, bodies: readonly MarkedBody[]): void {
  const pixi = ectx.deps.renderer.host.pixi();

  if (pixi === undefined) return;

  for (const { definition, mark } of bodies) {
    const program = quadProgramOf(ectx, pixi, definition);

    if (program === undefined) continue;

    const body = createTransitionBody(pixi, definition, program);
    const takeBack = ectx.deps.renderer.sync.leave.body(mark.kind, body.quad, mark.member);

    // The renderer lets go of the quad first, then the filter's uniform buffer is freed.
    ectx.state.removers.push(() => {
      takeBack();
      body.destroy();
    });
  }
}

/**
 * Arranges the hand-over of the transition bodies at the start of the plugin: when a registered kind carries a
 * transition mark, the bodies are handed once every shader check of this run answered. Nothing is arranged for a game
 * that lists no marked member.
 *
 * @param ectx - Domain context of the effects plugin.
 */
export function openTransitionBodies(ectx: EffectsCtx): void {
  const { state } = ectx;
  const bodies: MarkedBody[] = [];

  for (const kind of state.kindList) {
    if (kind.source !== "wgsl") continue;

    const mark = transitionMarkOf(kind.definition);

    if (mark !== undefined) bodies.push({ definition: kind.definition, mark });
  }

  if (bodies.length === 0) return;

  state.checks.settled.then(() => handBodies(ectx, bodies));
}
