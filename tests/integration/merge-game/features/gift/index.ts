/**
 * @file The daily gift as a feature: the popup Home opens from its gift button. The node that
 * shows it is `nodes/daily-gift.ts`, in the main flow; its strings live next to this file.
 */
import { defineFeature } from "../../kit";
import { DailyGift } from "./daily-gift";

export const giftFeature = defineFeature("gift", { ui: [DailyGift] });
