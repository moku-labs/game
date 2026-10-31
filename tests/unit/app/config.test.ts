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
