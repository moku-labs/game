/**
 * @file The splash (design §6 A1, §5.10): the full-bleed forest, the logo sign of Home at 24 % of
 * the safe height, and the loader 305 units above the bottom safe edge: the wooden track, the
 * honey fill that grows with `session.loading`, which the `setLoading` node commits as the three
 * bundles come in, the saw blade spinning on the head of the fill (`blade.ts`), and "Загрузка…"
 * under it.
 */
import { defineStyle, projection, tr } from "../../kit";
import type { Player, Session } from "../../state";
import { LogoSign } from "../home/logo";
import { fullBleed, safeScreen } from "../ui/kit";
import { blade, bladeSpin } from "./blade";

/** The track of the loading bar and the inset its fill keeps from the rim. */
export const track = { width: 810, height: 100, inset: 16 } as const;

/** The narrowest the fill can be drawn: the two ends of its nine-slice. */
const minFill = 48;

/** The room above the logo: 24 % of the safe height (design §5.10). */
const aboveLogo = defineStyle({ height: "24%" });

/** Everything between the logo and the loader. */
const between = defineStyle({ grow: 1 });

/** The loader: the bar and its label, 305 units above the bottom safe edge (design §5.10). */
const loader = defineStyle({
  direction: "column",
  align: "center",
  gap: 40,
  margin: { bottom: 305 }
});

/** The track of the bar. */
const trackStyle = defineStyle({
  width: track.width,
  height: track.height,
  direction: "row",
  align: "center",
  padding: track.inset,
  nineSlice: "ui.bar-track"
});

/**
 * The splash as the view reads it: how far the loading has come.
 *
 * @example
 * ```ts
 * const splash: SplashView = { loading: 0.5 };
 * ```
 */
export type SplashView = { loading: number };

/**
 * The width of the fill for one share, in reference units: from the two ends of the nine-slice up
 * to the inside of the track.
 *
 * @param loading - The share, 0..1.
 * @returns The width of the fill.
 * @example
 * ```ts
 * fillWidth(1); // 778
 * ```
 */
export function fillWidth(loading: number): number {
  const inside = track.width - 2 * track.inset;

  return Math.round(minFill + loading * (inside - minFill));
}

/**
 * Where the fill ends, in the track's own units: the point the middle of the saw blade stands on.
 *
 * @param loading - The share, 0..1.
 * @returns The x of the head of the fill.
 * @example
 * ```ts
 * fillHead(1); // 794
 * ```
 */
export function fillHead(loading: number): number {
  return track.inset + fillWidth(loading);
}

/**
 * The style of the fill for one share. Nothing is drawn before the first file settles.
 *
 * @param loading - The share, 0..1.
 * @returns The style of the fill.
 */
function fillStyle(loading: number) {
  return defineStyle({
    width: fillWidth(loading),
    height: track.height - 2 * track.inset,
    alpha: loading > 0 ? 1 : 0,
    nineSlice: "ui.bar-fill"
  });
}

/**
 * The style of the saw blade for one share: its middle on the head of the fill and on the middle
 * line of the track, tinted steel.
 *
 * @param loading - The share, 0..1.
 * @returns The style of the blade.
 */
function bladeStyle(loading: number) {
  return defineStyle({
    position: "absolute",
    left: fillHead(loading) - blade.size / 2,
    top: (track.height - blade.size) / 2,
    width: blade.size,
    height: blade.size,
    tint: blade.steel,
    reason: "the saw blade rides the head of the fill, over the rim of the track"
  });
}

/**
 * The splash screen: one item, so the projection needs no key.
 */
export const splashScreen = projection({
  name: "splash.screen",
  layer: "ui",
  from: (_player: Player, session: Session): SplashView => ({ loading: session.loading }),
  view: item => (
    <screen key="splashScreen" style={safeScreen}>
      <image key="splashBackground" texture="splash.bg-splash" fit="cover" style={fullBleed} />
      <spacer key="splashAbove" style={aboveLogo} />
      <LogoSign id="splashLogo" />
      <spacer key="splashBetween" style={between} />
      <column key="loader" style={loader}>
        <row key="loadingTrack" style={trackStyle}>
          <row key="loadingFill" style={fillStyle(item.loading)} />
          <image
            key="loadingBlade"
            texture="ui.icon-gear"
            style={bladeStyle(item.loading)}
            motion={bladeSpin}
          />
        </row>
        <text key="loadingLabel" style="ui.caption" content={tr("splash.loading")} />
      </column>
    </screen>
  )
});
