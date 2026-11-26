/**
 * @file The screens of the stress bench, in JSX, shaped like the heaviest screens of «A Memory Missing»: the album
 * sheet (the overview kept mounted at alpha 0 under the set page, a strip of two pages, the dots), an event popup of
 * about 250 elements over a dim, and the HUD of the board. Sizes follow the game's counts: a tile 18 elements, a
 * card 11 and its stars, a strip page about 170.
 */
import { Alpha, Frost, HudPart, Overlay, Source } from "../../../../src/index.ts";
import { projection } from "../../kit";
import type { Player, Session } from "../../state";

/** The width of a page; the pitch of the strip is 1.25 widths. */
export const PAGE_WIDTH = 348;

/** The distance between two pages of the strip. */
export const PITCH = PAGE_WIDTH * 1.25;

/** The height of the overview's scroll: the screen under its head. A scroll that grows shows all its content. */
const VIEWPORT = 784;

/** What the album sheet is drawn from. */
type AlbumView = {
  id: string;
  sets: number;
  on: number;
  beside: number;
  side: number;
  page: boolean;
  windowed: boolean;
};

/**
 * One tile of the overview: a button, a glow, a panel, a clipped cover with its ring, a ribbon and a pill.
 *
 * @param index - The set of the tile.
 * @returns The tile.
 */
function tile(index: number) {
  return (
    <button key={`tile${index}`} intent="peek" style={{ width: 114, height: 157 }}>
      <image
        texture="ui.fx-spark"
        style={{ position: "absolute", left: 0, top: 0, width: 114, height: 114 }}
      />
      <stack style={{ width: 114, height: 157, radius: 14, fill: 0xf4_ee_f0 }}>
        <column style={{ padding: 6, gap: 4, align: "center" }}>
          <stack style={{ width: 102, height: 102 }}>
            <stack style={{ width: 102, height: 102, radius: 15, fill: 0xff_ff_ff }} />
            <stack style={{ width: 98, height: 98, radius: 13, overflow: "hidden" }}>
              <image texture="ui.pv-item" fit="cover" style={{ width: 98, height: 98 }} />
            </stack>
          </stack>
          <stack style={{ width: 100, height: 18, radius: 6, fill: 0xaa_55_77 }}>
            <text style="s.name" content={`The set number ${index + 1}`} />
          </stack>
          <row style={{ height: 16, gap: 3, align: "center" }}>
            <stack style={{ width: 44, height: 16, radius: 8, fill: 0x66_44_55 }}>
              <text style="s.pill" content={`${index % 9}/9`} />
            </stack>
            <image texture="ui.fx-spark" style={{ width: 12, height: 12 }} />
          </row>
        </column>
      </stack>
    </button>
  );
}

/**
 * The overview: a head and the grid of the tiles, three a row, in a scroll.
 *
 * @param sets - The sets of the album.
 * @param covered - Whether a set page stands over it: it stays mounted, at alpha 0.
 * @param windowed - Whether the scroll is a window of rows: only the rows in view exist (`&cull=window`).
 * @returns The overview.
 */
function overview(sets: number, covered: boolean, windowed: boolean) {
  const rowOf = (line: number) => (
    <row key={`tileRow${line}`} style={{ gap: 10, height: 175, padding: 9 }}>
      {[0, 1, 2].map(column => tile(line * 3 + column))}
    </row>
  );
  const rows = windowed
    ? []
    : Array.from({ length: Math.ceil(sets / 3) }, (_unused, line) => (
        <row key={`tileRow${line}`} style={{ gap: 10 }}>
          {[0, 1, 2].map(column => tile(line * 3 + column))}
        </row>
      ));

  return (
    <column
      key="overview"
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
      components={[Alpha({ alpha: covered ? 0 : 1 })]}
    >
      <row key="overviewHead" style={{ height: 60, gap: 8, align: "center" }}>
        <image texture="ui.pv-item" style={{ width: 40, height: 40 }} />
        <text style="s.title" content="Album" />
        <stack style={{ width: 70, height: 28, radius: 14, fill: 0x66_44_55 }}>
          <text style="s.pill" content="12/135" />
        </stack>
      </row>
      {windowed ? (
        <scroll
          key="overviewScroll"
          rows={Math.ceil(sets / 3)}
          rowHeight={175}
          overscan={1}
          row={rowOf}
          style={{ height: VIEWPORT }}
        />
      ) : (
        <scroll key="overviewScroll" style={{ height: VIEWPORT }}>
          <column key="tileRows" style={{ gap: 18, padding: 12 }}>
            {rows}
          </column>
        </scroll>
      )}
    </column>
  );
}

/**
 * One card of a page: a panel, its stars, a clipped picture in a white ring and a caption.
 *
 * @param page - The set of the page.
 * @param index - The card.
 * @returns The card.
 */
function card(page: number, index: number) {
  const stars = 1 + ((page + index) % 5);

  return (
    <button key={`card${page}x${index}`} intent="peek" style={{ width: 104, height: 146 }}>
      <stack style={{ width: 104, height: 146, radius: 12, fill: 0xfa_f0_f4 }}>
        <column style={{ padding: 4, gap: 3, align: "center" }}>
          <row style={{ gap: 2, height: 10 }}>
            {Array.from({ length: stars }, (_unused, star) => (
              <image
                key={`card${page}x${index}star${star}`}
                texture="ui.fx-spark"
                style={{ width: 10, height: 10 }}
              />
            ))}
          </row>
          <stack style={{ width: 90, height: 90 }}>
            <stack style={{ width: 90, height: 90, radius: 10.5, fill: 0xff_ff_ff }} />
            <stack style={{ width: 86, height: 86, radius: 9, overflow: "hidden" }}>
              <image texture="ui.pv-item" fit="cover" style={{ width: 86, height: 86 }} />
            </stack>
          </stack>
          <stack style={{ width: 96, height: 28 }}>
            <text style="s.name" content={`A card with a name ${page + 1}.${index + 1}`} />
          </stack>
        </column>
      </stack>
    </button>
  );
}

/**
 * One page of the strip, placed at `x`: the head of its set and the grid of its nine cards.
 *
 * @param page - The set of the page.
 * @param x - Its place on the strip.
 * @returns The page.
 */
function stripPage(page: number, x: number) {
  const rows = [0, 1, 2].map(line => (
    <row key={`grid${page}Row${line}`} style={{ gap: 6 }}>
      {[0, 1, 2].map(column => card(page, line * 3 + column))}
    </row>
  ));

  return (
    <column
      key={`page${page}`}
      style={{ position: "absolute", left: x, top: 0, width: PAGE_WIDTH, gap: 10 }}
    >
      <row key={`head${page}`} style={{ height: 120, gap: 8 }}>
        <stack style={{ width: 102, height: 102 }}>
          <stack style={{ width: 102, height: 102, radius: 15, fill: 0xff_ff_ff }} />
          <stack style={{ width: 98, height: 98, radius: 13, overflow: "hidden" }}>
            <image texture="ui.pv-item" fit="cover" style={{ width: 98, height: 98 }} />
          </stack>
        </stack>
        <column style={{ gap: 4, width: 230 }}>
          <text style="s.title" content={`The set number ${page + 1}`} />
          <text style="s.name" content="Collect every card of the set to win its prize" />
          <row style={{ gap: 4 }}>
            <image texture="ui.pv-item" style={{ width: 24, height: 24 }} />
            <image texture="ui.pv-item" style={{ width: 24, height: 24 }} />
            <stack style={{ width: 44, height: 20, radius: 10, fill: 0x66_44_55 }}>
              <text style="s.pill" content="x250" />
            </stack>
          </row>
          <stack style={{ width: 200, height: 10, radius: 5, fill: 0xee_dd_ee }}>
            <stack
              style={{ width: 20 + ((page * 20) % 180), height: 10, radius: 5, fill: 0xaa_55_77 }}
            />
          </stack>
          <stack style={{ width: 44, height: 18, radius: 9, fill: 0x66_44_55 }}>
            <text style="s.pill" content={`${page % 9}/9`} />
          </stack>
        </column>
      </row>
      <stack key={`panel${page}`} style={{ width: PAGE_WIDTH, radius: 16, fill: 0xfc_f6_f8 }}>
        <column key={`grid${page}`} style={{ gap: 6, padding: 8 }}>
          {rows}
        </column>
      </stack>
    </column>
  );
}

/**
 * The page dots, the dot of the page on show wide and filled: 4 elements a set.
 *
 * @param sets - The sets of the album.
 * @param on - The page on show.
 * @returns The row of dots.
 */
function dots(sets: number, on: number) {
  return (
    <row key="dots" style={{ height: 30, align: "center", justify: "center", wrap: true }}>
      {Array.from({ length: sets }, (_unused, index) => (
        <button key={`dot${index}`} intent="peek" style={{ height: 15, padding: 3 }}>
          <stack key={`dot${index}Shape`} style={{ width: index === on ? 18 : 8, height: 8 }}>
            <stack
              key={`dot${index}Ring`}
              style={{
                width: 8,
                height: 8,
                radius: 4,
                fill: index === on ? 0xff_ff_ff : 0xee_ee_ee
              }}
            />
            <stack
              key={`dot${index}Fill`}
              style={{ width: index === on ? 18 : 8, height: 8, radius: 4, fill: 0x88_33_55 }}
            />
          </stack>
        </button>
      ))}
    </row>
  );
}

/**
 * The set page over the overview: the top bar, the strip of one or two pages, the dots.
 *
 * @param item - What the sheet is drawn from.
 * @returns The set page.
 */
function setPage(item: AlbumView) {
  return (
    <column key="setPage" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
      <row key="topBar" style={{ height: 60, gap: 8, align: "center" }}>
        <button key="back" intent="peek" style={{ width: 44, height: 44 }}>
          <image texture="ui.pv-item" style={{ width: 44, height: 44 }} />
        </button>
        <text key="setTitle" style="s.title" content={`Set ${item.on + 1} of ${item.sets}`} />
      </row>
      <stack key="pageArea" style={{ grow: 1, minHeight: 0, overflow: "hidden" }}>
        <stack key="pages" style={{ position: "absolute", left: 21, top: 0, width: PAGE_WIDTH }}>
          {stripPage(item.on, 0)}
          {item.beside < 0 ? undefined : stripPage(item.beside, item.side * PITCH)}
        </stack>
      </stack>
      {dots(item.sets, item.on)}
    </column>
  );
}

/** The album sheet: the overview under the set page, the strip of two pages, the dots. */
export const albumSheet = projection({
  name: "album.sheet",
  layer: "ui",
  from: (_player: Player, session: Session): AlbumView[] =>
    session.scene === "album" || session.scene === "scroll" || session.scene === "worst"
      ? [
          {
            id: "album",
            sets: session.sets,
            on: session.on,
            beside: session.beside,
            side: session.side,
            page: session.scene !== "scroll",
            windowed: session.cull === "window"
          }
        ]
      : [],
  key: (item: AlbumView) => item.id,
  view: (item: AlbumView) => (
    <stack
      key="albumRoot"
      style={{ width: 390, height: 844, fill: 0xf0_e6_ea }}
      components={[Source({ scale: 0.25 })]}
    >
      {overview(item.sets, item.page, item.windowed)}
      {item.page ? setPage(item) : undefined}
    </stack>
  )
});

/** What a popup is drawn from. */
type PopupView = { id: string; level: number; glass: boolean };

/**
 * One day card of the popup: about 22 elements.
 *
 * @param popup - The popup.
 * @param index - The day.
 * @returns The card.
 */
function day(popup: string, index: number) {
  return (
    <stack
      key={`${popup}Day${index}`}
      style={{ width: 96, height: 124, radius: 12, fill: 0xff_f8_ee }}
    >
      <column style={{ padding: 5, gap: 3, align: "center" }}>
        <stack style={{ width: 60, height: 16, radius: 8, fill: 0xdd_aa_55 }}>
          <text style="s.pill" content={`Day ${index + 1}`} />
        </stack>
        <stack style={{ width: 64, height: 64 }}>
          <stack style={{ width: 64, height: 64, radius: 10, fill: 0xff_ff_ff }} />
          <image
            texture="ui.fx-spark"
            style={{ position: "absolute", left: 0, top: 0, width: 64, height: 64 }}
          />
          <stack style={{ width: 60, height: 60, radius: 8, overflow: "hidden" }}>
            <image texture="ui.pv-item" fit="cover" style={{ width: 60, height: 60 }} />
          </stack>
        </stack>
        <row style={{ gap: 2, height: 14, align: "center" }}>
          <image texture="ui.fx-spark" style={{ width: 12, height: 12 }} />
          <text style="s.pill" content={`x${(index + 1) * 5}`} />
          <image texture="ui.fx-spark" style={{ width: 12, height: 12 }} />
        </row>
        <stack style={{ width: 80, height: 6, radius: 3, fill: 0xee_dd_ee }}>
          <stack style={{ width: 10 + index * 8, height: 6, radius: 3, fill: 0xaa_55_77 }} />
        </stack>
      </column>
    </stack>
  );
}

/** The event popups: each over a dim, with a head, nine day cards, a track of 30 steps and two buttons. */
export const popups = projection({
  name: "popups",
  layer: "ui",
  from: (_player: Player, session: Session): PopupView[] =>
    Array.from({ length: session.popups }, (_unused, level) => ({
      id: `popup${level}`,
      level,
      glass: session.glass
    })),
  key: (item: PopupView) => item.id,
  view: (item: PopupView) => (
    <stack
      key={`${item.id}Root`}
      style={{ width: 390, height: 844 }}
      components={[Overlay({ dim: 0.5, hold: true, hud: ["coins", "gems"], hudInert: true })]}
    >
      <column
        key={`${item.id}Panel`}
        style={{
          position: "absolute",
          left: 20 + item.level * 8,
          top: 110 + item.level * 30,
          width: 350,
          gap: 8,
          padding: 10,
          radius: 22,
          fill: 0xff_ff_ff
        }}
        components={item.glass ? [Frost({ blur: 12 })] : []}
      >
        <row key={`${item.id}Head`} style={{ height: 56, gap: 8, align: "center" }}>
          <image texture="ui.pv-item" style={{ width: 48, height: 48 }} />
          <text key={`${item.id}Title`} style="s.title" content="The daily gifts of the week" />
          <button key={`${item.id}Close`} intent="close" style={{ width: 44, height: 44 }}>
            <image texture="ui.fx-spark" style={{ width: 44, height: 44 }} />
          </button>
        </row>
        <text
          key={`${item.id}Body`}
          style="s.name"
          content="Come back every day and collect them all"
        />
        {[0, 1, 2].map(line => (
          <row key={`${item.id}Row${line}`} style={{ gap: 8, justify: "center" }}>
            {[0, 1, 2].map(column => day(item.id, line * 3 + column))}
          </row>
        ))}
        <row
          key={`${item.id}Track`}
          style={{ height: 20, gap: 2, align: "center", justify: "center" }}
        >
          {Array.from({ length: 15 }, (_unused, index) => (
            <stack
              key={`${item.id}Step${index}`}
              style={{ width: 18, height: 10, radius: 5, fill: 0xee_dd_ee }}
            >
              <stack style={{ width: 9, height: 10, radius: 5, fill: 0xaa_55_77 }} />
            </stack>
          ))}
        </row>
        <row key={`${item.id}Buttons`} style={{ height: 56, gap: 12, justify: "center" }}>
          <button
            key={`${item.id}Later`}
            intent="close"
            style={{ width: 150, height: 52, radius: 26, fill: 0xdd_dd_dd }}
          >
            <text style="s.title" content="Later" />
          </button>
          <button
            key={`${item.id}Go`}
            intent="close"
            style={{ width: 150, height: 52, radius: 26, fill: 0x55_aa_66 }}
          >
            <text style="s.title" content="Collect" />
          </button>
        </row>
      </column>
    </stack>
  )
});

/** What the HUD is drawn from. */
type HudView = { id: string; merges: number };

/**
 * One pill of the HUD: about 9 elements, its number changing with every merge.
 *
 * @param name - The key of the pill and its HUD part.
 * @param value - The number it shows.
 * @returns The pill.
 */
function pill(name: string, value: number) {
  return (
    <stack
      key={name}
      style={{ width: 84, height: 32, radius: 16, fill: 0x33_22_2a }}
      components={[HudPart({ key: name })]}
    >
      <row style={{ gap: 4, align: "center", padding: 4 }}>
        <image texture="ui.pv-item" style={{ width: 24, height: 24 }} />
        <text key={`${name}Count`} style="s.pill" content={`${value}`} />
        <stack style={{ width: 16, height: 16, radius: 8, fill: 0x55_aa_66 }}>
          <image texture="ui.fx-spark" style={{ width: 12, height: 12 }} />
        </stack>
      </row>
    </stack>
  );
}

/** The HUD of the board: four pills on top and an order row of five seats under the field. */
export const hud = projection({
  name: "hud",
  layer: "ui",
  from: (_player: Player, session: Session): HudView[] =>
    session.scene === "board" || session.scene === "worst"
      ? [{ id: "hud", merges: session.merges }]
      : [],
  key: (item: HudView) => item.id,
  view: (item: HudView) => (
    <column key="hudRoot" style={{ width: 390, height: 844, justify: "between" }}>
      <row key="hudTop" style={{ height: 60, gap: 8, align: "center", justify: "center" }}>
        {pill("coins", 1200 + item.merges * 7)}
        {pill("gems", 40 + item.merges)}
        {pill("energy", 99 - (item.merges % 90))}
        {pill("level", 12)}
      </row>
      <row key="orders" style={{ height: 150, gap: 6, justify: "center" }}>
        {Array.from({ length: 5 }, (_unused, seat) => (
          <stack
            key={`seat${seat}`}
            style={{ width: 70, height: 140, radius: 12, fill: 0xfa_f0_f4 }}
          >
            <column style={{ padding: 4, gap: 3, align: "center" }}>
              <stack style={{ width: 56, height: 56, radius: 28, overflow: "hidden" }}>
                <image texture="ui.pv-item" fit="cover" style={{ width: 56, height: 56 }} />
              </stack>
              <row style={{ gap: 2 }}>
                <image texture="ui.pv-item" style={{ width: 24, height: 24 }} />
                <image texture="ui.pv-item" style={{ width: 24, height: 24 }} />
              </row>
              <stack style={{ width: 60, height: 20, radius: 10, fill: 0x55_aa_66 }}>
                <text style="s.pill" content={`${(item.merges + seat) % 4}/3`} />
              </stack>
              <stack style={{ width: 60, height: 6, radius: 3, fill: 0xee_dd_ee }}>
                <stack style={{ width: 30, height: 6, radius: 3, fill: 0xaa_55_77 }} />
              </stack>
            </column>
          </stack>
        ))}
      </row>
    </column>
  )
});
