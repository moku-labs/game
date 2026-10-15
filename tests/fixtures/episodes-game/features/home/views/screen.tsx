/**
 * @file The Home screen: the background picture of Home. No text: the fixture loads no font, and
 * its strings are read through `app.i18n`.
 */
import { projection } from "@core/kit";

/** The Home screen: one item, so the projection needs no key. */
export const homeScreen = projection({
  name: "home.screen",
  layer: "ui",
  from: () => ({}),
  view: () => (
    <screen key="homeScreen">
      <image key="homeBg" texture="home.bg" />
    </screen>
  )
});
