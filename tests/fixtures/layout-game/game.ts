import { defineFlow } from "@core/kit";
import { homeNode, infoFlow } from "@features";
import { homeFeature, infoFeature } from "@features";
import { loadingPlugin } from "@plugins";
export const mainFlow = defineFlow("main", { nodes: { home: homeNode, info: infoFlow }, start: "home", edges: {} });
export default { flow: mainFlow, features: [homeFeature, infoFeature], plugins: [loadingPlugin] };
