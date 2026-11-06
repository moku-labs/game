/**
 * @file Root integration — i18n against text: a string parameter of a message is never markup.
 * `i18n` sits below `text` in the plugin graph, so it carries its own copy of the escape; this
 * pins that copy to the tag grammar of `text`. A parameter formatted by `i18n` and read by `text`
 * is one run of exactly its characters, and nothing is reported.
 */
import { createApp, i18nPlugin, messageArgument, tr, type } from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import { createIntlKit } from "../../src/plugins/i18n/intl";
import type { CompiledMessages } from "../../src/plugins/i18n/types";
import { escapeTags, parseTags } from "../../src/plugins/text/tags";
import type { Run, Warn } from "../../src/plugins/text/types";
import { defineFeature, defineFlow, defineNode, startingPlayer, startingSession } from "./helpers";

/**
 * Formats a parameter the way a compiled message does, and reads the part through `text`.
 *
 * @param value - The parameter of the message.
 * @returns The runs `text` draws, and the warnings it wrote.
 */
function drawn(value: unknown): { runs: Run[]; warned: string[] } {
  const warned: string[] = [];
  const warn: Warn = key => {
    warned.push(key);
  };
  const part = messageArgument(value, createIntlKit("en"));

  return { runs: part.kind === "text" ? parseTags(part.text, warn) : [], warned };
}

/**
 * One plain glyph run of these characters.
 *
 * @param text - The characters.
 * @returns The run.
 */
function plain(text: string): Run {
  return { kind: "text", text, bold: false, italic: false, color: undefined, span: undefined };
}

describe("a string parameter of a message, drawn by text", () => {
  // The bug: i18n's escape drifts from text's grammar, and a player named "<b>x" turns the rest
  // of the sentence bold, or the backslash of the escape shows on the screen.
  it("is one run of exactly its characters, with no warning", () => {
    expect(drawn("<b>x")).toEqual({ runs: [plain("<b>x")], warned: [] });
    expect(drawn("<span style=price.22>1</span>")).toEqual({
      runs: [plain("<span style=price.22>1</span>")],
      warned: []
    });
    expect(drawn(String.raw`a\<b`)).toEqual({ runs: [plain(String.raw`a\<b`)], warned: [] });
  });

  it("escapes every item of a list parameter the same way", () => {
    expect(drawn(["<b>Ann", "Bob"])).toEqual({ runs: [plain("<b>Ann and Bob")], warned: [] });
  });

  // The bug: the two copies of the escape write `<` two ways.
  it("writes a parameter as text's own escapeTags writes it", () => {
    const part = messageArgument("<i>a</i> < b", createIntlKit("en"));

    expect(part).toEqual({ kind: "text", text: escapeTags("<i>a</i> < b") });
  });
});

/** The characters a player typed, markup and a lone `<` in them. */
const TYPED = "<i>a</i> < b";

/** A compiled module whose message is one part written by text's own escape. */
const typed: CompiledMessages = {
  "field.value": () => [{ kind: "text", text: escapeTags(TYPED) }]
};

/** The one resting node the app waits on. */
const home = defineNode({ outcomes: { play: type() }, rest: true, checkpoint: true });

/** The flow of the app: home, and nothing after it. */
const main = defineFlow("escape", {
  nodes: { home },
  start: "home",
  edges: { home: { play: "home" } }
});

describe("a part written by text's escape, read by i18n's plain", () => {
  // The bug: `plain` undoes another escape than the one text writes, so an aria label or a game's
  // plain text shows a backslash, or drops a `<`.
  it("answers the characters the player typed", async () => {
    const feature = defineFeature("field", { strings: { en: typed } });
    const app = createApp({
      plugins: [i18nPlugin, feature],
      pluginConfigs: {
        flow: { mainFlow: main },
        i18n: { locale: "en", fallback: "en" },
        model: { initialPlayer: startingPlayer, initialSession: startingSession, seed: 1 }
      }
    });

    await app.start();

    expect(app.i18n.format(tr("field.value"))).toEqual([{ kind: "text", text: escapeTags(TYPED) }]);
    expect(app.i18n.plain(tr("field.value"))).toBe(TYPED);

    await app.stop();
  });
});
