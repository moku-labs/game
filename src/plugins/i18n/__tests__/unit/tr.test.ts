import { describe, expect, it } from "vitest";
import { i18nFor, tr } from "../../tr";
import type { ElementNode } from "../../types";

describe("tr", () => {
  it("returns the key alone when the message takes no parameters", () => {
    expect(tr("orders.complete")).toEqual({ key: "orders.complete" });
  });

  it("returns the key and the parameters", () => {
    expect(tr("hud.orders", { n: 3 })).toEqual({ key: "hud.orders", params: { n: 3 } });
  });

  it("freezes the message and its parameters", () => {
    const message = tr("hud.orders", { n: 3 });

    expect(Object.isFrozen(message)).toBe(true);
    expect(Object.isFrozen(message.params)).toBe(true);
  });

  it("copies the parameters, so the caller's object stays writable", () => {
    const params = { n: 3 };

    expect(tr("hud.orders", params).params).not.toBe(params);
    expect(Object.isFrozen(params)).toBe(false);
  });

  it("carries an element parameter through untouched", () => {
    const icon: ElementNode = { type: "icon", props: { name: "hud.coin" }, children: [] };

    expect(tr("hud.coins", { n: 25, icon }).params?.icon).toBe(icon);
  });
});

describe("i18nFor", () => {
  it("binds the same function the package exports", () => {
    const kit = i18nFor<{ "home.play": Record<never, never> }>();

    expect(kit.tr("home.play")).toEqual({ key: "home.play" });
  });
});
