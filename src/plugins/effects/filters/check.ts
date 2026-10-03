/**
 * @file effects/filters — the dev WGSL check. One bad shader blanks the whole frame and only
 * Chrome's console says why (P10), so in a dev build a kind with its own WGSL is compiled once
 * through the renderer's device before its first instance; an error is logged with its line and
 * column and the kind never gets an instance. A production build never asks the device.
 */
import { isDev } from "../../flow/doors/dev";
import type { EffectsCtx } from "../types";
import type { FilterKind } from "./types";

/** Where the check of one kind stands. */
type CheckStatus = "pending" | "ok" | "broken";

/**
 * Takes the compilation messages of one kind: every error is one log line, and one error breaks
 * the kind. A check the teardown dropped meanwhile is ignored.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param id - The kind id.
 * @param messages - What the compiler said.
 */
function settle(ectx: EffectsCtx, id: string, messages: readonly GPUCompilationMessage[]): void {
  const { state } = ectx;

  if (state.checks.get(id) !== "pending") return;

  const errors = messages.filter(message => message.type === "error");

  for (const error of errors) {
    ectx.log.error("effects:wgsl", {
      filter: id,
      line: error.lineNum,
      column: error.linePos,
      message: error.message
    });
  }

  if (errors.length === 0) {
    state.checks.set(id, "ok");

    return;
  }

  state.checks.delete(id);
  state.broken.add(id);
}

/**
 * Where the WGSL check of a kind stands, starting it on the first ask. A Pixi-core kind and every
 * kind in a production build are `"ok"` at once; with no device (inert, lost) the kind is `"ok"`
 * and never checked again; otherwise it is `"pending"` until `getCompilationInfo()` resolves. A
 * check that cannot read its info counts as `"ok"`.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param kind - The registered kind.
 * @returns `"pending"`, `"ok"` or `"broken"`.
 */
export function checkWgsl(ectx: EffectsCtx, kind: FilterKind): CheckStatus {
  const { state } = ectx;

  if (state.broken.has(kind.id)) return "broken";
  if (kind.source === "core") return "ok";

  const known = state.checks.get(kind.id);

  if (known !== undefined) return known;

  const device = isDev() ? ectx.deps.renderer.host.device() : undefined;

  if (device === undefined) {
    state.checks.set(kind.id, "ok");

    return "ok";
  }

  state.checks.set(kind.id, "pending");
  device
    .createShaderModule({ code: kind.definition.source })
    .getCompilationInfo()
    .then(
      info => settle(ectx, kind.id, info.messages),
      () => settle(ectx, kind.id, [])
    );

  return "pending";
}
