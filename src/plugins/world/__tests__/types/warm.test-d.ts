import { expectTypeOf } from "vitest";
import { projection } from "../../projection/define";

type Sheet = { id: string; page: string };
type Session = { sheet?: Sheet };

// The warm item is one item of `from`'s type: `from` decides the item, `warm` is checked against it.
const settings = projection({
  name: "settings.sheet",
  layer: "ui",
  from: (_player: unknown, session: Session) =>
    session.sheet === undefined ? [] : [session.sheet],
  key: sheet => sheet.id,
  view: () => [],
  warm: () => ({ id: "settings", page: "main" })
});

expectTypeOf<ReturnType<NonNullable<typeof settings.warm>>>().toEqualTypeOf<Sheet>();

// A warm item of another shape does not widen the item of `view` and the hooks: it is refused.
projection({
  name: "settings.sheet",
  layer: "ui",
  from: (_player: unknown, session: Session) =>
    session.sheet === undefined ? [] : [session.sheet],
  key: sheet => sheet.id,
  view: sheet => {
    expectTypeOf(sheet).toEqualTypeOf<Sheet>();

    return [];
  },
  // @ts-expect-error — the warm item has no `page`: it is not an item `from` gives
  warm: () => ({ id: "settings", tab: 3 })
});
