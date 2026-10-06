import { defineFeature, defineFlow } from "@core/kit";
import { show } from "./flow/show";
export const infoFlow = defineFlow("info", { nodes: { show }, start: "show", edges: {} });
export const infoFeature = defineFeature("info", {});
