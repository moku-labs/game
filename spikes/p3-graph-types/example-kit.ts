import { defineGame } from "./graph";

export type ItemId = string;
export type CellId = string;

export type Player = {
  lives: number;
  level: number;
  wallet: { coins: number; energy: number };
  board: Record<CellId, ItemId>;
  unseen: string[];
};

export type Session = { lastStars: number; visits: number };

export const { defineNode, defineFlow } = defineGame<{ player: Player; session: Session }>();

/** Stand-in for a popup descriptor awaited through fx. */
export const popup = <Pick extends string>(_name: string, _picks: readonly Pick[]): { readonly $awaits?: Pick } => ({});
