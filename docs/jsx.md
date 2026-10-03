# Interface in JSX

Screens are projections whose `view` returns JSX. Yoga lays them out.

The interface is one more projection. A screen is a projection whose `view` returns JSX; `ui` reconciles the tree by identity into entities it owns and lays them out with one Yoga solve per change. There is no DOM and no React: the runtime builds plain description nodes, and `"jsxImportSource": "@moku-labs/game"` is the only setup.

```jsonc
// tsconfig.json of the game
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@moku-labs/game" } }
```

The tags are `screen`, `layer`, `row`, `column`, `stack`, `spacer`, `panel`, `image`, `icon`, `text`, `button`, `scroll` and `input`. A `button` either names an `intent` for the gate or writes `local` state of its nearest component, never both. An `input` is a text field: its text lives in the `local` field it names, every keystroke writes it, and Enter answers its `submit` intent with `{ [local]: value }`, the only thing the gate hears: `<input key="nameField" local="name" maxLength={16} submit="save" placeholder={tr("rename.hint")} />`. A `text` takes a string or a `Message` from `tr`; its size comes from a text style key, not from the layout style. Every tag takes `components`, a list of extra component values for the element's entity: `<button key="claim" intent="claim" components={[Glow({ strength: 2 })]} />` glows, and the glow covers the button and its label.

```tsx
// features/hud/view.tsx — the HUD, a reward popup and the choreography they share
import type { Anim } from "@moku-labs/game";
import { Transform, mark, parallel, sequence, sfx, tween, type } from "@moku-labs/game";
import { defineAnimation, defineComponent, defineFeature, defineTextStyles, projection, tr } from "../../state";

export const hud = projection({
  name: "hud",
  layer: "ui",
  from: player => ({ coins: player.coins }),
  view: hud => (
    <row key="bar" style={{ gap: 16, padding: { top: "safeArea.top", left: 24, right: 24 }, width: "100%", height: 120 }}>
      <text key="coins" style="hud.digits" content={tr("hud.coins", { n: hud.coins })} />
      <button key="settings" intent="openSettings" style={{ width: 96, height: 96 }}>
        <icon name="hud.gear" />
      </button>
    </row>
  )
});

export const RewardPopup = defineComponent("RewardPopup", {
  outcomes: { claim: type<{ orderId: string }>() },
  view: (props: { orderId: string; gold: number }) => (
    <panel key="reward" style={{ nineSlice: "ui.panel", direction: "column", gap: 16, padding: 32, width: 600, height: 400, fit: "contain" }}>
      <text key="title" content={tr("orders.complete")} />
      <text key="gold" style="hud.digits" content={String(props.gold)} />
      <button key="claim" intent="claim" payload={{ orderId: props.orderId }} style={{ width: 240, height: 88 }}>
        <text content={tr("common.claim")} />
      </button>
    </panel>
  )
});

export const popCoins = defineAnimation("hud.popCoins", {
  slots: { coins: type<Anim.Target>() },
  build: ({ coins }) =>
    sequence(
      tween(coins, Transform, { scale: 1.2 }, { ms: 120 }),
      parallel(tween(coins, Transform, { scale: 1 }, { ms: 200, ease: "outCubic" }), sfx("hud.coins")),
      mark("done")
    )
});

export const hudFeature = defineFeature("hud", {
  projections: [hud],
  ui: [RewardPopup],
  animations: [popCoins],
  textStyles: defineTextStyles({ "hud.digits": { font: "ui.font-digits", size: 40, fill: 0xffe082, digits: true } }),
  strings: { en: () => import("../../generated/strings.en") }
});
```

A popup is an effect. The node awaits it, the gate opens for the outcomes of the component, and the promise resolves with the intent of the button the player pressed. The choreography is played the same way.

```ts
// features/orders/deliver.ts
import { play, sfx, type } from "@moku-labs/game";
import { defineNode, popup } from "../../state";
import { popCoins, RewardPopup } from "../hud/view";

export const deliver = defineNode({
  outcomes: { claimed: type<{ orderId: string }>() },
  run: async ({ player, fx, out }) => {
    fx(sfx("orders.complete"));
    const answer = (await fx(popup(RewardPopup, { orderId: "o1", gold: 5 }))) as { intent: "claim"; payload: { orderId: string } };

    player.coins += 5;
    await fx(play(popCoins, { coins: { projection: "hud", key: "coins" } }));
    return out.claimed({ orderId: answer.payload.orderId });
  }
});
```

Headless the same node runs to the end: `popup` resolves through the gate, `play` finishes at once in fast mode, and `sfx` without `audio` resolves `undefined`. The strings behind `tr` come from `features/*/strings/<locale>.json`; `bun run assets:keys` compiles them next to the asset keys, and `strings: Strings` in `defineGame` makes a wrong key or a missing parameter a compile error.

```ts
// game.ts — sound is opt-in, the buses follow the committed player
createApp({
  plugins: [...screen, audioPlugin, hudFeature],
  pluginConfigs: {
    renderer: { mount: "#game" },
    audio: { volumes: player => (player as Player).settings.audio }
  }
});
```

`volumes` receives the committed player as `Json`, so the game names its own type once. `player.settings.audio` is `{ master?, music?, sfx? }`, committed by a settings node like any other state and applied on every `model:committed`.

> [!TIP]
> `app.ui.tree()` answers the live screen as plain data, `app.ui.find(key)` the entity of a keyed element, and `app.ui.lint()` the tap targets under `tapTargetPt`, the text that overflows in some locale and the absolute elements without a `reason`. The example app of the `ui` tests, [`src/plugins/ui/__tests__/app.tsx`](../src/plugins/ui/__tests__/app.tsx), is a whole HUD with a settings component, a scrolling list and a popup, run in plain Bun.
