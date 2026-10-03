/** biome-ignore-all lint/a11y/useButtonType: a ui `button` tag is an element of the screen, not a DOM button. */
/**
 * @file ui plugin — the mistakes a game makes in its markup, each one a compile error whose
 * message names the tag and the prop. Nothing here runs: `tsc` reads it.
 */
import { component } from "../../../world/ecs/define";
import { defineComponent } from "../../jsx/component";

const Plain = defineComponent("Plain", { view: () => ({ type: "row", props: {}, children: [] }) });

/** A game's own component, standing in for a filter of `effects`. */
const Mark = component("Mark", { level: 0 });

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

/** A components list with a plain object where a component value belongs. */
export const plainExtra = (
  <button
    key="i"
    intent="claim"
    // @ts-expect-error — each value is an AnyComponentValue, built by calling a component.
    components={[{ level: 2 }]}
  />
);

/** A components list with the component itself, not a value of it. */
export const factoryExtra = (
  <button
    key="j"
    intent="claim"
    // @ts-expect-error — `Mark` is the component, not an AnyComponentValue: write `Mark({ level: 2 })`.
    components={[Mark]}
  />
);

/** A components prop that names a filter instead of listing values. */
export const namedExtra = (
  <button
    key="k"
    intent="claim"
    // @ts-expect-error — `components` is an ElementComponents, not a name.
    components="glow"
  />
);

/** A text field that names no local field. */
// @ts-expect-error — `local` is required: an InputLocal names the local field the text is written to.
export const noLocal = <input key="l" />;

/** A text field whose local field is not a name. */
export const wrongLocal = (
  <input
    key="m"
    // @ts-expect-error — `local` is an InputLocal, the name of a local field.
    local={5}
  />
);

/** A text field with a keyboard the engine does not open. */
export const wrongKind = (
  <input
    key="n"
    local="name"
    // @ts-expect-error — `kind` is a TextInputKind: "text", "number" or "email".
    kind="phone"
  />
);
