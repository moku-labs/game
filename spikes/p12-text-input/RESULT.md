# P12 result

Question: does a hidden DOM `<input>` that holds focus and the real text, with the canvas drawing the field, the text, the caret and the selection, work for text input on a mobile-first WebGPU game? Which hidden-input technique, which tap→focus path, how does the field get above the keyboard, and how does a game get "submit"?

Answer: stands, with three changes. The hidden input works on desktop Chrome, Chrome mobile emulation, Playwright WebKit and Mobile Safari in the iOS 26.3 Simulator. The changes:
1. `focus()` must run inside the DOM pointer listener. The engine's path (listener queues, frame step decides) focuses the input but iOS shows no keyboard.
2. The canvas `pointerdown` must call `preventDefault()`. Without it the compatibility `mousedown` blurs the input right after the focus, on every browser tested.
3. The field is lifted by the game from `visualViewport`. iOS does not pan the page for an `opacity: 0` input, so the keyboard covers the field unless the game moves it.

## Evidence

Page: `index.html` + `main.ts`, Pixi 8.21.0, one drawn field, one hidden `<input>` inside a `<form>`. Query parameters pick the variant (`tech`, `focus`, `pd`, `ps`, `lift`, `fs`, `ac`, `enter`, `autocap`, `autocorrect`, `ovf`, `vis`). `resize.html` is the same page with `interactive-widget=resizes-content`. Served by `bun serve.ts` on port 3062, all interfaces. `bun drive.ts chrome|chrome-mobile|webkit` runs Playwright 1.60.0 (Chrome 153 through `channel: "chrome"`, WebKit 2287). The page posts its event log to `logs/<label>.json`. iOS: iPhone 17 Pro simulator, iOS 26.3, Safari 26.3, page opened with `xcrun simctl openurl`, taps through the simulator tool, screenshots with `xcrun simctl io screenshot`.

### Renderer

| Where | `navigator.gpu` | Pixi renderer |
|---|---|---|
| Chrome 153 desktop | yes | webgpu |
| Chrome 153, Pixel 7 emulation | yes | webgpu |
| Playwright WebKit 2287, iPhone emulation | no | webgl (fallback) |
| iOS 26.3 Simulator, Safari 26.3 | no | webgl (fallback), `ios-01-load.png` |

WebGPU is not available in the iOS Simulator. This says nothing about a device; P1 lists iOS 26 devices as "on by default, documented, not measured".

### 1. Technique and tap→focus path

Focus matrix, desktop and emulation (`logs/drive-*.json`). A cell is "focus stays and typing lands". Same result for all six techniques: `top` (1 px at 0,0), `tiny` (1 px at the field), `over` (field-sized, `opacity: 0`), `clear` (field-sized, transparent colours), `offscreen` (`left: -10000px`), `native` (field-sized, `opacity: 0`, takes the touch itself).

| Focus called in | Chrome desktop | Chrome Pixel 7 emulation | Playwright WebKit iPhone |
|---|---|---|---|
| `pointerdown`, with `preventDefault` | yes | yes | yes |
| `pointerdown`, no `preventDefault` | no, `mousedown` blurs it | no, `mousedown` blurs it | no, `mousedown` blurs it |
| `pointerup`, with `preventDefault` | yes | yes | yes |
| `pointerup`, no `preventDefault`, second tap on the field | blur + refocus | no, value stays "" | not run |
| `click` | yes | yes | no: `click` never fires after a prevented touch `pointerdown` |
| next `requestAnimationFrame` (the engine's frame step) | yes | yes | yes |

iOS Simulator, Mobile Safari 26.3. "Keyboard" means `visualViewport.height` went from 714 to 404 (376 with a suggestion bar or the Japanese keyboard).

| Variant | Focused | Keyboard | Shot |
|---|---|---|---|
| `top`, focus in `pointerdown` | yes | yes | `ios-02-top-down-keyboard.png` |
| `tiny`, `pointerdown` | yes | yes | `ios-03-tiny-down.png` |
| `over`, `pointerdown` | yes | yes | `ios-05-over-down.png` |
| `offscreen`, `pointerdown`, no `preventScroll` | yes | yes | `ios-25-offscreen-no-preventscroll.png` |
| `native`, the input takes the touch | yes | yes | `ios-14-native-fs12.png` |
| `top`, focus in `pointerup` | yes | yes | `ios-09-top-up.png` |
| `top`, focus in `click` | yes | yes | `ios-10-top-click.png` |
| `top`, focus in the next frame | **yes** | **no** | `ios-08-top-raf.png` |
| `top`, `pointerup`, no `preventDefault` | blurred 34 ms later by `mousedown` | shows, then hides | `ios-29-up-no-preventdefault.png` |

- The frame-step case is the worst state: the input is focused, the field draws as focused, there is no keyboard, and a second tap through the same path changes nothing.
- `navigator.userActivation` does not predict iOS. In `pointerdown` it reads `isActive: false` and the keyboard shows. In the next frame it reads `isActive: true` and the keyboard does not show.
- On real iOS, `click` still fires after a prevented `pointerdown`; in Playwright WebKit it does not. Do not build on `click`.

### 2. Text, caret, selection, composition

- Every change arrives as `beforeinput` + `input`. The value and `selectionStart/End` are correct when `input` fires. In `compositionupdate` they are one step old.
- Keys say little on mobile. iOS soft keyboard: `keydown` with `key: "п"`, `code: "Unidentified"`, `keyCode: 0`. Japanese Romaji: `keyCode: 229`, `isComposing: true`. A picked QuickType suggestion: `insertReplacementText` with no `keydown` at all (`ios-18-suggestion-picked.png`).
- Composition, iOS Japanese (`ios-20-ime-composing.png`): during composition `selectionStart..End` is the whole marked range (0..4), not a caret. In Chrome it is a collapsed caret at the end. The commit is `deleteCompositionText` (value is "" for one event) then `insertFromComposition` then `compositionend`.
- Selection: Shift+Arrow fires `select` on each step; `selectionchange` arrives once, batched (`chrome-desktop-selection.png`).
- The canvas mirror that works: read `value`, `selectionStart`, `selectionEnd`, `selectionDirection` every frame, plus a `composing` range kept from `compositionstart/update/end`. Draw the underline over the composing range and no selection box while composing. Tap-to-place-caret: measure prefixes with `BitmapFontManager.measureText(prefix, style, false)`, then `setSelectionRange` (`chrome-desktop-caret-by-tap.png`, caret index 2 at 12 % of the field).
- Cyrillic and Japanese draw in Pixi `BitmapText` with a dynamic font (`ios-06-over-typing.png`, `chrome-desktop-ime-composing.png`).

### 3. Keyboard and viewport

| Case | `innerHeight` | `vv.height` | `vv.offsetTop` / `scrollY` | Field | Shot |
|---|---|---|---|---|---|
| `opacity: 0` input, our lift on | 714 | 404 | 0 / 0 | above the keyboard, lift 185 | `ios-05-over-down.png` |
| `opacity: 0` input, no lift | 714 | 404 | 0 / 0 | under the keyboard | `ios-12-over-nolift.png` |
| `opacity: 0`, no lift, no `preventScroll`, no `overflow: hidden` | 714 | 376 | 0 / 0 | under the keyboard | `ios-26-no-overflow-lock-no-pan.png` |
| `opacity: 0`, the input takes the touch, no lift | 714 | 376 | 0 / 0 | under the keyboard | `ios-27-direct-tap-no-pan.png` |
| visible input (`vis=1`), no lift | **376** | 376 | **338 / 338** | iOS panned the whole page | `ios-28-visible-input-pans.png` |
| `resize.html` (`interactive-widget=resizes-content`) | 714 | 376 | 0 / 0 | same as `index.html` | `ios-23-resize-meta.png` |

- iOS 26.3 does not pan for an `opacity: 0` input, whatever the position, `preventScroll` or overflow. It pans a visible input by 338 px and shrinks `innerHeight`. So `opacity: 0` is what keeps the fixed canvas still.
- `visualViewport` fires one `resize` 80 to 220 ms after `focus` (keyboard up) and one about 450 ms after `blur` (keyboard down). The lift `max(0, fieldBottom + 16 − (vv.offsetTop + vv.height))` follows the keyboard height: 185 plain, 212 with the suggestion bar, 213 with the Japanese keyboard (`ios-16-username-autofill.png`).
- Drop the lift on `blur`, not on the late `vv.resize`.
- `interactive-widget=resizes-content`: iOS ignores it (`innerHeight` stays 714). Chrome Android not measured: desktop emulation shows no keyboard.
- A tap on the canvas outside the field blurs it through our `pointerdown` and the keyboard leaves (`ios-24-tap-outside-blurs.png`).
- `font-size: 12px` on the input caused no zoom in iOS 26.3, either path (`ios-13-over-fs12-zoom.png`, `vv.scale` stays 1).

### 4. Attributes and submit

| Attribute | Seen on iOS 26.3 |
|---|---|
| `enterkeyhint="done"` | return key is ✓ (`ios-03-tiny-down.png`) |
| `enterkeyhint="go"` | return key is → (`ios-16-username-autofill.png`) |
| `autocorrect="off"` | no suggestion bar |
| `autocorrect="on"` | suggestion bar, keyboard 27 px taller |
| `autocapitalize="words"` | shift on at the start |
| `autocomplete="username"`, `name="username"` | no AutoFill or Passwords entry; the simulator has no saved credentials, so not conclusive |

| Action | Events |
|---|---|
| return key (✓ or →), no composition | `keydown Enter` keyCode 13, then implicit `form submit`, then our `blur` (`ios-07-after-done-key.png`, `ios-19-go-key.png`) |
| return key during Japanese composition | no `keydown`, only the commit; no submit (`ios-21-ime-enter-commits.png`). The next press submits (`ios-22-ime-second-enter.png`) |
| ✓ on the accessory bar above the keyboard | `blur` only, no `keydown`, no submit (`ios-15-accessory-done.png`) |
| Chrome, synthetic Enter during a CDP composition | `keydown` with `isComposing: true` AND `form submit`. CDP is not a real IME, but it shows `form submit` is not filtered |

So "submit" is `keydown` with `key === "Enter" && !isComposing && keyCode !== 229`. Blur means "done editing", not submit.

## What changes for the design

1. **A synchronous focus door in `input`.** `src/plugins/input/pointer.ts` says the listeners only queue; for a text field that rule must break once. The `pointerup` listener hit-tests the up point against the drawn rects of the text fields (ui owns them, published to input as a short list) and calls `input.focus({ preventScroll: true })` in the listener. `pointerup` matches tap semantics; `pointerdown` also worked but opens the keyboard on a press that becomes a drag. The frame step still sees the tap as usual.
2. **`preventDefault()` on canvas `pointerdown`.** In `attach`, next to `touch-action: none`. Without it a focused field loses focus on every tap, on desktop and on touch. The engine uses no `click`, so nothing is lost.
3. **Blur is explicit.** A `pointerdown` on the canvas outside a text field blurs it. Escape blurs it. Screen change or field unmount blurs it.
4. **One hidden input per app, owned by `ui`.** `position: fixed; opacity: 0; pointer-events: none; font-size: 16px; border: 0; padding: 0`, placed over the drawn field and moved with the lift. All positions focus the same; over the field is where a desktop IME candidate window and autofill popups anchor (expected, not verified). Keep `opacity: 0`: a visible input makes iOS pan the page.
5. **Keyboard inset in `ui`.** `inset = innerHeight − (vv.offsetTop + vv.height)`, read on `visualViewport` `resize` and `scroll`. While a field is focused, the root is lifted so the field bottom plus a margin clears the inset. Lift 0 on blur. No `interactive-widget` meta.
6. **The mirror is a pull.** Each frame `ui` reads `value`, selection and direction from the input, and the composing range from composition events. Text is never derived from `keydown`.
7. **Submit and done.** The `input` tag gets `onSubmit` (Enter, guarded as above) and `onDone` (blur). Attributes are props with game defaults: `autocomplete="off"`, `autocorrect="off"`, `autocapitalize="off"`, `spellcheck={false}`, `enterkeyhint="done"`, `maxLength`.
8. **The `keydown` listener on `window`** (`src/plugins/input/keys.ts:62`) must skip events whose target is the text input, except Enter and Escape. Otherwise Tab, Space and Enter go to the ui focus ring and get `preventDefault`. Read from the code, not run in the spike.
9. **e2e on the iOS Simulator runs WebGL.** WebGPU-only means the simulator cannot run the real renderer.

## What was NOT checked

- No physical device. No iPhone, no Android phone. Everything iOS is the Simulator.
- Android: no emulator on this Mac. Chrome mobile emulation has no soft keyboard, so the Android keyboard, `interactive-widget`, Gboard composition (it composes Latin words too), and Android `visualViewport` are not measured.
- WebGPU on an iOS device, and in Tauri's WKWebView or Android WebView.
- Tauri packaging. WKWebView inside an app may differ from Safari on keyboard pan and the accessory bar.
- iPad, landscape, split keyboard, external keyboard (the hardware keyboard hid the soft keyboard in the simulator, `ios-04-hw-keyboard-hides-soft.png`).
- Password managers and AutoFill with saved credentials.
- Long-press selection, the native copy/paste menu and the magnifier. The input has `pointer-events: none`, so these native gestures are not available on the field; paste would need a game button.
- A real desktop IME (macOS Japanese) with its candidate window; only CDP composition was used.
- Fields longer than the box (horizontal scroll of the text), multi-line input, emoji and grapheme clusters (`selectionStart` counts UTF-16 units, Pixi lays out graphemes).
- The engine itself: the spike page mimics the pointer path, it does not run the `input` or `ui` plugins.
