/**
 * @file The native verbs of `moku-game`: a game's `config.ts` as the config of `@moku-labs/native`,
 * and one verb run over it. Node only, no package export: the bin bundles it. The only file of the
 * engine that imports `@moku-labs/native`, and only with `import()`, so a web-only game never
 * loads it.
 */
import path from "node:path";
import type { Cli, Config, createApp, Target } from "@moku-labs/native";
import type { DebugLevel } from "./build";
import { TEST_APP_SUFFIX } from "./config";
import type { ResolvedGameConfig } from "./types";

/** The port of the dev server Tauri's shell starts and loads. */
const DEV_PORT = 5173;

/** The iOS minimum of a game that names none. Native's own default is older. */
const IOS_MINIMUM = "26.0";

/** The version shape a store takes, and the only one the engine hands native: `1.2.3`. */
const STORE_VERSION = /^\d+\.\d+\.\d+$/;

/** The Tauri project of the players' app, and of an Android debug app beside it. */
const STORE_PROJECT = ".moku/tauri";

/** The project of the test app: a full Rust build of its own. */
const DEV_PROJECT = ".moku/tauri-dev";

/** The project of the iOS debug app: tauri refuses a renamed app in one tree. */
const DEBUG_PROJECT = ".moku/tauri-debug";

/** Where the players' apps land, and the debug ones, which native files under `-debug` folders. */
const STORE_OUT = "dist-native";

/** Where the test apps land: native delivers one to `<outDir>/<target>`, as it does a store app. */
const DEV_OUT = "dist-native-dev";

/** A native verb of `moku-game native`. */
export type NativeVerb = "build" | "dev" | "doctor" | "clean";

/** Where the game lives, and how Tauri's shell runs `moku-game` again for the web build. */
export type NativeWhere = {
  /** The game folder, absolute. */
  cwd: string;
  /** The command that runs `moku-game`, with the runner flags (`--preload`, `--serve-plugin`) in it. */
  command: string;
  /** The home folder, where a `~/` of a keystore path starts. */
  home: string;
};

/** What `--store` hands a verb: the number, and the seams of its checks. */
export type NativeStore = {
  /** The `--build-number`, one number for both stores. */
  buildNumber: number;
  /** `--dev`: the test app of `native.dev`, not the players' app. */
  dev?: true;
  /** `--upload`: after the build, the `.ipa` goes to App Store Connect. iOS only. */
  upload?: true;
  /** The environment the password variables and the App Store Connect key are looked up in. */
  env: Readonly<Record<string, string | undefined>>;
  /** Tells whether a file is there. */
  exists: (path: string) => boolean;
};

/**
 * The App Store Connect key a build signs with and an upload sends: the two ids and the `.p8` file,
 * from `native.signing.apple` or from the env vars Tauri reads.
 */
export type AppleKey = {
  /** The key id, the value of `APPLE_API_KEY`. */
  keyId: string;
  /** The issuer id of the team, the value of `APPLE_API_ISSUER`. */
  issuer: string;
  /** The `.p8` file, the value of `APPLE_API_KEY_PATH`; absolute when `config.ts` names it. */
  keyPath: string;
};

/** What the command line adds to a verb. */
export type NativeVerbOptions = {
  /** The target the command line names, unchecked. */
  target?: string;
  /** iOS: build the simulator slice instead of a device archive. */
  simulator?: boolean;
  /** Build a debug app: the web page with the editor agent and its control profile; `native build` on Android and iOS only. */
  debug?: DebugLevel;
  /** The `host:port` the page agent of the debug app dials, when `--editor` gave one. */
  editor?: string;
  /** The `version` of the game's `package.json`, unchecked. */
  version?: string;
  /** A store build: `native build ios` or `android` with `--store`. */
  store?: NativeStore;
  /** A plain Android build whose passwords are not set: the upload key stays out of it. */
  unsigned?: true;
  /** `clean`: the test projects that exist, absolute, each cleaned after `.moku/tauri`. */
  testProjects?: readonly string[];
};

/** What `storeProblems` checks: one store build, before anything compiles. */
export type StoreInput = {
  /** The resolved `config.ts` of the game. */
  settings: ResolvedGameConfig;
  /** The store's target. */
  target: "ios" | "android";
  /** The game folder, absolute. */
  cwd: string;
  /** The home folder. */
  home: string;
  /** The `version` of the game's `package.json`, unchecked. */
  version: string | undefined;
  /** The number and the seams of the checks. */
  store: NativeStore;
};

/** The debug profile of a native build: the web build's `--debug` level and its `--editor`. */
type NativeDebug = { level: DebugLevel; editor?: string | undefined };

/** What one run adds to `config.ts`: a build number means a store build. */
type NativeExtras = {
  debug?: NativeDebug;
  buildNumber?: number;
  version?: string;
  unsigned?: true;
  dev?: true;
};

/** The native section of a resolved config. */
type NativeSection = NonNullable<ResolvedGameConfig["native"]>;

/** The env vars Tauri signs an iOS build with, from an App Store Connect key. */
type AppleKeyVariables = {
  APPLE_API_KEY: string;
  APPLE_API_ISSUER: string;
  APPLE_API_KEY_PATH: string;
};

/** The line of an `--upload` that finds no App Store Connect key, in `config.ts` or the env. */
const NO_UPLOAD_KEY =
  "--upload needs an App Store Connect key. Add apiKeyId, apiIssuer and apiKeyPath to native.signing.apple, or set APPLE_API_KEY, APPLE_API_ISSUER and APPLE_API_KEY_PATH.";

/** The part of the `@moku-labs/native` module a verb runs on. */
type NativeModule = { createApp: typeof createApp };

/** The name, the identifier and the icon of the app one run builds. */
type AppIdentity = Pick<NativeSection, "name" | "identifier"> & { icon: string | undefined };

/**
 * What `cli.build` of `@moku-labs/native` takes: the target, the iOS simulator slice, the debug
 * profile, which native's `BuildFlavor.debug` reads (the debug app installs beside the store app;
 * the engine renames it on iOS only), the dev profile of a test app, which `BuildFlavor.dev` reads,
 * and the store bundle of a store build on Android.
 */
type BuildOptions = {
  target: Target | undefined;
  simulator: boolean | undefined;
  debug?: true;
  dev?: true;
  aab?: true;
};

/**
 * The part of the `@moku-labs/native` config a game's `config.ts` decides. `signing` is required in
 * native's `Config`, so it comes as optional here: a plain config writes no `signing: {}`.
 */
export type NativeConfig = Pick<Config, "app" | "web" | "system" | "projectDir" | "outDir"> &
  Partial<Pick<Config, "signing" | "ios">> & {
    /** The targets the native app ships. Left out, native builds for the host. */
    targets?: readonly Target[];
  };

/**
 * The native section of a resolved config.
 *
 * @param settings - The resolved `config.ts` of the game.
 * @returns The native section.
 * @throws {Error} When `config.ts` has no native section.
 */
function nativeSectionOf(settings: ResolvedGameConfig): NativeSection {
  if (settings.native === undefined) {
    throw new Error(
      "[game] config.ts has no native section.\n  Add native: { name, identifier } to config.ts."
    );
  }

  return settings.native;
}

/**
 * Makes a keystore or `.p8` path absolute, since Gradle reads a relative one under
 * `gen/android/app`: `~/` starts at the home folder, anything else at the game folder.
 *
 * @param keystore - The path `config.ts` gives.
 * @param cwd - The game folder.
 * @param home - The home folder.
 * @returns The absolute path.
 * @example
 * ```ts
 * resolveKeystore("~/keys/upload.jks", "/g", "/home/a"); // "/home/a/keys/upload.jks"
 * ```
 */
function resolveKeystore(keystore: string, cwd: string, home: string): string {
  return keystore.startsWith("~/")
    ? path.join(home, keystore.slice(2))
    : path.resolve(cwd, keystore);
}

/**
 * The App Store Connect key of `config.ts`, its `.p8` path made absolute as a keystore's is.
 *
 * @param native - `native` of the resolved config.
 * @param where - The game folder and the home folder.
 * @returns The key, or `undefined` when `native.signing.apple` names none.
 * @example
 * ```ts
 * appleKeyOf({ name: "T", identifier: "com.acme.t", signing: { apple: { teamId: "ABCDE12345", apiKeyId: "ABC123DEF4", apiIssuer: "i-1", apiKeyPath: "keys/k.p8" } } }, { cwd: "/g", home: "/home/a" }); // { keyId: "ABC123DEF4", issuer: "i-1", keyPath: "/g/keys/k.p8" }
 * ```
 */
export function appleKeyOf(
  native: ResolvedGameConfig["native"],
  where: Pick<NativeWhere, "cwd" | "home">
): AppleKey | undefined {
  const apple = native?.signing?.apple;

  if (
    apple?.apiKeyId === undefined ||
    apple.apiIssuer === undefined ||
    apple.apiKeyPath === undefined
  ) {
    return undefined;
  }

  return {
    keyId: apple.apiKeyId,
    issuer: apple.apiIssuer,
    keyPath: resolveKeystore(apple.apiKeyPath, where.cwd, where.home)
  };
}

/**
 * The App Store Connect key of the env: the three variables Tauri reads, each set and not empty.
 *
 * @param env - The environment.
 * @returns The key, its path as the env gives it, or `undefined` without all three.
 * @example
 * ```ts
 * envAppleKeyOf({ APPLE_API_KEY: "ABC123DEF4", APPLE_API_ISSUER: "i-1" }); // undefined
 * ```
 */
function envAppleKeyOf(env: NativeStore["env"]): AppleKey | undefined {
  const keyId = env.APPLE_API_KEY ?? "";
  const issuer = env.APPLE_API_ISSUER ?? "";
  const keyPath = env.APPLE_API_KEY_PATH ?? "";

  return keyId === "" || issuer === "" || keyPath === "" ? undefined : { keyId, issuer, keyPath };
}

/**
 * The App Store Connect key an upload sends: the one of `config.ts`, else the three env vars.
 *
 * @param native - `native` of the resolved config.
 * @param where - The game folder and the home folder.
 * @param env - The environment.
 * @returns The key, or `undefined` when there is none.
 * @example
 * ```ts
 * uploadKeyOf({ name: "T", identifier: "com.acme.t" }, { cwd: "/g", home: "/home/a" }, { APPLE_API_KEY: "ABC123DEF4", APPLE_API_ISSUER: "i-1", APPLE_API_KEY_PATH: "/k/AuthKey.p8" }); // { keyId: "ABC123DEF4", issuer: "i-1", keyPath: "/k/AuthKey.p8" }
 * ```
 */
export function uploadKeyOf(
  native: ResolvedGameConfig["native"],
  where: Pick<NativeWhere, "cwd" | "home">,
  env: NativeStore["env"]
): AppleKey | undefined {
  return appleKeyOf(native, where) ?? envAppleKeyOf(env);
}

/**
 * The env vars of an App Store Connect key, by the names Tauri reads.
 *
 * @param key - The key.
 * @returns The three variables.
 * @example
 * ```ts
 * appleKeyVariablesOf({ keyId: "ABC123DEF4", issuer: "i-1", keyPath: "/k.p8" }).APPLE_API_KEY_PATH; // "/k.p8"
 * ```
 */
function appleKeyVariablesOf(key: AppleKey): AppleKeyVariables {
  return {
    APPLE_API_KEY: key.keyId,
    APPLE_API_ISSUER: key.issuer,
    APPLE_API_KEY_PATH: key.keyPath
  };
}

/**
 * The command that uploads an `.ipa` to App Store Connect with a team key: `xcrun altool`, the
 * path as one word, spaces and all.
 *
 * @param ipa - The `.ipa` file, absolute.
 * @param key - The App Store Connect key.
 * @returns The argv.
 * @example
 * ```ts
 * uploadArgvOf("/g/dist-native/ios/T.ipa", { keyId: "ABC123DEF4", issuer: "i-1", keyPath: "/k.p8" }); // ["xcrun", "altool", "--upload-app", "-f", "/g/dist-native/ios/T.ipa", "-t", "ios", "--api-key", "ABC123DEF4", "--api-issuer", "i-1", "--p8-file-path", "/k.p8"]
 * ```
 */
export function uploadArgvOf(ipa: string, key: AppleKey): string[] {
  return [
    "xcrun",
    "altool",
    "--upload-app",
    "-f",
    ipa,
    "-t",
    "ios",
    "--api-key",
    key.keyId,
    "--api-issuer",
    key.issuer,
    "--p8-file-path",
    key.keyPath
  ];
}

/**
 * The folder native leaves the `.ipa` of an iOS store build in: under `dist-native`, or under
 * `dist-native-dev` for the test app.
 *
 * @param cwd - The game folder.
 * @param store - The store block, for its `dev` mark.
 * @returns The folder, absolute.
 * @example
 * ```ts
 * uploadFolderOf("/g", { dev: true }); // "/g/dist-native-dev/ios"
 * ```
 */
export function uploadFolderOf(cwd: string, store: Pick<NativeStore, "dev">): string {
  return path.join(cwd, store.dev === true ? DEV_OUT : STORE_OUT, "ios");
}

/**
 * The password variables of an Android signing block that are unset or empty, by name only. The
 * key password falls back to the keystore's.
 *
 * @param android - `native.signing.android`, when the game has one.
 * @param env - The environment.
 * @returns The names of the variables.
 * @example
 * ```ts
 * missingPasswords({ keystorePath: "k.jks", keystorePasswordEnv: "KS", keyAlias: "a" }, { KS: "" }); // ["KS"]
 * ```
 */
export function missingPasswords(
  android: NonNullable<NativeSection["signing"]>["android"],
  env: NativeStore["env"]
): readonly string[] {
  if (android === undefined) return [];

  const names = new Set([
    android.keystorePasswordEnv,
    android.keyPasswordEnv ?? android.keystorePasswordEnv
  ]);

  return [...names].filter(name => (env[name] ?? "") === "");
}

/**
 * The problems of the Android row of a store build: the signing block, the keystore file, and the
 * two password variables, by name only.
 *
 * @param native - The native section.
 * @param input - The store build.
 * @returns One line per problem.
 */
function androidProblems(native: NativeSection, input: StoreInput): readonly string[] {
  const android = native.signing?.android;

  if (android === undefined) {
    return [
      "No native.signing.android in config.ts. Add keystorePath, keystorePasswordEnv and keyAlias."
    ];
  }

  const keystore = resolveKeystore(android.keystorePath, input.cwd, input.home);

  return [
    ...(input.store.exists(keystore) ? [] : [`The keystore ${keystore} is not a file.`]),
    ...missingPasswords(android, input.store.env).map(
      name => `The env var ${name} is not set. It holds a signing password.`
    )
  ];
}

/**
 * The problems of the App Store Connect key of an iOS store build: a `.p8` of `config.ts` that is
 * not a file, and for `--upload` no key at all or an env key whose file is not there. A line names
 * the resolved path of `config.ts` or the variable, never the value of a variable.
 *
 * @param native - The native section.
 * @param input - The store build.
 * @returns One line, or none for a key that can go.
 */
function appleKeyProblems(native: NativeSection, input: StoreInput): readonly string[] {
  const key = appleKeyOf(native, input);

  if (key !== undefined) {
    return input.store.exists(key.keyPath)
      ? []
      : [
          `The App Store Connect key ${key.keyPath} is not a file. Fix native.signing.apple.apiKeyPath.`
        ];
  }

  if (input.store.upload !== true) return [];

  const envKey = envAppleKeyOf(input.store.env);

  if (envKey === undefined) return [NO_UPLOAD_KEY];

  return input.store.exists(envKey.keyPath)
    ? []
    : ["The file of APPLE_API_KEY_PATH is not a file."];
}

/**
 * The problems of the iOS row of a store build: the Apple signing block, and the App Store Connect
 * key, which `config.ts` names or the env holds for Tauri.
 *
 * @param native - The native section.
 * @param input - The store build.
 * @returns One line per problem.
 */
function appleProblems(native: NativeSection, input: StoreInput): readonly string[] {
  return [
    ...(native.signing?.apple === undefined
      ? ["No native.signing.apple in config.ts. Add teamId."]
      : []),
    ...appleKeyProblems(native, input)
  ];
}

/**
 * The problem of a `package.json` version a store build cannot ship.
 *
 * @param version - The version, unchecked.
 * @returns One line, or none for an `x.y.z`.
 * @example
 * ```ts
 * versionProblems("1.2"); // ['package.json has version "1.2". Use x.y.z, such as 1.0.0.']
 * ```
 */
function versionProblems(version: string | undefined): readonly string[] {
  if (version === undefined) return ["package.json has no version. Add one, such as 1.0.0."];

  return STORE_VERSION.test(version)
    ? []
    : [`package.json has version "${version}". Use x.y.z, such as 1.0.0.`];
}

/**
 * The last parts of an identifier that never goes to a store.
 *
 * @returns The set of words.
 * @example
 * ```ts
 * testSuffixes().has("soak"); // true
 * ```
 */
function testSuffixes(): ReadonlySet<string> {
  return new Set(["soak", "debug", "dev", "test", "staging"]);
}

/**
 * The problem of a test app's identifier: it must end in `.dev`, the word the real one may not.
 *
 * @param dev - `native.dev` of a raw config: the checks of `resolveConfig` have not run on it.
 * @returns One line, or none for a good identifier.
 * @example
 * ```ts
 * devIdentifierProblems({ identifier: "com.acme.t.dev" }); // []
 * ```
 */
function devIdentifierProblems(dev: NativeSection["dev"]): readonly string[] {
  if (dev === undefined) return ["No native.dev in config.ts. Add identifier, ending in .dev."];

  return dev.identifier.endsWith(TEST_APP_SUFFIX)
    ? []
    : [`The test identifier ${dev.identifier} does not end in .dev. Fix native.dev.identifier.`];
}

/**
 * The problem of an identifier that names a test build.
 *
 * @param identifier - `native.identifier`.
 * @returns One line, or none for a real identifier.
 * @example
 * ```ts
 * identifierProblems("com.acme.t"); // []
 * ```
 */
function identifierProblems(identifier: string): readonly string[] {
  const last = identifier.slice(identifier.lastIndexOf(".") + 1);

  return testSuffixes().has(last)
    ? [`The identifier ${identifier} ends in .${last}. A store build ships the real identifier.`]
    : [];
}

/**
 * Everything that stops a store build, all at once, so one run shows every fix. A message names a
 * field, a path, a value of `package.json` or an env var, never the value of a variable.
 *
 * @param input - The store build.
 * @returns One line per problem, none for a build that can go.
 * @throws {Error} When `config.ts` has no native section.
 * @example
 * ```ts
 * const settings = resolveConfig({ page: { title: "T" }, native: { name: "T", identifier: "com.acme.t" } });
 * const store = { buildNumber: 12, env: {}, exists: () => true };
 * storeProblems({ settings, target: "ios", cwd: "/g", home: "/home/a", version: "1.2.3", store }); // ["No native.signing.apple in config.ts. Add teamId."]
 * ```
 */
export function storeProblems(input: StoreInput): readonly string[] {
  const native = nativeSectionOf(input.settings);

  return [
    ...(input.target === "android" ? androidProblems(native, input) : appleProblems(native, input)),
    ...versionProblems(input.version),
    ...(input.store.dev === true
      ? devIdentifierProblems(native.dev)
      : identifierProblems(native.identifier))
  ];
}

/**
 * The system rows native packages: one per system plugin that needs a Tauri capability. The
 * webview's own events and wake lock serve `lifecycle` and `keepAwake`, so they need no row. A
 * `"store"` save needs the store row even when `system` leaves it out.
 *
 * @param settings - The resolved `config.ts` of the game.
 * @returns The rows, in the order of `config.system`.
 */
function systemRowsOf(settings: ResolvedGameConfig): Config["system"] {
  const names: string[] = settings.system.filter(
    name => name !== "lifecycle" && name !== "keepAwake"
  );

  if (settings.save === "store" && !names.includes("store")) {
    names.push("store");
  }

  return names.map(name => ({ name }));
}

/**
 * The web build command native runs: `moku-game build`, with the debug profile and the editor
 * address of a debug app.
 *
 * @param where - The game folder and the command that runs `moku-game`.
 * @param debug - The debug profile, or `undefined` for a store app.
 * @returns The command.
 * @example
 * ```ts
 * webBuildOf({ cwd: "/g", command: '"bun" "/g/bin/moku-game.mjs"', home: "/home/a" }, { level: "full", editor: "192.168.1.20:47600" }); // '"bun" "/g/bin/moku-game.mjs" build --debug --editor 192.168.1.20:47600'
 * ```
 */
function webBuildOf(where: NativeWhere, debug: NativeDebug | undefined): string {
  if (debug === undefined) return `${where.command} build`;

  // `--debug` is the full profile; the read-only one is spelled out.
  const level = debug.level === "full" ? "--debug" : "--debug=read";
  const editor = debug.editor === undefined ? "" : ` --editor ${debug.editor}`;

  return `${where.command} build ${level}${editor}`;
}

/**
 * The app this run builds: the game's, the test app of a dev build, or on iOS the debug app, which
 * the engine names since native renames only on Android.
 *
 * @param native - The native section.
 * @param target - The target of the verb.
 * @param extras - The debug profile and the dev flag of this run.
 * @returns The name, the identifier and the icon, when there is one.
 * @example
 * ```ts
 * appIdentityOf({ name: "T", identifier: "com.x.t" }, "ios", { debug: { level: "full" } }); // { name: "T (debug)", identifier: "com.x.t.debug", icon: undefined }
 * ```
 */
function appIdentityOf(
  native: NativeSection,
  target: Target | undefined,
  extras: NativeExtras
): AppIdentity {
  const { name, identifier, icon, dev } = native;

  if (extras.dev === true && dev !== undefined) {
    return {
      name: dev.name ?? `${name} DEV`,
      identifier: dev.identifier,
      icon: dev.icon ?? icon
    };
  }

  return target === "ios" && extras.debug !== undefined
    ? { name: `${name} (debug)`, identifier: `${identifier}.debug`, icon }
    : { name, identifier, icon };
}

/**
 * The app block of the native config: the identity and the window, and what this run adds.
 *
 * @param settings - The resolved `config.ts` of the game.
 * @param identity - The app this run builds.
 * @param extras - The version and the build number of this run.
 * @returns The app block.
 */
function appOf(
  settings: ResolvedGameConfig,
  identity: AppIdentity,
  extras: NativeExtras
): NativeConfig["app"] {
  return {
    name: identity.name,
    identifier: identity.identifier,
    orientation: settings.page.orientation,
    backgroundColor: settings.page.background,
    ...(identity.icon === undefined ? {} : { icon: identity.icon }),
    ...(extras.version === undefined ? {} : { version: extras.version }),
    ...(extras.buildNumber === undefined ? {} : { buildNumber: String(extras.buildNumber) }),
    ...(settings.system.includes("keepAwake") ? { keepScreenOn: true } : {})
  };
}

/**
 * The signing block of the native config. A debug build keeps native's SDK key, so it takes no
 * upload key, and neither does a plain build without its passwords, which Gradle would refuse only
 * after the compile; a store build on iOS exports for App Store Connect, and only that one does.
 *
 * @param native - The native section.
 * @param where - The game folder and the home folder.
 * @param target - The target of the verb.
 * @param extras - The debug profile and the build number of this run.
 * @returns The block, empty when there is nothing to pass.
 */
function signingOf(
  native: NativeSection,
  where: NativeWhere,
  target: Target | undefined,
  extras: NativeExtras
): Config["signing"] {
  const android = native.signing?.android;
  const teamId = native.signing?.apple?.teamId;
  const isStoreIos = target === "ios" && extras.buildNumber !== undefined;
  const keyStaysOut =
    android === undefined || extras.debug !== undefined || extras.unsigned === true;

  // The Apple block: the team, the iOS minimum, the export of a store build.
  const apple: Config["signing"]["apple"] = {
    ...(teamId === undefined ? {} : { teamId }),
    ...(target === "ios"
      ? { iosMinimumSystemVersion: native.ios?.minimumVersion ?? IOS_MINIMUM }
      : {}),
    ...(isStoreIos ? { exportMethod: "app-store-connect" as const } : {})
  };

  return {
    ...(keyStaysOut
      ? {}
      : {
          android: {
            ...android,
            keystorePath: resolveKeystore(android.keystorePath, where.cwd, where.home)
          }
        }),
    ...(Object.keys(apple).length === 0 ? {} : { apple })
  };
}

/**
 * The iOS block of the native config. Native takes the manifest as an absolute path only.
 *
 * @param native - The native section.
 * @param cwd - The game folder.
 * @returns The block, empty when the game adds nothing to the bundle.
 */
function iosBundleOf(native: NativeSection, cwd: string): NonNullable<Config["ios"]> {
  const infoPlist = native.ios?.infoPlist;
  const manifest = native.ios?.privacyManifest;

  return {
    ...(infoPlist === undefined ? {} : { infoPlist }),
    ...(manifest === undefined ? {} : { privacyManifest: path.resolve(cwd, manifest) })
  };
}

/**
 * The project folder of one run: a test app and an iOS debug app each have their own, since tauri
 * refuses to rename an app in one tree.
 *
 * @param target - The target of the verb.
 * @param extras - The debug profile and the dev flag of this run.
 * @returns The folder, relative to the game.
 * @example
 * ```ts
 * projectOf("android", { debug: { level: "full" } }); // ".moku/tauri"
 * ```
 */
function projectOf(target: Target | undefined, extras: NativeExtras): string {
  if (extras.dev === true) return DEV_PROJECT;

  return target === "ios" && extras.debug !== undefined ? DEBUG_PROJECT : STORE_PROJECT;
}

/**
 * Lists the test projects of a game, which `moku-game native clean` removes too.
 *
 * @param cwd - The game folder.
 * @returns The absolute folders, whether they exist or not.
 * @example
 * ```ts
 * testProjectsOf("/g"); // ["/g/.moku/tauri-dev", "/g/.moku/tauri-debug"]
 * ```
 */
export function testProjectsOf(cwd: string): readonly string[] {
  return [DEV_PROJECT, DEBUG_PROJECT].map(folder => path.join(cwd, folder));
}

/**
 * Maps a game's resolved `config.ts` to the config of `@moku-labs/native`: the app from `native`
 * and `page`, the web build through `moku-game`, the system rows, the targets, the signing, the
 * iOS bundle, and the Tauri project and output folders under the game. An Android app composes
 * native's `shell` system first, the one that sets `globalThis.__MOKU_NATIVE__`. A debug app
 * builds its web page with the same profile and `--editor`; on Android its name and identifier stay
 * the game's and native renames it, on iOS the engine does, in a project of its own. A dev build is
 * a store build of the test app of `native.dev`, in its own project and output folders, with the
 * full debug page. A build number means a store build.
 *
 * @param settings - The resolved `config.ts` of the game.
 * @param where - The game folder, the command that runs `moku-game` and the home folder.
 * @param target - The target of the verb, used when `config.ts` names no targets.
 * @param extras - What this run adds: the debug profile, the dev flag, the build number, the version.
 * @returns The config for `createApp({ config })` of `@moku-labs/native`.
 * @throws {Error} When `config.ts` has no native section.
 * @example
 * ```ts
 * const where = { cwd: "/g", command: '"/usr/local/bin/bun" "/g/node_modules/@moku-labs/game/bin/moku-game.mjs" "--root" "/g"', home: "/home/a" };
 * nativeConfigOf(resolveConfig({ page: { title: "T" }, native: { name: "T", identifier: "com.x.t" } }), where, "ios").web.dist; // "/g/dist/web"
 * ```
 */
export function nativeConfigOf(
  settings: ResolvedGameConfig,
  where: NativeWhere,
  target: Target | undefined,
  extras: NativeExtras = {}
): NativeConfig {
  const native = nativeSectionOf(settings);
  const rows = systemRowsOf(settings);
  const isTestApp = extras.dev === true;
  const config: NativeConfig = {
    app: appOf(settings, appIdentityOf(native, target, extras), extras),
    web: {
      cwd: where.cwd,
      // A dev page is `--debug` as it is: the profile in native's env does the rest.
      build: webBuildOf(where, isTestApp ? { level: "full" } : extras.debug),
      devCommand: `${where.command} dev --port ${DEV_PORT}`,
      devUrl: `http://127.0.0.1:${DEV_PORT}`,
      dist: path.join(where.cwd, "dist/web")
    },
    // Every Android build composes the native shell once, first.
    system:
      target === "android"
        ? [{ name: "shell" }, ...rows.filter(row => row.name !== "shell")]
        : rows,
    projectDir: path.join(where.cwd, projectOf(target, extras)),
    outDir: path.join(where.cwd, isTestApp ? DEV_OUT : STORE_OUT)
  };
  const targets = native.targets ?? (target === undefined ? undefined : [target]);
  const signing = signingOf(native, where, target, extras);
  const ios = iosBundleOf(native, where.cwd);

  if (targets !== undefined) {
    config.targets = targets;
  }

  if (Object.keys(signing).length > 0) {
    config.signing = signing;
  }

  if (Object.keys(ios).length > 0) {
    config.ios = ios;
  }

  return config;
}

/**
 * Checks the target of a verb against the targets native knows. `build` and `dev` need one.
 *
 * @param known - The `TARGETS` of `@moku-labs/native`.
 * @param verb - The native verb.
 * @param given - The target the command line names, unchecked.
 * @returns The target, or `undefined` for a `doctor` or `clean` over every target.
 * @throws {Error} When the target is unknown, or `build` or `dev` names none.
 */
function targetOf(
  known: readonly Target[],
  verb: NativeVerb,
  given: string | undefined
): Target | undefined {
  const target = known.find(name => name === given);

  if (given !== undefined && target === undefined) {
    throw new Error(`[game] No native target "${given}".\n  Name one of ${known.join(", ")}.`);
  }

  if (target === undefined && verb === "build") {
    throw new Error(
      "[game] moku-game native build needs a target.\n  Run: moku-game native build ios --simulator."
    );
  }

  if (target === undefined && verb === "dev") {
    throw new Error(
      "[game] moku-game native dev needs a target.\n  Run: moku-game native dev ios."
    );
  }

  return target;
}

/**
 * Runs one verb on the cli of a started native app.
 *
 * @param cli - The cli of the native app.
 * @param verb - The native verb.
 * @param target - The checked target.
 * @param options - The simulator flag, the debug profile of a debug app, and the store flag.
 * @returns The boolean of `doctor`, true for the other verbs once they finish.
 */
async function runVerb(
  cli: Cli.Api,
  verb: NativeVerb,
  target: Target | undefined,
  options: NativeVerbOptions
): Promise<boolean> {
  switch (verb) {
    case "build": {
      const build: BuildOptions = {
        target,
        simulator: options.simulator,
        ...(options.debug === undefined ? {} : { debug: true }),
        ...(options.store?.dev === true ? { dev: true } : {}),
        ...(options.store !== undefined && target === "android" ? { aab: true } : {})
      };

      await cli.build(build);
      return true;
    }
    case "dev": {
      await cli.dev({ target });
      return true;
    }
    case "doctor": {
      return cli.doctor({ target });
    }
    case "clean": {
      await cli.clean({ target });
      return true;
    }
  }
}

/**
 * What this run adds to the native config. A version that is not `x.y.z` stays out, and native
 * falls back to its own; `--store` has refused one before this reads it.
 *
 * @param options - The verb options.
 * @returns The extras of `nativeConfigOf`.
 */
function extrasOf(options: NativeVerbOptions): NativeExtras {
  const { debug, editor, store, unsigned, version } = options;

  return {
    ...(debug === undefined ? {} : { debug: { level: debug, editor } }),
    ...(store === undefined ? {} : { buildNumber: store.buildNumber }),
    ...(store?.dev === true ? { dev: true } : {}),
    ...(unsigned === undefined ? {} : { unsigned }),
    ...(version !== undefined && STORE_VERSION.test(version) ? { version } : {})
  };
}

/**
 * Throws every problem of a store build as one error. A plain build passes untouched.
 *
 * @param settings - The resolved `config.ts` of the game.
 * @param where - The game folder and the home folder.
 * @param options - The verb options.
 * @throws {Error} With a line per problem.
 */
function refuseStoreProblems(
  settings: ResolvedGameConfig,
  where: NativeWhere,
  options: NativeVerbOptions
): void {
  if (options.store === undefined) return;

  const problems = storeProblems({
    settings,
    // `--store` lets only these two through, and every target but iOS takes the Android checks.
    target: options.target === "ios" ? "ios" : "android",
    cwd: where.cwd,
    home: where.home,
    version: options.version,
    store: options.store
  });

  if (problems.length > 0) {
    throw new Error(
      `[game] native --store: fix these before a store build.\n  ${problems.join("\n  ")}`
    );
  }
}

/**
 * Runs one verb on a native app of its own over one config, and stops the app.
 *
 * @param native - The `@moku-labs/native` module.
 * @param config - The native config.
 * @param verb - The native verb.
 * @param target - The checked target.
 * @param options - The verb options.
 * @returns True when the verb succeeded, false when it failed.
 */
async function runApp(
  native: NativeModule,
  config: NativeConfig,
  verb: NativeVerb,
  target: Target | undefined,
  options: NativeVerbOptions
): Promise<boolean> {
  const app = native.createApp({ config });

  await app.start();

  try {
    return await runVerb(app.cli, verb, target, options);
  } catch {
    // Native's cli has printed the failure with the last lines of the toolchain.
    return false;
  } finally {
    await app.stop();
  }
}

/**
 * Runs one verb over the native config, and for `clean` once more per test project, one after the
 * other.
 *
 * @param native - The `@moku-labs/native` module.
 * @param config - The native config.
 * @param verb - The native verb.
 * @param target - The checked target.
 * @param options - The verb options.
 * @returns True when the verb succeeded on every folder.
 */
async function runApps(
  native: NativeModule,
  config: NativeConfig,
  verb: NativeVerb,
  target: Target | undefined,
  options: NativeVerbOptions
): Promise<boolean> {
  let passed = await runApp(native, config, verb, target, options);

  // One folder that will not go stops none of the others.
  for (const project of options.testProjects ?? []) {
    const cleaned = await runApp(native, { ...config, projectDir: project }, verb, target, options);

    passed &&= cleaned;
  }

  return passed;
}

/**
 * The env an iOS `build` or `dev` signs with when `config.ts` names the App Store Connect key.
 *
 * @param native - The native section.
 * @param where - The game folder and the home folder.
 * @param verb - The native verb.
 * @param target - The checked target.
 * @returns The three variables, or `undefined` for another verb or target, or without the key.
 */
function keyVariablesOf(
  native: NativeSection,
  where: NativeWhere,
  verb: NativeVerb,
  target: Target | undefined
): AppleKeyVariables | undefined {
  if (target !== "ios" || (verb !== "build" && verb !== "dev")) return undefined;

  const key = appleKeyOf(native, where);

  return key === undefined ? undefined : appleKeyVariablesOf(key);
}

/**
 * Runs with the given variables in the env of this process, which native's Tauri spawn passes on,
 * and puts back every earlier value, or its absence, when the run ends, also when it throws.
 *
 * @param values - The variables, or `undefined` to leave the env untouched.
 * @param run - The run.
 * @returns What the run answers.
 */
async function withProcessVariables(
  values: AppleKeyVariables | undefined,
  run: () => Promise<boolean>
): Promise<boolean> {
  if (values === undefined) return run();

  const names = Object.keys(values);
  const before = names.map(name => [name, process.env[name]] as const); // @env-allow: kept to restore

  Object.assign(process.env, values); // @env-allow: native's Tauri spawn reads the key here

  try {
    return await run();
  } finally {
    for (const [name, value] of before) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name); // @env-allow: the variable was not set before
      } else {
        process.env[name] = value; // @env-allow: the person's own value comes back
      }
    }
  }
}

/**
 * Runs one native verb through `@moku-labs/native` over the game's config: once, or for `clean`
 * once per project folder, one after the other. An iOS `build` or `dev` with the App Store Connect
 * key in `config.ts` runs with the key in the env Tauri reads, the earlier env put back after.
 * Native's cli prints the progress and the failure itself.
 *
 * @param verb - The native verb: build, dev, doctor or clean.
 * @param settings - The resolved `config.ts` of the game.
 * @param where - The game folder, the command that runs `moku-game` and the home folder.
 * @param options - The target, the simulator flag, the debug profile, the version, the store build,
 *   the test projects of a `clean`.
 * @returns True when the verb succeeded, false when it failed on any folder.
 * @throws {Error} When `config.ts` has no native section, a store build has a problem, before
 * anything loads, `@moku-labs/native` is not installed, or the target is unknown or missing.
 */
export async function runNative(
  verb: NativeVerb,
  settings: ResolvedGameConfig,
  where: NativeWhere,
  options: NativeVerbOptions
): Promise<boolean> {
  const section = nativeSectionOf(settings);

  refuseStoreProblems(settings, where, options);

  const native = await import("@moku-labs/native").catch((error: unknown) => {
    throw new Error(
      "[game] moku-game native needs @moku-labs/native.\n  Install it: bun add -d @moku-labs/native@^0.3.13.",
      { cause: error }
    );
  });
  const target = targetOf(native.TARGETS, verb, options.target);
  const config = nativeConfigOf(settings, where, target, extrasOf(options));

  return withProcessVariables(keyVariablesOf(section, where, verb, target), () =>
    runApps(native, config, verb, target, options)
  );
}
