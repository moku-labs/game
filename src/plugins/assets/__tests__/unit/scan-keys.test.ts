import { describe, expect, it } from "vitest";
import { isAssetFile, keyOf, parseTags } from "../../scan/keys";

describe("isAssetFile", () => {
  it("takes PNG and WebP", () => {
    expect(isAssetFile("cell.png")).toBe(true);
    expect(isAssetFile("star-on.webp")).toBe(true);
  });

  it("takes an upper-case extension", () => {
    expect(isAssetFile("cell.PNG")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isAssetFile("notes.md")).toBe(false);
    expect(isAssetFile("sheet.jpg")).toBe(false);
    expect(isAssetFile("LICENSE")).toBe(false);
  });
});

describe("parseTags", () => {
  it("returns the plain name of a file without tags", () => {
    expect(parseTags("primary.png", "features/ui/assets/button/primary.png")).toEqual({
      stem: "primary",
      nine: undefined
    });
  });

  it("reads {nine=48} as four borders and drops it from the stem", () => {
    expect(parseTags("panel{nine=48}.png", "features/ui/assets/panel{nine=48}.png")).toEqual({
      stem: "panel",
      nine: { left: 48, top: 48, right: 48, bottom: 48 }
    });
  });

  it("reads a zero border", () => {
    expect(parseTags("panel{nine=0}.webp", "features/ui/assets/panel{nine=0}.webp").nine).toEqual({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0
    });
  });

  it("refuses an unknown tag and names the file", () => {
    expect(() =>
      parseTags("panel{atlas=ui}.png", "features/ui/assets/panel{atlas=ui}.png")
    ).toThrow(
      /\[game] assets: .*"features\/ui\/assets\/panel\{atlas=ui\}\.png".*unknown tag "atlas"/
    );
  });

  it("refuses a tag that is not name=value", () => {
    expect(() => parseTags("panel{nine}.png", "features/ui/assets/panel{nine}.png")).toThrow(
      /malformed tag "\{nine\}"/
    );
  });

  it("refuses a nine value that is not a whole number", () => {
    expect(() =>
      parseTags("panel{nine=4.5}.png", "features/ui/assets/panel{nine=4.5}.png")
    ).toThrow(/nine tag "4\.5"/);
  });

  it("refuses a brace that is not a trailing tag group", () => {
    expect(() => parseTags("pa{nel.png", "features/ui/assets/pa{nel.png")).toThrow(
      /\[game] assets: .*"features\/ui\/assets\/pa\{nel\.png"/
    );
  });

  it("takes a name without an extension as it stands", () => {
    expect(parseTags("LICENSE", "features/ui/assets/LICENSE")).toEqual({
      stem: "LICENSE",
      nine: undefined
    });
  });

  it("refuses a closing brace without a group", () => {
    expect(() => parseTags("pa}nel.png", "features/ui/assets/pa}nel.png")).toThrow(
      /has a brace that is not a tag group/
    );
  });

  it("refuses a name that is only tags", () => {
    expect(() => parseTags("{nine=4}.png", "features/ui/assets/{nine=4}.png")).toThrow(
      /has no name before its tags/
    );
  });

  it("refuses a dot inside the name", () => {
    expect(() => parseTags("panel.v2.png", "features/ui/assets/panel.v2.png")).toThrow(
      /"\." in "panel\.v2"/
    );
  });
});

describe("keyOf", () => {
  it("joins the feature and the path inside assets/", () => {
    expect(keyOf("board", "item-a-1.png", "features/board/assets/item-a-1.png")).toBe(
      "board.item-a-1"
    );
    expect(keyOf("reward-popup", "star-on.webp", "features/reward-popup/assets/star-on.webp")).toBe(
      "reward-popup.star-on"
    );
  });

  it("turns a folder into a dot", () => {
    expect(keyOf("ui", "button/primary.png", "features/ui/assets/button/primary.png")).toBe(
      "ui.button.primary"
    );
  });

  it("drops the tags", () => {
    expect(keyOf("ui", "panel{nine=48}.png", "features/ui/assets/panel{nine=48}.png")).toBe(
      "ui.panel"
    );
  });

  it("refuses a dot inside a folder name", () => {
    expect(() => keyOf("ui", "v2.old/panel.png", "features/ui/assets/v2.old/panel.png")).toThrow(
      /"\." in "v2\.old"/
    );
  });
});
