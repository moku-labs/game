import type { Cell } from "@core/types";
import { clamp } from "@shared/rules";
export const pick = (c: Cell): number => clamp(c.col);
