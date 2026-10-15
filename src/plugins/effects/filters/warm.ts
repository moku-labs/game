/**
 * @file effects/filters — the warm hooks for spec 27: when every shader check answered, and what may be warmed. The
 * list holds exactly the definitions an instance can draw (`stages` is static) and none that failed its check; the
 * probes themselves are built with `createWarmFilter` of `instance.ts`.
 */
import type { EffectsCtx } from "../types";
import { kindStatus } from "./check";
import type { FilterDefinition } from "./types";

/** One definition the warm-up may draw, the role it plays and the kind it belongs to. */
type WarmEntry = {
  definition: FilterDefinition;
  role: "kind" | "stage" | "fallback";
  kind: string;
};

/**
 * Resolves once every definition's shader check answered on the running backend: after the checks started (the first
 * drawn frame, or the first node entry) and the last one answered. While nothing draws it does not resolve.
 *
 * @param ectx - Domain context of the effects plugin.
 * @returns The promise of this run's checks.
 */
export function checksSettled(ectx: EffectsCtx): Promise<void> {
  return ectx.state.checks.settled;
}

/**
 * Lists every definition a kind can draw whose check answered ok, each once, in check order: the main body of every
 * ready kind, every stage of its inputs, every checked fallback (the fallback of a kind that is not broken too: it
 * must be warm before the day it is needed).
 *
 * @param ectx - Domain context of the effects plugin.
 * @returns The definitions with their role and kind id.
 */
export function warmDefinitions(ectx: EffectsCtx): readonly WarmEntry[] {
  const { checks } = ectx.state;
  const seen = new Set<FilterDefinition>();
  const list: WarmEntry[] = [];
  const add = (definition: FilterDefinition, role: WarmEntry["role"], kind: string): void => {
    if (seen.has(definition) || checks.status.get(definition) !== "ok") return;

    seen.add(definition);
    list.push({ definition, role, kind });
  };

  for (const kind of ectx.state.kinds.values()) {
    if (kind.source !== "wgsl") continue;

    if (kindStatus(ectx, kind) === "ok") {
      add(kind.definition, "kind", kind.id);

      for (const input of kind.definition.inputs) {
        for (const stage of input.stages) add(stage.filter, "stage", kind.id);
      }
    }

    if (kind.definition.fallback !== undefined) add(kind.definition.fallback, "fallback", kind.id);
  }

  return list;
}
