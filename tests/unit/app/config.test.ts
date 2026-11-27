/**
 * @file `resolveConfig`: the defaults of `config.ts`, and the three values TypeScript cannot stop
 * in a file that skips `satisfies GameConfig`.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import { resolveConfig } from "../../../src/app/config";
import type { GameConfig, PlistValue } from "../../../src/app/types";

/** The name of the variable with the keystore password. */
const STORE_VARIABLE = "KS_PASS";

/** A full Android signing block. */
const android = {
  keystorePath: "~/k.jks",
  keystorePasswordEnv: STORE_VARIABLE,
  keyAlias: "upload"
};

/**
 * A config with a raw part of `native`, as a `config.ts` that skips `satisfies` writes it.
 *
 * @param part - The fields over the name and the identifier.
 * @returns The config.
 */
function nativeWith(part: object): GameConfig {
  return {
    page: { title: "T" },
    native: { name: "T", identifier: "com.acme.t", ...part }
  } as GameConfig;
}

/** The frame of the worked placement: the splash art of A Memory Missing. */
const placedFrame = { width: 1024, height: 1536 };

/** Where the still lies on that frame. */
const placedRect = { x: 215, y: 402, width: 600, height: 640 };

/**
 * The first line of the error a run throws.
 *
 * @param run - What throws.
 * @returns The line, or `"no error"` when nothing was thrown.
 */
function firstLineOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return String((error as Error).message).split("\n")[0] ?? "";
  }

  return "no error";
}

describe("resolveConfig", () => {
  it("fills every default of a config with a title only", () => {
    expect(resolveConfig({ page: { title: "T" } })).toEqual({
      page: {
        title: "T",
        lang: "en",
        background: "#000000",
        orientation: "portrait",
        icons: {},
        head: []
      },
      native: undefined,
      system: [],
      save: "memory",
      assets: { layers: {} },
      debug: { overlay: "closed" }
    });
  });

  it("keeps every value the config sets", () => {
    const config = {
      page: {
        title: "Лесной городок",
        lang: "ru",
        background: "#10161d",
        orientation: "landscape",
        icons: { favicon: "assets/icon.png", appleTouch: "assets/icon-180.png" },
        head: ['<meta name="robots" content="noindex" />']
      },
      native: { name: "Лесной городок", identifier: "com.mokulabs.timber", targets: ["ios"] },
      system: ["lifecycle", "back", "haptics", "keepAwake"],
      save: "local",
      assets: { layers: { shared: "ui" } },
      debug: { overlay: "pill" }
    } satisfies GameConfig;

    expect(resolveConfig(config)).toEqual({ ...config, assets: { layers: { shared: "ui" } } });
  });

  it("debug.overlay defaults to closed; pill and open pass; another value throws naming it", () => {
    expect(resolveConfig({ page: { title: "T" }, debug: {} }).debug).toEqual({ overlay: "closed" });
    expect(resolveConfig({ page: { title: "T" }, debug: { overlay: "open" } }).debug).toEqual({
      overlay: "open"
    });

    const config = { page: { title: "T" }, debug: { overlay: "card" } } as unknown as GameConfig;

    expect(() => resolveConfig(config)).toThrow(
      new Error('[game] config.ts: debug.overlay must be "closed", "pill" or "open", got "card".')
    );
  });

  it("does not share the default lists between two configs", () => {
    const first = resolveConfig({ page: { title: "A" } });
    const second = resolveConfig({ page: { title: "B" } });

    expect(first.system).not.toBe(second.system);
    expect(first.page.head).not.toBe(second.page.head);
  });

  it("refuses a save kind it does not know", () => {
    const config = { page: { title: "T" }, save: "disk" } as unknown as GameConfig;

    expect(() => resolveConfig(config)).toThrow(
      new Error('[game] config.save is "disk".\n  Use "memory", "local" or "store".')
    );
  });

  it("refuses a system name the game shell does not wire", () => {
    const config = { page: { title: "T" }, system: ["back", "tray"] } as unknown as GameConfig;

    expect(() => resolveConfig(config)).toThrow(
      new Error(
        '[game] config.system names "tray", which the game shell does not wire.\n  Use lifecycle, back, haptics, keepAwake or store.'
      )
    );
  });

  it("refuses an empty page title", () => {
    expect(() => resolveConfig({ page: { title: "" } })).toThrow(
      new Error("[game] config.page.title is empty.\n  Give the page a title in config.ts.")
    );
    expect(() => resolveConfig({ page: { title: "  " } })).toThrow(
      "[game] config.page.title is empty."
    );
  });

  // Bug: a boot without a width or a fade gives the page "undefined" in its style.
  it("page.boot fills width 40vmin and fadeMs 300, and keeps a value the config sets", () => {
    expect(
      resolveConfig({ page: { title: "T", boot: { image: "assets/boot.png" } } }).page.boot
    ).toEqual({ image: "assets/boot.png", width: "40vmin", fadeMs: 300 });

    const boot = { image: "assets/boot.png", width: "52vmin", fadeMs: 0 };

    expect(resolveConfig({ page: { title: "T", boot } }).page.boot).toEqual(boot);
  });

  // Bug: a page with no boot gets a default picture, or a `boot: undefined` key a shell's fake config lacks.
  it("a page without page.boot resolves with no boot key", () => {
    expect("boot" in resolveConfig({ page: { title: "T" } }).page).toBe(false);
  });

  // Bug: a config.ts that skips `satisfies` writes a boot with no picture and the page throws a bare TypeError.
  it("refuses a page.boot with no image", () => {
    const boot = {} as { image: string };

    expect(() => resolveConfig({ page: { title: "T", boot } })).toThrow(
      new Error(
        "[game] config.page.boot has no image.\n  Name a picture file of the game in page.boot.image."
      )
    );
  });

  // Bug: a negative or NaN fade lands in the style as a broken transition and the timer fires at once.
  it("refuses a page.boot.fadeMs that is not a finite number of 0 or more", () => {
    for (const fadeMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        resolveConfig({ page: { title: "T", boot: { image: "assets/boot.png", fadeMs } } })
      ).toThrow(
        new Error(
          `[game] config.page.boot.fadeMs is ${String(fadeMs)}.\n  Use a number of milliseconds, 0 or more.`
        )
      );
    }
  });

  // Bug: a placed boot loses its place, gets no aspect, or keeps "any" as an orientation the CSS cannot read.
  it("a page.boot with frame and rect resolves place with the default aspect and the orientation fallback", () => {
    const boot = {
      image: "assets/splash/studio.webp",
      frame: placedFrame,
      rect: placedRect
    };

    expect(
      resolveConfig({ page: { title: "T", orientation: "any", boot } }).page.boot?.place
    ).toEqual({
      frame: placedFrame,
      rect: placedRect,
      aspect: { min: 4 / 3, max: 21 / 9 },
      orientation: "portrait"
    });
    expect(
      resolveConfig({ page: { title: "T", orientation: "landscape", boot } }).page.boot?.place
        ?.orientation
    ).toBe("landscape");

    const own = { ...boot, aspect: { min: 0.4, max: 2.6 }, orientation: "landscape" as const };

    expect(resolveConfig({ page: { title: "T", boot: own } }).page.boot?.place).toMatchObject({
      aspect: { min: 0.4, max: 2.6 },
      orientation: "landscape"
    });
    expect(
      "place" in (resolveConfig({ page: { title: "T", boot: { image: "b.jpg" } } }).page.boot ?? {})
    ).toBe(false);
  });

  // Bug: a broken placement reaches the page as a still in the wrong place, or as a bare TypeError.
  it.each([
    [
      "a frame with no rect",
      { frame: placedFrame },
      "[game] config.page.boot has a frame but no rect."
    ],
    [
      "a rect with no frame",
      { rect: placedRect },
      "[game] config.page.boot has a rect but no frame."
    ],
    [
      "a frame that is no object",
      { frame: 7, rect: placedRect },
      "[game] config.page.boot.frame is 7."
    ],
    [
      "a rect that is no object",
      { frame: placedFrame, rect: "x" },
      '[game] config.page.boot.rect is "x".'
    ],
    [
      "a frame without a height",
      { frame: { width: 1024 }, rect: placedRect },
      "[game] config.page.boot.frame.height is undefined."
    ],
    [
      "a frame width of 0",
      { frame: { ...placedFrame, width: 0 }, rect: placedRect },
      "[game] config.page.boot.frame.width is 0."
    ],
    [
      "a rect height that is not finite",
      { frame: placedFrame, rect: { ...placedRect, height: Number.POSITIVE_INFINITY } },
      "[game] config.page.boot.rect.height is Infinity."
    ],
    [
      "a negative rect x",
      { frame: placedFrame, rect: { ...placedRect, x: -1 } },
      "[game] config.page.boot.rect.x is -1."
    ],
    [
      "a rect y that is NaN",
      { frame: placedFrame, rect: { ...placedRect, y: Number.NaN } },
      "[game] config.page.boot.rect.y is NaN."
    ],
    [
      "a rect past the right edge",
      { frame: placedFrame, rect: { ...placedRect, x: 425 } },
      "[game] config.page.boot.rect ends at x 1025, past frame.width 1024."
    ],
    [
      "a rect past the bottom edge",
      { frame: placedFrame, rect: { ...placedRect, y: 897 } },
      "[game] config.page.boot.rect ends at y 1537, past frame.height 1536."
    ],
    [
      "an aspect with no frame",
      { aspect: { min: 0.4, max: 2.6 } },
      "[game] config.page.boot.aspect is set without a frame."
    ],
    [
      "an orientation with no frame",
      { orientation: "portrait" },
      "[game] config.page.boot.orientation is set without a frame."
    ],
    [
      "an aspect that is no object",
      { frame: placedFrame, rect: placedRect, aspect: "wide" },
      '[game] config.page.boot.aspect is "wide".'
    ],
    [
      "an aspect min of 0",
      { frame: placedFrame, rect: placedRect, aspect: { min: 0, max: 2.6 } },
      "[game] config.page.boot.aspect.min is 0."
    ],
    [
      "an aspect max below min",
      { frame: placedFrame, rect: placedRect, aspect: { min: 0.4, max: 0.3 } },
      "[game] config.page.boot.aspect.max is 0.3."
    ],
    [
      "an orientation the CSS cannot place",
      { frame: placedFrame, rect: placedRect, orientation: "any" },
      '[game] config.page.boot.orientation is "any".'
    ],
    [
      "a placed picture the native still cannot take",
      { image: "assets/boot.jpg", frame: placedFrame, rect: placedRect },
      '[game] config.page.boot.image "assets/boot.jpg" is not a .png or .webp file.'
    ]
  ])("refuses %s, naming the field", (_name, part, first) => {
    const boot = { image: "assets/boot.webp", ...part } as NonNullable<GameConfig["page"]["boot"]>;

    expect(firstLineOf(() => resolveConfig({ page: { title: "T", boot } }))).toBe(first);
  });

  // Bug: the image check refuses a picture the shell takes, or a centred boot that never reaches the shell.
  it("a placed picture may be .PNG or .webp in any case; a centred one may be any picture", () => {
    for (const image of ["assets/boot.PNG", "assets/boot.WebP"]) {
      const boot = { image, frame: placedFrame, rect: placedRect };

      expect(resolveConfig({ page: { title: "T", boot } }).page.boot?.image).toBe(image);
    }

    expect(resolveConfig({ page: { title: "T", boot: { image: "b.jpg" } } }).page.boot?.image).toBe(
      "b.jpg"
    );
  });

  // Bug: a still that fills its frame to the edge, or starts at its corner, is refused as outside it.
  it("a rect from the frame's corner to its far edges is inside the frame", () => {
    const rect = { x: 0, y: 0, ...placedFrame };
    const boot = { image: "assets/boot.webp", frame: placedFrame, rect };

    expect(resolveConfig({ page: { title: "T", boot } }).page.boot?.place?.rect).toEqual(rect);
  });

  // Bug: a half-filled signing block reaches Gradle, which fails after the compile.
  it("refuses a signing.android missing one of its three required strings", () => {
    for (const field of ["keystorePath", "keystorePasswordEnv", "keyAlias"]) {
      for (const signing of [
        { ...android, [field]: undefined },
        { ...android, [field]: "" }
      ]) {
        expect(() => resolveConfig(nativeWith({ signing: { android: signing } }))).toThrow(
          new Error(
            `[game] config.native.signing.android has no ${field}.\n  Name keystorePath, keystorePasswordEnv and keyAlias.`
          )
        );
      }
    }
  });

  // Bug: the store checks let a team-less Apple block through to a failed export.
  it("refuses a signing.apple without teamId", () => {
    for (const apple of [{}, { teamId: "" }]) {
      expect(() => resolveConfig(nativeWith({ signing: { apple } }))).toThrow(
        new Error(
          "[game] config.native.signing.apple has no teamId.\n  Name the Apple Developer team id."
        )
      );
    }
  });

  // Bug: a key named in part reaches tauri, which signs with nothing and fails after the compile.
  it("refuses one or two of the App Store Connect key fields, naming the missing ones; takes none or all three", () => {
    const key = { apiKeyId: "ABC123DEF4", apiIssuer: "issuer-uuid", apiKeyPath: "~/k.p8" };
    const refusals: [object, string][] = [
      [{ apiKeyId: key.apiKeyId }, "has apiKeyId but no apiIssuer, apiKeyPath."],
      [{ apiIssuer: key.apiIssuer }, "has apiIssuer but no apiKeyId, apiKeyPath."],
      [{ apiKeyPath: key.apiKeyPath }, "has apiKeyPath but no apiKeyId, apiIssuer."],
      [
        { apiKeyId: key.apiKeyId, apiKeyPath: key.apiKeyPath },
        "has apiKeyId, apiKeyPath but no apiIssuer."
      ],
      [{ ...key, apiIssuer: "" }, "has apiKeyId, apiKeyPath but no apiIssuer."],
      [{ apiKeyId: "" }, "has no apiKeyId, apiIssuer, apiKeyPath."]
    ];

    for (const [part, message] of refusals) {
      expect(() =>
        resolveConfig(nativeWith({ signing: { apple: { teamId: "ABCDE12345", ...part } } }))
      ).toThrow(
        new Error(
          `[game] config.native.signing.apple ${message}\n  Name all three of the App Store Connect key, or none.`
        )
      );
    }

    for (const apple of [{ teamId: "ABCDE12345" }, { teamId: "ABCDE12345", ...key }]) {
      expect(resolveConfig(nativeWith({ signing: { apple } })).native?.signing?.apple).toEqual(
        apple
      );
    }
  });

  // Bug: native fails later, or a number like 26.5 passes as text and lands as a bad plist value.
  it("refuses a minimumVersion that is not x.y or x.y.z", () => {
    for (const minimumVersion of ["26", "26.0.0.0.1", "v26.0", "26.0-beta", 26.5]) {
      expect(() => resolveConfig(nativeWith({ ios: { minimumVersion } }))).toThrow(
        new Error(
          `[game] config.native.ios.minimumVersion is ${JSON.stringify(minimumVersion)}.\n  Use a version such as "26.0" or "26.0.1".`
        )
      );
    }
  });

  // Bug: a null or a number nested in a dictionary renders as an empty <dict> in Info.plist.
  it("refuses a value of infoPlist that is null, a number or undefined, at any depth", () => {
    const refused = [
      [{ Build: 7 }, "Build"],
      [{ Gone: undefined }, "Gone"],
      [
        { NSAppTransportSecurity: { NSExceptionDomains: { local: Number.NaN } } },
        "NSAppTransportSecurity.NSExceptionDomains.local"
      ],
      [{ UIModes: ["audio", JSON.parse("null")] }, "UIModes.1"]
    ] as const;

    for (const [infoPlist, at] of refused) {
      expect(() => resolveConfig(nativeWith({ ios: { infoPlist } }))).toThrow(
        new Error(
          `[game] config.native.ios.infoPlist.${at} is not a plist value.\n  Use a string, a boolean, an array or an object.`
        )
      );
    }
  });

  // Bug: the checks refuse a good config, and a game cannot use the fields it was promised.
  // Bug: a test app with the players' id replaces their game, or a block fails deep in a build.
  it("refuses a native.dev with no identifier, one not ending in .dev, the real one, or an empty name or icon", () => {
    const refusals: [object, string][] = [
      [{}, "[game] config.native.dev has no identifier.\n  Name one that ends in .dev."],
      [
        { identifier: "" },
        "[game] config.native.dev has no identifier.\n  Name one that ends in .dev."
      ],
      [
        { identifier: "com.acme.t.debug" },
        '[game] config.native.dev.identifier is "com.acme.t.debug".\n  Use one that ends in .dev.'
      ],
      [
        { identifier: "com.acme.t.dev", name: "" },
        "[game] config.native.dev.name is empty.\n  Name the test app, or leave the field out."
      ],
      [
        { identifier: "com.acme.t.dev", icon: "" },
        "[game] config.native.dev.icon is empty.\n  Name a 1024 px PNG, or leave the field out."
      ]
    ];

    for (const [dev, message] of refusals) {
      expect(() => resolveConfig(nativeWith({ dev }))).toThrow(new Error(message));
    }

    expect(() =>
      resolveConfig(
        nativeWith({ identifier: "com.acme.t.dev", dev: { identifier: "com.acme.t.dev" } })
      )
    ).toThrow(
      new Error(
        '[game] config.native.dev.identifier is "com.acme.t.dev", the same as native.identifier.\n  The test app needs an id of its own.'
      )
    );
  });

  it("takes a native.dev with its identifier alone, and one with a name and an icon", () => {
    const dev = { identifier: "com.acme.t.dev", name: "T Test", icon: "assets/icon-dev.png" };

    expect(resolveConfig(nativeWith({ dev })).native?.dev).toEqual(dev);
    expect(() => resolveConfig(nativeWith({ dev: { identifier: dev.identifier } }))).not.toThrow();
  });

  it("takes a full signing block and an ios block with nested plist values", () => {
    const native = {
      name: "T",
      identifier: "com.acme.t",
      signing: {
        android: { ...android, keyPasswordEnv: STORE_VARIABLE },
        apple: { teamId: "ABCDE12345" }
      },
      ios: {
        minimumVersion: "26.0.1",
        infoPlist: {
          ITSAppUsesNonExemptEncryption: false,
          NSLocalNetworkUsageDescription: "The editor",
          UIBackgroundModes: ["audio"],
          NSAppTransportSecurity: { NSAllowsLocalNetworking: true }
        },
        privacyManifest: "ios/PrivacyInfo.xcprivacy"
      }
    } satisfies GameConfig["native"];

    expect(resolveConfig({ page: { title: "T" }, native }).native).toEqual(native);
  });

  // Bug: the type takes a boot with nothing to show, or makes every game write a boot.
  it("the type refuses a boot without an image and takes a page without a boot", () => {
    expectTypeOf<{ page: { title: string } }>().toExtend<GameConfig>();
    expectTypeOf<{ page: { title: string; boot: { image: string } } }>().toExtend<GameConfig>();
    expectTypeOf<{ page: { title: string; boot: { width: string } } }>().not.toExtend<GameConfig>();
  });

  // Bug: a game can write a number into a plist, which the page never sees and native refuses late.
  it("the type takes nested plist values and refuses a number", () => {
    expectTypeOf<{ a: { b: readonly [string, boolean] } }>().toExtend<Record<string, PlistValue>>();
    expectTypeOf<{ a: { b: number } }>().not.toExtend<Record<string, PlistValue>>();
  });
});
