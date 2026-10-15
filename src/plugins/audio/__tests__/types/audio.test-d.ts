import { expectTypeOf } from "vitest";
import { createApp, defineGame, screen } from "../../../../index";
import type { NodeFx } from "../../../flow/types";
import type { Events as ScenesEvents } from "../../../scenes/types";
import { audioFor, music } from "../../descriptors";
import { audioPlugin } from "../../index";
import type {
  AudioApi,
  AudioContextLike,
  Bus,
  Config,
  MusicDescriptor,
  SoundEntry,
  Volumes
} from "../../types";

// ---------------------------------------------------------------------------
// Type-level only. This file is not collected by vitest: `tsc --noEmit` is the
// runner, and every `@ts-expect-error` below fails the build when it stops
// being an error. It stands in for what `defineGame<Types>()` hands a game.
// ---------------------------------------------------------------------------

/** What the scanner would generate for the audio files of a game. */
type AudioKey = "board.theme" | "ui.click";

const { music: gameMusic } = audioFor<AudioKey>();

expectTypeOf(gameMusic).toEqualTypeOf<MusicDescriptor<AudioKey>>();
expectTypeOf(gameMusic("board.theme").kind).toEqualTypeOf<string>();

// eslint-disable-next-line unicorn/no-null -- `null` is the seam: it stops the music.
expectTypeOf(gameMusic(null).cosmetic).toEqualTypeOf<boolean | undefined>();

// @ts-expect-error — "board.png" is a texture, not one of the game's audio keys.
gameMusic("board.png");

// The loose export a game without generated keys imports from the package root.
expectTypeOf(music("anything.at.all").kind).toEqualTypeOf<string>();

const api = {} as AudioApi;

expectTypeOf(api.setVolume).parameter(0).toEqualTypeOf<Bus>();
expectTypeOf(api.volume("music")).toEqualTypeOf<number>();
expectTypeOf(api.unlocked()).toEqualTypeOf<boolean>();
expectTypeOf(api.muted).parameter(0).toEqualTypeOf<Bus>();
expectTypeOf(api.muted("master")).toEqualTypeOf<boolean>();
expectTypeOf(api.journal()).toEqualTypeOf<readonly SoundEntry[]>();
expectTypeOf<SoundEntry["kind"]>().toEqualTypeOf<"sfx" | "music">();
expectTypeOf<Config["journal"]>().toEqualTypeOf<number>();

// @ts-expect-error — "voice" is not one of the three buses.
api.setVolume("voice", 1);

// @ts-expect-error — "voice" is not one of the three buses.
api.muted("voice");

const volumes: Volumes = () => ({ music: 0.5, master: 1 });

expectTypeOf(volumes).toMatchTypeOf<Config["volumes"]>();

// @ts-expect-error — "voice" is not a bus, so it cannot carry a volume.
const wrong: Volumes = () => ({ voice: 1 });

expectTypeOf(wrong).toMatchTypeOf<Config["volumes"]>();

// The payload `audio` listens to: the music key of the next scene.
expectTypeOf<ScenesEvents["scenes:changed"]["music"]>().toEqualTypeOf<string | undefined>();

// The two fields of streamed music and the audio session.
expectTypeOf<Config["music"]>().toEqualTypeOf<"decode" | "stream">();
expectTypeOf<Config["session"]>().toEqualTypeOf<"ambient" | "playback" | "auto">();

// A real context still satisfies the seam, `createMediaElementSource` included.
expectTypeOf<AudioContext>().toExtend<AudioContextLike>();

createApp({
  plugins: [...screen, audioPlugin],
  pluginConfigs: {
    // @ts-expect-error — "buffer" is not a music mode.
    audio: { music: "buffer" }
  }
});

createApp({
  plugins: [...screen, audioPlugin],
  pluginConfigs: {
    // @ts-expect-error — "solo" is not an audio session type.
    audio: { session: "solo" }
  }
});

// ─── music resolves nothing ───────────────────────────────────

declare const fx: NodeFx;

// eslint-disable-next-line unicorn/no-null -- `null` is the seam: it stops the music.
expectTypeOf(fx(music(null))).toEqualTypeOf<Promise<void>>();
expectTypeOf(fx(gameMusic("board.theme"))).toEqualTypeOf<Promise<void>>();

// ─── the kit's volumes reads the game's player ────────────────

const { volumes: gameVolumes } = defineGame<{
  player: { settings: { music: number; sfx: number } };
  session: { open: boolean };
  assets: AudioKey;
  strings: Record<string, never>;
}>();

const typedVolumes = gameVolumes(player => {
  expectTypeOf(player.settings.music).toEqualTypeOf<number>();

  return { music: player.settings.music, sfx: player.settings.sfx };
});

expectTypeOf(typedVolumes).toEqualTypeOf<Volumes>();

createApp({
  plugins: [...screen, audioPlugin],
  pluginConfigs: { audio: { volumes: typedVolumes } }
});

// @ts-expect-error — "voice" is not one of the three buses.
gameVolumes(player => ({ voice: player.settings.music }));

// @ts-expect-error — the player of this game has no `audio` field.
gameVolumes(player => ({ music: player.audio }));
