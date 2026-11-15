/**
 * @file The LAN address of this computer, the one `--editor lan` bakes into a debug page so a phone
 * on the same Wi-Fi dials the editor. Pure: it reads the interface table it is given, the shape of
 * `os.networkInterfaces()`, which `src/cli.ts` hands in. The pick is the editor hub's.
 */

/** One address of a network interface, the part of `os.networkInterfaces()` the pick reads. */
export type InterfaceAddress = {
  /** The address, such as `192.168.1.20`. */
  readonly address: string;
  /** `IPv4` or `IPv6`. */
  readonly family: string;
  /** True for the loopback, which a phone cannot dial. */
  readonly internal: boolean;
};

/** The interface table, addresses by interface name: the shape of `os.networkInterfaces()`. */
export type Interfaces = Readonly<Record<string, readonly InterfaceAddress[] | undefined>>;

/**
 * Name prefixes of a Wi-Fi or wired card (macOS `en0`, Linux `wlan0`, `eth0`): their addresses are
 * tried first, so a VPN tunnel (`utun3`) a phone cannot reach is not picked.
 */
const CARD_PREFIXES: readonly string[] = ["en", "wl", "eth"];

/**
 * The first non-internal IPv4 address of the interfaces whose name passes a test.
 *
 * @param interfaces - The interface table.
 * @param named - The name test.
 * @returns The address, or `undefined`.
 * @example
 * ```ts
 * firstIpv4Of({ en0: [{ address: "192.168.1.5", family: "IPv4", internal: false }] }, () => true); // "192.168.1.5"
 * ```
 */
function firstIpv4Of(interfaces: Interfaces, named: (name: string) => boolean): string | undefined {
  for (const [name, addresses] of Object.entries(interfaces)) {
    const found = named(name)
      ? addresses?.find(entry => entry.family === "IPv4" && !entry.internal)
      : undefined;

    if (found !== undefined) return found.address;
  }

  return undefined;
}

/**
 * The LAN address of this computer: the first non-internal IPv4 of an interface whose name starts
 * with `en`, `wl` or `eth`, else the first non-internal IPv4 of any interface, else `undefined`
 * (the loopback only, or IPv6 only).
 *
 * @param interfaces - The interface table.
 * @returns The address, or `undefined`.
 * @example
 * ```ts
 * lanAddressOf({ utun3: [{ address: "10.8.0.2", family: "IPv4", internal: false }], en0: [{ address: "192.168.1.5", family: "IPv4", internal: false }] }); // "192.168.1.5"
 * ```
 */
export function lanAddressOf(interfaces: Interfaces): string | undefined {
  return (
    firstIpv4Of(interfaces, name => CARD_PREFIXES.some(prefix => name.startsWith(prefix))) ??
    firstIpv4Of(interfaces, () => true)
  );
}
