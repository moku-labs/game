/**
 * @file The episode picker: the cover of the episodes. No text: the fixture loads no font.
 */
import { projection } from "@core/kit";

/** The picker screen: one item, so the projection needs no key. */
export const pickerScreen = projection({
  name: "episodes.picker",
  layer: "ui",
  from: () => ({}),
  view: () => (
    <screen key="picker">
      <image key="pickerCover" texture="episodes.cover" />
    </screen>
  )
});
