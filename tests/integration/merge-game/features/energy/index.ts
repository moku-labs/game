/**
 * @file The energy as a feature: the popup the sawmill opens when the bar is empty. The node that
 * shows it is `nodes/energy.ts`, in the board flow; its strings live next to this file.
 */
import { defineFeature } from "../../kit";
import { OutOfEnergy } from "./out-of-energy";

export const energyFeature = defineFeature("energy", { ui: [OutOfEnergy] });
