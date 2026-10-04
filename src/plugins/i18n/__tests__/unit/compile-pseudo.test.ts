import { describe, expect, it } from "vitest";
import { compileElements, parseMessage } from "../../compile/message";
import { accent, pad, pseudoMessage } from "../../compile/pseudo";
import { createIntlKit } from "../../intl";
import { evaluateCompiled } from "./evaluate";

const ORDERS_EN = "{n, plural, one {# order} other {# orders}}";

/**
 * Derives the pseudo message of one English message and formats it in `en-XA`, through the module
 * the build would write.
 *
 * @param text - The English ICU message.
 * @param params - The parameters of the message.
 * @returns The text parts joined.
 */
function pseudoOf(text: string, params: Record<string, unknown> = {}): string {
  const compiled = evaluateCompiled(compileElements(pseudoMessage(parseMessage(text))));

  return compiled(params, createIntlKit("en-XA"))
    .map(part => (part.kind === "text" ? part.text : ""))
    .join("");
}

describe("accent", () => {
  it("accents every ASCII letter of both cases", () => {
    expect(accent("abcdefghijklmnopqrstuvwxyz")).toBe("áɓçðéƒĝĥíĵķļɱñóþǫŕšţúṿŵẋýž");
    expect(accent("ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe("ÁƁÇÐÉƑĜĤÍĴĶĻⱮÑÓÞǪŔŠŢÚṾŴẊÝŽ");
  });

  it("keeps the length: one character for one letter", () => {
    expect(accent("Opens in").length).toBe("Opens in".length);
  });

  it("leaves digits, punctuation, spaces and other scripts alone", () => {
    expect(accent("0-9, !? ё_\n")).toBe("0-9, !? ё_\n");
  });

  it("copies a tag run as it is", () => {
    expect(accent("<b>Gold</b> <color=#a05>x</color> <icon=hud.coin>")).toBe(
      "<b>Ĝóļð</b> <color=#a05>ẋ</color> <icon=hud.coin>"
    );
  });
});

describe("pad", () => {
  it.each([
    [0, ""],
    [1, " one"],
    [9, " one"],
    [13, " one two"],
    [100, " one two three four five six seven eight"]
  ])("pads %d literal characters with %j", (original, padding) => {
    expect(pad(original)).toBe(padding);
  });

  it("cycles the ten words", () => {
    expect(pad(200)).toBe(
      " one two three four five six seven eight nine ten one two three four five six seven"
    );
  });

  it("reaches ceil(1.4 × n) in whole words, and not one word earlier", () => {
    for (let original = 1; original <= 80; original += 1) {
      const target = Math.ceil((original * 14) / 10);
      const padding = pad(original);
      const shorter = padding.slice(0, padding.lastIndexOf(" "));

      expect(original + padding.length).toBeGreaterThanOrEqual(target);
      expect(original + shorter.length).toBeLessThan(target);
    }
  });
});

describe("pseudoMessage", () => {
  it("accents, pads and brackets a duration message", () => {
    expect(pseudoOf("Opens in {left, duration, short}", { left: 95_000 })).toBe(
      "[Óþéñš íñ 1 min, 35 sec one]"
    );
  });

  it("counts the literals of every branch of a plural", () => {
    expect(pseudoOf(ORDERS_EN, { n: 3 })).toBe("[3 óŕðéŕš one two]");
    expect(pseudoOf(ORDERS_EN, { n: 1 })).toBe("[1 óŕðéŕ one two]");
  });

  it("keeps the parameters, their kinds and the select options", () => {
    const tabs = "{id, select, audio {Audio} other {Tab}}";

    expect(compileElements(pseudoMessage(parseMessage(ORDERS_EN))).params).toEqual({
      n: { kind: "number" }
    });
    expect(compileElements(pseudoMessage(parseMessage(tabs))).params).toEqual({
      id: { kind: "select", options: ["audio"] }
    });
    expect(pseudoOf(tabs, { id: "audio" })).toBe("[Áúðíó one]");
    expect(pseudoOf(tabs, { id: "video" })).toBe("[Ţáɓ one]");
  });

  it("keeps exact matches and #", () => {
    const message = "{n, plural, =0 {nobody} one {# other} other {# others}}";

    expect(pseudoOf(message, { n: 0 })).toBe("[ñóɓóðý one two]");
    expect(pseudoOf(message, { n: 2 })).toBe("[2 óţĥéŕš one two]");
  });

  it("keeps the offset", () => {
    const message = "{n, plural, offset:1 one {you and # other} other {you and # others}}";

    expect(pseudoOf(message, { n: 2 })).toBe("[ýóú áñð 1 óţĥéŕ one two three]");
  });

  it("leaves a tag run for the tag pass of text", () => {
    expect(pseudoOf("<b>{n, number}</b> gold", { n: 7 })).toBe("[<b>7</b> ĝóļð one]");
  });

  it("brackets a message of only an argument and does not pad it", () => {
    expect(pseudoOf("{name}", { name: "Ann" })).toBe("[Ann]");
  });

  it("brackets an element argument without touching it", () => {
    const coin = { type: "icon", props: { name: "hud.coin" }, children: [] };
    const compiled = evaluateCompiled(compileElements(pseudoMessage(parseMessage("{icon}"))));

    expect(compiled({ icon: coin }, createIntlKit("en-XA"))).toEqual([
      { kind: "text", text: "[" },
      { kind: "element", node: coin },
      { kind: "text", text: "]" }
    ]);
  });
});
