/** biome-ignore-all lint/a11y/useButtonType: a ui `button` tag is an element of the screen, not a DOM button. */
/**
 * @file ui plugin — the mistakes a game makes in its markup, each one a compile error whose
 * message names the tag and the prop. Nothing here runs: `tsc` reads it.
 */
import { defineComponent } from "../../jsx/component";

const Plain = defineComponent("Plain", { view: () => ({ type: "row", props: {}, children: [] }) });

/** A button whose intent is a number, not an intent name. */
export const wrongIntent = (
  <button
    key="a"
    // @ts-expect-error — `intent` is a ButtonIntent, and 5 is a number.
    intent={5}
  />
);

/** A button that both answers the gate and writes local state. */
export const bothAnswers = (
  // @ts-expect-error — `intent` and `local` exclude each other on one button.
  <button key="b" intent="claim" local={{ tab: "audio" }} />
);

/** An image with no texture key. */
// @ts-expect-error — `texture` is required on an image.
export const noTexture = <image key="c" />;

/** A row given a prop that belongs to a text. */
export const wrongProp = (
  <row
    key="d"
    // @ts-expect-error — `content` does not exist on a row.
    content="hello"
  />
);

/** A text whose content is neither a string nor a message. */
export const wrongContent = (
  <text
    key="e"
    // @ts-expect-error — `content` is a TextContent: a string or a message.
    content={5}
  />
);

/** A component tag given a prop its view does not take. */
export const wrongComponentProp = (
  <Plain
    key="f"
    // @ts-expect-error — Plain takes no props.
    volume={3}
  />
);

/** A panel given the nine-slice as a prop, which moved into the style in delta 4. */
export const panelNineSlice = (
  <panel
    key="g"
    // @ts-expect-error — `nineSlice` is a style field now: `style={{ nineSlice: "ui.panel" }}`.
    nineSlice="ui.panel"
  />
);

/** An image given a fit the sprite does not know. */
export const wrongFit = (
  <image
    key="h"
    texture="ui.coin"
    // @ts-expect-error — `fit` is "contain", "cover" or "fill".
    fit="stretch"
  />
);
