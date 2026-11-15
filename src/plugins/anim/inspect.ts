/**
 * @file anim plugin — the source of the `/inspect` door: the timelines that run and the last ones
 * that ended. Production-safe: it only reads.
 */
import { defineSource } from "../flow/doors/define";
import { notInstalled } from "../flow/doors/dev";
import type { HeadlessApp } from "../flow/headless";
import type { AnimApi } from "./types";

/**
 * What plays now and what ended last: `anim.timelines()`, the running timelines with the targets
 * they were played with and the last 16 ended with their reason. The value is plain JSON.
 *
 * @throws {Error} `[game] The source game.timelines needs animPlugin.` when the app has no `animPlugin`.
 * @example
 * ```ts
 * // The editor's timelines panel while a card flies: one running, the last ended one a finished flight.
 * read(app, sources.timelines);
 * // { running: [{ timeline: 7, animation: "orders.deliver", startFrame: 412, slots: { card: { projection: "board.items", key: "a" } }, entities: [1_048_580], marks: [] }],
 * //   ended: [{ timeline: 3, animation: "orders.deliver", startFrame: 380, endFrame: 386, reason: "ended" }] }
 * ```
 */
export const timelinesSource = defineSource({
  id: "game.timelines",
  title: "Timelines",
  input: {},
  changes: "frame",
  read: (app: HeadlessApp & { readonly anim?: AnimApi }) => {
    if (app.anim === undefined) throw notInstalled("game.timelines", "animPlugin");

    return app.anim.timelines();
  }
});
