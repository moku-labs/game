import type { Log } from "@moku-labs/common/browser";
import { describe, expect, it, vi } from "vitest";
import type { Descriptor } from "../../fx/types";
import { nodeFx } from "../../runner/node";
import type { Modules } from "../../runner/types";

// ---------------------------------------------------------------------------
// Unit (F206): `fx.cancel` of the node context refuses what is not an open effect of its node.
// ---------------------------------------------------------------------------

const notice: Descriptor = { kind: "popup", answers: ["ok"] };

/**
 * The `fx` of one node run over modules whose effects never end on their own.
 *
 * @param signal - The node's abort signal.
 * @returns The `fx`, the gate's `close` and the signals `fx.run` got.
 */
const fxOf = (signal: AbortSignal) => {
  const close = vi.fn();
  const signals: AbortSignal[] = [];
  const modules = {
    fx: {
      run: (_descriptor: Descriptor, given: AbortSignal) => {
        signals.push(given);

        return new Promise<never>(() => undefined);
      }
    },
    gate: { close, narrow: vi.fn() }
  } as unknown as Modules;
  const log = { error: vi.fn() } as unknown as Log.LogApi;
  const fx = nodeFx(modules, { signal, gateOpened: () => undefined, path: "ask", log });

  return { fx, close, signals };
};

describe("fx.cancel of a node context", () => {
  it("returns false for a promise its fx did not return, and touches nothing", () => {
    const own = fxOf(new AbortController().signal);
    const other = fxOf(new AbortController().signal);
    const foreign = other.fx(notice);

    own.fx(notice);

    expect(own.fx.cancel(Promise.resolve())).toBe(false);
    expect(own.fx.cancel(foreign)).toBe(false);
    expect(own.close).not.toHaveBeenCalled();
    expect(own.signals[0]?.aborted).toBe(false);
    expect(other.signals[0]?.aborted).toBe(false);
  });

  it("returns false after the abort of its node, and does not close the gate", () => {
    const node = new AbortController();
    const { fx, close, signals } = fxOf(node.signal);
    const popup = fx(notice);

    node.abort("inbox");

    expect(fx.cancel(popup)).toBe(false);
    expect(close).not.toHaveBeenCalled();
    // The abort of the node reached the effect with its reason.
    expect(signals[0]?.reason).toBe("inbox");
  });

  it("returns false for an effect that settled, and leaves its signal alone", async () => {
    const signals: AbortSignal[] = [];
    const modules = {
      fx: {
        run: (_descriptor: Descriptor, given: AbortSignal) => {
          signals.push(given);

          return Promise.resolve("dealt");
        }
      },
      gate: { close: vi.fn(), narrow: vi.fn() }
    } as unknown as Modules;
    const log = { error: vi.fn() } as unknown as Log.LogApi;
    const fx = nodeFx(modules, {
      signal: new AbortController().signal,
      gateOpened: () => undefined,
      path: "ask",
      log
    });
    const deal = fx({ kind: "deal" });

    await expect(deal).resolves.toBe("dealt");
    expect(fx.cancel(deal)).toBe(false);
    expect(signals[0]?.aborted).toBe(false);
  });

  it("closes the gate for a popup, not for an effect without answers", () => {
    const { fx, close, signals } = fxOf(new AbortController().signal);
    const deal = fx({ kind: "deal" });
    const popup = fx(notice);

    expect(fx.cancel(deal)).toBe(true);
    expect(close).not.toHaveBeenCalled();
    expect(fx.cancel(popup)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(signals.map(signal => signal.aborted)).toEqual([true, true]);
  });
});
