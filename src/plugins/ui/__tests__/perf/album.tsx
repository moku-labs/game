/**
 * @file ui plugin — the album of the perf files of change 2026-11-26-f244-album-swipe. Not a test file. A root shaped
 * like the album sheet of «A Memory Missing» on its set page: the overview of 15 tiles behind, the top bar, the strip
 * of the pages and the 15 page dots. The strip holds the page on show at 0 and a second one beside it, as the game's
 * pager draws a peek and a turn. Every tree of a flip is built once, at load: a window allocates no description node.
 */
import type { DescriptionNode } from "../../jsx/types";

/** The sets of the album: its pages, its tiles and its dots. */
export const ALBUM_SETS = 15;

/** The cards of a page, three rows of three. */
const CARDS = 9;

/** The width of a page; the pitch of the strip is 1.25 widths, a quarter-width gap. */
const PAGE_WIDTH = 348;

/** The distance between two pages of the strip. */
const PITCH = PAGE_WIDTH * 1.25;

/**
 * One tile of the overview: a button over a cover, a name, three stars and a pill with a count. 20 elements.
 *
 * @param index - The set of the tile.
 * @returns The tile.
 */
function tile(index: number) {
  return (
    <button key={`albumTile${index}`} intent="view" style={{ width: 110, height: 150 }}>
      <stack key={`albumTile${index}Body`} style={{ width: 110, height: 150, fill: 0xf4_ee_f0 }}>
        <column key={`albumTile${index}Column`} style={{ padding: 6, gap: 4, align: "center" }}>
          <stack style={{ width: 90, height: 90 }}>
            <image texture="ui.coin" style={{ width: 90, height: 90 }} />
            <stack style={{ width: 90, height: 90, fill: 0x22_22_22 }} />
          </stack>
          <text style={{ width: 98, height: 18 }} content={`set ${index}`} />
          <row style={{ gap: 2 }}>
            <image texture="ui.coin" style={{ width: 10, height: 10 }} />
            <image texture="ui.coin" style={{ width: 10, height: 10 }} />
            <image texture="ui.coin" style={{ width: 10, height: 10 }} />
          </row>
          <row style={{ height: 16, gap: 3, align: "center" }}>
            <stack style={{ width: 40, height: 16, fill: 0x66_44_55 }} />
            <text style={{ width: 30, height: 14 }} content="3/9" />
            <image texture="ui.coin" style={{ width: 12, height: 12 }} />
          </row>
          <row style={{ height: 6 }}>
            <stack style={{ width: 60, height: 6, fill: 0xee_dd_ee }} />
            <stack style={{ width: 20, height: 6, fill: 0xaa_55_77 }} />
          </row>
        </column>
      </stack>
    </button>
  );
}

/**
 * The overview behind the set page: a head and five rows of three tiles. 312 elements.
 *
 * @returns The overview.
 */
function overview() {
  const rows = Array.from({ length: ALBUM_SETS / 3 }, (_unused, line) => (
    <row key={`albumRow${line}`} style={{ gap: 8 }}>
      {[0, 1, 2].map(column => tile(line * 3 + column))}
    </row>
  ));

  return (
    <column key="albumOverview" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
      <row key="albumOverviewHead" style={{ height: 60, gap: 8, align: "center" }}>
        <image texture="ui.coin" style={{ width: 40, height: 40 }} />
        <text style={{ width: 200, height: 30 }} content="Album" />
        <image texture="ui.coin" style={{ width: 40, height: 40 }} />
      </row>
      <column key="albumRows" style={{ gap: 8, padding: 12 }}>
        {rows}
      </column>
    </column>
  );
}

/**
 * One card of a page: a pearl box over two stars, a picture and a name. 12 elements.
 *
 * @param page - The set of the page.
 * @param index - The card.
 * @returns The card.
 */
function card(page: number, index: number) {
  return (
    <button key={`albumCard${page}x${index}`} intent="zoom" style={{ width: 100, height: 140 }}>
      <stack style={{ width: 100, height: 140, fill: 0xfa_f0_f4 }}>
        <column style={{ padding: 4, gap: 3, align: "center" }}>
          <row style={{ gap: 2, height: 10 }}>
            <image texture="ui.coin" style={{ width: 10, height: 10 }} />
            <image texture="ui.coin" style={{ width: 10, height: 10 }} />
          </row>
          <stack style={{ width: 86, height: 86 }}>
            <stack style={{ width: 86, height: 86, fill: 0xf0_ea_e0 }} />
            <image texture="ui.coin" style={{ width: 86, height: 86 }} />
          </stack>
          <text style={{ width: 90, height: 28 }} content={`card ${page}.${index}`} />
        </column>
      </stack>
    </button>
  );
}

/**
 * One page of the strip, placed at `x`: the head of its set and the grid of its nine cards. 128 elements.
 *
 * @param page - The set of the page.
 * @param x - Its place on the strip.
 * @returns The page.
 */
function stripPage(page: number, x: number) {
  const rows = [0, 1, 2].map(line => (
    <row key={`albumGrid${page}Row${line}`} style={{ gap: 6 }}>
      {[0, 1, 2].map(column => card(page, line * 3 + column))}
    </row>
  ));

  return (
    <column
      key={`albumPage${page}`}
      style={{ position: "absolute", left: x, top: 0, width: PAGE_WIDTH, gap: 10 }}
    >
      <row key={`albumHead${page}`} style={{ height: 120, gap: 8 }}>
        <image texture="ui.coin" style={{ width: 100, height: 100 }} />
        <column style={{ gap: 4 }}>
          <text style={{ width: 220, height: 40 }} content={`The set ${page}`} />
          <text style={{ width: 220, height: 18 }} content="Collect every card" />
          <row style={{ gap: 4 }}>
            <image texture="ui.coin" style={{ width: 24, height: 24 }} />
            <image texture="ui.coin" style={{ width: 24, height: 24 }} />
          </row>
          <row style={{ height: 10 }}>
            <stack style={{ width: 160, height: 10, fill: 0xee_dd_ee }} />
            <stack style={{ width: 40, height: 10, fill: 0xaa_55_77 }} />
          </row>
          <text style={{ width: 40, height: 18 }} content={`${page % CARDS}/9`} />
        </column>
      </row>
      <stack key={`albumPanel${page}`} style={{ width: PAGE_WIDTH, fill: 0xfc_f6_f8 }}>
        <column key={`albumGrid${page}`} style={{ gap: 6, padding: 8 }}>
          {rows}
        </column>
      </stack>
    </column>
  );
}

/**
 * The 15 page dots, the dot of the page on show wide and filled. 61 elements.
 *
 * @param on - The page on show.
 * @returns The row of dots.
 */
function dots(on: number) {
  return (
    <row key="albumDots" style={{ height: 30, align: "center", justify: "center" }}>
      {Array.from({ length: ALBUM_SETS }, (_unused, index) => (
        <button key={`albumDot${index}`} intent="view" style={{ height: 30, padding: 4 }}>
          <stack key={`albumDot${index}Shape`} style={{ width: index === on ? 18 : 8, height: 8 }}>
            <stack
              key={`albumDot${index}Ring`}
              style={{ width: 8, height: 8, fill: index === on ? 0xff_ff_ff : 0xee_ee_ee }}
            />
            <stack
              key={`albumDot${index}Fill`}
              style={{ width: index === on ? 18 : 8, height: 8, fill: 0x88_33_55 }}
            />
          </stack>
        </button>
      ))}
    </row>
  );
}

/**
 * The album root on the set page: the page on show and the one beside it, on its side.
 *
 * @param on - The page on show.
 * @param beside - The second page of the strip.
 * @param side - Its side: -1 left, 1 right.
 * @returns The root's tree.
 */
function albumTree(on: number, beside: number, side: -1 | 1): DescriptionNode {
  return (
    <stack key="albumRoot" style={{ width: 390, height: 844 }}>
      {overview()}
      <column
        key="albumSetPage"
        style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
      >
        <row key="albumTopBar" style={{ height: 60, gap: 8, align: "center" }}>
          <button key="albumBack" intent="back" style={{ width: 44, height: 44 }}>
            <image texture="ui.coin" style={{ width: 44, height: 44 }} />
          </button>
          <text key="albumSetTitle" style={{ width: 200, height: 30 }} content={`Set ${on + 1} of 15`} />
          <button key="albumClose" intent="close" style={{ width: 44, height: 44 }}>
            <image texture="ui.coin" style={{ width: 44, height: 44 }} />
          </button>
        </row>
        <stack key="albumPageArea" style={{ grow: 1, minHeight: 0, overflow: "hidden" }}>
          <stack key="albumPages" style={{ position: "absolute", left: 21, top: 0, width: PAGE_WIDTH }}>
            {stripPage(on, 0)}
            {stripPage(beside, side * PITCH)}
          </stack>
          <button key="albumPrev" intent="view" style={{ position: "absolute", left: 0, top: 300 }}>
            <image texture="ui.coin" style={{ width: 40, height: 40 }} />
          </button>
          <button key="albumNext" intent="view" style={{ position: "absolute", right: 0, top: 300 }}>
            <image texture="ui.coin" style={{ width: 40, height: 40 }} />
          </button>
        </stack>
        {dots(on)}
      </column>
    </stack>
  ) as DescriptionNode;
}

/**
 * The trees of a swipe through the album, built once: from set `n` the finger peeks at set `n + 1`, which slides in
 * beside it, then the page turns and set `n + 1` stands at 0 with set `n` left behind on the left. The next peek drops
 * set `n` and brings set `n + 2`. A turn alone swaps the two pages of the strip and moves the wide dot: `peek` and
 * `turned` of one set, in turn, mount and drop nothing.
 */
export const ALBUM = {
  /** `peek[n]`: set `n` on show, set `n + 1` beside it on the right. */
  peek: Array.from({ length: ALBUM_SETS }, (_unused, set) =>
    albumTree(set, (set + 1) % ALBUM_SETS, 1)
  ),
  /** `turned[n]`: set `n + 1` on show, set `n` left on the left. */
  turned: Array.from({ length: ALBUM_SETS }, (_unused, set) =>
    albumTree((set + 1) % ALBUM_SETS, set, -1)
  )
};
