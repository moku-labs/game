import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Loads a package file the way Node resolves it from this test. */
const load = createRequire(import.meta.url);

afterEach(() => {
  vi.doUnmock("sharp");
  vi.resetModules();
});

describe("loadEncoder", () => {
  it("loads the installed sharp and reads its version", async () => {
    const { loadEncoder } = await import("../../scan/pack/encode");

    const encoder = await loadEncoder();

    const installed: unknown = load("sharp/package.json");

    expect(encoder.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(installed).toMatchObject({ version: encoder.version });
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
