# P13: WebGPU inside a Tauri 2 WKWebView on the iOS 26.3 simulator

**Goal: learn whether a Tauri 2 iOS webview gives the engine WebGPU, and which renderer PixiJS 8 picks there.**

Status: run on 2026-10-03. Host: macOS 15.6.1, Xcode 26.3, iOS 26.3 simulator runtime, iPhone 17 Pro. Packager `@moku-labs/native` 0.2.2 from npm, `@tauri-apps/cli` 2.12.1, `pixi.js` 8.22.0.

**The simulator renders through the Mac GPU. A simulator answer does not prove anything for a real iPhone, yes or no.**

## Results

| check | result | proof |
|---|---|---|
| Native doctor | pass 5, warn 1 (no Apple signing, legal for simulator), fail 0. Nothing to install. | `bun scripts/native.ts doctor` output |
| Simulator build | First build fails: packager bug, see risk 1. After a one-line fix in the generated `project.pbxproj` the build passes in 75 s. | `build-1-failed.log`, `build-2-ok.log` |
| Page origin | `tauri://localhost`, `isSecureContext: true` | `reports.jsonl` line 1 |
| POST to the Mac | Works. `fetch("http://127.0.0.1:8787/report")` from `tauri://localhost` returns 200. No ATS, mixed-content or CORS block. Server sends `access-control-allow-origin: *`. | `reports.jsonl` line 1, `p13-iphone17pro.png` ("report POST: 200") |
| `navigator.gpu` exists | yes | `reports.jsonl` line 1 `"navigatorGpu":true` |
| `getPreferredCanvasFormat()` | `bgra8unorm` | same line |
| `requestAdapter()` | returns `null` | same line `"adapter":false` |
| `requestDevice()` | not reached, no adapter | same line, no `device` key |
| Pixi renderer with `preference: "webgpu"` | `webgl` (type 1). Pixi falls back cleanly, the sprite renders. | same line, `p13-iphone17pro.png` |
| Same page in Mobile Safari on the same simulator | identical: `navigator.gpu` yes, adapter `null`, Pixi `webgl` | `reports.jsonl` line 2, `p13-sim-safari.png` |
| User agent | WKWebView says `iPhone OS 18_7` on iOS 26.3. Safari adds `Version/26.3`. The OS number in the UA is frozen. | `reports.jsonl` lines 1 and 2 |
| Mac Safari 18.6 on the host, for reference | no `navigator.gpu`, Pixi `webgl` | `reports.jsonl` line 3 |

## Answer

On the iOS 26.3 simulator the WebGPU API is exposed but no adapter is given. This is the same in Tauri's WKWebView and in Mobile Safari. So the null adapter comes from the simulator, not from Tauri or WKWebView. The simulator cannot answer the WebGPU question for a device. Pixi falls back to WebGL without an error.

## Open / risks

1. **Packager bug in `@moku-labs/native` 0.2.2: first iOS build always fails.** `patchMobile` drops the opening quote of `shellScript` in `gen/apple/<app>.xcodeproj/project.pbxproj`. xcodebuild then says `The project 'p13gpu' is damaged and cannot be opened due to a parse error` (exit 74). Cause: in `PACKAGE_RUNNER` the prefix `(?:\S*/)?` also eats the `"` that opens the pbxproj string. The `project.yml` copy is fine. Same failure in P15. Spike workaround after the failed build:
   ```
   // now (line 239 of project.pbxproj)
   shellScript = \"/opt/homebrew/bin/node\" \"…/tauri.js\" ios xcode-script …
   // fix
   shellScript = "\"/opt/homebrew/bin/node\" \"…/tauri.js\" ios xcode-script …
   ```
   A second build keeps the fix, because the absolute-pair pattern then matches and rewrites in place.
2. **Real device still unknown.** WebGPU on a physical iPhone with iOS 26 needs one run of this same app on a device. That needs Apple signing (doctor warn `signing-ios`).
3. **Mobile WebGL path is real.** Every simulator run, and every iPhone below iOS 26, draws with WebGL. WGSL-only filters need a WebGL answer (P16 says the same).
4. **Do not read the iOS version from the UA.** It says 18_7 on iOS 26.3.

## Files

`web/main.ts` (probe page), `scripts/native.ts` (packager as a library), `scripts/report-server.ts` (POST sink on 127.0.0.1:8787), `scripts/static.ts` (same page on 127.0.0.1:8790 for Safari). Rerun: `bun scripts/report-server.ts &`, `bun scripts/native.ts build`, `xcrun simctl install booted dist-native/ios/P13Gpu.app`, `xcrun simctl launch booted dev.moku.spike.p13`.
