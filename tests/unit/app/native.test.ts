/**
 * @file `nativeConfigOf`, `storeProblems` and `runNative`: a game's `config.ts` as the config of
 * `@moku-labs/native`, the checks of a store build, and the four native verbs over a recording fake
 * of that package.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../../src/app/config";
import type { NativeConfig, NativeStore, StoreInput } from "../../../src/app/native";
import { nativeConfigOf, runNative, storeProblems } from "../../../src/app/native";
import type { GameConfig, ResolvedGameConfig } from "../../../src/app/types";

/** The options a fake cli verb was called with. */
type VerbCall = {
  target?: string | undefined;
  simulator?: boolean | undefined;
  debug?: boolean | undefined;
  aab?: boolean | undefined;
  dev?: boolean | undefined;
};

/** What the fake native app saw: the configs it was made with, and every call in order. */
type Recorder = {
  configs: NativeConfig[];
  calls: (readonly [string] | readonly [string, VerbCall])[];
  fail: boolean;
  /** The call of a verb that throws, counted from 1; 0 for none. */
  failAfter: number;
  doctor: boolean;
};

const { recorder, fakeNative } = vi.hoisted(() => {
  const recorder: Recorder = { configs: [], calls: [], fail: false, failAfter: 0, doctor: true };

  /**
   * Records a verb call, then throws when the test asks it to fail.
   *
   * @param name - The verb name.
   * @param options - The options it was called with.
   */
  function verb(name: string, options: VerbCall): void {
    recorder.calls.push([name, options]);

    const count = recorder.calls.filter(call => call[0] === name).length;

    if (recorder.fail || count === recorder.failAfter) {
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

const where = {
  cwd: "/g",
  command: '"bun" "/g/bin/moku-game.mjs" "--root" "/g"',
  home: "/home/a"
};

/** The name of the variable with the keystore password. */
const STORE_VARIABLE = "KS_PASS";

/** The name of the variable with the key password. */
const KEY_VARIABLE = "KEY_PASS";

/** The Android signing of a store game: the two password variables by name. */
const android = {
  keystorePath: "keys/k.jks",
  keystorePasswordEnv: STORE_VARIABLE,
  keyPasswordEnv: KEY_VARIABLE,
  keyAlias: "upload"
};

/** A native section that can ship: every signing block and a real identifier. */
const shippable: NonNullable<GameConfig["native"]> = {
  name: "T",
  identifier: "com.acme.t",
  signing: { android, apple: { teamId: "ABCDE12345" } }
};

/** A shippable native section with the test app, named and drawn by the game. */
const withTestApp: NonNullable<GameConfig["native"]> = {
  ...shippable,
  icon: "assets/icon.png",
  dev: { identifier: "com.acme.t.dev", name: "T Test", icon: "assets/icon-dev.png" }
};

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

/**
 * The keystore path native gets for a path in `config.ts`.
 *
 * @param keystorePath - The path as the game writes it.
 * @returns The path in the native config.
 */
function keystoreOf(keystorePath: string): string | undefined {
  const settings = settingsOf({
    native: { ...shippable, signing: { android: { ...android, keystorePath } } }
  });

  return nativeConfigOf(settings, where, "android").signing?.android?.keystorePath;
}

/**
 * The Apple block of a native config.
 *
 * @param config - The native config.
 * @returns The block.
 */
function appleOf(config: NativeConfig): NonNullable<NativeConfig["signing"]>["apple"] {
  return config.signing?.apple;
}

/**
 * The seams of a store build that has everything: the passwords set and every file there.
 *
 * @param change - Seams to replace.
 * @returns The seams.
 */
function storeOf(change: Partial<NativeStore> = {}): NativeStore {
  return {
    buildNumber: 12,
    env: { KS_PASS: "ks-secret-value", KEY_PASS: "key-secret-value" },
    exists: () => true,
    ...change
  };
}

/**
 * The input of the store checks for a game that passes every one of them on Android.
 *
 * @param change - Fields to replace.
 * @param native - Fields over the native section.
 * @returns The input.
 */
function storeInput(
  change: Partial<StoreInput> = {},
  native: Partial<NonNullable<GameConfig["native"]>> = {}
): StoreInput {
  return {
    settings: settingsOf({ native: { ...shippable, ...native } }),
    target: "android",
    cwd: "/g",
    home: "/home/a",
    version: "1.2.3",
    store: storeOf(),
    ...change
  };
}

afterEach(() => {
  recorder.configs.length = 0;
  recorder.calls.length = 0;
  recorder.fail = false;
  recorder.failAfter = 0;
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
      devUrl: "http://127.0.0.1:5173",
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

  it("with debug builds the web page with the profile and --editor, and keeps the game's name and identifier", () => {
    const store = nativeConfigOf(settingsOf(), where, "android");
    const full = nativeConfigOf(settingsOf(), where, "android", {
      debug: { level: "full", editor: "192.168.1.20:47600" }
    });
    const read = nativeConfigOf(settingsOf(), where, "android", { debug: { level: "read" } });

    expect(full.web.build).toBe(
      '"bun" "/g/bin/moku-game.mjs" "--root" "/g" build --debug --editor 192.168.1.20:47600'
    );
    expect(read.web.build).toBe('"bun" "/g/bin/moku-game.mjs" "--root" "/g" build --debug=read');
    expect(store.web.build).toBe('"bun" "/g/bin/moku-game.mjs" "--root" "/g" build');
    expect({ ...full, web: store.web }).toEqual(store);
    expect(full.app).toMatchObject({ name: "Лесной городок", identifier: "com.mokulabs.timber" });
  });

  // Bug: the test app overwrites the players' project, ships the players' icon, or goes unsigned.
  it("a dev build is the test app: its id, name and icon, its own folders, the debug page, the same signing", () => {
    const settings = settingsOf({ native: withTestApp });
    const config = nativeConfigOf(settings, where, "android", { dev: true, buildNumber: 13 });

    expect(config.app).toMatchObject({
      identifier: "com.acme.t.dev",
      name: "T Test",
      icon: "assets/icon-dev.png",
      buildNumber: "13"
    });
    expect(config.projectDir).toBe("/g/.moku/tauri-dev");
    expect(config.outDir).toBe("/g/dist-native-dev");
    expect(config.web.build).toBe('"bun" "/g/bin/moku-game.mjs" "--root" "/g" build --debug');
    expect(config.signing?.android?.keystorePath).toBe("/g/keys/k.jks");
  });

  it("a dev build on iOS exports for App Store Connect, as a store build does", () => {
    const settings = settingsOf({ native: withTestApp });
    const config = nativeConfigOf(settings, where, "ios", { dev: true, buildNumber: 13 });

    expect(appleOf(config)?.exportMethod).toBe("app-store-connect");
  });

  // Bug: the test app shows up nameless on a phone, or with a placeholder for an icon.
  it("a test app with no name reads <name> DEV, and one with no icon takes the game's", () => {
    const dev = { identifier: "com.acme.t.dev" };
    const settings = settingsOf({ native: { ...withTestApp, dev } });
    const { app } = nativeConfigOf(settings, where, "android", { dev: true, buildNumber: 13 });

    expect(app).toMatchObject({ name: "T DEV", icon: "assets/icon.png" });
  });

  // Bug: a players' build goes out under the test id, or into the test folders.
  it("without dev nothing of native.dev reaches the config", () => {
    const players = { ...shippable, icon: "assets/icon.png" };
    const extras = { buildNumber: 13 };

    expect(nativeConfigOf(settingsOf({ native: withTestApp }), where, "android", extras)).toEqual(
      nativeConfigOf(settingsOf({ native: players }), where, "android", extras)
    );
  });

  // Bug: tauri refuses a renamed app in one tree, and gen/apple regenerates on each swap.
  it("an iOS debug app has the .debug id, the (debug) name and a project of its own; its apps stay in dist-native", () => {
    const store = nativeConfigOf(settingsOf(), where, "ios");
    const debug = nativeConfigOf(settingsOf(), where, "ios", { debug: { level: "full" } });

    expect(debug.app).toEqual({
      ...store.app,
      identifier: "com.mokulabs.timber.debug",
      name: "Лесной городок (debug)"
    });
    expect(debug.projectDir).toBe("/g/.moku/tauri-debug");
    expect(debug.outDir).toBe("/g/dist-native");
    expect(debug.web.build).toContain("build --debug");
  });

  it("an android config composes the native shell once, first; an ios config does not", () => {
    const shell = settingsOf({ system: ["back", "haptics"] });

    expect(nativeConfigOf(shell, where, "android").system).toEqual([
      { name: "shell" },
      { name: "back" },
      { name: "haptics" }
    ]);
    expect(nativeConfigOf(settingsOf(), where, "android").system).toEqual([{ name: "shell" }]);
    expect(nativeConfigOf(shell, where, "ios").system).toEqual([
      { name: "back" },
      { name: "haptics" }
    ]);
  });

  it("a config without native throws the native-section message", () => {
    expect(() => nativeConfigOf(resolveConfig({ page: { title: "T" } }), where, "ios")).toThrow(
      new Error(
        "[game] config.ts has no native section.\n  Add native: { name, identifier } to config.ts."
      )
    );
  });

  // Bug: Gradle resolves a relative path under gen/android/app and finds no keystore.
  it("a keystore path comes out absolute: ~/ from the home folder, a relative one from the game", () => {
    expect(keystoreOf("~/k.jks")).toBe("/home/a/k.jks");
    expect(keystoreOf("keys/k.jks")).toBe("/g/keys/k.jks");
    expect(keystoreOf("/keys/k.jks")).toBe("/keys/k.jks");
  });

  // Bug: the passwords or the alias never reach native, and Gradle signs with nothing.
  it("the Android signing goes to native whole, the passwords by their variable names", () => {
    const settings = settingsOf({ native: shippable });

    expect(nativeConfigOf(settings, where, "android").signing?.android).toEqual({
      ...android,
      keystorePath: "/g/keys/k.jks"
    });
  });

  // Bug: a debug or plain build carries a store number.
  it("a build number comes only with a store build, as a string", () => {
    const settings = settingsOf({ native: shippable });

    expect(nativeConfigOf(settings, where, "android", { buildNumber: 12 }).app.buildNumber).toBe(
      "12"
    );
    expect(nativeConfigOf(settings, where, "android").app).not.toHaveProperty("buildNumber");
  });

  // Bug: a device build asks for an App Store export and fails without Distribution rights.
  it("exportMethod comes only with a store build on iOS", () => {
    const settings = settingsOf({ native: shippable });

    expect(appleOf(nativeConfigOf(settings, where, "ios", { buildNumber: 12 }))).toEqual({
      teamId: "ABCDE12345",
      iosMinimumSystemVersion: "26.0",
      exportMethod: "app-store-connect"
    });
    expect(appleOf(nativeConfigOf(settings, where, "ios"))).toEqual({
      teamId: "ABCDE12345",
      iosMinimumSystemVersion: "26.0"
    });
    expect(appleOf(nativeConfigOf(settings, where, "android", { buildNumber: 12 }))).toEqual({
      teamId: "ABCDE12345"
    });
  });

  // Bug: iOS stays at native's 15.0, or an Android config grows an Apple block of nothing.
  it("the iOS minimum is 26.0 on an iOS target, a game's own wins, and other targets write none", () => {
    const own = settingsOf({ native: { ...shippable, ios: { minimumVersion: "26.2" } } });

    expect(nativeConfigOf(settingsOf(), where, "ios").signing).toEqual({
      apple: { iosMinimumSystemVersion: "26.0" }
    });
    expect(nativeConfigOf(own, where, "ios").signing?.apple?.iosMinimumSystemVersion).toBe("26.2");
    expect(nativeConfigOf(settingsOf(), where, "android")).not.toHaveProperty("signing");
  });

  // Bug: the screen sleeps through a game that asked to stay awake, or stays on in one that did not.
  it("keepScreenOn follows keepAwake in config.system", () => {
    const awake = settingsOf({ system: ["back", "keepAwake"] });
    const plain = settingsOf({ system: ["back"] });

    expect(nativeConfigOf(awake, where, "ios").app.keepScreenOn).toBe(true);
    expect(nativeConfigOf(plain, where, "ios").app).not.toHaveProperty("keepScreenOn");
  });

  // Bug: the debug app is signed with the upload key, or leaves native's SDK key out.
  it("a debug build keeps no store keystore", () => {
    const settings = settingsOf({ native: { ...shippable, signing: { android } } });
    const debug = nativeConfigOf(settings, where, "android", { debug: { level: "full" } });

    expect(debug).not.toHaveProperty("signing");
  });

  // Bug: Gradle refuses a signing block with no password after a whole compile.
  it("an unsigned build leaves the key out", () => {
    const settings = settingsOf({ native: { ...shippable, signing: { android } } });
    const unsigned = nativeConfigOf(settings, where, "android", { unsigned: true });

    expect(unsigned).not.toHaveProperty("signing");
  });

  // Bug: every build ships as native's fallback version.
  it("the version goes to app.version when given, and stays out when not", () => {
    expect(nativeConfigOf(settingsOf(), where, "ios", { version: "1.2.3" }).app.version).toBe(
      "1.2.3"
    );
    expect(nativeConfigOf(settingsOf(), where, "ios").app).not.toHaveProperty("version");
  });

  // Bug: native's createApp refuses a relative manifest, or the game's plist keys never land.
  it("ios carries infoPlist and the manifest as an absolute path; a game with a minimum only writes none", () => {
    const infoPlist = { ITSAppUsesNonExemptEncryption: false };
    const both = settingsOf({
      native: { ...shippable, ios: { infoPlist, privacyManifest: "ios/PrivacyInfo.xcprivacy" } }
    });
    const plist = settingsOf({ native: { ...shippable, ios: { infoPlist } } });
    const minimum = settingsOf({ native: { ...shippable, ios: { minimumVersion: "26.0" } } });

    expect(nativeConfigOf(both, where, "ios").ios).toEqual({
      infoPlist,
      privacyManifest: "/g/ios/PrivacyInfo.xcprivacy"
    });
    expect(nativeConfigOf(plist, where, "ios").ios).toEqual({ infoPlist });
    expect(nativeConfigOf(minimum, where, "ios")).not.toHaveProperty("ios");
  });
});

describe("storeProblems", () => {
  it("a game with everything has no problem", () => {
    expect(storeProblems(storeInput())).toEqual([]);
    expect(storeProblems(storeInput({ target: "ios" }))).toEqual([]);
  });

  // Bug: a store build starts with no signing and fails long after the compile.
  it("Android without native.signing.android names the field, and only that", () => {
    expect(
      storeProblems(
        storeInput({ store: storeOf({ env: {}, exists: () => false }) }, { signing: {} })
      )
    ).toEqual([
      "No native.signing.android in config.ts. Add keystorePath, keystorePasswordEnv and keyAlias."
    ]);
  });

  // Bug: the check looks at the path as written, and passes for a file Gradle will not find.
  it("a missing keystore names the resolved path", () => {
    const seen: string[] = [];
    const store = storeOf({
      exists: file => {
        seen.push(file);

        return false;
      }
    });

    expect(storeProblems(storeInput({ store }))).toEqual([
      "The keystore /g/keys/k.jks is not a file."
    ]);
    expect(seen).toEqual(["/g/keys/k.jks"]);
  });

  // Bug: a store build with an unset password fails at the signing step.
  it("an unset or empty password variable is named, both of them", () => {
    expect(storeProblems(storeInput({ store: storeOf({ env: {} }) }))).toEqual([
      "The env var KS_PASS is not set. It holds a signing password.",
      "The env var KEY_PASS is not set. It holds a signing password."
    ]);
    expect(
      storeProblems(storeInput({ store: storeOf({ env: { KS_PASS: "", KEY_PASS: "set" } }) }))
    ).toEqual(["The env var KS_PASS is not set. It holds a signing password."]);
  });

  // Bug: one variable named twice prints the same line twice.
  it("a key password left out, or the same variable twice, reads as one variable", () => {
    const oneVariable = {
      keystorePath: "k.jks",
      keystorePasswordEnv: STORE_VARIABLE,
      keyAlias: "a"
    };
    const same = { ...android, keyPasswordEnv: android.keystorePasswordEnv };
    const unset = storeOf({ env: {} });
    const line = ["The env var KS_PASS is not set. It holds a signing password."];

    expect(
      storeProblems(storeInput({ store: unset }, { signing: { android: oneVariable } }))
    ).toEqual(line);
    expect(storeProblems(storeInput({ store: unset }, { signing: { android: same } }))).toEqual(
      line
    );
  });

  // Bug: an iOS store build starts with no team and fails at the export.
  it("iOS without native.signing.apple names the field, and takes no Android row", () => {
    expect(
      storeProblems(
        storeInput(
          { target: "ios", store: storeOf({ env: {}, exists: () => false }) },
          { signing: { android } }
        )
      )
    ).toEqual(["No native.signing.apple in config.ts. Add teamId."]);
  });

  // Bug: a store build ships native's 0.1.0, or a version a store refuses.
  it("package.json with no version, or one that is not x.y.z, is named with its value", () => {
    expect(storeProblems(storeInput({ version: undefined }))).toEqual([
      "package.json has no version. Add one, such as 1.0.0."
    ]);
    expect(storeProblems(storeInput({ version: "1.2" }))).toEqual([
      'package.json has version "1.2". Use x.y.z, such as 1.0.0.'
    ]);
    expect(storeProblems(storeInput({ version: "1.2.3-beta.1" }))).toEqual([
      'package.json has version "1.2.3-beta.1". Use x.y.z, such as 1.0.0.'
    ]);
  });

  // Bug: a test identifier goes to a store, and that app record cannot be renamed.
  it("an identifier that ends in a test word is named; a test word in the middle passes", () => {
    for (const word of ["soak", "debug", "dev", "test", "staging"]) {
      const identifier = `com.acme.t.${word}`;

      expect(storeProblems(storeInput({}, { identifier })), word).toEqual([
        `The identifier ${identifier} ends in .${word}. A store build ships the real identifier.`
      ]);
    }

    expect(storeProblems(storeInput({}, { identifier: "com.test.t" }))).toEqual([]);
    expect(storeProblems(storeInput({}, { identifier: "com.acme.devices" }))).toEqual([]);
  });

  // Bug: a signing problem of the test app shows up only after the compile.
  it("a dev build checks native.dev.identifier in place of the real one, and every other row as before", () => {
    const store = storeOf({ dev: true });
    const dev = { identifier: "com.acme.t.dev" };

    expect(storeProblems(storeInput({ store }, { dev }))).toEqual([]);
    expect(storeProblems(storeInput({ store }, { identifier: "com.acme.t.soak", dev }))).toEqual(
      []
    );
    expect(
      storeProblems(
        storeInput(
          { version: "1.2", store: storeOf({ dev: true, env: {}, exists: () => false }) },
          { dev }
        )
      )
    ).toEqual([
      "The keystore /g/keys/k.jks is not a file.",
      "The env var KS_PASS is not set. It holds a signing password.",
      "The env var KEY_PASS is not set. It holds a signing password.",
      'package.json has version "1.2". Use x.y.z, such as 1.0.0.'
    ]);
  });

  // Bug: runNative is called without the checks of the config, and the test app takes the real id.
  it("a dev build refuses a test identifier that does not end in .dev, or none at all", () => {
    const store = storeOf({ dev: true });
    const settings = settingsOf({ native: shippable });
    const wrong = { ...settings.native, dev: { identifier: "com.acme.t.soak" } };

    expect(
      storeProblems(
        storeInput({ store, settings: { ...settings, native: wrong as typeof shippable } })
      )
    ).toEqual([
      "The test identifier com.acme.t.soak does not end in .dev. Fix native.dev.identifier."
    ]);
    expect(storeProblems(storeInput({ store }))).toEqual([
      "No native.dev in config.ts. Add identifier, ending in .dev."
    ]);
  });

  it("every Android problem at once comes as one line each, so one run shows every fix", () => {
    const input = storeInput(
      { version: "1.2", store: storeOf({ env: {}, exists: () => false }) },
      { identifier: "com.acme.t.soak" }
    );

    expect(storeProblems(input)).toEqual([
      "The keystore /g/keys/k.jks is not a file.",
      "The env var KS_PASS is not set. It holds a signing password.",
      "The env var KEY_PASS is not set. It holds a signing password.",
      'package.json has version "1.2". Use x.y.z, such as 1.0.0.',
      "The identifier com.acme.t.soak ends in .soak. A store build ships the real identifier."
    ]);
  });

  // Bug: a password lands in the log of a CI run.
  it("a message never carries the value of a variable", () => {
    const store = storeOf({ env: { KS_PASS: "ks-secret-value" }, exists: () => false });
    const text = storeProblems(storeInput({ store, version: "1.2" })).join("\n");

    expect(text).toContain("KEY_PASS");
    expect(text).not.toContain("ks-secret-value");
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

  it("a debug build passes debug: true to native's build, and the web build carries the profile", async () => {
    const done = await runNative("build", settingsOf(), where, {
      target: "android",
      debug: "full",
      editor: "192.168.1.20:47600"
    });

    expect(done).toBe(true);
    expect(recorder.calls).toEqual([
      ["start"],
      ["build", { target: "android", simulator: undefined, debug: true }],
      ["stop"]
    ]);
    expect(recorder.configs[0]?.web.build).toContain("build --debug --editor 192.168.1.20:47600");
  });

  // Bug: a store build makes an .apk Play refuses, or an iOS or plain build gets the Android flag.
  it("aab goes to native's build with --store on Android only", async () => {
    const settings = settingsOf({ native: shippable });
    const options = { version: "1.2.3", store: storeOf() };

    expect(await runNative("build", settings, where, { target: "android", ...options })).toBe(true);
    expect(await runNative("build", settings, where, { target: "ios", ...options })).toBe(true);
    expect(await runNative("build", settings, where, { target: "android" })).toBe(true);
    expect(recorder.calls.filter(call => call[0] === "build")).toEqual([
      ["build", { target: "android", simulator: undefined, aab: true }],
      ["build", { target: "ios", simulator: undefined }],
      ["build", { target: "android", simulator: undefined }]
    ]);
  });

  // Bug: native's store profile refuses the agent page, or a test app ships as an .apk.
  it("a dev store build passes dev to native, with aab on Android only, over the test app's config", async () => {
    const settings = settingsOf({ native: withTestApp });
    const options = { version: "1.2.3", store: storeOf({ dev: true }) };

    expect(await runNative("build", settings, where, { target: "android", ...options })).toBe(true);
    expect(await runNative("build", settings, where, { target: "ios", ...options })).toBe(true);
    expect(recorder.calls.filter(call => call[0] === "build")).toEqual([
      ["build", { target: "android", simulator: undefined, aab: true, dev: true }],
      ["build", { target: "ios", simulator: undefined, dev: true }]
    ]);
    expect(recorder.configs.map(config => config.projectDir)).toEqual([
      "/g/.moku/tauri-dev",
      "/g/.moku/tauri-dev"
    ]);
  });

  // Bug: a store build drops its number or its version on the way to native.
  it("a store build hands native the version and the number", async () => {
    await runNative("build", settingsOf({ native: shippable }), where, {
      target: "android",
      version: "1.2.3",
      store: storeOf({ buildNumber: 40 })
    });

    expect(recorder.configs[0]?.app).toMatchObject({ version: "1.2.3", buildNumber: "40" });
  });

  // Bug: a plain build stops on a package.json version native would refuse, or loses a good one.
  it("a plain build takes a valid version, and leaves another one to native's fallback", async () => {
    await runNative("build", settingsOf(), where, { target: "ios", version: "1.2.3" });
    await runNative("build", settingsOf(), where, { target: "ios", version: "1.2" });

    expect(recorder.configs[0]?.app.version).toBe("1.2.3");
    expect(recorder.configs[1]?.app).not.toHaveProperty("version");
  });

  // Bug: a refused store build compiles first, and fails long after.
  it("a store problem refuses with one error, a line per problem, and starts nothing", async () => {
    const settings = settingsOf({ native: { ...shippable, identifier: "com.acme.t.soak" } });
    const store = storeOf({ env: {} });

    await expect(
      runNative("build", settings, where, { target: "android", version: "1.2.3", store })
    ).rejects.toThrow(
      new Error(
        "[game] native --store: fix these before a store build.\n" +
          "  The env var KS_PASS is not set. It holds a signing password.\n" +
          "  The env var KEY_PASS is not set. It holds a signing password.\n" +
          "  The identifier com.acme.t.soak ends in .soak. A store build ships the real identifier."
      )
    );
    expect(recorder.configs).toEqual([]);
    expect(recorder.calls).toEqual([]);
  });

  // Bug: the iOS checks ask for an Android keystore, or the other way round.
  it("the store checks follow the target of the command", async () => {
    const settings = settingsOf({ native: { name: "T", identifier: "com.acme.t" } });

    await expect(
      runNative("build", settings, where, { target: "ios", version: "1.2.3", store: storeOf() })
    ).rejects.toThrow("No native.signing.apple in config.ts.");
    await expect(
      runNative("build", settings, where, { target: "android", version: "1.2.3", store: storeOf() })
    ).rejects.toThrow("No native.signing.android in config.ts.");
  });

  // Bug: the store checks land on the plain device build, which Р6 keeps free of them.
  it("a plain iOS build with signing and ios set runs no store check", async () => {
    const native = {
      name: "T",
      identifier: "com.acme.t.soak",
      signing: { apple: { teamId: "ABCDE12345" } },
      ios: { privacyManifest: "ios/PrivacyInfo.xcprivacy" }
    };

    expect(await runNative("build", settingsOf({ native }), where, { target: "ios" })).toBe(true);
    expect(recorder.configs[0]?.app).not.toHaveProperty("buildNumber");
    expect(recorder.configs[0]?.signing?.apple).not.toHaveProperty("exportMethod");
    expect(recorder.calls).toContainEqual(["build", { target: "ios", simulator: undefined }]);
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

  // Bug: an 8 GB test project stays behind, since nothing removes it.
  it("clean runs native once per folder, the given test projects after .moku/tauri", async () => {
    const testProjects = ["/g/.moku/tauri-dev", "/g/.moku/tauri-debug"];

    expect(await runNative("clean", settingsOf(), where, { target: "ios", testProjects })).toBe(
      true
    );
    expect(recorder.configs.map(config => config.projectDir)).toEqual([
      "/g/.moku/tauri",
      "/g/.moku/tauri-dev",
      "/g/.moku/tauri-debug"
    ]);
    expect(recorder.calls.filter(call => call[0] === "clean")).toHaveLength(3);
  });

  // Bug: one folder that will not go hides behind the two that did, or stops them.
  it("a clean that fails on one folder still cleans the others, and answers false", async () => {
    const testProjects = ["/g/.moku/tauri-dev", "/g/.moku/tauri-debug"];

    recorder.failAfter = 2;

    expect(await runNative("clean", settingsOf(), where, { testProjects })).toBe(false);
    expect(recorder.configs).toHaveLength(3);
    expect(recorder.calls.filter(call => call[0] === "stop")).toHaveLength(3);
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
          "[game] moku-game native needs @moku-labs/native.\n  Install it: bun add -d @moku-labs/native@^0.3.13."
        )
      );
    } finally {
      vi.doMock("@moku-labs/native", () => fakeNative());
      vi.resetModules();
    }
  });

  // Bug: a refused store build waits for native to load, or hides its problem behind the install hint.
  it("the store checks run before native is imported", async () => {
    vi.resetModules();
    vi.doMock("@moku-labs/native", () => {
      throw new Error("Cannot find package '@moku-labs/native'");
    });

    try {
      const fresh = await import("../../../src/app/native");

      await expect(
        fresh.runNative("build", settingsOf(), where, {
          target: "android",
          version: "1.2.3",
          store: storeOf()
        })
      ).rejects.toThrow("[game] native --store:");
    } finally {
      vi.doMock("@moku-labs/native", () => fakeNative());
      vi.resetModules();
    }
  });
});
