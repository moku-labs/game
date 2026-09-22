import { describe, expect, it } from "vitest";
import { parseTags } from "../../tags";
import type { Run, TextRun, Warn } from "../../types";

// ---------------------------------------------------------------------------
// Golden table: one tagged source string in, the runs it becomes out. The
// parser knows nothing about fonts or widths, so every case here is pure.
// ---------------------------------------------------------------------------

/** One warning a parse wrote. */
type Written = { key: string; message: string; data: Record<string, unknown> | undefined };

/** Collects what the parser warned about. */
function collector(): { warn: Warn; written: Written[] } {
  const written: Written[] = [];
  const warn: Warn = (key, message, data): void => {
    written.push({ key, message, data });
  };

  return { warn, written };
}

/** A plain run with the flags a case does not care about. */
function text(value: string, over: Partial<TextRun> = {}): TextRun {
  return { kind: "text", text: value, bold: false, italic: false, color: undefined, ...over };
}

/** Parses a source and drops the warnings. */
function runs(source: string): Run[] {
  return parseTags(source, collector().warn);
}

describe("parseTags — the golden table", () => {
  it("keeps plain text as one run", () => {
    expect(runs("abc")).toEqual([text("abc")]);
  });

  it("marks what <b> holds as bold and leaves the rest alone", () => {
    expect(runs("<b>a</b>b")).toEqual([text("a", { bold: true }), text("b")]);
  });

  it("nests <i> inside <b>", () => {
    expect(runs("<b>a <i>b</i></b>")).toEqual([
      text("a ", { bold: true }),
      text("b", { bold: true, italic: true })
    ]);
  });

  it("carries a colour through a bold run", () => {
    expect(runs("<b><color=#ff0000>x</color></b>")).toEqual([
      text("x", { bold: true, color: 0xff_00_00 })
    ]);
  });

  it("lets a nested colour win over the outer one", () => {
    expect(runs("<color=#ff0000>a<color=#00ff00>b</color>c</color>")).toEqual([
      text("a", { color: 0xff_00_00 }),
      text("b", { color: 0x00_ff_00 }),
      text("c", { color: 0xff_00_00 })
    ]);
  });

  it("makes an icon run, which has no closing tag", () => {
    expect(runs("<icon=hud.coin> 5")).toEqual([{ kind: "icon", key: "hud.coin" }, text(" 5")]);
  });

  it("takes a backslash before < as a literal <", () => {
    expect(runs(String.raw`\<b>`)).toEqual([text("<b>")]);
  });

  it("leaves a backslash before anything else as a backslash", () => {
    expect(runs(String.raw`a\b`)).toEqual([text(String.raw`a\b`)]);
  });

  it("keeps a line break inside the run, where the layout finds it", () => {
    expect(runs("a\nb")).toEqual([text("a\nb")]);
  });

  it("merges runs of equal flags across an empty tag", () => {
    expect(runs("a<b></b>b")).toEqual([text("ab")]);
  });
});

describe("parseTags — what is wrong stays visible", () => {
  it("keeps an unknown tag as literal text and warns once", () => {
    const { warn, written } = collector();

    expect(parseTags("a<blink>b", warn)).toEqual([text("a<blink>b")]);
    expect(written).toHaveLength(1);
    expect(written[0]?.message).toBe("text: unknown tag");
    expect(written[0]?.data).toEqual({ tag: "blink", text: "a<blink>b" });
  });

  it("refuses a three-digit colour and keeps the tag literal", () => {
    const { warn, written } = collector();

    expect(parseTags("<color=#f00>a</color>", warn)).toEqual([text("<color=#f00>a</color>")]);
    expect(written).toHaveLength(1);
  });

  it("closes a tag that was left open at the end, and warns", () => {
    const { warn, written } = collector();

    expect(parseTags("<b>a", warn)).toEqual([text("a", { bold: true })]);
    expect(written).toHaveLength(1);
    expect(written[0]?.message).toBe("text: unclosed tag");
  });

  it("keeps a close with no open as literal text, and warns", () => {
    const { warn, written } = collector();

    expect(parseTags("a</b>", warn)).toEqual([text("a</b>")]);
    expect(written).toHaveLength(1);
  });

  it("keeps a < with no > as literal text", () => {
    expect(runs("a < b")).toEqual([text("a < b")]);
  });

  it("warns once for a source that holds two bad tags", () => {
    const { warn, written } = collector();

    parseTags("<blink>a</blink>", warn);

    expect(written).toHaveLength(1);
  });
});
