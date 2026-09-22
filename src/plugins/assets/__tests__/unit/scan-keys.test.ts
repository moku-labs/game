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

  it("reads {nine=H,V} as left and right H, top and bottom V", () => {
    expect(parseTags("bar{nine=24,12}.png", "features/ui/assets/bar{nine=24,12}.png")).toEqual({
      stem: "bar",
      nine: { left: 24, top: 12, right: 24, bottom: 12 },
      note: undefined
    });
  });

  it("reads {nine=L,T,R,B} in the order textures.create takes", () => {
    expect(
      parseTags("sign{nine=30,10,40,20}.webp", "features/ui/assets/sign{nine=30,10,40,20}.webp")
    ).toEqual({
      stem: "sign",
      nine: { left: 30, top: 10, right: 40, bottom: 20 },
      note: undefined
    });
  });

  it("keeps the whole name of a nine tag with three numbers and adds one note", () => {
    expect(parseTags("panel{nine=4,5,6}.png", "features/ui/assets/panel{nine=4,5,6}.png")).toEqual({
      stem: "panel{nine=4,5,6}",
      nine: undefined,
      note:
        'kept the whole name of "features/ui/assets/panel{nine=4,5,6}.png": the tag ' +
        '"{nine=4,5,6}" is not {nine=N}, {nine=H,V} or {nine=L,T,R,B}.'
    });
  });

  it("keeps the whole name of a tag that is not name=value", () => {
    const parsed = parseTags("panel{nine}.png", "features/ui/assets/panel{nine}.png");

    expect(parsed.stem).toBe("panel{nine}");
    expect(parsed.nine).toBeUndefined();
    expect(parsed.note).toContain('the tag "{nine}" is not');
  });

  it("keeps the whole name of a nine value that is not a number", () => {
    const parsed = parseTags("panel{nine=wide}.png", "features/ui/assets/panel{nine=wide}.png");

    expect(parsed.stem).toBe("panel{nine=wide}");
    expect(parsed.nine).toBeUndefined();
    expect(parsed.note).toContain('the tag "{nine=wide}" is not');
  });

  it("drops a good nine tag too when another tag of the name is malformed", () => {
    const parsed = parseTags(
      "panel{nine=8}{nine=1,2,3}.png",
      "features/ui/assets/panel{nine=8}{nine=1,2,3}.png"
    );

    expect(parsed.stem).toBe("panel{nine=8}{nine=1,2,3}");
    expect(parsed.nine).toBeUndefined();
    expect(parsed.note).toContain('the tag "{nine=1,2,3}" is not');
  });

  it("refuses a fractional nine value and names the bad tag, not a fake folder", () => {
    expect(() => parseTags("bar{nine=12.5}.png", "features/ui/assets/bar{nine=12.5}.png")).toThrow(
      '[game] assets: "features/ui/assets/bar{nine=12.5}.png" has the malformed tag ' +
        '"{nine=12.5}", whose "." cannot stay in a key. Use {nine=N}, {nine=H,V} or ' +
        "{nine=L,T,R,B} with whole numbers."
    );
  });

  it("still names the fake folder when the dot stands before a malformed tag", () => {
    expect(() =>
      parseTags("panel.v2{nine=x}.png", "features/ui/assets/panel.v2{nine=x}.png")
    ).toThrow(/"\." in "panel\.v2", which would fake a folder/);
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

  it("drops the two-number and the four-number nine tags", () => {
    expect(keyOf("ui", "bar{nine=24,12}.png", "features/ui/assets/bar{nine=24,12}.png")).toBe(
      "ui.bar"
    );
    expect(
      keyOf("ui", "sign{nine=30,10,40,20}.webp", "features/ui/assets/sign{nine=30,10,40,20}.webp")
    ).toBe("ui.sign");
  });

  it("keeps the whole name when the tag is malformed", () => {
    expect(keyOf("ui", "panel{nine=4,5,6}.png", "features/ui/assets/panel{nine=4,5,6}.png")).toBe(
      "ui.panel{nine=4,5,6}"
    );
  });

  it("refuses a dot inside a folder name", () => {
    expect(() => keyOf("ui", "v2.old/panel.png", "features/ui/assets/v2.old/panel.png")).toThrow(
      /"\." in "v2\.old"/
    );
  });
});
