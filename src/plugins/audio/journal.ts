/**
 * @file audio plugin — the journal of started sounds. A ring of `config.journal` entries a test
 * or an editor reads to see what the player heard; off, and free, while the size is 0. The list
 * is frozen and replaced on every write, so `journal()` hands it out as it is, with no copy.
 */
import type { AudioCtx, Bus, SoundEntry } from "./types";

/**
 * Replaces the journal with a frozen list that ends with one started sound, stamped with the
 * elapsed game time, and keeps only the newest `config.journal` entries. A size of 0, or anything
 * that is not a positive number, records nothing.
 *
 * @param ctx - Domain context of the plugin.
 * @param sound - What started.
 * @param sound.key - Asset key of the sound.
 * @param sound.bus - The bus it plays on.
 * @param sound.kind - `"sfx"` for a play, `"music"` for a track.
 */
export function recordSound(
  ctx: AudioCtx,
  sound: { key: string; bus: Bus; kind: SoundEntry["kind"] }
): void {
  const size = Math.floor(ctx.config.journal);

  if (!Number.isFinite(size) || size <= 0) return;

  const entry: SoundEntry = { ...sound, at: ctx.deps.time.snapshot().elapsed };

  ctx.state.journal = Object.freeze([...ctx.state.journal, entry].slice(-size));
}
