# P1 result
Question: Which share of target devices runs WebGPU in the system WebView, and what are the minimum OS versions?
Answer: changes
Evidence:
- Measured on the development Mac (macOS 15.6.1, Apple silicon): Chromium 152 and Chrome 153 run PixiJS 8.21.0 on the `webgpu` renderer. 200 sprites at 116 fps on a 120 Hz display, first frame after 131 ms. The engine's rendering path works.
- Documented, not measured (sources and dates in `DEVICES.md` and `.planning/build/research-p1-webgpu.md`):
  - iOS and iPadOS: WebGPU is on by default only from iOS 26. Reach today: about 79 % of active iPhones (Apple, 2026-06), range 71–86 %.
  - Android: Android 12 and later with an Adreno or Mali GPU, WebView 121 and later. Reach today: 65–80 %. 80.6 % is the OS-version ceiling; the GPU allowlist lowers it by an unknown amount.
  - macOS as a Tauri target: macOS 26. This very development Mac runs macOS 15.6.1 with Safari 18.6, so its system WKWebView has no WebGPU by default: a Tauri build of the game would not start here today.
  - PixiJS itself still recommends the WebGL renderer for production and mobile and describes WebGPU as feature complete but inconsistent across browsers.
- Open risk: nothing was verified on a physical phone. It is not confirmed that "on by default in Safari 26" also covers WKWebView inside a third-party app.

What changes in the plan:
- Milestone V1 (logic, no screen) is NOT affected. The build continues.
- The decision "WebGPU only, no fallback" must be reopened with Alex BEFORE the `renderer` spec of V2 is written. With it, a game loses roughly one player in five on iOS and one in four on Android today, and cannot run in Tauri on macOS 15 and earlier.
- Options for that discussion, cheapest first: (1) keep WebGPU only and accept the reach, with the honest "device not supported" screen; (2) let Pixi v8 pick WebGL when WebGPU is missing, keep WGSL-only custom filters as a WebGPU extra and ship filters that have a GLSL twin; (3) WebGL first, WebGPU opt-in. Option 2 costs one line in the renderer host and a second shader source per custom filter; nothing else in the architecture depends on the API, because game code never touches Pixi.
- Minimum OS versions to write into the `renderer` and `platform` specs under option 1: iOS 26, iPadOS 26, macOS 26, Android 12 with Adreno or Mali.
