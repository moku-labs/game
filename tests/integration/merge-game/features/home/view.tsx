/**
 * @file Home (design §6 A2): the hub the player comes back to. A `screen` root padded with the
 * safe-area tokens holds the full-bleed sawmill yard, the top bar with the coin pill and the gear,
 * the logo sign over the Play plank, and the daily gift with its "1" while it waits. Every button
 * names an intent of the `home` rest node: `play`, `gift` and `openSettings`.
 */
import { projection, tr } from "../../kit";
import type { Player } from "../../state";
import { fullBleed, HudPill, LogoSign, PlankButton, RoundButton, safeScreen } from "../ui/kit";
import { giftCorner, homeBar, homeBottom, homeCentre, homeMiddle } from "./styles";

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
 * The Home screen: one item, so the projection needs no key.
 */
export const homeScreen = projection({
  name: "home.screen",
  layer: "ui",
  from: (player: Player): HomeView => ({ giftWaiting: !player.giftClaimed }),
  view: item => (
    <screen key="homeScreen" style={safeScreen}>
      <image key="homeBackground" texture="home.home-sawmill-scene" fit="cover" style={fullBleed} />
      <row key="homeBar" style={homeBar}>
        <HudPill id="homeCoins" icon="ui.icon-coin" hosts={["hud.coins"]} width="wide" />
        <RoundButton id="homeSettings" intent="openSettings" icon="ui.icon-gear" />
      </row>
      <column key="homeMiddle" style={homeMiddle}>
        <column key="homeCentre" style={homeCentre}>
          <LogoSign id="homeLogo" />
          <PlankButton id="play" intent="play" look="green" size="large" label={tr("home.play")} />
        </column>
      </column>
      <row key="homeBottom" style={homeBottom}>
        <column key="giftCorner" style={giftCorner}>
          <RoundButton
            id="gift"
            intent="gift"
            icon="ui.icon-gift"
            badge={item.giftWaiting ? 1 : undefined}
          />
          <text key="giftLabel" style="ui.name" content={tr("gift.title")} />
        </column>
      </row>
    </screen>
  )
});
