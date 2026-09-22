import { describe, expect, it } from "vitest";
import { Display, NineSlice, Parent, Sprite, sprite, Transform } from "../../components";

describe("renderer components", () => {
  it("gives Transform the reference-space defaults, turning around its own origin", () => {
    expect(Transform().value).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      pivot: { x: 0, y: 0 }
    });
    expect(Transform.componentName).toBe("Transform");
  });

  it("gives Sprite a white tint, full alpha, a centred anchor and the texture's own size", () => {
    expect(Sprite().value).toEqual({
      texture: "",
      tint: 0xff_ff_ff,
      alpha: 1,
      anchor: { x: 0.5, y: 0.5 },
      width: 0,
      height: 0,
      fit: "fill"
    });
  });

  it("gives NineSlice a zero size, full alpha and a white tint", () => {
    expect(NineSlice().value).toEqual({
      texture: "",
      width: 0,
      height: 0,
      alpha: 1,
      tint: 0xff_ff_ff
    });
  });

  it("gives Parent entity 0, which means no parent", () => {
    expect(Parent().value).toEqual({ entity: 0 });
  });

  it("gives Display no object, so an entity without one is still valid", () => {
    expect(Display().value).toEqual({ object: undefined });
  });

  it("builds a sprite and a transform from one call", () => {
    const [visual, place] = sprite({ texture: "board.cell", at: { x: 540, y: 300 } });

    expect(visual.type).toBe(Sprite);
    expect(visual.value).toEqual({
      texture: "board.cell",
      tint: 0xff_ff_ff,
      alpha: 1,
      anchor: { x: 0.5, y: 0.5 },
      width: 0,
      height: 0,
      fit: "fill"
    });
    expect(place.type).toBe(Transform);
    expect(place.value).toEqual({ x: 540, y: 300, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } });
  });

  it("takes the four optional values of sprite() over the defaults", () => {
    const [visual, place] = sprite({
      texture: "board.item",
      at: { x: 10, y: 20 },
      tint: 0xff_00_00,
      alpha: 0.5,
      anchor: { x: 0, y: 1 },
      scale: 2
    });

    expect(visual.value.tint).toBe(0xff_00_00);
    expect(visual.value.alpha).toBe(0.5);
    expect(visual.value.anchor).toEqual({ x: 0, y: 1 });
    expect(place.value.scale).toBe(2);
  });

  it("names every component, so the storage keys are stable", () => {
    expect([Sprite, NineSlice, Parent, Display].map(type => type.componentName)).toEqual([
      "Sprite",
      "NineSlice",
      "Parent",
      "Display"
    ]);
  });
});
