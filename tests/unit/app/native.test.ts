/**
 * @file `nativeConfigOf` and `runNative`: a game's `config.ts` as the config of `@moku-labs/native`,
 * and the four native verbs over a recording fake of that package.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../../src/app/config";
import type { NativeConfig } from "../../../src/app/native";
import { nativeConfigOf, runNative } from "../../../src/app/native";
import type { GameConfig, ResolvedGameConfig } from "../../../src/app/types";

/** The options a fake cli verb was called with. */
type VerbCall = { target?: string | undefined; simulator?: boolean | undefined };

/** What the fake native app saw: the configs it was made with, and every call in order. */
type Recorder = {
  configs: NativeConfig[];
  calls: (readonly [string] | readonly [string, VerbCall])[];
  fail: boolean;
  doctor: boolean;
};

const { recorder, fakeNative } = vi.hoisted(() => {
  const recorder: Recorder = { configs: [], calls: [], fail: false, doctor: true };

  /**
   * Records a verb call, then throws when the test asks it to fail.
   *
   * @param name - The verb name.
   * @param options - The options it was called with.
   */
  function verb(name: string, options: VerbCall): void {
    recorder.calls.push([name, options]);

    if (recorder.fail) {
      throw new Error("[native] tauri compile failed.");
    }
  }

  /**
   * The fake `@moku-labs/native` module: `TARGETS` and a `createApp` that records.
   *
   * @returns The module the native file imports.
   */
  function fakeNative() {
    return {
      TARGETS: ["macos", "windows", "linux", "ios", "android"],
      createApp: (options: { config: NativeConfig }) => {
        recorder.configs.push(options.config);

        return {
          start: async () => {
            recorder.calls.push(["start"]);
          },
          stop: async () => {
            recorder.calls.push(["stop"]);
          },
          cli: {
            build: async (options: VerbCall) => verb("build", options),
            dev: async (options: VerbCall) => verb("dev", options),
            clean: async (options: VerbCall) => verb("clean", options),
            doctor: async (options: VerbCall) => {
              verb("doctor", options);

              return recorder.doctor;
            }
          }
        };
      }
    };
  }

  return { recorder, fakeNative };
});

vi.mock("@moku-labs/native", () => fakeNative());

const where = { cwd: "/g", command: '"bun" "/g/bin/moku-game.mjs" "--root" "/g"' };

/**
 * A resolved config of a game with a native section.
 *
 * @param config - Fields over the timber defaults.
 * @returns The resolved config.
 */
function settingsOf(config: Partial<GameConfig> = {}): ResolvedGameConfig {
  return resolveConfig({
    page: { title: "Лесной городок", background: "#10161d", orientation: "landscape" },
    native: { name: "Лесной городок", identifier: "com.mokulabs.timber", icon: "assets/icon.png" },
    ...config
  });
}

afterEach(() => {
  recorder.configs.length = 0;
  recorder.calls.length = 0;
  recorder.fail = false;
  recorder.doctor = true;
});

describe("nativeConfigOf", () => {
  it("the native config takes name, identifier, icon, orientation and background from config.ts", () => {
    expect(nativeConfigOf(settingsOf(), where, "ios").app).toEqual({
      name: "Лесной городок",
      identifier: "com.mokulabs.timber",
      icon: "assets/icon.png",
      orientation: "landscape",
      backgroundColor: "#10161d"
    });
  });

  it("leaves the icon out when config.ts names none, and takes the page defaults", () => {
    const settings = resolveConfig({
      page: { title: "T" },
      native: { name: "T", identifier: "com.acme.t" }
    });

    expect(nativeConfigOf(settings, where, "ios").app).toEqual({
      name: "T",
      identifier: "com.acme.t",
      orientation: "portrait",
      backgroundColor: "#000000"
    });
  });

  it("the web commands run moku-game through the given command", () => {
    expect(nativeConfigOf(settingsOf(), where, "ios").web).toEqual({
      cwd: "/g",
      build: '"bun" "/g/bin/moku-game.mjs" "--root" "/g" build',
      devCommand: '"bun" "/g/bin/moku-game.mjs" "--root" "/g" dev --port 5173',
      devUrl: "http://localhost:5173",
      dist: "/g/dist/web"
    });
  });

  it("system rows skip lifecycle and keepAwake and add store for save store", () => {
    const shell = settingsOf({ system: ["lifecycle", "back", "haptics", "keepAwake"] });
    const stored = settingsOf({ system: ["back"], save: "store" });
    const both = settingsOf({ system: ["store"], save: "store" });

    expect(nativeConfigOf(shell, where, "ios").system).toEqual([
      { name: "back" },
      { name: "haptics" }
    ]);
    expect(nativeConfigOf(stored, where, "ios").system).toEqual([
      { name: "back" },
      { name: "store" }
    ]);
    expect(nativeConfigOf(both, where, "ios").system).toEqual([{ name: "store" }]);
    expect(nativeConfigOf(settingsOf(), where, "ios").system).toEqual([]);
  });

  it("targets come from config.ts, else the verb's target", () => {
    const named = settingsOf({
      native: { name: "T", identifier: "com.acme.t", targets: ["ios", "macos"] }
    });

    expect(nativeConfigOf(named, where, "android").targets).toEqual(["ios", "macos"]);
    expect(nativeConfigOf(settingsOf(), where, "android").targets).toEqual(["android"]);
    expect(nativeConfigOf(settingsOf(), where, undefined)).not.toHaveProperty("targets");
  });

  it("the project and output folders are .moku/tauri and dist-native under the game", () => {
    const config = nativeConfigOf(settingsOf(), where, "ios");

    expect(config.projectDir).toBe("/g/.moku/tauri");
    expect(config.outDir).toBe("/g/dist-native");
  });

  it("a config without native throws the native-section message", () => {
    expect(() => nativeConfigOf(resolveConfig({ page: { title: "T" } }), where, "ios")).toThrow(
      new Error(
        "[game] config.ts has no native section.\n  Add native: { name, identifier } to config.ts."
      )
    );
  });
});

describe("runNative", () => {
  it("build passes the simulator flag and answers true", async () => {
    const done = await runNative("build", settingsOf(), where, {
      target: "ios",
      simulator: true
    });

    expect(done).toBe(true);
    expect(recorder.calls).toEqual([
      ["start"],
      ["build", { target: "ios", simulator: true }],
      ["stop"]
    ]);
    expect(recorder.configs).toEqual([nativeConfigOf(settingsOf(), where, "ios")]);
  });

  it("dev runs the native shell on the target", async () => {
    expect(await runNative("dev", settingsOf(), where, { target: "macos" })).toBe(true);
    expect(recorder.calls).toEqual([["start"], ["dev", { target: "macos" }], ["stop"]]);
  });

  it("clean answers true, with or without a target", async () => {
    expect(await runNative("clean", settingsOf(), where, {})).toBe(true);
    expect(await runNative("clean", settingsOf(), where, { target: "ios" })).toBe(true);
    expect(recorder.calls).toEqual([
      ["start"],
      ["clean", { target: undefined }],
      ["stop"],
      ["start"],
      ["clean", { target: "ios" }],
      ["stop"]
    ]);
    expect(recorder.configs[0]).not.toHaveProperty("targets");
  });

  it("a throwing verb answers false and still stops the app", async () => {
    recorder.fail = true;

    expect(await runNative("build", settingsOf(), where, { target: "ios" })).toBe(false);
    expect(recorder.calls).toEqual([
      ["start"],
      ["build", { target: "ios", simulator: undefined }],
      ["stop"]
    ]);
  });

  it("doctor answers native's boolean", async () => {
    expect(await runNative("doctor", settingsOf(), where, {})).toBe(true);

    recorder.doctor = false;

    expect(await runNative("doctor", settingsOf(), where, { target: "ios" })).toBe(false);
    expect(recorder.calls).toContainEqual(["doctor", { target: "ios" }]);
  });

  it("a config without native throws the native-section message", async () => {
    await expect(
      runNative("build", resolveConfig({ page: { title: "T" } }), where, { target: "ios" })
    ).rejects.toThrow(
      new Error(
        "[game] config.ts has no native section.\n  Add native: { name, identifier } to config.ts."
      )
    );
    expect(recorder.calls).toEqual([]);
  });

  it("an unknown target names the five targets", async () => {
    await expect(runNative("build", settingsOf(), where, { target: "tvos" })).rejects.toThrow(
      new Error(
        '[game] No native target "tvos".\n  Name one of macos, windows, linux, ios, android.'
      )
    );
    await expect(runNative("doctor", settingsOf(), where, { target: "tvos" })).rejects.toThrow(
      'No native target "tvos"'
    );
    expect(recorder.calls).toEqual([]);
  });

  it("build and dev need a target", async () => {
    await expect(runNative("build", settingsOf(), where, {})).rejects.toThrow(
      new Error(
        "[game] moku-game native build needs a target.\n  Run: moku-game native build ios --simulator."
      )
    );
    await expect(runNative("dev", settingsOf(), where, {})).rejects.toThrow(
      new Error("[game] moku-game native dev needs a target.\n  Run: moku-game native dev ios.")
    );
    expect(recorder.calls).toEqual([]);
  });

  it("a missing @moku-labs/native throws the install message", async () => {
    vi.resetModules();
    vi.doMock("@moku-labs/native", () => {
      throw new Error("Cannot find package '@moku-labs/native'");
    });

    try {
      const fresh = await import("../../../src/app/native");

      await expect(
        fresh.runNative("build", settingsOf(), where, { target: "ios" })
      ).rejects.toThrow(
        new Error(
          "[game] moku-game native needs @moku-labs/native.\n  Install it: bun add -d @moku-labs/native@^0.3.2."
        )
      );
    } finally {
      vi.doMock("@moku-labs/native", () => fakeNative());
      vi.resetModules();
    }
  });
});
