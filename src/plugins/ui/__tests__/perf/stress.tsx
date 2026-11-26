/**
 * @file ui plugin — the trees of the scale files of change 2026-11-26-hot-path-research. Not a test file. The album
 * sheet of the F244 files (`album.tsx`) with its number of sets as a parameter, so one shape is measured at 572,
 * 1 180 and 1 960 elements, and an event popup of 150 elements that opens over it. Every tree is built once, at load.
 */
import type { DescriptionNode } from "../../jsx/types";

/** The cards of a page, three rows of three. */
const CARDS = 9;

/** The width of a page; the pitch of the strip is 1.25 widths. */
const PAGE_WIDTH = 348;

/** The distance between two pages of the strip. */
const PITCH = PAGE_WIDTH * 1.25;

/**
 * One tile of the overview: 20 elements.
 *
 * @param index - The set of the tile.
 * @returns The tile.
 */
function tile(index: number) {
  return (
    <button key={`sTile${index}`} intent="view" style={{ width: 110, height: 150 }}>
      <stack key={`sTile${index}Body`} style={{ width: 110, height: 150, fill: 0xf4_ee_f0 }}>
        <column key={`sTile${index}Column`} style={{ padding: 6, gap: 4, align: "center" }}>
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
 * The overview behind the set page: a head and rows of three tiles.
 *
 * @param sets - The sets of the album.
 * @returns The overview.
 */
function overview(sets: number) {
  const rows = Array.from({ length: sets / 3 }, (_unused, line) => (
    <row key={`sRow${line}`} style={{ gap: 8 }}>
      {[0, 1, 2].map(column => tile(line * 3 + column))}
    </row>
  ));

  return (
    <column key="sOverview" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
      <row key="sOverviewHead" style={{ height: 60, gap: 8, align: "center" }}>
        <image texture="ui.coin" style={{ width: 40, height: 40 }} />
        <text style={{ width: 200, height: 30 }} content="Album" />
        <image texture="ui.coin" style={{ width: 40, height: 40 }} />
      </row>
      <column key="sRows" style={{ gap: 8, padding: 12 }}>
        {rows}
      </column>
    </column>
  );
}

/**
 * One card of a page: 12 elements.
 *
 * @param page - The set of the page.
 * @param index - The card.
 * @returns The card.
 */
function card(page: number, index: number) {
  return (
    <button key={`sCard${page}x${index}`} intent="zoom" style={{ width: 100, height: 140 }}>
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
 * One page of the strip, placed at `x`: 128 elements.
 *
 * @param page - The set of the page.
 * @param x - Its place on the strip.
 * @returns The page.
 */
function stripPage(page: number, x: number) {
  const rows = [0, 1, 2].map(line => (
    <row key={`sGrid${page}Row${line}`} style={{ gap: 6 }}>
      {[0, 1, 2].map(column => card(page, line * 3 + column))}
    </row>
  ));

  return (
    <column
      key={`sPage${page}`}
      style={{ position: "absolute", left: x, top: 0, width: PAGE_WIDTH, gap: 10 }}
    >
      <row key={`sHead${page}`} style={{ height: 120, gap: 8 }}>
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
      <stack key={`sPanel${page}`} style={{ width: PAGE_WIDTH, fill: 0xfc_f6_f8 }}>
        <column key={`sGrid${page}`} style={{ gap: 6, padding: 8 }}>
          {rows}
        </column>
      </stack>
    </column>
  );
}

/**
 * The page dots, the dot of the page on show wide and filled: 4 elements a set and the row.
 *
 * @param sets - The sets of the album.
 * @param on - The page on show.
 * @returns The row of dots.
 */
function dots(sets: number, on: number) {
  return (
    <row key="sDots" style={{ height: 30, align: "center", justify: "center" }}>
      {Array.from({ length: sets }, (_unused, index) => (
        <button key={`sDot${index}`} intent="view" style={{ height: 30, padding: 4 }}>
          <stack key={`sDot${index}Shape`} style={{ width: index === on ? 18 : 8, height: 8 }}>
            <stack
              key={`sDot${index}Ring`}
              style={{ width: 8, height: 8, fill: index === on ? 0xff_ff_ff : 0xee_ee_ee }}
            />
            <stack
              key={`sDot${index}Fill`}
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
 * @param sets - The sets of the album: 15 gives 572 elements, 40 gives 1 180, 72 gives 1 960.
 * @param on - The page on show.
 * @param beside - The second page of the strip.
 * @param side - Its side: -1 left, 1 right.
 * @returns The root's tree.
 */
export function stressAlbumTree(
  sets: number,
  on: number,
  beside: number,
  side: -1 | 1
): DescriptionNode {
  return (
    <stack key="sRoot" style={{ width: 390, height: 844 }}>
      {overview(sets)}
      <column key="sSetPage" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
        <row key="sTopBar" style={{ height: 60, gap: 8, align: "center" }}>
          <button key="sBack" intent="back" style={{ width: 44, height: 44 }}>
            <image texture="ui.coin" style={{ width: 44, height: 44 }} />
          </button>
          <text key="sSetTitle" style={{ width: 200, height: 30 }} content={`Set ${on + 1}`} />
          <button key="sClose" intent="close" style={{ width: 44, height: 44 }}>
            <image texture="ui.coin" style={{ width: 44, height: 44 }} />
          </button>
        </row>
        <stack key="sPageArea" style={{ grow: 1, minHeight: 0, overflow: "hidden" }}>
          <stack key="sPages" style={{ position: "absolute", left: 21, top: 0, width: PAGE_WIDTH }}>
            {stripPage(on, 0)}
            {stripPage(beside, side * PITCH)}
          </stack>
        </stack>
        {dots(sets, on)}
      </column>
    </stack>
  ) as DescriptionNode;
}

/** The trees of a swipe through an album of one size. */
export type StressAlbum = {
  sets: number;
  /** `peek[n]`: set `n` on show, set `n + 1` beside it on the right. */
  peek: DescriptionNode[];
  /** `turned[n]`: set `n + 1` on show, set `n` left on the left. */
  turned: DescriptionNode[];
};

/** How many sets of a walk are prebuilt: a swipe goes through them and starts over. */
export const WALK = 6;

/**
 * The prebuilt trees of a swipe through the first sets of an album.
 *
 * @param sets - The sets of the album.
 * @returns Its peeks and turns.
 */
export function stressAlbum(sets: number): StressAlbum {
  return {
    sets,
    peek: Array.from({ length: WALK }, (_unused, set) =>
      stressAlbumTree(sets, set, (set + 1) % WALK, 1)
    ),
    turned: Array.from({ length: WALK }, (_unused, set) =>
      stressAlbumTree(sets, (set + 1) % WALK, set, -1)
    )
  };
}

/** The album sizes of the scale files: sets, and the name of the projection that mounts it. */
export const SIZES = [
  { sets: 15, name: "album572" },
  { sets: 40, name: "album1180" },
  { sets: 72, name: "album1960" }
] as const;

/** The trees of each size, by projection name. */
export const ALBUMS: Record<string, StressAlbum> = Object.fromEntries(
  SIZES.map(size => [size.name, stressAlbum(size.sets)])
);

/**
 * One reward of the popup: a box, a picture, a count and a tag. 6 elements.
 *
 * @param index - The reward.
 * @returns The reward.
 */
function reward(index: number) {
  return (
    <stack key={`pReward${index}`} style={{ width: 72, height: 92, fill: 0xff_f8_ee }}>
      <column style={{ padding: 4, gap: 2, align: "center" }}>
        <image texture="ui.coin" style={{ width: 56, height: 56 }} />
        <text style={{ width: 64, height: 16 }} content={`x${index + 1}`} />
        <stack style={{ width: 40, height: 6, fill: 0xdd_aa_55 }} />
        <image texture="ui.coin" style={{ width: 10, height: 10 }} />
      </column>
    </stack>
  );
}

/**
 * An event popup over the screen: the dim, a panel with a head, a text, a grid of 16 rewards, a progress line of
 * 12 steps and two buttons. 150 elements.
 *
 * @returns The popup's tree.
 */
export function popupTree(): DescriptionNode {
  return (
    <stack key="pRoot" style={{ width: 390, height: 844 }}>
      <stack
        key="pDim"
        style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, fill: 0 }}
      />
      <column
        key="pPanel"
        style={{ position: "absolute", left: 25, top: 140, width: 340, gap: 8, fill: 0xff_ff_ff }}
      >
        <row key="pHead" style={{ height: 60, gap: 8, align: "center" }}>
          <image texture="ui.coin" style={{ width: 48, height: 48 }} />
          <text key="pTitle" style={{ width: 220, height: 30 }} content="The event" />
          <button key="pClose" intent="close" style={{ width: 44, height: 44 }}>
            <image texture="ui.coin" style={{ width: 44, height: 44 }} />
          </button>
        </row>
        <text key="pBody" style={{ width: 320, height: 60 }} content="Collect and win the prize" />
        {[0, 1, 2, 3].map(line => (
          <row key={`pRow${line}`} style={{ gap: 6, justify: "center" }}>
            {[0, 1, 2, 3].map(column => reward(line * 4 + column))}
          </row>
        ))}
        <row key="pSteps" style={{ height: 24, gap: 2, align: "center" }}>
          {Array.from({ length: 12 }, (_unused, index) => (
            <stack key={`pStep${index}`} style={{ width: 24, height: 12, fill: 0xee_dd_ee }}>
              <stack style={{ width: 12, height: 12, fill: 0xaa_55_77 }} />
            </stack>
          ))}
        </row>
        <row key="pButtons" style={{ height: 60, gap: 12, justify: "center" }}>
          <button key="pLater" intent="close" style={{ width: 140, height: 52, fill: 0xdd_dd_dd }}>
            <text style={{ width: 120, height: 24 }} content="Later" />
          </button>
          <button key="pGo" intent="view" style={{ width: 140, height: 52, fill: 0x55_aa_66 }}>
            <text style={{ width: 120, height: 24 }} content="Play" />
          </button>
        </row>
      </column>
    </stack>
  ) as DescriptionNode;
}

/** The popup's one tree, built once. */
export const POPUP = popupTree();
