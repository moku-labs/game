# P14: Tauri 2 mobile platform capabilities

**Goal: find what Tauri 2 offers today on iOS and Android for lifecycle, back button, haptics, keep-awake, orientation, safe area and asset loading, and how each one becomes a `@moku-labs/system` plugin plus a `@moku-labs/native` registry row.**

Status: desk research from primary sources, 2026-10-03. Nothing was run on a device or simulator. Every "not verified" row needs an on-device check before design.

## Versions checked

| Package | Version | Source |
|---|---|---|
| `tauri` crate | 2.12.1 (stable, 2026-10-01). 3.0.0-alpha.4 exists, not used. | https://crates.io/crates/tauri |
| `@tauri-apps/api` | 2.12.1 | https://www.npmjs.com/package/@tauri-apps/api |
| `@tauri-apps/cli` | 2.12.1 (`latest`), 3.0.0-alpha.4 (`next`) | https://www.npmjs.com/package/@tauri-apps/cli |
| `tauri-plugin-haptics` / `@tauri-apps/plugin-haptics` | 2.4.1 / 2.4.1 | https://crates.io/crates/tauri-plugin-haptics |
| `tao` / `wry` used by tauri 2.12.1 | 0.37.0 / 0.57.0 | https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-runtime-wry/Cargo.toml |

## How a capability is wired today (store as the model)

| Step | Where | What |
|---|---|---|
| 1. API + provider pick | `system/src/plugins/store/providers/index.ts` | Branches once on `ctx.runtime.kind`. Tauri provider is a dynamic `import()` behind `requirePeer`. |
| 2. Tauri provider | `system/src/plugins/store/providers/tauri.ts` | Only file that imports `@tauri-apps/plugin-store`. Throws map to `SystemResult` `error`. |
| 3. Web provider | `system/src/plugins/store/providers/web.ts` | Same interface, `unsupported` when the web has no equivalent. |
| 4. Registry row | `native/src/plugins/project/registry.ts` | `name`, `npmPackage`, `crate`, `rustInit`, `cargoFeatures`, `permissions`, `platforms`. `tray` shows a row with no crate, only permissions. |
| 5. Codegen | `native/src/plugins/project/generators/*` | `capabilities.ts` always adds `core:default`. `sidecar.ts` writes `Info.ios.plist` from `sidecarPlist`. `ManifestEntry` exists but is empty for all v1 rows. |
| 6. Name link | `native/src/plugins/project/api.ts` | `config.system[].name` must equal the registry row `name`. |

---

## 1. App lifecycle (pause / resume)

| Capability | iOS | Android | API / plugin + version | Permission | Source URL |
|---|---|---|---|---|---|
| Rust `WindowEvent::Suspended` / `Resumed` | yes. `applicationWillResignActive` / `applicationWillEnterForeground`. | yes. Activity `onPause` / `onResume`. First `onResume` is skipped. | tauri 2.12.1, `#[cfg(mobile)]` | none | https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/app.rs |
| JS event `tauri://suspended` / `tauri://resumed` | Rust emits it for every `WindowEvent::Suspended`. JS docs say "Android only". Conflict, see Risks. | yes | `@tauri-apps/api/event` `listen(TauriEvent.WINDOW_SUSPENDED, …)`, api 2.12.1 | `core:event:default` (in `core:default`) | https://github.com/tauri-apps/tauri/blob/%40tauri-apps/api-v2.12.1/packages/api/src/event.ts , https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/manager/window.rs |
| tao iOS source | `will_resign_active` emits `Suspended`. Scene delegate also emits it. | n/a | tao `dev` branch | n/a | https://github.com/tauri-apps/tao/blob/dev/src/platform_impl/ios/view.rs |
| `visibilitychange` | not verified. No primary source found for WKWebView in Tauri. | likely yes. wry calls `WebView.onPause()` in `onPause`. Android WebView visibility is `!paused && window visible`. | web platform | none | https://github.com/tauri-apps/wry/blob/wry-v0.57.0/src/android/kotlin/WryActivity.kt , https://groups.google.com/a/chromium.org/g/android-webview-dev/c/LpBaOxxcAhY |
| Known desktop bug | n/a | n/a | `visibilitychange` broken on Windows desktop | n/a | https://github.com/tauri-apps/tauri/issues/10592 |
| Community plugin | yes | yes | `tauri-plugin-app-events` 0.2.0 (2025-02), `onResume` / `onPause` | `app-events:default` | https://github.com/wtto00/tauri-plugin-app-events |

## 2. Android hardware back button

| Capability | iOS | Android | API / plugin + version | Permission | Source URL |
|---|---|---|---|---|---|
| Listen | handler never called | yes | `onBackButtonPress(({ canGoBack }) => …)` from `@tauri-apps/api/app`, since 2.9.0 | `core:app:allow-register-listener` (in `core:app:default`) | https://github.com/tauri-apps/tauri/blob/%40tauri-apps/api-v2.12.1/packages/api/src/app.ts |
| Prevent default exit | n/a | Registering any listener takes over. No listener means `webView.goBack()` or `activity.onBackPressed()`. | same | same | https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/mobile/android/src/main/java/app/tauri/AppPlugin.kt |
| Restore default | n/a | `await listener.unregister()` | same | `core:app:allow-remove-listener` (in default) | https://github.com/tauri-apps/tauri/blob/%40tauri-apps/api-v2.12.1/packages/api/src/app.ts |
| Exit explicitly | works on all | finishes the activity, code ignored | `exit(code)` from `@tauri-apps/api/app`, since 2.12.0. No plugin needed. | `core:app:allow-exit` (NOT in `core:app:default`) | https://github.com/tauri-apps/tauri/blob/%40tauri-apps/api-v2.12.1/packages/api/src/app.ts , https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/permissions/app/autogenerated/reference.md |

## 3. Haptics

| Capability | iOS | Android | API / plugin + version | Permission | Source URL |
|---|---|---|---|---|---|
| `vibrate(duration: number)` (ms) | yes, `AudioServicesPlayAlertSound` fallback | yes | `@tauri-apps/plugin-haptics` 2.4.1, crate `tauri-plugin-haptics` 2.4.1 | `haptics:allow-vibrate` | https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/haptics/guest-js/bindings.ts |
| `impactFeedback(style)`; style `light` `medium` `heavy` `soft` `rigid` | yes, `UIImpactFeedbackGenerator` | emulated waveform | same | `haptics:allow-impact-feedback` | https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/haptics/guest-js/bindings.ts |
| `notificationFeedback(type)`; type `success` `warning` `error` | yes | emulated waveform | same | `haptics:allow-notification-feedback` | same |
| `selectionFeedback()` | yes | emulated | same | `haptics:allow-selection-feedback` | same |
| Return shape | `Promise<Result<null, Error>>` (specta), not a throw | same | same | n/a | https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/haptics/guest-js/index.ts |
| Default permission set | none. `permissions/` has no `default.toml`. List all four `allow-*`. | same | same | see above | https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/haptics/permissions/autogenerated/reference.md |
| Android manifest | n/a | plugin merges `android.permission.VIBRATE` itself | same | none to add | https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/haptics/android/src/main/AndroidManifest.xml |
| Desktop | no effect | no effect | Rust init `tauri_plugin_haptics::init()` | n/a | https://v2.tauri.app/plugin/haptics/ |
| Cheap phones | n/a | "feedback APIs may not work correctly" | same | n/a | https://v2.tauri.app/plugin/haptics/ |

## 4. Keep-awake

| Capability | iOS | Android | API / plugin + version | Permission | Source URL |
|---|---|---|---|---|---|
| Official Tauri plugin | none | none | not in plugins-workspace `v2` plugin list | n/a | https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins |
| Community `tauri-plugin-keep-screen-on` | yes | yes | 0.1.4, last update 2024-08-30, GitLab, one maintainer. `keepScreenOn(true)`. | not verified | https://gitlab.com/cristofa/tauri-plugin-keep-screen-on , https://crates.io/crates/tauri-plugin-keep-screen-on |
| Community `tauri-plugin-screen-wake-lock` | not verified | not verified | 0.1.0 (2025-12), 39 downloads | not verified | https://github.com/cijiugechu/tauri-plugin-screen-wake-lock |
| Web Screen Wake Lock API in the webview | Safari iOS 18.4+ per BCD. WKWebView behaviour not verified. | WebView mirrors Chrome Android per BCD. Not verified in WebView. | `navigator.wakeLock.request("screen")` | none | https://github.com/mdn/browser-compat-data/blob/main/api/WakeLock.json |
| Custom plugin | `UIApplication.shared.isIdleTimerDisabled = true` | `window.addFlags(FLAG_KEEP_SCREEN_ON)` | own Tauri mobile plugin, Swift + Kotlin. Hooks `onPause` / `onResume` exist on `Plugin`. | own `allow-*` | https://v2.tauri.app/develop/plugins/develop-mobile/ , https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/mobile/android/src/main/java/app/tauri/plugin/Plugin.kt |

## 5. Orientation lock

| Capability | iOS | Android | API / plugin + version | Permission | Source URL |
|---|---|---|---|---|---|
| Template default | `UISupportedInterfaceOrientations` = Portrait, LandscapeLeft, LandscapeRight. iPad adds UpsideDown. | `<activity>` has no `screenOrientation`. `configChanges` includes `orientation`. | tauri-cli 2.12.1 mobile templates | n/a | https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-cli/templates/mobile/ios/project.yml , https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-cli/templates/mobile/android/app/src/main/AndroidManifest.xml |
| Build-time lock iOS | `src-tauri/Info.ios.plist` with `UISupportedInterfaceOrientations` = `[UIInterfaceOrientationPortrait]`. Merge replaces top-level keys, so the array wins. Also set the `~ipad` key. | n/a | tauri-cli `merge_plist` | n/a | https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-cli/src/mobile/ios/build.rs , https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-cli/src/helpers/plist.rs |
| Build-time lock Android | n/a | `android:screenOrientation="portrait"` on the `<activity>` in `gen/android/app/src/main/AndroidManifest.xml`. No tauri.conf key exists for it. | tauri-utils config has no orientation key | n/a | https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-utils/src/config.rs |
| Runtime web API | `screen.orientation.lock()` not in Safari | Chrome Android 38+. In WebView, not verified. Chrome needs fullscreen. | web platform | none | https://github.com/mdn/browser-compat-data/blob/main/api/ScreenOrientation.json |
| Runtime native | no official plugin | no official plugin | custom plugin only | own | https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins |

## 6. Safe area insets

| Capability | iOS | Android | API / plugin + version | Permission | Source URL |
|---|---|---|---|---|---|
| CSS `env(safe-area-inset-*)` | works with `<meta name="viewport" content="…, viewport-fit=cover">`. Without it all insets are 0. | WebView M144+: system bars and cutout for all WebViews. M136 to M143: fullscreen WebViews only. Older: 0. | web platform | none | https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets , https://engineering.mobalab.net/2026/05/13/tauri-2-on-ios-a-simple-fix-for-wkwebview-safe-area-inset-issues/ |
| Edge-to-edge | WKWebView fills the screen | Template `MainActivity` calls `enableEdgeToEdge()` | tauri-cli 2.12.1 template | n/a | https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-cli/templates/mobile/android/app/src/main/MainActivity.kt |
| iOS scroll-view inset band | `contentInsetAdjustmentBehavior` defaults to `.automatic`. Gives a colored band. Fix: set `.never` from a tiny Swift plugin. wry 0.57.0 does not set it (grep of `src/wkwebview`). | n/a | community `tauri-plugin-ios-webview-insets` | n/a | https://engineering.mobalab.net/2026/05/13/tauri-2-on-ios-a-simple-fix-for-wkwebview-safe-area-inset-issues/ , https://github.com/tauri-apps/wry/tree/wry-v0.57.0/src/wkwebview |
| Android fallback for old WebView | n/a | community `tauri-plugin-edge-to-edge` 0.3.3 (2025-11). Not reviewed. | crates.io | not verified | https://crates.io/crates/tauri-plugin-edge-to-edge |

## 7. Asset loading from the custom protocol

| Capability | iOS | Android | API / plugin + version | Permission | Source URL |
|---|---|---|---|---|---|
| Origin | `tauri://localhost` | `http://tauri.localhost` (or `https://` with `app.windows[].useHttpsScheme`). Changing it later moves IndexedDB and localStorage. | tauri 2.12.1 config | n/a | https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-utils/src/config.rs |
| `fetch()` of bundled files | relative URLs are served by the asset protocol. Device test not done. | same, through `shouldInterceptRequest` into Rust | wry 0.57.0 | none | https://github.com/tauri-apps/wry/blob/wry-v0.57.0/src/android/kotlin/RustWebViewClient.kt |
| MIME | magic bytes via `infer` 0.22 first, then extension. `webp`, `woff2`, `ttf`, `wasm` detected. `.ktx2` is unknown and falls back to `text/html`. `woff2` comes as `application/font-woff`. | same | `tauri-utils` `mime_type.rs` | n/a | https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-utils/src/mime_type.rs , https://github.com/bojand/infer/blob/master/src/map.rs |
| Missing file | falls back to `<path>/index.html`, then `index.html`. A missing JSON returns HTML, not 404. | same | `manager/mod.rs` | n/a | https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/manager/mod.rs |
| CORS | same-origin for the app's own files. Protocol sets `Access-Control-Allow-Origin` to the window origin. | same | `protocol/tauri.rs` | n/a | https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/protocol/tauri.rs |
| Caching | not verified | every intercepted response gets `Cache-Control: no-store` | wry 0.57.0 | n/a | https://github.com/tauri-apps/wry/blob/wry-v0.57.0/src/android/kotlin/RustWebViewClient.kt |

---

## Recommendation

| Capability | Where it lives | Provider | Effort |
|---|---|---|---|
| Lifecycle pause / resume | new `lifecyclePlugin` at `@moku-labs/system/lifecycle`. API `onPause(cb)`, `onResume(cb)`, events `lifecycle:pause` / `lifecycle:resume`. | tauri: `listen("tauri://suspended" / "tauri://resumed")` plus `visibilitychange`, deduped. web: `visibilitychange` + `pagehide`. Registry: no row needed, `core:default` covers it. | S |
| Back button | new `backPlugin` at `@moku-labs/system/back`. API `onBack(cb)`, `exit()`. | tauri: `onBackButtonPress` + `exit` from `@tauri-apps/api/app`. web: `unsupported`. Registry row `back`: no crate, `permissions: ["core:app:allow-exit"]`, `platforms: ["android"]` (like `tray`). | S |
| Haptics | new `hapticsPlugin` at `@moku-labs/system/haptics`. Same four methods. | tauri: `@tauri-apps/plugin-haptics` ^2. Map its `Result` error to `SystemResult` `error`. web: `navigator.vibrate` where present, else `unsupported`. Registry row `haptics`: crate `tauri-plugin-haptics` ^2, init `tauri_plugin_haptics::init()`, the four `haptics:allow-*`, `platforms: ["ios", "android"]`. | S |
| Keep-awake | new `keepAwakePlugin` at `@moku-labs/system/keep-awake`. API `enable()`, `disable()`. | tauri and web both try `navigator.wakeLock` first. If on-device test fails: a small own native plugin (see Risks). Do not take the 2024 community crate. | S, or M with own plugin |
| Orientation lock | no runtime plugin. Build-time field in `@moku-labs/native` config, for example `app.orientation: "portrait"`. | native codegen: `Info.ios.plist` keys with array values, plus an `android:screenOrientation` attribute patch in `patchMobile`. | M |
| Safe area | no system capability. The engine reads CSS `env(safe-area-inset-*)`. The native packager makes sure `viewport-fit=cover` is in the page. | iOS `.never` inset fix and old-WebView Android fallback go into the same own native plugin, only if the device test shows the problem. | S, M with fallback |
| Asset loading | no capability. Engine loader rules: check `response.ok` and `content-type` for JSON, read binary with `arrayBuffer()`. | n/a | S |

The `platform` plugin in the engine composes `lifecycle`, `back`, `haptics` and `keepAwake` from `@moku-labs/system`. Orientation and safe area need no runtime call.

## Risks / open

1. **iOS lifecycle event conflict.** Rust `app.rs` and tao say iOS emits `Suspended` / `Resumed`. The JS `TauriEvent` doc says "Android only". Test on the iOS simulator before relying on it. The `visibilitychange` fallback covers it either way.
2. **WKWebView `visibilitychange` not verified.** No primary source found. Needs one simulator run: background the app, log the event.
3. **Native registry types are too narrow.** `PlistEntry.value` is `string`, but orientation needs an array. `ManifestEntry` adds child XML, but `screenOrientation` is an attribute on `<activity>`. Both types need a change in `@moku-labs/native`.
4. **Own native plugin is a new pattern.** Today every registry row points to a published crate. Keep-awake, the iOS inset fix and an Android inset fallback would need a Moku-owned crate with Swift and Kotlin parts. Decide where it lives before design.
5. **Missing-asset fallback hides 404s.** A wrong JSON path returns `index.html` with status 200. The loader must check `content-type` or it fails with a JSON parse error far from the cause.
6. **`.ktx2` served as `text/html`.** Harmless for `fetch().arrayBuffer()`. Breaks any code that checks the MIME type.
7. **Android `Cache-Control: no-store`** on every asset. Large texture sets reload from Rust on each fetch. Measure on a device.
8. **WebGPU on mobile webviews is out of scope here and not verified.** The engine is WebGPU only. WKWebView and Android WebView support for WebGPU needs its own spike before mobile is promised.
9. **Haptics on cheap Android phones** may do nothing. The result is still `ok`, so the game cannot tell.
10. **iOS simulator flow exists** in `@moku-labs/native`: `native.cli.build({ target: "ios", simulator: true })` builds an unsigned `.app`. Prerequisites are checked by `native doctor` (README "iOS simulator"). It was not run in this spike.
