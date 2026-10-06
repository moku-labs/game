import { defineNode } from "@core/kit";
import { pick } from "../rules/pick";
export const homeNode = defineNode("home", { run: () => pick({ col: 1, row: 2 }) });
