import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import { builtInStyles, defineTextStyles, label, readStyle, Text, textFor } from "../../components";

// ---------------------------------------------------------------------------
// The pure half of the plugin: the component a game writes, the pair `label`
// returns, and the style map a feature registers. No ctx, no state, no Pixi.
// ---------------------------------------------------------------------------

describe("Text", () => {
  it("starts empty, in the body style, centred on its transform", () => {
    expect(Text.defaults).toEqual({
      content: "",
      style: "body",
      bind: undefined,
      anchor: { x: 0.5, y: 0.5 },
      resolved: ""
    });
  });

  it("takes the fields a game writes and leaves `resolved` to the engine", () => {
    expect(Text({ content: "+5", style: "board.float" }).value).toEqual({
      content: "+5",
      style: "board.float",
      bind: undefined,
      anchor: { x: 0.5, y: 0.5 },
      resolved: ""
    });
  });
});

describe("label", () => {
  it("pairs the text with the transform it sits on", () => {
    const [text, transform] = label({ text: "+5", style: "board.float", at: { x: 90, y: 180 } });

    expect(text.type.componentName).toBe("Text");
    expect(text.value).toEqual({
      content: "+5",
      style: "board.float",
      bind: undefined,
      anchor: { x: 0.5, y: 0.5 },
      resolved: ""
    });
    expect(transform.type).toBe(Transform);
    expect(transform.value).toEqual({ x: 90, y: 180, rotation: 0, scale: 1 });
  });

  it("takes the anchor the caller named", () => {
    const [text] = label({
      text: "+5",
      style: "board.float",
      at: { x: 0, y: 0 },
      anchor: { x: 0, y: 1 }
    });

    expect(text.value.anchor).toEqual({ x: 0, y: 1 });
  });

  it("keeps a message as data, so a locale change reaches it", () => {
    const message = { key: "board.bonus", params: { n: 5 } };
    const [text] = label({ text: message, style: "board.float", at: { x: 0, y: 0 } });

    expect(text.value.content).toBe(message);
  });
});

describe("defineTextStyles", () => {
  it("fills every default a style did not name", () => {
    const styles = defineTextStyles({
      "hud.title": { font: "ui.font-body", size: 40, fill: 0xff_e0_82 }
    });

    expect(styles.kind).toBe("textStyles");
    expect(styles.map["hud.title"]).toEqual({
      font: "ui.font-body",
      bold: undefined,
      italic: undefined,
      size: 40,
      fill: 0xff_e0_82,
      stroke: 0x00_00_00,
      strokeWidth: 0,
      letterSpacing: 0,
      align: "left",
      wrap: "none",
      digits: false
    });
  });

  it("keeps the bold and italic fonts a game shipped", () => {
    const styles = defineTextStyles({
      "hud.title": {
        font: "ui.font-body",
        bold: "ui.font-bold",
        italic: "ui.font-italic",
        size: 32,
        fill: 0xff_ff_ff,
        wrap: 480,
        align: "center",
        digits: true
      }
    });

    expect(styles.map["hud.title"]?.bold).toBe("ui.font-bold");
    expect(styles.map["hud.title"]?.italic).toBe("ui.font-italic");
    expect(styles.map["hud.title"]?.wrap).toBe(480);
  });

  it("refuses a wrap that is neither a width nor none", () => {
    expect(() =>
      defineTextStyles({ "hud.title": { font: "ui.font-body", size: 32, fill: 0, wrap: 0 } })
    ).toThrow(
      '[game] Text style "hud.title" has wrap 0.\n' + '  Use a width in reference px or "none".'
    );
  });
});

describe("builtInStyles", () => {
  it("makes `body` and `digits` out of the two configured fonts", () => {
    const styles = builtInStyles({ body: "ui.font-body", digits: "ui.font-digits" });

    expect(styles.body).toEqual(
      expect.objectContaining({ font: "ui.font-body", size: 32, fill: 0xff_ff_ff, digits: false })
    );
    expect(styles.digits).toEqual(
      expect.objectContaining({ font: "ui.font-digits", size: 32, digits: true })
    );
  });
});

describe("readStyle", () => {
  it("reads what a feature registered back into a full style", () => {
    const map = defineTextStyles({
      "hud.title": { font: "ui.font-body", size: 40, fill: 1 }
    }).map;

    expect(readStyle("hud.title", map["hud.title"] ?? {})?.size).toBe(40);
  });

  it("answers nothing for an entry that is not a style", () => {
    expect(readStyle("x", { size: "big" })).toBeUndefined();
    expect(readStyle("x", { font: 7, size: 32, fill: 0 })).toBeUndefined();
    expect(readStyle("x", { font: "ui.font-body", size: 32, fill: "white" })).toBeUndefined();
  });
});

describe("textFor", () => {
  it("hands back the same two helpers, bound to one game's keys", () => {
    const kit = textFor<"hud.title", "ui.font-body">();

    expect(kit.label).toBe(label);
    expect(kit.defineTextStyles).toBe(defineTextStyles);
  });
});
