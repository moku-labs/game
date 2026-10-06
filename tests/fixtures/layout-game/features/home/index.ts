import { defineFeature } from "@core/kit";
import { homeScreen } from "./views/screen";
export { homeNode } from "./flow/home";
export const homeFeature = defineFeature("home", { projections: [homeScreen] });
