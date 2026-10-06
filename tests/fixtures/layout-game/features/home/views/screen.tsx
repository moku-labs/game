import { projection } from "@core/kit";
import { Panel } from "@shared";
export const homeScreen = projection({ name: "home.screen", build: () => <Panel id="homePanel" /> });
