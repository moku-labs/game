import { cycleB } from "./cycle-b";

export const A_VALUE = 1;

export function cycleA(): string {
  return `a${A_VALUE}+${cycleB()}`;
}
