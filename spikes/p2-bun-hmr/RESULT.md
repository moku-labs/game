# P2 result
Question: Does Bun HMR work with the Pixi v8 module graph, and does the before-full-reload event fire?
Answer: stands
Evidence:

- Bun 1.3.14. pixi.js 8.21.0. Renderer chosen: `webgpu` (`preference: "webgpu"`, `navigator.gpu` present, Playwright MCP Chrome 153 on macOS).
- Command: `bun ./index.html --port=4173 --console`. `--console` streams the browser console into server stdout. Raw log: `server.log` in this folder.
- Docs: https://bun.sh/docs/bundler/hot-reloading (https://bun.sh/docs/bundler/hmr redirects here with 308). https://bun.sh/docs/bundler/html-static (CLI `bun ./index.html`, `--port`, `--console`). https://bun.sh/docs/bundler/fullstack (`development: { hmr, console }`).
- API names confirmed from docs and used: `import.meta.hot.accept`, `import.meta.hot.dispose`, `import.meta.hot.data`, `import.meta.hot.on`. Event name is `bun:beforeFullReload`. Other events: `bun:beforeUpdate`, `bun:afterUpdate`, `bun:error`, `bun:ws:connect`, `bun:ws:disconnect`. `vite:*` aliases exist.
- Doc caveat: `import.meta.hot.*` must be called directly. `const hot = import.meta.hot; hot.accept()` does not work. Writing to `import.meta.hot.data` marks the module self-accepting. `hot.invalidate()` and `hot.send()` are not implemented.
- Frame counter lives on `globalThis.__spike`. `bootId` is a random id per page load. Same `bootId` means no page reload.

| case | what I edited | what happened | state kept? | status |
| --- | --- | --- | --- | --- |
| 1 self-accepting module | `scene-accepting.ts` `COLOR` 0xff3366 to 0x3366ff | `bun:beforeUpdate`, dispose ran, module re-evaluated and remounted with new colour, `bun:afterUpdate`. Stage had 2 children after. No leak. | Yes. Same bootId `3mmfj0`. Frames 921 and counting. One canvas. | OBSERVED IN BROWSER |
| 2 plain module, no accept | `scene-plain.ts` `PLAIN_COLOR` 0x33cc66 to 0xcccc33 | Bun warned "Hot update was not accepted". `bun:beforeFullReload` fired. Listener wrote the marker to `sessionStorage`. Page reloaded. New boot logged `[p2] restored after full reload` with marker `{"frames":2132,"bootId":"3mmfj0"}`. Same again on revert. | No. New bootId. Frames back to 0. Marker survived. | OBSERVED IN BROWSER |
| 3 circular pair | `cycle-b.ts` `B_VALUE` 10 to 11. Then `cycle-a.ts` `A_VALUE` 1 to 2. `scene-accepting.ts` imports `cycle-a`. | Both edits bubbled to the accepting importer. Hot swap. Log showed `a1+b11(sees a=1)` then `a2+b11(sees a=2)`. Both sides of the cycle saw fresh values. No error. No full reload. | Yes. Same bootId `hoj5w5`. Frames 352 then 713. | OBSERVED IN BROWSER |
| 4 pure data | `data-only.ts` `durationFrames` 120 to 30 | Bubbled to the accepting importer. It disposed and remounted with the new object. Hot swap in 0 to 1 ms server side. | Yes. Same bootId. Frames 1678. | OBSERVED IN BROWSER |

- NOT VERIFIED: full reload caused by a manual browser refresh or by a server restart. `bun:beforeFullReload` is an HMR event. Assume it fires only for HMR-driven reloads.
- NOT VERIFIED: an accepting module that holds GPU resources such as textures. The spike used `Graphics` only.
- NOT VERIFIED: WebGL fallback. Not needed, WebGPU was chosen.
- Note: `bun:afterUpdate` also logs just before the full reload in case 2. It is not a signal that the update was accepted.

What changes in the plan: none. Tier 1 works as planned: a data file with no `accept` hot-swaps when its importer self-accepts and disposes what it built. Tier 2 can use `bun:beforeFullReload` as the save hook. Keep "save the snapshot at every rest node" as the base, because the event does not cover a manual refresh or a crash. One rule to write down: call `import.meta.hot.accept` and `import.meta.hot.dispose` directly, never through a variable or a wrapper.
