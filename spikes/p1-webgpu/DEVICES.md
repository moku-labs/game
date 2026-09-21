# P1 device table

Read and measured on 2026-09-21. Nobody tested on a phone. A row is either `measured` on the development Mac or `documented, not measured` with its source. Full source notes: `.planning/build/research-p1-webgpu.md`.

| Platform | OS version | WebView or browser | WebGPU status | Source |
|---|---|---|---|---|
| macOS (dev Mac, Apple silicon, Metal 3) | 15.6.1 | Chromium 152 (the Claude app browser) | works. Pixi v8 chose `webgpu`. 200 sprites: 116 fps on a 120 Hz display, first frame after 131 ms, `maxTextureDimension2D` 16384 | measured |
| macOS (dev Mac) | 15.6.1 | Chrome 153 through Playwright | works. Pixi v8 chose `webgpu` | measured in spike P2 |
| macOS (dev Mac) | 15.6.1 | Safari 18.6 and the system WKWebView | NOT available by default: WebGPU ships on by default from Safari 26 | documented, not measured. https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/ |
| iOS, iPadOS | 26.0 and later | Safari 26, WKWebView | on by default | documented, not measured. Same WebKit post. It does not name WKWebView inside third-party apps explicitly; WebKit is one shared system framework, so this is expected but unconfirmed |
| iOS, iPadOS | 18 and earlier | Safari, WKWebView | not available by default | documented, not measured. Same WebKit post |
| macOS as a Tauri target | 26 (Tahoe) | system WKWebView | on by default | documented, not measured. Safari 26 can be installed on macOS 14 and 15, but it is not confirmed that the system WKWebView framework gets WebGPU with it |
| Android | 12 and later, Qualcomm Adreno or ARM Mali GPU | Chrome 121 and later | on by default | documented, not measured. https://developer.chrome.com/blog/new-in-webgpu-121 |
| Android | 12 and later, same GPUs | Android System WebView 121 and later | on by default, mirrors Chrome for Android | documented, not measured. MDN browser-compat-data `api/GPU.json` (`webview_android` mirrors `chrome_android`) and the Chromium intent-to-ship thread. caniuse.com showed "no support" for Android WebView in one reading; the contradiction is unresolved |
| Android | 11 and earlier, or PowerVR, Unisoc and other GPUs | Chrome, WebView | not enabled | documented, not measured. Chrome 121 post; no newer allowlist was found |

## Version share used for the reach estimate

| Platform | Figure | Source |
|---|---|---|
| iOS 26 on all active iPhones | 79 % (86 % of iPhones from the last four years) | Apple, developer.apple.com/support/app-store, measured 2026-06-07 |
| iOS 26.x share of iOS traffic | about 71 % | StatCounter, 2026-08 |
| Android 12 and later | 80.6 % (16: 25.76, 15: 16.91, 14: 13.09, 13: 14.75, 12: 10.07) | StatCounter, 2026-08. Upper bound: the GPU allowlist is not subtracted |
