import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import { component } from "../../../world/ecs/define";
import {
  bind,
  builtInStyles,
  Countdown,
  defineTextStyles,
  label,
  readStyle,
  Text,
  textFor
} from "../../components";

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
      alpha: 1,
      resolved: ""
    });
  });

  // The bug: a box on every label, 0 or undefined, is written into every saved, inspected and
  // described value (a field that is undefined drops the whole component from the snapshot), so
  // every game's visual baselines change though none of its texts wraps at a box (F50, 0.15.16).
  it("carries no box field until ui lays the text out at one", () => {
    expect(Object.keys(Text({ content: "+5" }).value)).not.toContain("box");
  });

  it("draws at full alpha unless the game fades it", () => {
    expect(Text({ content: "Your name", alpha: 0.5 }).value.alpha).toBe(0.5);
  });

  it("takes the fields a game writes and leaves `resolved` to the engine", () => {
    expect(Text({ content: "+5", style: "board.float" }).value).toEqual({
      content: "+5",
      style: "board.float",
      bind: undefined,
      anchor: { x: 0.5, y: 0.5 },
      alpha: 1,
      resolved: ""
    });
  });
});

/** A game's numeric component, as the HUD coin counter has it. */
const Counter = component("Counter", { value: 0, name: "" });

describe("bind", () => {
  it("names the component and the field, and shows an int unless told otherwise", () => {
    expect(bind(Counter, "value")).toEqual({ component: "Counter", field: "value", format: "int" });
  });

  it("keeps the format it was given", () => {
    expect(bind(Countdown, "left", { format: "mm:ss" })).toEqual({
      component: "Countdown",
      field: "left",
      format: "mm:ss"
    });
  });

  it("is plain data a Text carries", () => {
    expect(Text({ style: "digits", bind: bind(Counter, "value") }).value.bind).toEqual({
      component: "Counter",
      field: "value",
      format: "int"
    });
  });
});

describe("Countdown", () => {
  it("starts at zero, and leaves `left` to the engine", () => {
    expect(Countdown().value).toEqual({ until: 0, left: 0 });
    expect(Countdown.owned).toEqual(["left"]);
    expect(Countdown.componentName).toBe("Countdown");
  });

  it("takes the moment a game writes", () => {
    expect(Countdown({ until: 1_790_000_095_000 }).value).toEqual({
      until: 1_790_000_095_000,
      left: 0
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
      alpha: 1,
      resolved: ""
    });
    expect(transform.type).toBe(Transform);
    expect(transform.value).toEqual({
      x: 90,
      y: 180,
      rotation: 0,
      scale: 1,
      pivot: { x: 0, y: 0 }
    });
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

  it("keeps a shadow and fills its alpha with 1", () => {
    const styles = defineTextStyles({
      "popup.title": {
        font: "ui.font-display",
        size: 56,
        fill: 0xff_f3_d6,
        shadow: { color: 0x5b_3a_1e, dx: 0, dy: 4 }
      }
    });

    expect(styles.map["popup.title"]?.shadow).toEqual({
      color: 0x5b_3a_1e,
      dx: 0,
      dy: 4,
      alpha: 1
    });
  });

  it("keeps the alpha a shadow names", () => {
    const styles = defineTextStyles({
      "popup.title": {
        font: "ui.font-display",
        size: 56,
        fill: 0xff_f3_d6,
        shadow: { color: 0, dx: 2, dy: 3, alpha: 0.4 }
      }
    });

    expect(styles.map["popup.title"]?.shadow).toEqual({ color: 0, dx: 2, dy: 3, alpha: 0.4 });
  });

  it("leaves the shadow out of a style that names none", () => {
    const styles = defineTextStyles({ "hud.title": { font: "ui.font-body", size: 40, fill: 1 } });

    expect(styles.map["hud.title"]?.shadow).toBeUndefined();
  });

  it("refuses a wrap that is neither a width nor none", () => {
    expect(() =>
      defineTextStyles({ "hud.title": { font: "ui.font-body", size: 32, fill: 0, wrap: 0 } })
    ).toThrow(
      '[game] Text style "hud.title" has wrap 0.\n' +
        '  Use a width in reference px, "box" or "none".'
    );
    expect(() =>
      defineTextStyles({ "hud.title": { font: "ui.font-body", size: 32, fill: 0, wrap: -1 } })
    ).toThrow('[game] Text style "hud.title" has wrap -1.');
  });

  // The bug: "box" is compared as a width and refused, or stored as something else.
  it('keeps wrap "box", the width the ui layout gives the text', () => {
    const styles = defineTextStyles({
      "card.name": { font: "ui.font-body", size: 32, fill: 0, wrap: "box" }
    });

    expect(styles.map["card.name"]?.wrap).toBe("box");
  });
});

describe("defineTextStyles — lineHeight", () => {
  it("keeps the lineHeight a style names, and leaves it out of one that names none", () => {
    const styles = defineTextStyles({
      plate: { font: "text-medium", size: 14, fill: 0, lineHeight: 1.28 },
      body: { font: "text-medium", size: 14, fill: 0 }
    });

    expect(styles.map.plate?.lineHeight).toBe(1.28);
    expect(styles.map.body?.lineHeight).toBeUndefined();
  });

  // The bug: a line of 0, below 0 or NaN is stored, and every label of the style collapses or
  // vanishes with no word of why.
  it("refuses a lineHeight that is not a number above 0", () => {
    for (const lineHeight of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        defineTextStyles({ plate: { font: "text-medium", size: 14, fill: 0, lineHeight } })
      ).toThrow(
        `[game] Text style "plate" has lineHeight ${lineHeight}.\n` +
          "  Use a multiple of size above 0, such as 1.2."
      );
    }
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

  it("reads the shadow of a registered style back", () => {
    const map = defineTextStyles({
      "popup.title": {
        font: "ui.font-display",
        size: 56,
        fill: 1,
        shadow: { color: 0x5b_3a_1e, dx: 1, dy: 4, alpha: 0.5 }
      }
    }).map;

    expect(readStyle("popup.title", map["popup.title"] ?? {})?.shadow).toEqual({
      color: 0x5b_3a_1e,
      dx: 1,
      dy: 4,
      alpha: 0.5
    });
  });

  it("drops a shadow that is not one and keeps the style", () => {
    const style = readStyle("x", { font: "ui.font-body", size: 32, fill: 0, shadow: { dy: 4 } });

    expect(style?.size).toBe(32);
    expect(style?.shadow).toBeUndefined();
  });

  // The bug: a hot-swapped style with a wrap that is no width, no "box" and no "none" is kept, and
  // its labels wrap at a string.
  it("refuses a wrap that is a word other than box or none", () => {
    expect(() =>
      readStyle("hud.note", { font: "ui.font-body", size: 32, fill: 0, wrap: "auto" })
    ).toThrow('[game] Text style "hud.note" has wrap auto.');
  });

  // The bug: a hot swap reads the style back without its line, and the labels jump to the font's.
  it("reads the lineHeight of a registered style back", () => {
    const map = defineTextStyles({
      plate: { font: "text-medium", size: 14, fill: 0, lineHeight: 1.28 }
    }).map;

    expect(readStyle("plate", map.plate ?? {})?.lineHeight).toBe(1.28);
  });

  it("refuses a stored lineHeight that is not a number above 0", () => {
    expect(() =>
      readStyle("plate", { font: "text-medium", size: 14, fill: 0, lineHeight: "1.2" })
    ).toThrow('[game] Text style "plate" has lineHeight 1.2.');
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
