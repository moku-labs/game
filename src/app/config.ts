/**
 * @file The defaults of a game's `config.ts`, and the checks of the values TypeScript cannot stop
 * in a file that skips `satisfies GameConfig`. No IO: the page and the CLI both call it. Not
 * exported from any entry.
 */
import { DEFAULT_ASPECT } from "../plugins/renderer/viewport/fit";
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

/** The pictures a placed boot may name: the native launch still takes only PNG and WebP. */
const PLACED_IMAGE = /\.(?:png|webp)$/i;

/** The strings a `native.signing.android` cannot go without. */
const ANDROID_SIGNING_FIELDS = ["keystorePath", "keystorePasswordEnv", "keyAlias"] as const;

/** The fields of the App Store Connect key, all three or none, in the order a message names them. */
const APPLE_KEY_FIELDS = ["apiKeyId", "apiIssuer", "apiKeyPath"] as const;

/** The last part of a test app's identifier. */
export const TEST_APP_SUFFIX = ".dev";

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
 * Throws for an App Store Connect key named in part: one or two of its fields, or an empty one.
 *
 * @param apple - `native.signing.apple` of the config.
 * @throws {Error} Naming the fields that are there and, in field order, the ones that are not.
 */
function checkAppleKey(
  apple: NonNullable<NonNullable<GameConfig["native"]>["signing"]>["apple"]
): void {
  const written = APPLE_KEY_FIELDS.filter(field => apple?.[field] !== undefined);
  const named = APPLE_KEY_FIELDS.filter(field => isFilled(apple?.[field]));

  if (written.length === 0 || named.length === APPLE_KEY_FIELDS.length) return;

  const missing = APPLE_KEY_FIELDS.filter(field => !named.includes(field));
  const has = named.length === 0 ? "" : `${named.join(", ")} but `;

  throw new Error(
    `[game] config.native.signing.apple has ${has}no ${missing.join(", ")}.\n  Name all three of the App Store Connect key, or none.`
  );
}

/**
 * Throws for a half-filled `native.signing`.
 *
 * @param signing - `native.signing` of the config.
 * @throws {Error} When `android` misses one of its required strings, or `apple` has no `teamId` or
 * a part of the App Store Connect key only.
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

  checkAppleKey(signing?.apple);
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

  if (!dev.identifier.endsWith(TEST_APP_SUFFIX)) {
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
 * Writes a config value the way an error message names it: a string quoted, anything else as is.
 *
 * @param value - The value, unchecked.
 * @returns The text.
 * @example
 * ```ts
 * shown("wide"); // '"wide"'
 * ```
 */
function shown(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/**
 * Throws for a block of `page.boot` that is not an object, and returns it.
 *
 * @param field - The field under `page.boot`, such as `frame`.
 * @param value - The block, unchecked.
 * @param fields - The fields it holds, for the message, such as `{ width, height }`.
 * @returns The block.
 * @throws {Error} When the block is not an object.
 */
function bootBlock(field: string, value: unknown, fields: string): object {
  if (value instanceof Object && !Array.isArray(value)) return value;

  throw new Error(`[game] config.page.boot.${field} is ${shown(value)}.\n  Use ${fields}.`);
}

/**
 * Throws for a number of `page.boot` that is not finite or under its least value, and returns it.
 *
 * @param block - The block that holds it, such as `page.boot.rect`.
 * @param path - The path of the block under `page.boot`, such as `rect`.
 * @param key - The number's key in the block, such as `x`.
 * @param least - `"above 0"` for a size, `"of 0 or more"` for a position.
 * @returns The number.
 * @throws {Error} When the number is missing, not finite, or under its least value.
 */
function bootNumber(
  block: object,
  path: string,
  key: string,
  least: "above 0" | "of 0 or more"
): number {
  const value: unknown = Reflect.get(block, key);
  const inRange =
    typeof value === "number" &&
    Number.isFinite(value) &&
    (least === "above 0" ? value > 0 : value >= 0);

  if (inRange) return value;

  throw new Error(
    `[game] config.page.boot.${path}.${key} is ${shown(value)}.\n  Use a finite number ${least}.`
  );
}

/**
 * Throws for a `frame` or a `rect` of `page.boot` that cannot place the picture: one without the
 * other, a block that is no object or lacks a number, a size that is not above 0, a position under
 * 0, or a rect that leaves the frame.
 *
 * @param frame - `page.boot.frame`, unchecked.
 * @param rect - `page.boot.rect`, unchecked.
 * @throws {Error} Naming the field, its value and the fix.
 */
function checkBootRect(frame: unknown, rect: unknown): void {
  if (rect === undefined) {
    throw new Error(
      "[game] config.page.boot has a frame but no rect.\n  Name page.boot.rect, where the picture lies on the frame."
    );
  }

  if (frame === undefined) {
    throw new Error(
      "[game] config.page.boot has a rect but no frame.\n  Name page.boot.frame, the canvas the rect is given in."
    );
  }

  const canvas = bootBlock("frame", frame, "{ width, height }");
  const frameWidth = bootNumber(canvas, "frame", "width", "above 0");
  const frameHeight = bootNumber(canvas, "frame", "height", "above 0");
  const box = bootBlock("rect", rect, "{ x, y, width, height }");
  const right =
    bootNumber(box, "rect", "x", "of 0 or more") + bootNumber(box, "rect", "width", "above 0");
  const bottom =
    bootNumber(box, "rect", "y", "of 0 or more") + bootNumber(box, "rect", "height", "above 0");

  if (right > frameWidth) {
    throw new Error(
      `[game] config.page.boot.rect ends at x ${right}, past frame.width ${frameWidth}.\n  Keep the rect inside page.boot.frame.`
    );
  }

  if (bottom > frameHeight) {
    throw new Error(
      `[game] config.page.boot.rect ends at y ${bottom}, past frame.height ${frameHeight}.\n  Keep the rect inside page.boot.frame.`
    );
  }
}

/**
 * Throws for an `aspect` or an `orientation` of `page.boot` the page cannot fit a frame with.
 *
 * @param aspect - `page.boot.aspect`, unchecked.
 * @param orientation - `page.boot.orientation`, unchecked.
 * @throws {Error} When `aspect` is no object, `min` is not a finite number above 0, `max` is not a
 * finite number of `min` or more, or `orientation` is neither `"portrait"` nor `"landscape"`.
 */
function checkBootFit(aspect: unknown, orientation: unknown): void {
  if (aspect !== undefined) {
    const range = bootBlock("aspect", aspect, "{ min, max }");
    const min = bootNumber(range, "aspect", "min", "above 0");
    const max: unknown = Reflect.get(range, "max");

    if (!(typeof max === "number" && Number.isFinite(max) && max >= min)) {
      throw new Error(
        `[game] config.page.boot.aspect.max is ${shown(max)}.\n  Use a finite number of aspect.min (${min}) or more.`
      );
    }
  }

  if (orientation !== undefined && orientation !== "portrait" && orientation !== "landscape") {
    throw new Error(
      `[game] config.page.boot.orientation is ${shown(orientation)}.\n  Use "portrait" or "landscape".`
    );
  }
}

/**
 * The error of a field only a placed boot picture reads, set on a centred one.
 *
 * @param field - `aspect` or `orientation`.
 * @returns The error.
 * @example
 * ```ts
 * unplacedError("aspect").message.split("\n")[0]; // "[game] config.page.boot.aspect is set without a frame."
 * ```
 */
function unplacedError(field: "aspect" | "orientation"): Error {
  return new Error(
    `[game] config.page.boot.${field} is set without a frame.\n  Name page.boot.frame and page.boot.rect, or leave ${field} out.`
  );
}

/**
 * Throws for a placement of `page.boot` that the page and the native launch still cannot show.
 * Without `frame` and `rect`, only `aspect` and `orientation` are refused; `width` is never read
 * with a `frame`.
 *
 * @param boot - `page.boot` of the config.
 * @throws {Error} When `frame` and `rect` do not come together or cannot place the picture,
 * `aspect` or `orientation` comes without a frame or is out of range, or a placed `image` is not
 * a `.png` or `.webp`.
 */
function checkBootPlace(boot: NonNullable<GameConfig["page"]["boot"]>): void {
  const { frame, rect, aspect, orientation } = boot;

  // A centred picture: what only a placement reads is refused, everything else is as before.
  if (frame === undefined && rect === undefined) {
    if (aspect !== undefined) throw unplacedError("aspect");
    if (orientation !== undefined) throw unplacedError("orientation");

    return;
  }

  checkBootRect(frame, rect);
  checkBootFit(aspect, orientation);

  if (!PLACED_IMAGE.test(boot.image)) {
    throw new Error(
      `[game] config.page.boot.image "${boot.image}" is not a .png or .webp file.\n  The native launch still takes only those: convert the picture.`
    );
  }
}

/**
 * Throws for the first value of a config that TypeScript would have refused.
 *
 * @param config - The default export of `config.ts`.
 * @throws {Error} When `save` is not a save kind, a `system` name is not wired, the title is empty,
 * `debug.overlay` is not a start mode, `page.boot` has no image, `page.boot.fadeMs` is not a finite number of 0
 * or more, the placement of `page.boot` (`frame`, `rect`, `aspect`, `orientation`, a placed `image`) cannot
 * place the picture, `native.signing` is half filled, `native.ios.minimumVersion` is no iOS version, a value of
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

  if (config.page.boot !== undefined) checkBootPlace(config.page.boot);

  checkSigning(config.native?.signing);
  checkIos(config.native?.ios);
  checkTestApp(config.native);
}

/**
 * Fills the defaults of `page.boot`: the width `"40vmin"`, the fade 300 ms. With `frame` and
 * `rect` it adds `place`: the aspect defaults to the renderer's, the orientation to
 * `page.orientation` when it is `"portrait"` or `"landscape"`, else `"portrait"`.
 *
 * @param boot - `page.boot` of the config, checked.
 * @param orientation - `page.orientation` of the config, or `undefined`.
 * @returns The boot with every field set.
 * @example
 * ```ts
 * resolveBoot({ image: "assets/boot.png", fadeMs: 0 }, "any"); // { image: "assets/boot.png", width: "40vmin", fadeMs: 0 }
 * ```
 */
function resolveBoot(
  boot: NonNullable<GameConfig["page"]["boot"]>,
  orientation: GameConfig["page"]["orientation"]
): ResolvedPageBoot {
  const resolved = {
    image: boot.image,
    width: boot.width ?? BOOT_WIDTH,
    fadeMs: boot.fadeMs ?? BOOT_FADE_MS
  };
  const { frame, rect, aspect = DEFAULT_ASPECT } = boot;

  // A centred picture: no place, the page as before.
  if (frame === undefined || rect === undefined) return resolved;

  return {
    ...resolved,
    // Fresh blocks of the known keys only: nothing else of the config reaches the page or the shell.
    place: {
      frame: { width: frame.width, height: frame.height },
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      aspect: { min: aspect.min, max: aspect.max },
      orientation: boot.orientation ?? (orientation === "landscape" ? "landscape" : "portrait")
    }
  };
}

/**
 * Fills every default of a game's `config.ts`: `lang` `"en"`, `background` `"#000000"`,
 * `orientation` `"portrait"`, no icons, no head tags, no system plugin, the memory save, no asset
 * layers, the overlay of a debug page closed at its start. A `page.boot` gets the width
 * `"40vmin"` and the fade 300 ms, and with `frame` and `rect` a `place` (the renderer's aspect and
 * `page.orientation`, or `"portrait"`, by default); without one the page has no `boot` key.
 *
 * @param config - The default export of `config.ts`.
 * @returns The config with every field set.
 * @throws {Error} When `save` is not a save kind, a `system` name is not wired, the title is empty,
 * `debug.overlay` is not a start mode, `page.boot` has no image, `page.boot.fadeMs` is not a finite number of 0
 * or more, the placement of `page.boot` (`frame`, `rect`, `aspect`, `orientation`, a placed `image`) cannot
 * place the picture, `native.signing` is half filled, `native.ios.minimumVersion` is no iOS version, a value of
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
      ...(config.page.boot === undefined
        ? {}
        : { boot: resolveBoot(config.page.boot, config.page.orientation) })
    },
    native: config.native,
    system: config.system ?? [],
    save: config.save ?? "memory",
    assets: { layers: config.assets?.layers ?? {} },
    debug: { overlay: config.debug?.overlay ?? "closed" }
  };
}
