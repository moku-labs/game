/**
 * @file flow/inbox — API factory skeleton.
 */
import type { FlowCtx } from "../types";
import type { InboxApi, InboxInternal } from "./types";

/**
 * Creates the inbox API: `post` queues a world event, duplicates of one `type` collapse to the
 * latest; the internal `take` removes the first event a rest node accepts and `onPost` tells the
 * runner that something arrived.
 *
 * @param _ctx - Domain context of the flow plugin.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const inbox = createInboxApi(ctx);
 * inbox.post({ type: "elapsed", payload: { now: 1000 } });
 * ```
 */
export function createInboxApi(_ctx: FlowCtx): InboxApi & InboxInternal {
  throw new Error("not implemented");
}
