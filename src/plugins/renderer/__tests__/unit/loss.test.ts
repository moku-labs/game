import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOSS_KEY, leaveAfterLoss, readLosses, reportLosses } from "../../loss";
import type { RendererCtx } from "../../types";

// ---------------------------------------------------------------------------
// F189: a lost GPU device with freed decoded images reloads the page; every loss is kept across the reload and
// reported once at the next start, so a loss on a phone can be read afterwards.
// ---------------------------------------------------------------------------

/* eslint-disable unicorn/no-null -- `Storage` answers a missing key with null. */

/** A `localStorage` over a map. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();

  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
    clear: () => items.clear(),
    key: () => null,
    get length() {
      return items.size;
    }
  };
}

/**
 * The context `loss.ts` reads: the clock, the flow path and the log.
 *
 * @param path - The flow path the game stands on.
 * @returns The context and its log spies.
 */
function lossCtx(path = "board/awaitIntent"): {
  ctx: RendererCtx;
  error: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
} {
  const error = vi.fn();
  const warn = vi.fn();
  const ctx = {
    deps: { clock: { now: () => 1_790_000_000_000 }, flow: { state: () => ({ path }) } },
    log: { error, warn }
  } as unknown as RendererCtx;

  return { ctx, error, warn };
}

const lost = { kind: "webgpu", reason: "unknown", textureBytes: 262_144_000 } as const;

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a lost device (F189)", () => {
  // Bug: freed textures upload the 1x1 stand-in to the new device and the game draws transparent pictures.
  it("reloads the page when textures had their decoded image freed, and keeps the record", () => {
    const { ctx, error } = lossCtx();
    const reload = vi.fn();

    expect(leaveAfterLoss(ctx, lost, 12, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    const [record] = readLosses();

    expect(record).toMatchObject({
      at: 1_790_000_000_000,
      kind: "webgpu",
      reason: "unknown",
      path: "board/awaitIntent",
      textureMb: 250,
      freed: 12,
      reloaded: true,
      reported: false
    });
    expect(error).toHaveBeenCalledWith("renderer:gpu-lost", record);
  });

  // Bug: a loss with nothing freed reloads the game the restore would have saved.
  it("restores without a reload when nothing was freed, and still records the loss", () => {
    const { ctx } = lossCtx();
    const reload = vi.fn();

    expect(leaveAfterLoss(ctx, lost, 0, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(readLosses()).toHaveLength(1);
    expect(readLosses()[0]?.reloaded).toBe(false);
  });

  // Bug: a phone that loses its device again and again fills the storage.
  it("keeps the ten newest records", () => {
    const { ctx } = lossCtx();

    for (let at = 0; at < 12; at += 1) leaveAfterLoss(ctx, { ...lost, reason: `r${at}` }, 0);

    expect(readLosses().map(record => record.reason)).toEqual(
      Array.from({ length: 10 }, (_, at) => `r${at + 2}`)
    );
  });

  // Bug: private mode refuses the write and the loss throws out of the device callback: no reload.
  it("still reloads where the storage refuses the write", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      }
    });

    const { ctx, error } = lossCtx();
    const reload = vi.fn();

    expect(leaveAfterLoss(ctx, lost, 1, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe("the start after a loss (F189)", () => {
  // Bug: the reload took the log away, and nobody learns the phone lost its device.
  it("logs each loss no start reported yet, once", () => {
    const { ctx } = lossCtx();

    leaveAfterLoss(ctx, lost, 3, vi.fn());

    const next = lossCtx();

    reportLosses(next.ctx);
    reportLosses(next.ctx);

    expect(next.warn).toHaveBeenCalledTimes(1);
    expect(next.warn).toHaveBeenCalledWith(
      "renderer:gpu-lost-before",
      expect.objectContaining({ freed: 3, path: "board/awaitIntent" })
    );
    expect(readLosses()[0]?.reported).toBe(true);
  });

  // Bug: a storage that holds something else under the key throws at boot.
  it("reads a broken record list as none", () => {
    localStorage.setItem(LOSS_KEY, "{not json");

    const { ctx, warn } = lossCtx();

    expect(() => reportLosses(ctx)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
