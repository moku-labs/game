/* eslint-disable sonarjs/no-hardcoded-ip -- interface addresses are the cases under test */
/**
 * @file `lanAddressOf`: the LAN IPv4 of this computer that `--editor lan` bakes into a debug page,
 * picked from a table shaped like `os.networkInterfaces()`.
 */
import { describe, expect, it } from "vitest";
import { lanAddressOf } from "../../../src/app/lan";

describe("lanAddressOf", () => {
  it("picks the IPv4 of en0 over a VPN tunnel listed first, past its IPv6 and loopback entries (bug: a VPN address the phone cannot reach is baked)", () => {
    expect(
      lanAddressOf({
        lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
        utun3: [{ address: "10.8.0.2", family: "IPv4", internal: false }],
        en0: [
          { address: "fe80::1c2a", family: "IPv6", internal: false },
          { address: "192.168.1.20", family: "IPv4", internal: false }
        ]
      })
    ).toBe("192.168.1.20");
    expect(
      lanAddressOf({
        utun3: [{ address: "10.8.0.2", family: "IPv4", internal: false }],
        wlan0: [{ address: "192.168.1.30", family: "IPv4", internal: false }]
      })
    ).toBe("192.168.1.30");
    expect(
      lanAddressOf({
        utun3: [{ address: "10.8.0.2", family: "IPv4", internal: false }],
        eth0: [{ address: "10.0.0.7", family: "IPv4", internal: false }]
      })
    ).toBe("10.0.0.7");
  });

  it("falls back to the first non-internal IPv4 of any interface when no card has one (bug: a Mac on a bridge only finds no address)", () => {
    expect(
      lanAddressOf({
        lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
        en0: [{ address: "fe80::1c2a", family: "IPv6", internal: false }],
        bridge100: [{ address: "192.168.2.1", family: "IPv4", internal: false }]
      })
    ).toBe("192.168.2.1");
  });

  it("answers undefined for a table with internal or IPv6 addresses only, or an empty entry (bug: a crash, or the loopback baked, on a computer with no Wi-Fi)", () => {
    expect(
      lanAddressOf({
        lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
        en0: [{ address: "fe80::1c2a", family: "IPv6", internal: false }],
        awdl0: undefined
      })
    ).toBeUndefined();
    expect(lanAddressOf({})).toBeUndefined();
  });
});
