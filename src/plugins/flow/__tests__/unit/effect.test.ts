import { describe, expect, it, vi } from "vitest";
import { defineEffect } from "../../fx/effect";
import type { FxApi, FxHandler } from "../../fx/types";

/** What the stub gateway recorded for one `fx.handle` call. */
type Registration = {
  kind: string;
  handler: FxHandler;
  options: { runInFast?: boolean } | undefined;
};

/**
 * A gateway that records every registration and hands back one remover per call.
 *
 * @returns The stub `FxApi`, its registrations and the removers it returned.
 */
function stubFx(): { fx: FxApi; registered: Registration[]; removers: Array<() => void> } {
  const registered: Registration[] = [];
  const removers: Array<() => void> = [];
  const fx: FxApi = {
    handle: (kind, handler, options) => {
      const remove = vi.fn();

      registered.push({ kind, handler, options });
      removers.push(remove);

      return remove;
    },
    dispatch: vi.fn(),
    onHint: vi.fn(() => vi.fn())
  };

  return { fx, registered, removers };
}

describe("defineEffect: the descriptor", () => {
  it("carries the payload, and no payload key for a void effect", () => {
    const envRead = defineEffect<{ notice: boolean }, { reducedMotion: boolean }>("view-env.read", {
      fast: "run"
    });
    const ping = defineEffect<void, number>("view-env.ping");

    expect(envRead({ notice: true })).toEqual({
      kind: "view-env.read",
      payload: { notice: true }
    });
    expect(Object.keys(ping())).toEqual(["kind"]);
    expect(ping.kind).toBe("view-env.ping");
  });

  it("marks the descriptor cosmetic for a cosmetic declaration, and not otherwise", () => {
    const confetti = defineEffect<{ cell: string }, void>("board.confetti", { cosmetic: true });
    const save = defineEffect<{ slot: number }, boolean>("save.write", { fast: "skip" });

    expect(confetti({ cell: "c3" })).toEqual({
      kind: "board.confetti",
      payload: { cell: "c3" },
      cosmetic: true
    });
    expect(Object.hasOwn(save({ slot: 1 }), "cosmetic")).toBe(false);
  });
});

describe("defineEffect: handle", () => {
  it("registers the handler with runInFast for fast: run and without it otherwise", () => {
    const { fx, registered } = stubFx();
    const fastRead = defineEffect<void, number>("read.fast", { fast: "run" });
    const liveRead = defineEffect<void, number>("read.live");

    fastRead.handle(fx, () => 1);
    liveRead.handle(fx, () => 2);

    expect(registered.map(({ kind, options }) => ({ kind, options }))).toEqual([
      { kind: "read.fast", options: { runInFast: true } },
      { kind: "read.live", options: { runInFast: false } }
    ]);
  });

  it("hands the handler the payload, not the descriptor, and the gateway's context", async () => {
    const { fx, registered } = stubFx();
    const envRead = defineEffect<{ notice: boolean }, { notice: boolean }>("view-env.read", {
      fast: "run"
    });
    const handler = vi.fn((payload: { notice: boolean }) => ({ notice: !payload.notice }));
    const context = { signal: new AbortController().signal, mode: "fast" as const };

    envRead.handle(fx, handler);

    const answer = await registered[0]?.handler(envRead({ notice: true }), context);

    expect(handler).toHaveBeenCalledWith({ notice: true }, context);
    expect(answer).toEqual({ notice: false });
  });

  it("returns the remover fx.handle returned", () => {
    const { fx, removers } = stubFx();
    const envRead = defineEffect<void, number>("view-env.read", { fast: "run" });

    const off = envRead.handle(fx, () => 1);

    expect(off).toBe(removers[0]);
  });
});
