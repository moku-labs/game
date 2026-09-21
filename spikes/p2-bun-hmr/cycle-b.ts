import { A_VALUE } from "./cycle-a";

export const B_VALUE = 10;

export function cycleB(): string {
  return `b${B_VALUE}(sees a=${A_VALUE})`;
}
