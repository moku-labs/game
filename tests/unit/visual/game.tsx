/**
 * @file The tiny game the visual runner tests play: Home with a coin counter and an Open button,
 * a reward popup that swings in for four seconds, and a node that credits the reward after the
 * Claim tap. The real screen set in plain Bun: the renderer is inert, Yoga and `anim` run.
 */
import {
  createApp,
  defineComponent,
  defineGame,
  defineMotion,
  popup,
  projection,
  screen,
  type
} from "@moku-labs/game";
import { fakeClock } from "@moku-labs/game/testing";

/** The player of the tiny game. */
export type Player = { coins: number };

/** The session of the tiny game. */
type Session = { visits: number };

const { defineNode, defineFlow, defineFeature, defineScene } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** How long the popup swings in: far longer than the frames a settle runs before the gate opens. */
export const swingMs = 4000;

/** The popup drops in from above and settles, over `swingMs`. */
const swing = defineMotion({
  keyframes: {
    dropIn: [
      { at: 0, Transform: { dy: -600, scale: 0.8 } },
      { at: 1, Transform: { dy: 0, scale: 1 } }
    ]
  },
  transition: { ms: swingMs },
  on: { enter: "dropIn" }
});

/** The reward popup: the gold it pays and a Claim button, its one outcome. */
const RewardPopup = defineComponent("RewardPopup", {
  outcomes: { claim: type() },
  view: (props: { gold: number }) => (
    <panel key="reward" style={{ width: 600, height: 400, fill: 0x10_10_18 }} motion={swing}>
      <text key="gold" style={{ width: 200, height: 40 }} content={String(props.gold)} />
      <button key="claim" intent="claim" style={{ width: 200, height: 80 }} />
    </panel>
  )
});

/** One row of the HUD: the screen is one item of the model. */
type HudItem = { id: string; coins: number };

/** The HUD of Home: the coin counter and the Open button. */
const hud = projection({
  name: "hud",
  layer: "ui",
  from: (player: Player): HudItem[] => [{ id: "hud", coins: player.coins }],
  key: (item: HudItem) => item.id,
  view: (item: HudItem) => (
    <row key="bar" style={{ direction: "row", gap: 10, width: 1080, height: 120 }}>
      <text key="coins" style={{ width: 200, height: 60 }} content={String(item.coins)} />
      <button key="open" intent="open" style={{ width: 100, height: 100 }} />
    </row>
  )
});

const homeScene = defineScene("home", { bundle: "home", layers: {}, projections: [hud] });

const home = defineNode({
  rest: true,
  checkpoint: true,
  scene: "home",
  outcomes: { open: type() }
});

const reward = defineNode({
  outcomes: { claimed: type() },
  async run({ fx, out }) {
    await fx(popup(RewardPopup, { gold: 5 }));

    return out.claimed();
  }
});

const credit = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.coins += 5;

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, reward, credit },
  start: "home",
  edges: { home: { open: "reward" }, reward: { claimed: "credit" }, credit: { done: "home" } }
});

const visualFeature = defineFeature("visual", {
  flows: [main],
  scenes: [homeScene],
  projections: [hud],
  ui: [RewardPopup]
});

/**
 * Builds the tiny game with the screen set, not started.
 *
 * @returns The app.
 */
export function createTinyGame() {
  return createApp({
    plugins: [...screen, visualFeature],
    pluginConfigs: {
      clock: { source: fakeClock(1000) },
      flow: { mainFlow: main },
      model: { initialPlayer: { coins: 0 }, initialSession: { visits: 0 }, seed: 1 }
    }
  });
}
