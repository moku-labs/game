/**
 * @file Home (design §6 A2): the hub the player comes back to. A `screen` root padded with the
 * safe-area tokens holds the full-bleed meadow, the centre group — the logo sign on its ropes, the
 * sawmill yard and the green Play sign on two posts — and the daily gift with its "1" and its
 * wobble while it waits. The top bar with the coin pill and the gear lies over it all. Every button names an
 * intent of the `home` rest node: `play`, `gift` and `openSettings`.
 */
import { projection, tr } from "../../kit";
import type { Player } from "../../state";
import { fullBleed, HudPill, RoundButton, safeScreen } from "../ui/kit";
import { LogoSign } from "./logo";
import { giftStill, giftWobble } from "./motions";
import {
  GIFT_SIZE,
  giftCorner,
  giftWobbleStyle,
  homeBar,
  homeBarRoom,
  homeBottom,
  homeCentre,
  homeMiddle,
  homeTop,
  homeYard,
  playButton,
  playPosts,
  playSignStyle,
  playSprigLeft,
  playSprigRight
} from "./styles";

/**
 * Home as the view reads it: only whether the gift is still there. The coins are the counter
 * projection the coin pill hosts.
 *
 * @example
 * ```ts
 * const home: HomeView = { giftWaiting: true };
 * ```
 */
export type HomeView = { giftWaiting: boolean };

/**
 * The Play sign: the green plank on two posts, a berry sprig on each end. The posts come first,
 * so the plank covers their tops; the plank is the button `play`.
 *
 * @returns The stack element.
 */
function PlaySign() {
  return (
    <stack key="playSign" style={playSignStyle}>
      <image key="playPostLeft" texture="home.sign-post" fit="cover" style={playPosts.left} />
      <image key="playPostRight" texture="home.sign-post" fit="cover" style={playPosts.right} />
      <button key="play" intent="play" style={playButton}>
        <text key="playLabel" style="ui.sign" content={tr("home.play")} />
      </button>
      <image key="playSprigLeft" texture="ui.decor-sprig" style={playSprigLeft} />
      <image key="playSprigRight" texture="ui.decor-sprig" style={playSprigRight} />
    </stack>
  );
}

/**
 * The Home screen: one item, so the projection needs no key.
 */
export const homeScreen = projection({
  name: "home.screen",
  layer: "ui",
  from: (player: Player): HomeView => ({ giftWaiting: !player.giftClaimed }),
  view: item => (
    <screen key="homeScreen" style={safeScreen}>
      <image key="homeBackground" texture="board.bg-forest-meadow" fit="cover" style={fullBleed} />
      <spacer key="homeBarRoom" style={homeBarRoom} />
      <column key="homeMiddle" style={homeMiddle}>
        <column key="homeCentre" style={homeCentre}>
          <LogoSign id="homeLogo" />
          <image key="homeYard" texture="home.home-yard" style={homeYard} />
          <PlaySign />
        </column>
      </column>
      <row key="homeBottom" style={homeBottom}>
        <column key="giftCorner" style={giftCorner}>
          <stack
            key="giftWobble"
            style={giftWobbleStyle}
            motion={item.giftWaiting ? giftWobble : giftStill}
          >
            <RoundButton
              id="gift"
              intent="gift"
              icon="ui.icon-gift"
              badge={item.giftWaiting ? 1 : undefined}
              size={GIFT_SIZE}
            />
          </stack>
          <text key="giftLabel" style="ui.caption" content={tr("gift.title")} />
        </column>
      </row>
      <column key="homeTop" style={homeTop}>
        <row key="homeBar" style={homeBar}>
          <HudPill id="homeCoins" icon="ui.icon-coin" hosts={["hud.coins"]} width="wide" />
          <RoundButton id="homeSettings" intent="openSettings" icon="ui.icon-gear" />
        </row>
      </column>
    </screen>
  )
});
