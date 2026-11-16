import { describe, expect, it } from "vitest";
import { groupOf, LOOSE_SIDE, planGroups } from "../../scan/pack/groups";

/** A texture of the plan, by key and size. */
function texture(key: string, width = 64, height = 64) {
  return { key, width, height };
}

describe("groupOf", () => {
  it("sends a key whose last segment starts with fx- to fx, whatever its size", () => {
    expect(groupOf(texture("ui.fx-rays", 504, 512))).toBe("fx");
    expect(groupOf(texture("ui.fx-glow", 900, 900))).toBe("fx");
    expect(groupOf(texture("ui.effects.fx-star"))).toBe("fx");
  });

  it("sends a key with an fx folder to fx, whatever its size", () => {
    expect(groupOf(texture("ui.fx.leaf"))).toBe("fx");
    expect(groupOf(texture("ui.fx.glow", 900, 900))).toBe("fx");
    expect(groupOf(texture("ui.effects.fx.star"))).toBe("fx");
  });

  it("sends the frames of an animation in an fx folder to fx", () => {
    expect(groupOf(texture("ui.fx.coin-spin.0"))).toBe("fx");
    expect(groupOf(texture("ui.fx.coin-spin.11"))).toBe("fx");
  });

  it("reads fx as a folder only between the bundle name and the stem", () => {
    expect(groupOf(texture("ui.fx"))).toBe("main");
    expect(groupOf(texture("fx.leaf"))).toBe("main");
    expect(groupOf(texture("ui.fxs.leaf"))).toBe("main");
    expect(groupOf(texture("ui.my-fx.leaf"))).toBe("main");
  });

  it("does not read fx- anywhere but in the last segment", () => {
    expect(groupOf(texture("fx-ui.star"))).toBe("main");
    expect(groupOf(texture("ui.star-fx-1"))).toBe("main");
  });

  it("packs a 600 px texture: the old 512 px rule kept it loose", () => {
    // Bug caught: the old LOOSE_SIDE of 512 sent every texture above it to a file of its own, so
    // the pack never saw the textures between 512 and 1018 px.
    expect(groupOf(texture("ui.panel", 600, 600))).toBe("main");
    expect(groupOf(texture("ui.banner", 513, 40))).toBe("main");
  });

  it("packs a texture at LOOSE_SIDE and leaves one a pixel above it loose, by either side", () => {
    // Bug caught: an off-by-one at the boundary packs a texture the layout cannot hold, or leaves
    // loose one it could.
    expect(groupOf(texture("ui.panel", LOOSE_SIDE, LOOSE_SIDE))).toBe("main");
    expect(groupOf(texture("ui.banner", LOOSE_SIDE + 1, 40))).toBeUndefined();
    expect(groupOf(texture("ui.rope", 16, LOOSE_SIDE + 1))).toBeUndefined();
  });

  it("sends an fx texture to fx whatever its size, even above LOOSE_SIDE", () => {
    // Bug caught: sending a large fx texture loose makes its emitter sample the wrong page.
    expect(groupOf(texture("ui.fx-sky", LOOSE_SIDE + 1000, 64))).toBe("fx");
  });
});

describe("planGroups", () => {
  it("packs main and fx groups and keeps what is too large loose", () => {
    const plan = planGroups([
      texture("ui.icon-b"),
      texture("ui.fx-star"),
      texture("ui.bg", LOOSE_SIDE + 1, 1536),
      texture("ui.icon-a"),
      texture("ui.fx-spark")
    ]);

    expect([...plan.groups.keys()]).toEqual(["fx", "main"]);
    expect(plan.groups.get("fx")?.map(member => member.key)).toEqual(["ui.fx-spark", "ui.fx-star"]);
    expect(plan.groups.get("main")?.map(member => member.key)).toEqual(["ui.icon-a", "ui.icon-b"]);
    expect(plan.loose.map(member => member.key)).toEqual(["ui.bg"]);
  });

  it("sends a group of one loose: an atlas of one file is one request either way", () => {
    const plan = planGroups([texture("orders.card"), texture("orders.bg", LOOSE_SIDE + 1, 900)]);

    expect(plan.groups.size).toBe(0);
    expect(plan.loose.map(member => member.key)).toEqual(["orders.bg", "orders.card"]);
  });

  it("packs an fx folder and fx- stems into one fx group", () => {
    const plan = planGroups([
      texture("ui.fx.leaf"),
      texture("ui.icon-a"),
      texture("ui.fx-spark"),
      texture("ui.fx.coin-spin.0"),
      texture("ui.icon-b")
    ]);

    expect(plan.groups.get("fx")?.map(member => member.key)).toEqual([
      "ui.fx-spark",
      "ui.fx.coin-spin.0",
      "ui.fx.leaf"
    ]);
    expect(plan.groups.get("main")?.map(member => member.key)).toEqual(["ui.icon-a", "ui.icon-b"]);
  });

  it("sends an fx group of one loose too", () => {
    const plan = planGroups([texture("ui.fx-star"), texture("ui.icon-a"), texture("ui.icon-b")]);

    expect([...plan.groups.keys()]).toEqual(["main"]);
    expect(plan.loose.map(member => member.key)).toEqual(["ui.fx-star"]);
  });

  it("keeps the members of each group sorted by key, whatever the input order", () => {
    const keys = ["ui.c", "ui.a", "ui.b"];
    const forward = planGroups(keys.map(key => texture(key)));
    const backward = planGroups(keys.toReversed().map(key => texture(key)));

    expect(forward).toEqual(backward);
    expect(forward.groups.get("main")?.map(member => member.key)).toEqual(["ui.a", "ui.b", "ui.c"]);
  });

  it("plans nothing for no texture", () => {
    expect(planGroups([])).toEqual({ groups: new Map(), loose: [] });
  });
});

describe("groupOf with mipmaps and sub-feature keys", () => {
  it("keeps a mipmapped texture loose, also an fx stem and a small one", () => {
    expect(groupOf({ key: "ep01.fx-glow", width: 64, height: 64, mips: true })).toBeUndefined();
    expect(groupOf({ key: "ep01.items.cup", width: 336, height: 288, mips: true })).toBeUndefined();
  });

  it("reads the first segment of a sub-feature's key as its bundle", () => {
    expect(groupOf(texture("ep01.fx.leaf"))).toBe("fx");
    // A sub-feature named fx: "fx" is its bundle, not a folder.
    expect(groupOf(texture("fx.leaf"))).toBe("main");
  });
});
