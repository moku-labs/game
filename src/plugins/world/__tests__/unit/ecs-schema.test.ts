import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import { component, tag } from "../../ecs/define";
import { fieldKind, schemaOf } from "../../ecs/schema";
import type { AnyComponentType } from "../../ecs/types";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: the component schema (pure) and `ecs.schema` over the mock world
// ---------------------------------------------------------------------------

const Card = component(
  "Card",
  // eslint-disable-next-line unicorn/no-null -- a JSON null default is a field kind of its own
  { title: "", cost: 3, rare: false, art: { frame: "gold" }, tags: ["fire"], parent: null },
  { owned: ["title"] }
);
const Callback = component("Callback", { run: (): number => 1 });
const Held = tag("Held");

describe("fieldKind", () => {
  it("names the JSON kind of a default value", () => {
    expect(fieldKind(3)).toBe("number");
    expect(fieldKind("gold")).toBe("string");
    expect(fieldKind(false)).toBe("boolean");
    expect(fieldKind({ x: 0 })).toBe("object");
    expect(fieldKind([1, 2])).toBe("array");
    // eslint-disable-next-line unicorn/no-null -- JSON null is a field kind of its own
    expect(fieldKind(null)).toBe("null");
  });
});

describe("schemaOf", () => {
  it("describes every field of a component by the kind of its default", () => {
    expect(schemaOf([Card])).toEqual([
      {
        name: "Card",
        kind: "component",
        json: true,
        fields: {
          title: "string",
          cost: "number",
          rare: "boolean",
          art: "object",
          tags: "array",
          parent: "null"
        },
        defaults: {
          title: "",
          cost: 3,
          rare: false,
          art: { frame: "gold" },
          tags: ["fire"],
          // eslint-disable-next-line unicorn/no-null -- the default really is JSON null
          parent: null
        },
        owned: ["title"]
      }
    ]);
  });

  it("describes a tag as true with no field", () => {
    expect(schemaOf([Held])).toEqual([
      { name: "Held", kind: "tag", json: true, fields: {}, defaults: true, owned: [] }
    ]);
  });

  it("says json: false for defaults that are not JSON, with no field and null defaults", () => {
    expect(schemaOf([Callback])).toEqual([
      // eslint-disable-next-line unicorn/no-null -- the schema says null for defaults it cannot carry
      { name: "Callback", kind: "component", json: false, fields: {}, defaults: null, owned: [] }
    ]);
  });

  it("treats a registered type that carries no defaults as not JSON", () => {
    const bare: AnyComponentType = { componentName: "Bare", kind: "component" };

    expect(schemaOf([bare])).toEqual([
      // eslint-disable-next-line unicorn/no-null -- the schema says null for defaults it cannot carry
      { name: "Bare", kind: "component", json: false, fields: {}, defaults: null, owned: [] }
    ]);
  });

  it("sorts the entries by name", () => {
    expect(schemaOf([Held, Card, Callback]).map(entry => entry.name)).toEqual([
      "Callback",
      "Card",
      "Held"
    ]);
  });

  it("hands out copies, so a reader cannot write into a component type", () => {
    const [card] = schemaOf([Card]);

    expect(card?.defaults).toEqual(Card.defaults);
    expect(card?.defaults).not.toBe(Card.defaults);
    expect(card?.owned).not.toBe(Card.owned);
  });
});

describe("ecs.schema", () => {
  it("lists the types the world met so far, a type registering on first use", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn({ kind: "plugin", name: "test" }, [Transform()]);

    expect(world.api.ecs.schema().map(entry => entry.name)).toEqual(["Transform"]);

    world.api.ecs.has(entity, Held);

    expect(world.api.ecs.schema().map(entry => entry.name)).toEqual(["Held", "Transform"]);
  });

  it("answers the scenario of its JSDoc: the Transform row of the palette", () => {
    const world = createMockWorld();

    world.api.ecs.spawn({ kind: "plugin", name: "test" }, [Transform({ x: 40 })]);

    expect(world.api.ecs.schema().find(entry => entry.name === "Transform")).toEqual({
      name: "Transform",
      kind: "component",
      json: true,
      fields: { x: "number", y: "number", rotation: "number", scale: "number", pivot: "object" },
      defaults: { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } },
      owned: []
    });
  });

  it("builds a new list on every call", () => {
    const world = createMockWorld();

    world.api.ecs.spawn({ kind: "plugin", name: "test" }, [Transform()]);

    expect(world.api.ecs.schema()).not.toBe(world.api.ecs.schema());
    expect(world.api.ecs.schema()).toEqual(world.api.ecs.schema());
  });
});
