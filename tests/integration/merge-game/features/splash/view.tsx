/**
 * @file The splash (design §6 A1): the full-bleed forest, the logo sign at a quarter of the safe
 * height, and the loading bar with its label near the bottom. The fill of the bar is
 * `session.loading`, which the `setLoading` node commits as the three bundles come in.
 */
import { defineStyle, projection, tr } from "../../kit";
import type { Player, Session } from "../../state";
import { fullBleed, LogoSign, safeScreen } from "../ui/kit";

/** The track of the loading bar and the inset its fill keeps from the rim. */
const track = { width: 720, height: 72, inset: 12 } as const;

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
  gap: 16,
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
 * fillWidth(1); // 696
 * ```
 */
export function fillWidth(loading: number): number {
  const inside = track.width - 2 * track.inset;

  return Math.round(minFill + loading * (inside - minFill));
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
        </row>
        <text key="loadingLabel" style="ui.caption" content={tr("splash.loading")} />
      </column>
    </screen>
  )
});
