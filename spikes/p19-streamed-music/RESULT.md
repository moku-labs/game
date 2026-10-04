# P19: streamed music instead of decoded buffers

**Goal: know what a decoded music track costs, what a streamed `<audio>` track costs, and what streaming can and cannot do on iOS, Android and Tauri, before the `audio` API changes.**

Status: probe run on macOS in Playwright Chromium 148.0.7778.96 (headless shell) and Playwright WebKit 26.4 (desktop build, not iOS). Nothing was run on a phone. Every iOS, Android and Tauri claim below is from source or docs and is "not verified" on a device. Support data is MDN browser-compat-data 8.1.4, built 2026-10-01 ([data.json](https://unpkg.com/@mdn/browser-compat-data@8.1.4/data.json)). Tauri source is read at tag `tauri-v2.12.1`, wry at `wry-v0.57.0`.

How to rerun: `sh gen.sh`, `bun server.ts &` (ports 8796 and 8797), `bun probe.ts`, `bun blob-probe.ts`. Raw numbers: `results.json`, `results-blob.json`, `requests.jsonl`.

## 1. How `audio` plays music today

| fact | where |
|---|---|
| `assets` fetches every `.mp3` of a bundle with `response.arrayBuffer()` and keeps the bytes until the bundle unloads. | `src/plugins/assets/tiers.ts:422`, `src/plugins/assets/types.ts:410` |
| `audio` decodes a key once with `decodeAudioData(bytes.slice(0))` and caches the promise in `state.decoded` until `assets:bundle-unloaded` names the key. Music and sfx share this cache. | `src/plugins/audio/playback.ts` `decode` |
| Graph: `master` to destination, `music` and `sfx` to `master`. A track is one `AudioBufferSourceNode`, `loop = true`, into its own track `GainNode`, into `music`. | `src/plugins/audio/graph.ts`, `playback.ts` `startTrack` |
| Cross-fade `music(key, { fadeMs })`: old track gain ramps to 0 and `source.stop(now + fade)`, new track gain ramps 0 to 1. All on the context clock. During the fade both tracks are decoded and held. | `playback.ts` `fadeOut`, `startTrack` |
| Unlock: one `pointerdown` or `touchend` on `window` calls `context.resume()`. Music declared before that is remembered and started after it. | `src/plugins/audio/unlock.ts` |
| Pause: `lifecycle:changed` push puts every bus gain to 0. Pop restores it and resumes a `suspended` or `interrupted` context. | `src/plugins/audio/handlers.ts` |
| Spec and README say: "music is buffered, not streamed", streamed music is a backlog item. The only seam is `assets.audio(key): ArrayBuffer`. | `.planning/specs/16-audio.md` Music rules, `src/plugins/audio/README.md` Memory |

## 2. Memory: decoded vs streamed (measured)

Test track: 150 s, stereo, 44.1 kHz, made by `gen.sh`. A decoded `AudioBuffer` is float32 at the **context** rate, not the file rate. The default context rate on this Mac is 48 kHz.

| file | file size | decoded at 44.1 kHz ctx | decoded at 48 kHz ctx | decode time Chromium / WebKit (48 kHz) |
|---|---|---|---|---|
| `track.mp3` 128 kbit/s | 2.40 MB | 52.9 MB | 57.6 MB | 348 ms / 150 ms |
| `track.m4a` AAC 128 kbit/s | 2.43 MB | 52.9 MB | 57.6 MB | 312 ms / decode failed in Playwright WebKit |
| `track.ogg` Vorbis q4 | 1.69 MB | n/a | 57.6 MB | 294 ms / decode failed in Playwright WebKit |
| `track.opus.ogg` 96 kbit/s | 1.66 MB | n/a | 57.6 MB | 165 ms / decode failed in Playwright WebKit |
| `track.webm` Opus 96 kbit/s | 1.70 MB | n/a | 57.6 MB | 164 ms / 207 ms |

Rule that matches every row: `seconds × rate × channels × 4 bytes`. A 2 min track at 48 kHz is 46 MB, a 3 min track is 69 MB. The compressed bytes `assets` keeps add about 2 MB per minute at 128 kbit/s.

Playwright WebKit failing on AAC and Ogg is a property of that build, not of Safari. Safari supports Ogg Opus and Vorbis since 18.4 ([WebKit 18.4 notes](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)). Not verified on iOS.

Process memory, fresh browser per row, `track.mp3` playing in a loop for 3 s, then GC (`--expose-gc`, Chromium only). Largest process = the renderer or web content process.

| scenario | Chromium largest process | delta vs no audio | WebKit largest process | delta vs no audio |
|---|---|---|---|---|
| context only, no audio | 85 MB | 0 | 105 MB | 0 |
| 1 decoded track (`AudioBufferSourceNode`) | 209 MB | **+124 MB** | 226 MB | **+121 MB** |
| 2 decoded tracks (cross-fade state) | 270 MB | **+185 MB** | 288 MB | **+183 MB** |
| 1 streamed `<audio>` into `MediaElementSource` | 97 MB | **+12 MB** | not reliable | not reliable |
| 2 streamed `<audio>` | 103 MB | **+18 MB** | not reliable | not reliable |

The second decoded track adds about 61 MB, which is the 57.6 MB buffer. The first also pays a one-time cost of about 60 MB (decoder peak and the audio render path). WebKit streamed rows are not reliable: WebKit spawned 14 to 40 extra helper processes during media playback and the pid diff counted all of them. Phone numbers: not verified.

## 3. Streaming with `<audio>` into the music bus (measured, desktop)

| question | Chromium 148 | WebKit 26.4 (desktop Playwright) | source |
|---|---|---|---|
| `MediaElementSource` into a `GainNode`: does the gain work? | Yes. RMS 0.181, mid-ramp 0.138, after ramp to 0: 0. | Yes for MP3: same numbers. | `results.json` `fade` |
| Same for WebM Opus | Yes. | **No. Output is silence** (RMS 0) through `MediaElementSource`. | `results.json` `loop` webm element. Matches open [WebKit 276813](https://bugs.webkit.org/show_bug.cgi?id=276813): WebM Opus ignores the gain on Safari 17.5 to 27. |
| Cross-fade two streamed tracks over 1 s | Works. Mid: 0.138 / 0.055. End: 0 / 0.19. Second `play()` to playing: 0 ms. | Works. Mid: 0.139 / 0.025. End: 0 / 0.19. 13 ms. | `results.json` `crossfade` |
| Element `loop = true`, 2 s sine | **Gap on every loop.** 257 to 2360 silent samples at 48 kHz (5 to 49 ms), WAV included. | **Gap on every loop.** About 19 900 silent samples (0.41 s), WAV included. | `results.json` `loop` |
| `AudioBufferSourceNode.loop`, same files | Gapless for WAV, MP3 (LAME header), WebM Opus. **Gap for M4A** (760 trailing padding samples kept) and **Ogg Vorbis** (440 extra samples). | Gapless for WAV, MP3, WebM. | `results.json` `loop`, `decodeLoopEdges` |
| Server without Range (always 200, no `Accept-Ranges`) | Plays, seeks to 100 s, loops, fades. Chromium sends `bytes=0-` and takes the full body. | Plays, seeks to 100 s, fades. WebKit sends `bytes=0-1` then `bytes=0-<end>`. | `requests.jsonl`, `results.json` `seekloop`, `fadeNoRange` |
| `blob:` URL of bytes already fetched (the `assets.audio` seam) | MP3 and M4A play, fade to 0, seek to 100 s. | Same. | `results-blob.json` |
| Cross-origin media without CORS into `MediaElementSource` | Silence (RMS 0). Spec rule. | Silence. | `results.json` `nocors`, [Web Audio spec](https://webaudio.github.io/web-audio-api/#MediaElementAudioSourceNode-security) |

The loop gaps of the element are the element restarting, not codec padding: WAV has the same gap. A streamed track does not loop seamlessly in any engine tested.

## 4. Platform facts (from sources, not verified on device)

| topic | fact | source URL |
|---|---|---|
| iOS `volume` | Always 1. Setting it does nothing. BCD `safari_ios` and `webview_ios` partial. Fades must go through a `GainNode`. | https://github.com/mdn/browser-compat-data/blob/main/api/HTMLMediaElement.json |
| `MediaElementAudioSourceNode` | BCD: Safari iOS 6, WKWebView 6, Chrome Android 18, Android WebView 4.4. | https://github.com/mdn/browser-compat-data/blob/main/api/MediaElementAudioSourceNode.json |
| iOS silent output | Regression in iOS 13 ([203435](https://bugs.webkit.org/show_bug.cgi?id=203435)). Fixed by [211394](https://bugs.webkit.org/show_bug.cgi?id=211394), r261865, confirmed fixed in iOS 13.6. | WebKit bugs |
| Still open in WebKit | HLS gives silence ([180696](https://bugs.webkit.org/show_bug.cgi?id=180696), [306493](https://bugs.webkit.org/show_bug.cgi?id=306493)). MSE source passes no samples ([266922](https://bugs.webkit.org/show_bug.cgi?id=266922)). Element silent after connect, Safari 18.5 ([293891](https://bugs.webkit.org/show_bug.cgi?id=293891)). WebM Opus ignores gain ([276813](https://bugs.webkit.org/show_bug.cgi?id=276813)). | WebKit bugs |
| Progressive MP4/AAC and MP3 | Work through `MediaElementSource` on iOS per 306493 ("progressive MP4 works"). | https://bugs.webkit.org/show_bug.cgi?id=306493 |
| iOS autoplay | `play()` with sound needs a user gesture, else the promise rejects. Embedder switch: `mediaTypesRequiringUserActionForPlayback`. Whether a resumed `AudioContext` unlocks an `<audio>`: not verified. | https://webkit.org/blog/6784/new-video-policies-for-ios/ |
| Tauri iOS autoplay | wry sets `allowsInlineMediaPlayback = YES` and `mediaTypesRequiringUserActionForPlayback = .None` when `autoplay` is true. Default is true. Tauri does not change it. So no gesture is needed for media. | https://github.com/tauri-apps/wry/blob/wry-v0.57.0/src/wkwebview/mod.rs , https://github.com/tauri-apps/wry/blob/wry-v0.57.0/src/lib.rs |
| Tauri Android autoplay | Android default `mediaPlaybackRequiresUserGesture = true`. wry sets it to false. Effect on the `AudioContext` gate: not verified. | https://developer.android.com/reference/android/webkit/WebSettings#setMediaPlaybackRequiresUserGesture(boolean) , https://github.com/tauri-apps/wry/blob/wry-v0.57.0/src/android/kotlin/RustWebView.kt |
| iOS silent switch | Web Audio goes silent in silent mode. Compressed audio through `MediaElementSource` keeps playing. WebKit says by design. Open [262781](https://bugs.webkit.org/show_bug.cgi?id=262781). `navigator.audioSession.type` exists since iOS 16.4 (BCD) and can set `"ambient"`. Effect in WKWebView: not verified. | https://bugs.webkit.org/show_bug.cgi?id=262781 , https://github.com/mdn/browser-compat-data/blob/main/api/AudioSession.json |
| Background | An `<audio>` element can keep playing in the background and shows Now Playing controls; the `AudioContext` is suspended. Bus gain 0 on pause silences the element too, because it is routed through the context. Open bugs on resume after background: [263627](https://bugs.webkit.org/show_bug.cgi?id=263627), [276016](https://bugs.webkit.org/show_bug.cgi?id=276016) (stays `interrupted`, fix is suspend then resume on `visibilitychange`), [287624](https://bugs.webkit.org/show_bug.cgi?id=287624) (`<audio>` stuck after background). | WebKit bugs |
| Android media notification | Chrome Android shows a media notification and takes audio focus for media of 5 s or more. Web Audio alone does not. MediaSession: BCD Android WebView none, so no notification in Tauri Android. | https://developer.chrome.com/blog/media-session , https://github.com/mdn/browser-compat-data/blob/main/api/MediaSession.json |
| Tauri Android background | Closed [#12650](https://github.com/tauri-apps/tauri/issues/12650): `<audio>` pauses in background. The reporter saw it with MP4, not with MP3. | Tauri issue |
| Gapless loop with an element | Chromium developers recommend `AudioBufferSourceNode.loop` or an MSE double buffer. MSE gives silence through `MediaElementSource` on WebKit (266922). | https://lists.w3.org/Archives/Public/public-whatwg-archive/2014Oct/0251.html |
| Other decode paths | WebCodecs `AudioDecoder`: Chrome Android 94, iOS 26, WKWebView 26. `ManagedMediaSource`: iOS 17.1 only. | BCD `api/AudioDecoder.json`, `api/ManagedMediaSource.json` |

## 5. Tauri custom protocol and Range

| fact | source URL |
|---|---|
| `tauri://` (iOS) and `http://tauri.localhost` (Android) serve the embedded frontend as a full 200. No 206, no `Accept-Ranges`, no `Content-Range`. In dev they proxy the dev server's status and headers. | https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/protocol/tauri.rs |
| A missing file is 200 `text/html` with `index.html` as body. An `<audio>` pointed at a wrong path gets HTML and fails with a media error, not a 404. | `spikes/p15-fixture-native/RESULT.md` rows "Missing file", measured on iOS simulator |
| `asset://` (`convertFileSrc`) supports Range: 206, `Content-Range`, chunks capped at 1000 KiB, 416 on a bad range. Multi-range fixed in 2.12.0 ([#15837](https://github.com/tauri-apps/tauri/issues/15837)). It serves files from disk under an `assetProtocol` scope, not the embedded frontend. | https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/protocol/asset.rs |
| Android: wry passes the real status and headers to `WebResourceResponse`, so 206 passes. wry forces `Cache-Control: no-store`. | https://github.com/tauri-apps/wry/blob/wry-v0.57.0/src/android/binding.rs |
| Open media issues: [#3725](https://github.com/tauri-apps/tauri/issues/3725) audio/video as asset, [#4133](https://github.com/tauri-apps/tauri/issues/4133) streaming without loading the whole file, [#10426](https://github.com/tauri-apps/tauri/issues/10426), [#12019](https://github.com/tauri-apps/tauri/issues/12019) Android repeated `bytes=0-` and out of memory, [#13554](https://github.com/tauri-apps/tauri/issues/13554) Android ogg assets memory. | Tauri issues |
| Apple: servers hosting media for iOS "must support byte-range requests". WKURLSchemeHandler gets Range headers since [WebKit 203302](https://bugs.webkit.org/show_bug.cgi?id=203302) (r276932, 2021). Whether iOS plays a 200 without `Accept-Ranges` from `tauri://`: **not verified**. Desktop WebKit did play it (section 3). | https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/CreatingVideoforSafarioniPhone/CreatingVideoforSafarioniPhone.html |
| A `blob:` URL never goes through the Tauri protocol. The browser serves its own Range on it. | measured on desktop, `results-blob.json`. Not verified in WKWebView or Android WebView. |

## Decision input for design

| option | how | memory per 2.5 min track | keeps | loses | risk |
|---|---|---|---|---|---|
| **A. Stream from a `blob:` URL of the bytes `assets` already holds** | `assets.audio(key)` stays the seam. For music, `audio` makes `URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }))`, one `<audio>` per track, `createMediaElementSource` into the track gain into `music`. Revoke the URL on track end and on bundle unload. | about 2.4 MB compressed + about 6 to 12 MB decoder, vs about 120 MB for the first decoded track and 58 MB for the next | buses, fades, cross-fade, pause by gain, `music(key, { fadeMs })` API unchanged. No Tauri protocol or Range question. Same-origin, so no CORS silence. | Seamless loop: the element leaves a 5 ms to 0.4 s gap on each loop. iOS silent switch: music keeps playing in silent mode (262781). Background: the element can outlive the suspended context. | Not verified on iOS, WKWebView or Android WebView. MP3 or AAC only for music; never WebM Opus on WebKit (276813). |
| **B. Stream from a URL, no bytes in memory** | Manifest marks music as `stream`. `assets` does not fetch it; it hands a URL. `<audio src>` into `MediaElementSource`. | about 6 to 12 MB decoder only | Lowest memory. Start before download ends on the web. | Tauri: `tauri://` gives no 206 and returns `index.html` for a missing file, so a wrong path is a media error, not a 404. Seeking on iOS from a full-200 scheme handler is not verified. `asset://` would need files on disk and a scope. Same loop and silent-switch limits as A. | Highest. Needs a device test on iOS before it is chosen. Changes the `assets` seam and the manifest. |
| **C. Keep decoded buffers, cut the cost** | Decode music at a lower context rate or mono, evict the old track's buffer when the cross-fade ends, decode music on demand instead of per bundle. | 46 to 58 MB per track at 48 kHz stereo; about 29 MB mono 48 kHz; two tracks only during a fade | Gapless loop, silent-switch behaviour as today, no element quirks, no new platform risk. | Memory stays an order of magnitude above streaming. Decode costs 130 to 350 ms on a desktop per track; phones: not verified. | Low. Today's code, one eviction rule more. |

What the numbers say: streaming saves about 50 MB per track and about 100 MB during a cross-fade. The price is the loop gap and the iOS silent-switch behaviour. A design that wants both can stream with `blob:` (A) and declare music tracks as "loops with an audible seam are fine", or keep buffers (C) for short loops and stream (A) only for long tracks. The device test that decides between A and B: on iOS 26 WKWebView via Tauri, play an MP3 from `tauri://` and from `blob:` through `MediaElementSource`, check gain, loop, seek, silent switch and resume after background.
