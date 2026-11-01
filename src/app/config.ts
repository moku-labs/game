/**
 * @file The defaults of a game's `config.ts`, and the checks of the values TypeScript cannot stop
 * in a file that skips `satisfies GameConfig`. No IO: the page and the CLI both call it. Not
 * exported from any entry.
 */
import type {
  GameConfig,
  OverlayStart,
  ResolvedGameConfig,
  ResolvedPageBoot,
  SaveKind,
  SystemName
} from "./types";

/** The CSS width of a boot picture whose config names none. */
const BOOT_WIDTH = "40vmin";

/** The fade of a boot picture whose config names none, ms. */
const BOOT_FADE_MS = 300;

/** The strings a `native.signing.android` cannot go without. */
const ANDROID_SIGNING_FIELDS = ["keystorePath", "keystorePasswordEnv", "keyAlias"] as const;

/** An iOS version as native takes it: `26.0` or `26.0.1`. */
const IOS_VERSION = /^\d+\.\d+(\.\d+)?$/;

/**
 * The save kinds a config may name.
 *
 * @returns The set of save kinds.
 * @example
 * ```ts
 * saveKinds().has("disk"); // false
 * ```
 */
function saveKinds(): ReadonlySet<string> {
  return new Set<SaveKind>(["memory", "local", "store"]);
}

/**
 * The system plugins the game shell wires, by their `@moku-labs/system` names.
 *
 * @returns The set of system names.
 * @example
 * ```ts
 * systemNames().has("keepAwake"); // true
 * systemNames().has("tray"); // false
 * ```
 */
function systemNames(): ReadonlySet<string> {
  return new Set<SystemName>(["lifecycle", "back", "haptics", "keepAwake", "store"]);
}

/**
 * The modes a debug page may start the overlay in.
 *
 * @returns The set of `debug.overlay` values.
 * @example
 * ```ts
 * overlayStarts().has("pill"); // true
 * ```
 */
function overlayStarts(): ReadonlySet<string> {
  return new Set<OverlayStart>(["closed", "pill", "open"]);
}

/**
 * Tells whether a field of a config is a string with something in it.
 *
 * @param value - The field, unchecked.
 * @returns False for a missing field, an empty string and any other type.
 * @example
 * ```ts
 * isFilled(""); // false
 * ```
 */
function isFilled(value: unknown): boolean {
  return typeof value === "string" && value !== "";
}

/**
 * Finds the first value under an `Info.plist` value that a plist cannot hold.
 *
 * @param value - The value, unchecked.
 * @param at - Its dotted path.
 * @returns The path of the bad value, or `undefined` when all of it is fine.
 * @example
 * ```ts
 * badPlistValue({ a: [true, 7] }, "Key"); // "Key.a.1"
 * ```
 */
function badPlistValue(value: unknown, at: string): string | undefined {
  if (typeof value === "string" || typeof value === "boolean") return undefined;
  if (!(value instanceof Object)) return at;

  for (const [key, child] of Object.entries(value)) {
    const bad = badPlistValue(child, `${at}.${key}`);

    if (bad !== undefined) return bad;
  }

  return undefined;
}

/**
 * Throws for a half-filled `native.signing`.
 *
 * @param signing - `native.signing` of the config.
 * @throws {Error} When `android` misses one of its required strings, or `apple` has no `teamId`.
 */
function checkSigning(signing: NonNullable<GameConfig["native"]>["signing"]): void {
  const android = signing?.android;
  const missing = ANDROID_SIGNING_FIELDS.find(field => !isFilled(android?.[field]));

  if (android !== undefined && missing !== undefined) {
    throw new Error(
      `[game] config.native.signing.android has no ${missing}.\n  Name keystorePath, keystorePasswordEnv and keyAlias.`
    );
  }

  if (signing?.apple !== undefined && !isFilled(signing.apple.teamId)) {
    throw new Error(
      "[game] config.native.signing.apple has no teamId.\n  Name the Apple Developer team id."
    );
  }
}

/**
 * Throws for a value of `native.ios` that would fail deep in a build.
 *
 * @param ios - `native.ios` of the config.
 * @throws {Error} When `minimumVersion` is no iOS version, or a value of `infoPlist`, at any depth,
 * is no plist value.
 */
function checkIos(ios: NonNullable<GameConfig["native"]>["ios"]): void {
  const minimum: unknown = ios?.minimumVersion;
  const isIosVersion = typeof minimum === "string" && IOS_VERSION.test(minimum);

  if (minimum !== undefined && !isIosVersion) {
    throw new Error(
      `[game] config.native.ios.minimumVersion is ${JSON.stringify(minimum)}.\n  Use a version such as "26.0" or "26.0.1".`
    );
  }

  for (const [key, value] of Object.entries(ios?.infoPlist ?? {})) {
    const bad = badPlistValue(value, key);

    if (bad === undefined) continue;

    throw new Error(
      `[game] config.native.ios.infoPlist.${bad} is not a plist value.\n  Use a string, a boolean, an array or an object.`
    );
  }
}

/**
 * Throws for a `native.dev` that cannot name a test app.
 *
 * @param native - `native` of the config.
 * @throws {Error} When the block has no `identifier`, or one that does not end in `.dev` or is
 * `native.identifier` itself, or when `name` or `icon` is an empty string.
 */
function checkTestApp(native: GameConfig["native"]): void {
  const dev = native?.dev;

  if (dev === undefined) return;

  if (!isFilled(dev.identifier)) {
    throw new Error("[game] config.native.dev has no identifier.\n  Name one that ends in .dev.");
  }

  if (!dev.identifier.endsWith(".dev")) {
    throw new Error(
      `[game] config.native.dev.identifier is "${dev.identifier}".\n  Use one that ends in .dev.`
    );
  }

  if (dev.identifier === native?.identifier) {
    throw new Error(
      `[game] config.native.dev.identifier is "${dev.identifier}", the same as native.identifier.\n  The test app needs an id of its own.`
    );
  }

  if (dev.name === "") {
    throw new Error(
      "[game] config.native.dev.name is empty.\n  Name the test app, or leave the field out."
    );
  }

  if (dev.icon === "") {
    throw new Error(
      "[game] config.native.dev.icon is empty.\n  Name a 1024 px PNG, or leave the field out."
    );
  }
}

/**
 * Throws for the first value of a config that TypeScript would have refused.
 *
 * @param config - The default export of `config.ts`.
 * @throws {Error} When `save` is not a save kind, a `system` name is not wired, the title is empty,
 * `debug.overlay` is not a start mode, `page.boot` has no image, `page.boot.fadeMs` is not a finite number of 0
 * or more, `native.signing` is half filled, `native.ios.minimumVersion` is no iOS version, a value of
 * `native.ios.infoPlist` is no plist value, or `native.dev` cannot name a test app.
 */
function checkConfig(config: GameConfig): void {
  if (config.save !== undefined && !saveKinds().has(config.save)) {
    throw new Error(`[game] config.save is "${config.save}".\n  Use "memory", "local" or "store".`);
  }

  const wired = systemNames();
  const unwired = config.system?.find(name => !wired.has(name));

  if (unwired !== undefined) {
    throw new Error(
      `[game] config.system names "${unwired}", which the game shell does not wire.\n  Use lifecycle, back, haptics, keepAwake or store.`
    );
  }

  if (config.page.title.trim() === "") {
    throw new Error("[game] config.page.title is empty.\n  Give the page a title in config.ts.");
  }

  const overlay = config.debug?.overlay;

  if (overlay !== undefined && !overlayStarts().has(overlay)) {
    throw new Error(
      `[game] config.ts: debug.overlay must be "closed", "pill" or "open", got "${String(overlay)}".`
    );
  }

  const image: unknown = config.page.boot?.image;
  const bootWithoutImage =
    config.page.boot !== undefined && (typeof image !== "string" || image === "");

  if (bootWithoutImage) {
    throw new Error(
      "[game] config.page.boot has no image.\n  Name a picture file of the game in page.boot.image."
    );
  }

  const fadeMs = config.page.boot?.fadeMs;
  const badFade = fadeMs !== undefined && !(Number.isFinite(fadeMs) && fadeMs >= 0);

  if (badFade) {
    throw new Error(
      `[game] config.page.boot.fadeMs is ${String(fadeMs)}.\n  Use a number of milliseconds, 0 or more.`
    );
  }

  checkSigning(config.native?.signing);
  checkIos(config.native?.ios);
  checkTestApp(config.native);
}

/**
 * Fills the defaults of `page.boot`: the width `"40vmin"`, the fade 300 ms.
 *
 * @param boot - `page.boot` of the config.
 * @returns The boot with every field set.
 * @example
 * ```ts
 * resolveBoot({ image: "assets/boot.png", fadeMs: 0 }); // { image: "assets/boot.png", width: "40vmin", fadeMs: 0 }
 * ```
 */
function resolveBoot(boot: NonNullable<GameConfig["page"]["boot"]>): ResolvedPageBoot {
  return {
    image: boot.image,
    width: boot.width ?? BOOT_WIDTH,
    fadeMs: boot.fadeMs ?? BOOT_FADE_MS
  };
}

/**
 * Fills every default of a game's `config.ts`: `lang` `"en"`, `background` `"#000000"`,
 * `orientation` `"portrait"`, no icons, no head tags, no system plugin, the memory save, no asset
 * layers, the overlay of a debug page closed at its start. A `page.boot` gets the width
 * `"40vmin"` and the fade 300 ms; without one the page has no `boot` key.
 *
 * @param config - The default export of `config.ts`.
 * @returns The config with every field set.
 * @throws {Error} When `save` is not a save kind, a `system` name is not wired, the title is empty,
 * `debug.overlay` is not a start mode, `page.boot` has no image, `page.boot.fadeMs` is not a finite number of 0
 * or more, `native.signing` is half filled, `native.ios.minimumVersion` is no iOS version, a value of
 * `native.ios.infoPlist` is no plist value, or `native.dev` cannot name a test app.
 * @example
 * ```ts
 * resolveConfig({ page: { title: "T" } }).save; // "memory"
 * ```
 */
export function resolveConfig(config: GameConfig): ResolvedGameConfig {
  checkConfig(config);

  return {
    page: {
      title: config.page.title,
      lang: config.page.lang ?? "en",
      background: config.page.background ?? "#000000",
      orientation: config.page.orientation ?? "portrait",
      icons: config.page.icons ?? {},
      head: config.page.head ?? [],
      // Written only with a boot: a page without one resolves as it did before page.boot.
      ...(config.page.boot === undefined ? {} : { boot: resolveBoot(config.page.boot) })
    },
    native: config.native,
    system: config.system ?? [],
    save: config.save ?? "memory",
    assets: { layers: config.assets?.layers ?? {} },
    debug: { overlay: config.debug?.overlay ?? "closed" }
  };
}
