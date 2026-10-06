import { defineGame } from "@moku-labs/game";
export const { defineNode, defineFlow, defineFeature, defineScene, projection, defineTextStyles, defineStyle, defineComponent } =
  defineGame<{ player: object; session: object; assets: string; strings: object }>();
