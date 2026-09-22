/**
 * @file text plugin — the fixture font. One tiny BMFont with five glyphs and no page image, in
 * both formats the reader accepts. `size` is 32 and `lineHeight` is 40, so every expected number
 * in the measurement tests is a hand-computable multiple of them.
 */

/** The advance of every glyph of the fixture, by character. */
export const miniAdvances = { "1": 16, "2": 20, A: 24, " ": 8, "□": 12 } as const;

/** The fixture as BMFont JSON: what a game ships next to its MSDF page. */
export const miniFontJson = JSON.stringify({
  info: { face: "mini", size: 32 },
  common: { lineHeight: 40, base: 32 },
  chars: [
    { id: 49, char: "1", xadvance: 16 },
    { id: 50, char: "2", xadvance: 20 },
    { id: 65, char: "A", xadvance: 24 },
    { id: 32, char: " ", xadvance: 8 },
    { id: 9633, char: "□", xadvance: 12 }
  ]
});

/** The same fixture as BMFont XML, the other format the exporters write. */
export const miniFontXml = `<?xml version="1.0"?>
<font>
  <info face="mini" size="32" />
  <common lineHeight="40" base="32" />
  <chars count="5">
    <char id="49" xadvance="16" />
    <char id="50" xadvance="20" />
    <char id="65" xadvance="24" />
    <char id="32" xadvance="8" />
    <char id="9633" xadvance="12" />
  </chars>
</font>`;

/** The fixture with no `□`, so a character the font lacks falls through to the 0.6 em rule. */
export const miniFontNoMissing = JSON.stringify({
  info: { face: "mini", size: 32 },
  common: { lineHeight: 40 },
  chars: [
    { id: 49, xadvance: 16 },
    { id: 32, xadvance: 8 }
  ]
});
