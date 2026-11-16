/**
 * @file flow plugin — the child abort signal that the effects gateway and the `fx` of a node
 * context both derive. A plugin-root helper: the `fx` and `runner` modules may not import each
 * other's run-time code, and both need this one.
 */

/**
 * Derives a signal that ends with its parent or earlier on its own: a child of the node's signal
 * that the gateway, or the `fx` of a node context, can end by itself. The parent's abort reaches
 * the child with its reason; what the child does never reaches the parent. The forwarding
 * listener is dropped with the child, so a node that shows many popups leaves nothing behind on
 * its signal once they ended.
 *
 * @param signal - The parent signal, the node's or one derived from it.
 * @returns The controller of the child signal.
 * @example
 * ```ts
 * childOf(AbortSignal.abort("restore")).signal.reason; // "restore": born aborted, like its parent
 * ```
 */
export function childOf(signal: AbortSignal): AbortController {
  const child = new AbortController();

  if (signal.aborted) {
    child.abort(signal.reason);

    return child;
  }

  signal.addEventListener(
    "abort",
    () => {
      child.abort(signal.reason);
    },
    { once: true, signal: child.signal }
  );

  return child;
}
