import { describe, expect, it } from "vitest";
import { groupOf, planGroups } from "../../scan/pack/groups";

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

  it("does not read fx- anywhere but in the last segment", () => {
    expect(groupOf(texture("fx-ui.star"))).toBe("main");
    expect(groupOf(texture("ui.star-fx-1"))).toBe("main");
  });

  it("keeps a 512 px side in main and sends a 513 px side loose", () => {
    expect(groupOf(texture("ui.panel", 512, 512))).toBe("main");
    expect(groupOf(texture("ui.banner", 513, 40))).toBeUndefined();
    expect(groupOf(texture("ui.rope", 16, 513))).toBeUndefined();
  });
});

describe("planGroups", () => {
  it("packs main and fx groups and keeps what is too large loose", () => {
    const plan = planGroups([
      texture("ui.icon-b"),
      texture("ui.fx-star"),
      texture("ui.bg", 1024, 1536),
      texture("ui.icon-a"),
      texture("ui.fx-spark")
    ]);

    expect([...plan.groups.keys()]).toEqual(["fx", "main"]);
    expect(plan.groups.get("fx")?.map(member => member.key)).toEqual(["ui.fx-spark", "ui.fx-star"]);
    expect(plan.groups.get("main")?.map(member => member.key)).toEqual(["ui.icon-a", "ui.icon-b"]);
    expect(plan.loose.map(member => member.key)).toEqual(["ui.bg"]);
  });

  it("sends a group of one loose: an atlas of one file is one request either way", () => {
    const plan = planGroups([texture("orders.card"), texture("orders.bg", 600, 900)]);

    expect(plan.groups.size).toBe(0);
    expect(plan.loose.map(member => member.key)).toEqual(["orders.bg", "orders.card"]);
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
