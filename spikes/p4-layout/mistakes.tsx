// Spike P4. One deliberate mistake per tag. Checked by `tsconfig.mistakes.json`, never built.
// Expected: five errors, each naming the tag and the bad prop.

import type { DescriptionNode } from "./ui/node";

export function mistakes(): DescriptionNode[] {
  return [
    // box: `style` is required
    <box key="m-box" />,
    // text: `content` is a string, not a number
    <text key="m-text" style={{ height: 40 }} content={42} />,
    // image: `texture` is required
    <image key="m-image" style={{ width: 40, height: 40 }} />,
    // button: `intent` is a string, not a number
    <button key="m-button" style={{ width: 96, height: 96 }} intent={7} />,
    // list: has no `content` prop
    <list key="m-list" style={{ grow: 1 }} content="rows" />
  ];
}
