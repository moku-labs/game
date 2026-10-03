import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("sharp");
  vi.resetModules();
});

describe("loadEncoder", () => {
  it("loads the installed sharp and reads its version", async () => {
    const { loadEncoder } = await import("../../scan/pack/encode");

    const encoder = await loadEncoder();

    expect(encoder.version).toBe("0.34.5");
  });

  it("names the command that installs sharp when it is missing", async () => {
    vi.resetModules();
    vi.doMock("sharp", () => {
      throw new Error("Cannot find package 'sharp'");
    });

    const { loadEncoder } = await import("../../scan/pack/encode");

    await expect(loadEncoder()).rejects.toThrow(
      '[game] assets: "--pack" needs sharp.\n  Run "bun add -d sharp".'
    );
  });
});
