# P20: iOS audio session for the `audio` plugin

**Goal: know whether `navigator.audioSession.type = "ambient"` is needed, where it works, and where it belongs, so the game's music mixes with the player's own music and obeys the silent switch.**

Status: done from documents and WebKit source. One measurement in desktop Chromium 152. No iOS simulator was booted (`xcrun simctl list devices booted` is empty), so nothing ran on iOS. Support data is MDN browser-compat-data 8.1.4, built 2026-10-01 ([data.json](https://unpkg.com/@mdn/browser-compat-data@8.1.4/data.json)). WebKit source is `main` on 2026-10-04. Claims marked "not verified" have no primary source or no device test. `probe.html` in this folder is the device check for later.

## 1. API support

| target | `navigator.audioSession` / `.type` | `.state` and `statechange` | source URL |
|---|---|---|---|
| iOS Safari | Yes since 16.4 (BCD). A WebKit engineer says "since iOS 17" in the bug. The engine needs iOS 26 for WebGPU, so the gap does not matter. | No (BCD `false`). | https://github.com/mdn/browser-compat-data/blob/main/api/AudioSession.json , https://bugs.webkit.org/show_bug.cgi?id=237322 |
| WKWebView iOS (Tauri iOS) | Yes since 16.4 (BCD `webview_ios`). Not verified on device. | No. | https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json |
| macOS Safari | Yes since 16.4 (BCD). Effect on macOS: not verified. macOS has no ringer switch and no app categories like iOS. | No. | same |
| Chrome desktop, Chrome Android, Android WebView, Edge | No (BCD `false`). Measured: `navigator.audioSession` is `undefined` in Chromium 152 desktop (`probe.html`). | No. | same |
| Firefox | Preview only (BCD `"preview"`). | Preview only. | same |
| Spec | W3C Editor's Draft, 13 Nov 2024. Experimental. Types: `auto` (default), `playback`, `transient`, `transient-solo`, `ambient`, `play-and-record`. `auto` lets the UA choose and falls back to `ambient`. | `inactive`, `active`, `interrupted`. | https://w3c.github.io/audio-session/ , https://www.w3.org/TR/2024/WD-audio-session-20241107 |

The setter is guarded. WebKit ignores `type = ...` silently when the Permissions Policy `microphone` feature is off for the document. The getter then answers `"auto"`. A top-level page has it by default. A cross-origin iframe without `allow="microphone"` does not. Source: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/audiosession/DOMAudioSession.cpp

## 2. What iOS does without it

WebKit picks the iOS category itself, in `MediaSessionManagerCocoa::updateSessionState`. The order is: an override from `navigator.audioSession`, then capture, then an audible `<video>`, then an audible `<audio>`, then Web Audio.

| what the page plays | category WebKit sets | other apps (Spotify) | silent switch | source URL |
|---|---|---|---|---|
| Only Web Audio (`AudioContext`, buffer sources). This is the engine today. | `AVAudioSessionCategoryAmbient`, no options. | Mix. Ambient is the only category WebKit treats as "can mix with others". Apple's Eric Carlson: "An AudioContext does not interrupt at all." | Muted by the switch. | https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/MediaSessionManagerCocoa.mm , https://github.com/WebKit/WebKit/blob/main/Source/WebKit/GPUProcess/media/RemoteAudioSessionProxyManager.cpp , https://www.w3.org/2024/09/27-mediawg-minutes.html |
| An audible `<audio>` or `<video>` element (also one routed into Web Audio) | `AVAudioSessionCategoryPlayback`, route policy long-form audio. | Spotify stops. | Plays through the switch. | MediaSessionManagerCocoa.mm above. The element-into-Web-Audio case is not verified. |
| `type = "ambient"` or `"transient"` | Ambient, forced for the whole page. | Mix. | Muted. | DOMAudioSession.cpp above, https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/ios/AudioSessionIOS.mm |
| `type = "playback"` | Playback. | Spotify stops. | Plays through. | same |
| `type = "transient-solo"` | SoloAmbient. | Spotify stops. | Muted. | same |
| `type = "auto"` | Removes the override. WebKit picks again by the table above. | | | same |

Facts the table rests on:

- WebKit engineer, bug 237322: by default the type is ambient, "audio will be muted if the phone is muted". https://bugs.webkit.org/show_bug.cgi?id=237322
- When audio stops, WebKit keeps the previous category for 2 s before it sets none. Same file.
- None of this was heard on a device. Not verified: Spotify really keeps playing under the engine's music on iOS 26.

## 3. WKWebView inside Tauri

| question | answer | source URL |
|---|---|---|
| Does the app's `AVAudioSession.sharedInstance().setCategory(...)` govern page audio? | No. Media runs in the WebKit GPU process. Its `AVAudioSession` is that process's own, not the app's. WebKit only attributes it to the app bundle (`setHostProcessAttribution`, for the privacy report). Developers report since 2015 that WKWebView ignores the app category. Capacitor projects still set it in `AppDelegate`; the one PR found says it never ran on a device. | https://github.com/WebKit/WebKit/blob/main/Source/WebKit/GPUProcess/GPUProcess.cpp (line `setShouldManageAudioSessionCategory(true)` for iOS), RemoteAudioSessionProxyManager.cpp above, https://developer.apple.com/forums/thread/24464 , https://github.com/unfoldingWord/tc-mobile/pull/1116 |
| So the only lever for page audio is | `navigator.audioSession.type` in the page. Same code for Safari and Tauri iOS. Not verified on device. | DOMAudioSession.cpp |
| What wry 0.57.0 sets | iOS: `allowsInlineMediaPlayback = YES`. With `autoplay` (default `true`): `mediaTypesRequiringUserActionForPlayback = None`. No `AVAudioSession` call anywhere in `src/`. | https://github.com/tauri-apps/wry/blob/wry-v0.57.0/src/wkwebview/mod.rs , https://github.com/tauri-apps/wry/blob/wry-v0.57.0/src/lib.rs |
| Side effect of wry autoplay | The `AudioContext` may start `running` without a tap in Tauri iOS. The engine's unlock then resolves at once. Not verified. | same |
| `@moku-labs/native` 0.3.0 | No audio and no `AVAudioSession` support. It can write `Info.ios.plist` sidecar entries (`PlistEntry`), so `UIBackgroundModes: audio` would be possible. No registry row uses it. A game does not need background audio. | node_modules/@moku-labs/native/dist/index.d.mts |
| `@moku-labs/system` 0.3.0 | No audio API at all (grep of `dist`). | node_modules/@moku-labs/system/dist |
| A native Swift plugin that sets the category | Would change the app process session, not the GPU process one. Useless for page audio, by the facts above. | same as row 1 |

## 4. Android and desktop

| target | other apps | silent / ring mode | source URL |
|---|---|---|---|
| Chrome Android | Media elements take audio focus per tab ("Gain" in most cases), so Spotify pauses. Web Audio does not take focus in the W3C discussion. Not verified on device. | No hardware switch. Ring mode does not mute the media stream. Not verified for WebView. | https://chromium.googlesource.com/chromium/src/+/HEAD/services/media_session/controlling_media_playback.md , https://www.w3.org/2024/09/27-mediawg-minutes.html |
| Android WebView (Tauri Android) | Not verified. No API to change it from the page. | same | n/a |
| Desktop browsers | Every app mixes. Nothing to do. | n/a | n/a |

## 5. Where it belongs in the engine

| fact | from |
|---|---|
| `audio` owns the one `AudioContext` and the only `window` code (`unlock.ts`). The setter is a DOM property of the same document. | `src/plugins/audio/unlock.ts`, `.planning/specs/16-audio.md` |
| `platform` holds a `PlatformProvider` built by the game from native APIs. The engine never imports native packages. | `src/plugins/platform/types.ts`, `.planning/specs/17-platform.md` |
| A provider cannot reach the GPU-process session in Tauri iOS. The page setter works in Safari and in Tauri iOS alike. | sections 2 and 3 |
| Streamed music is backlog idea 14 in the same change. If it plays an `<audio>` element, WebKit switches to Playback: Spotify stops and the switch is ignored. An explicit `ambient` prevents that. | `.planning/changes/2026-10-04-engine-features/intake.md`, MediaSessionManagerCocoa.mm |
| The type must be set before the first sound. Setting it later changes the category at the next session update. Exact timing not verified. | DOMAudioSession.cpp |

## Decision input for design

| option | what | for | against |
|---|---|---|---|
| A. `audio` config `session: "ambient" \| "playback" \| "auto"`, default `"ambient"` | `startAudio` sets `navigator.audioSession.type` when the object exists, before the context is made. `stopAudio` sets `"auto"` back. No API exists: nothing happens. | One place, one line, works in Safari and Tauri iOS. Pins today's behaviour so streamed music (idea 14) cannot flip to Playback. A music game can pick `"playback"`. Testable through `ctx.global`. | Experimental API. Chromium has none, so the option is iOS-only in effect. One more config field. |
| B. Do nothing now | Rely on WebKit's default: Web Audio only is already Ambient. | Zero code. Already true for the current buffer-only engine. | Breaks the day streamed music uses `<audio>`. Behaviour depends on an implicit WebKit rule. |
| C. `platform` provider method `audioSession(type)` | The game's bridge sets a native category. | Fits "native things go through the provider". | Does not reach page audio in Tauri iOS (GPU process). Does nothing on the web without a bridge. Two plugins for one concern. |

Device facts to check before build, with `probe.html` on an iPhone with iOS 26: Spotify keeps playing under the `ambient` tone, the switch mutes it, `playback` stops Spotify, and the `<audio>` button stops Spotify. Same in a Tauri iOS build.
