# Assets of Timber Town

Where every art file and font of the fixture game came from. The art is final: Astra drew it for
the Timber Town design, and each file was trimmed and converted to WebP for the game. A 9-slice
piece carries its insets in the file name as `{nine=left,top,right,bottom}` in texture px; the
key drops the tag.

## Art

- Source: Astra, through the moku-astra plugin on its codex backend (model `gpt-6-astra`).
- Generated: the Astra manifests record 2026-09-22 (the originals were drawn over the night of
  2026-09-22 to 2026-09-23); trimmed and converted to WebP on 2026-09-23.
- Originals: 1024 px PNGs (1024 × 1536 for the backgrounds) with a manifest per group:
  `sprites/manifest.json`, `ui/manifest.json` and `backgrounds/manifest.json` of the design
  capture `merge-game-showcase`. The prompt of each file below is copied from those manifests.

### `ui.panel-signboard`

- File: `features/ui/assets/panel-signboard{nine=72,72,72,76}.webp`, 512 × 505 px, 9-slice left 72, top 72, right 72, bottom 76 (the nails and the thicker bottom lip stay in the corners).
- Original: `fix1/panel-signboard.png`, 1024 × 1024 px, drawn by Astra (gpt-6-astra, codex backend) on 2026-09-23.
- Prompt:

  > Create one 1024x1024 PNG with genuinely transparent alpha background. Style: hand-drawn storybook cartoon for a cozy casual mobile merge game called Timber Town, set in a forest lumber village. Confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked line; flat cel colours with soft watercolor-like shading and gentle top-left light; a single small white highlight on rounded forms; subtle paper/wood grain texture. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions, strong readable silhouettes at 64 px. No text, letters, numbers, watermark, or drop shadow outside the object. No ground plane unless specifically requested below. Transparent pixels outside the object, never a checkerboard illustration. Popup panel for 9-slice scaling: one single piece of light warm wood (#efcd94 to #d8a062) with fine vertical grain that repeats evenly, NO horizontal plank seams anywhere. Thick dark-brown ink outline, softly rounded corners about 10% of the width, a light inner bevel line inset from the edge, a darker bottom lip showing thickness, and one small round iron nail head in each of the four corners inside the bevel. Outside the corner regions, edges must be perfectly uniform so they stretch cleanly. Square, front-facing, filling the canvas with about 4% transparent margin on each side. Uniform restrained texture and no central decoration.

### `ui.panel-parchment`

- File: `features/ui/assets/panel-parchment{nine=48,48,48,48}.webp`, 384 × 379 px, 9-slice left 48, top 48, right 48, bottom 48.
- Original: `ui/panel-parchment.png`, 1024 × 1024 px.
- Prompt:

  > Use case: stylized-concept. Create exactly one 1024x1024 PNG game UI asset with a genuinely transparent alpha background. STYLE: hand-drawn storybook cartoon for a cozy casual mobile merge game called Timber Town, set in a forest lumber village. Confident dark-brown ink outlines (#3a2212), slightly wobbly hand-inked character, flat cel colours with soft watercolor-like shading and gentle top-left light, subtle paper/wood grain texture. Chunky friendly toy-like proportions, readable at 64 px. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss #8ab84e / #557f2d, pine #2f5a3b, berry #c93b4d / #8f2334, parchment #fbeed2, sky #cfe6ee. Use only the material-relevant colors. Orthographic front view. Designed for 9-slice scaling: fixed rounded corners, perfectly straight uniform middle edges, plain stretchable center with only fine repeating texture. No text, letters, numbers, icons, watermark, center decorations, edge-middle decorations, external drop shadows, ground plane, perspective, nails, ropes, foliage or separate objects. Transparent outside the shape. Subject: one inner insert panel of warm parchment paper #fbeed2. Nearly square silhouette spanning x=41..983 and y=41..983, approximately 4% transparent margin. Thin dark-brown ink outline, softly rounded fixed corners, faint paper grain, plain uniform stretchable interior. Very subtle soft top-left shading. No curled, torn or rolled edges.

### `ui.header-plank`

- File: `features/ui/assets/header-plank{nine=52,52,52,52}.webp`, 480 × 107 px, 9-slice left 52, top 52, right 52, bottom 52.
- Original: `ui/header-plank.png`, 1024 × 1024 px.
- Prompt:

  > Use case: stylized-concept. Create exactly one 1024x1024 PNG game UI asset with a genuinely transparent alpha background. STYLE: hand-drawn storybook cartoon for a cozy casual mobile merge game called Timber Town, set in a forest lumber village. Confident dark-brown ink outlines (#3a2212), slightly wobbly hand-inked character, flat cel colours with soft watercolor-like shading and gentle top-left light, subtle paper/wood grain texture. Chunky friendly toy-like proportions, readable at 64 px. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss #8ab84e / #557f2d, pine #2f5a3b, berry #c93b4d / #8f2334, parchment #fbeed2, sky #cfe6ee. Use only the material-relevant colors. Orthographic front view. Designed for 9-slice scaling: fixed rounded corners, perfectly straight uniform middle edges, plain stretchable center with only fine repeating texture. No text, letters, numbers, icons, watermark, center decorations, edge-middle decorations, external drop shadows, ground plane, perspective, nails, ropes, foliage or separate objects. Transparent outside the shape. Subject: one honey-gold wooden title plank, width:height exactly about 4:1, centered vertically and horizontally in square canvas. Shape approximately x=41..983, y=394..630, with transparent space above and below. Rounded ends, straight parallel horizontal edges, 5-7 px dark-brown outline, restrained light top bevel and darker bottom lip, plain stretchable honey-gold center with very fine repeating wood texture. Single small white highlight on upper-left rounded end only.

### `ui.button-green`

- File: `features/ui/assets/button-green{nine=36,40,36,40}.webp`, 360 × 94 px, 9-slice left 36, top 40, right 36, bottom 40.
- Original: `ui/button-green.png`, 1024 × 1024 px.
- Prompt:

  > Generate exactly one 1024x1024 PNG with genuine transparent alpha background: button-green.png. Use case: ui-mockup, production 9-slice button asset for the cozy forest lumber village mobile merge game Timber Town. One centered horizontal rounded rectangle with overall width 942 px and height 314 px (3:1), bounds approximately x=41..983, y=355..669, fixed rounded corner radius about 60 px. Front-on view. Juicy moss-green face #8ab84e, lighter glossy top highlight band, darker moss #557f2d bottom lip showing gentle toy-like thickness. Hand-drawn storybook cartoon, confident dark-brown #3a2212 ink outline 5-7 px, subtly hand-inked corners; flat cel colors, soft watercolor-like shading, gentle top-left light, subtle fine paper grain. Chunky friendly silhouette readable at 64 px. A single small white highlight confined to the upper-left rounded corner. Strict 9-slice geometry: perfectly straight horizontal and vertical middle edges, uniform edge profiles, fixed-size rounded corners; plain stretchable center with only very fine repeating texture. Highlight band and bottom lip remain straight and uniform through the middle. No text, letters, numbers, icons, decoration, wood knots, seams, scratches, or other details in the center or along middle edges. No external drop shadow, ground plane, surrounding objects, or background color. Transparent outside the single button. Preserve the 3:1 object inside the square canvas with approximately 4% left/right canvas margin and larger transparent space above/below. Output one button only.

### `ui.button-wood`

- File: `features/ui/assets/button-wood{nine=36,36,36,36}.webp`, 360 × 94 px, 9-slice left 36, top 36, right 36, bottom 36.
- Original: `ui/button-wood.png`, 1024 × 1024 px.
- Prompt:

  > Use case: precise-object-edit. Create button-wood.png, exactly one 1024x1024 PNG with genuine transparent alpha background. Input image is the reference and edit target: the green Timber Town UI button. Change only its material and colors to warm light wood face #d8a062, pale wood #efcd94 glossy top band, dark wood #9c6031 bottom lip, and extremely subtle fine repeating wood grain without knots. Preserve the reference silhouette, placement, rounded corners, dark-brown #3a2212 hand-inked 5-7 px outline, single small upper-left white highlight, straight glossy top band, darker bottom lip thickness, soft watercolor-like shading, gentle top-left light, subtle fine grain, and cozy hand-drawn storybook cartoon style. One horizontal rounded rectangle, approximately 3:1, centered in a square transparent canvas with about 4% horizontal margin. Strict 9-slice asset: fixed corners, perfectly straight uniform middle edges, plain stretchable center with only fine repeating texture. Keep all four buttons visually identical in geometry and treatment. No text, letters, numbers, icons, decoration in center or middle edges, knots, seams, external shadows, ground, other objects, watermark, or background color. Output a single button only.

### `ui.button-berry`

- File: `features/ui/assets/button-berry{nine=32,40,32,40}.webp`, 360 × 93 px, 9-slice left 32, top 40, right 32, bottom 40.
- Original: `ui/button-berry.png`, 1024 × 1024 px.
- Prompt:

  > Use case: precise-object-edit. Create button-berry.png, exactly one 1024x1024 PNG with genuine transparent alpha background. Input image is the reference and edit target: the green Timber Town UI button. Change only its material and colors to berry red face #c93b4d, a lighter berry glossy top band, and deep berry #8f2334 bottom lip for danger actions. Preserve the reference silhouette, placement, rounded corners, dark-brown #3a2212 hand-inked 5-7 px outline, single small upper-left white highlight, straight glossy top band, darker bottom lip thickness, soft watercolor-like shading, gentle top-left light, subtle fine grain, and cozy hand-drawn storybook cartoon style. One horizontal rounded rectangle, approximately 3:1, centered in a square transparent canvas with about 4% horizontal margin. Strict 9-slice asset: fixed corners, perfectly straight uniform middle edges, plain stretchable center with only fine repeating texture. Keep all four buttons visually identical in geometry and treatment. No text, letters, numbers, icons, decoration in center or middle edges, knots, seams, external shadows, ground, other objects, watermark, or background color. Output a single button only.

### `ui.button-disabled`

- File: `features/ui/assets/button-disabled{nine=36,40,36,40}.webp`, 360 × 94 px, 9-slice left 36, top 40, right 36, bottom 40.
- Original: `ui/button-disabled.png`, 1024 × 1024 px.
- Prompt:

  > Use case: precise-object-edit. Create button-disabled.png, exactly one 1024x1024 PNG with genuine transparent alpha background. Input image is the reference and edit target: the green Timber Town UI button. Change only its material and colors to desaturated grey-beige face, light grey-beige glossy top band, and darker taupe bottom lip for the disabled state. Preserve the reference silhouette, placement, rounded corners, dark-brown #3a2212 hand-inked 5-7 px outline, single small upper-left white highlight, straight glossy top band, darker bottom lip thickness, soft watercolor-like shading, gentle top-left light, subtle fine grain, and cozy hand-drawn storybook cartoon style. One horizontal rounded rectangle, approximately 3:1, centered in a square transparent canvas with about 4% horizontal margin. Strict 9-slice asset: fixed corners, perfectly straight uniform middle edges, plain stretchable center with only fine repeating texture. Keep all four buttons visually identical in geometry and treatment. No text, letters, numbers, icons, decoration in center or middle edges, knots, seams, external shadows, ground, other objects, watermark, or background color. Output a single button only.

### `ui.hud-pill`

- File: `features/ui/assets/hud-pill{nine=28,30,28,30}.webp`, 300 × 63 px, 9-slice left 28, top 30, right 28, bottom 30.
- Original: `ui/hud-pill.png`, 1024 × 1024 px.
- Prompt:

  > Create one 1024x1024 transparent PNG game UI asset for Timber Town, a cozy forest lumber village merge game. Hand-drawn storybook cartoon, confident dark-brown #3a2212 ink outlines 5-7 px at 1024 px with subtly wobbly hand-inked character, flat cel colours with soft watercolor-like shading, gentle top-left light, subtle fine paper/wood grain. Chunky friendly toy-like proportions, readable at 64 px. Palette: ink #3a2212, wood #d8a062 / #efcd94 / #9c6031 / walnut #6e4121, honey #f2b43d / #c7841c, moss #8ab84e / #557f2d, pine #2f5a3b, berry #c93b4d / #8f2334, parchment #fbeed2, sky #cfe6ee. Genuine alpha transparency outside the object, no painted checkerboard. No text, letters, numbers, watermark, icons, ground plane, or external drop shadow. Front-on orthographic UI sprite, no perspective. Subject: hud-pill.png, one horizontal dark walnut wood HUD capsule centered on the square canvas, width about 944 px and height about 315 px, 3:1 aspect ratio. Very rounded semicircular ends, ink outline and restrained inner shadow. Designed for 9-slice scaling: fixed rounded ends, perfectly straight uniform horizontal middle edges, plain stretchable dark walnut centre with only fine repeating wood texture; no decoration, knots, seams or marks in centre or along middle edges. One small white highlight confined to upper-left rounded end. About 4% horizontal transparent margin, larger transparent space above and below to retain 3:1 capsule proportions.

### `ui.tab-active`

- File: `features/ui/assets/tab-active{nine=20,20,20,20}.webp`, 256 × 105 px, 9-slice left 20, top 20, right 20, bottom 20.
- Original: `ui/tab-active.png`, 1024 × 1024 px.
- Prompt:

  > Use case: ui-mockup. Generate one 1024x1024 PNG game UI asset with a genuinely transparent alpha background. Style: hand-drawn storybook cartoon for the cozy casual forest lumber village mobile merge game Timber Town. Confident dark-brown #3a2212 ink outlines 5-7 px at 1024 px, slightly wobbly hand-inked character while preserving straight scalable edge middles. Flat cel colours, soft watercolor-like shading, gentle top-left light, subtle fine paper/wood grain. Chunky friendly toy-like proportions readable at 64 px. Palette: ink #3a2212, warm wood #d8a062, light wood #efcd94, dark wood #9c6031, walnut #6e4121, honey gold #f2b43d and #c7841c, parchment #fbeed2. 9-slice UI requirements: fixed-size rounded corners, perfectly straight uniform middle edges on every side, plain stretchable centre with only fine repeating texture. No text, letters, numbers, watermark, icons, ornaments, central decoration, decoration along middle edges, external drop shadow, or ground plane. Front-on orthographic flat UI shape. Shape centered horizontally and vertically, about 4% canvas margin left and right; vertical transparent margins follow the specified object aspect ratio. Do not stretch the shape to square. Subject: one active folder tab made of light parchment #fbeed2, warm #efcd94 subtle inner-edge shading. Shape about 2:1, approximately 942 px wide by 471 px tall, rounded top corners of roughly 48 px radius, straight vertical sides, perfectly flat straight bottom with square bottom corners. One tiny white highlight confined near the upper-left rounded corner. Plain uninterrupted parchment center.
CRITICAL CANVAS: The output image itself MUST be SQUARE, exactly 1024 pixels wide and 1024 pixels tall. Large empty transparent space above and below the subject is intentional. Draw ONLY the tab itself as a simple rectangle with two rounded upper corners and square lower corners. The entire top edge is ONE horizontal straight line connecting the two upper rounded corners at equal height. NO stepped silhouette, NO projecting folder flap, NO notch, NO full folder. Object bounds x=41 to 983, y=276 to 748.

### `ui.tab-idle`

- File: `features/ui/assets/tab-idle{nine=24,20,24,20}.webp`, 256 × 101 px, 9-slice left 24, top 20, right 24, bottom 20.
- Original: `ui/tab-idle.png`, 1024 × 1024 px.
- Prompt:

  > Use case: ui-mockup. Generate one 1024x1024 PNG game UI asset with a genuinely transparent alpha background. Style: hand-drawn storybook cartoon for the cozy casual forest lumber village mobile merge game Timber Town. Confident dark-brown #3a2212 ink outlines 5-7 px at 1024 px, slightly wobbly hand-inked character while preserving straight scalable edge middles. Flat cel colours, soft watercolor-like shading, gentle top-left light, subtle fine paper/wood grain. Chunky friendly toy-like proportions readable at 64 px. Palette: ink #3a2212, warm wood #d8a062, light wood #efcd94, dark wood #9c6031, walnut #6e4121, honey gold #f2b43d and #c7841c, parchment #fbeed2. 9-slice UI requirements: fixed-size rounded corners, perfectly straight uniform middle edges on every side, plain stretchable centre with only fine repeating texture. No text, letters, numbers, watermark, icons, ornaments, central decoration, decoration along middle edges, external drop shadow, or ground plane. Front-on orthographic flat UI shape. Shape centered horizontally and vertically, about 4% canvas margin left and right; vertical transparent margins follow the specified object aspect ratio. Do not stretch the shape to square. Subject: one idle folder tab made of darker wood #9c6031 with subtle #d8a062 top-left lighting and #6e4121 inner-edge shading. Shape about 2:1, approximately 942 px wide by 471 px tall, rounded top corners of roughly 48 px radius, straight vertical sides, perfectly flat straight bottom with square bottom corners. One tiny white highlight confined near the upper-left rounded corner. Plain uninterrupted wood center; extremely fine repeating grain, no knots or planks. Match the geometry and style of a parchment active folder tab.
CRITICAL CANVAS: The output image itself MUST be SQUARE, exactly 1024 pixels wide and 1024 pixels tall. Large empty transparent space above and below the subject is intentional. Draw ONLY the tab itself as a simple rectangle with two rounded upper corners and square lower corners. The entire top edge is ONE horizontal straight line connecting the two upper rounded corners at equal height. NO stepped silhouette, NO projecting folder flap, NO notch, NO full folder. Object bounds x=41 to 983, y=276 to 748.

### `ui.bar-track`

- File: `features/ui/assets/bar-track{nine=32,28,32,28}.webp`, 480 × 65 px, 9-slice left 32, top 28, right 32, bottom 28.
- Original: `ui/bar-track.png`, 1024 × 1024 px.
- Prompt:

  > Use case: ui-mockup. Generate one 1024x1024 PNG game UI asset with a genuinely transparent alpha background. Style: hand-drawn storybook cartoon for the cozy casual forest lumber village mobile merge game Timber Town. Confident dark-brown #3a2212 ink outlines 5-7 px at 1024 px, slightly wobbly hand-inked character while preserving straight scalable edge middles. Flat cel colours, soft watercolor-like shading, gentle top-left light, subtle fine paper/wood grain. Chunky friendly toy-like proportions readable at 64 px. Palette: ink #3a2212, warm wood #d8a062, light wood #efcd94, dark wood #9c6031, walnut #6e4121, honey gold #f2b43d and #c7841c, parchment #fbeed2. 9-slice UI requirements: fixed-size rounded corners, perfectly straight uniform middle edges on every side, plain stretchable centre with only fine repeating texture. No text, letters, numbers, watermark, icons, ornaments, central decoration, decoration along middle edges, external drop shadow, or ground plane. Front-on orthographic flat UI shape. Shape centered horizontally and vertically, about 4% canvas margin left and right; vertical transparent margins follow the specified object aspect ratio. Do not stretch the shape to square. Subject: one horizontal progress bar track, a dark walnut #6e4121 recessed groove, subtle darker #3a2212 inner rim and soft top-left edge lighting. Shape about 8:1, approximately 942 px wide by 118 px tall, rounded end corners of roughly 32 px radius and long perfectly straight horizontal sides. Plain dark walnut stretchable center, fine repeating wood texture only. No fill inside, no handle, no ticks.
CRITICAL CANVAS: The output image itself MUST be SQUARE, exactly 1024 pixels wide and 1024 pixels tall. Large empty transparent space above and below the subject is intentional. Object bounds x=41 to 983, y=453 to 571. Keep the bar only 118 px tall on the 1024 px tall square canvas.

### `ui.bar-fill`

- File: `features/ui/assets/bar-fill{nine=24,24,24,24}.webp`, 480 × 50 px, 9-slice left 24, top 24, right 24, bottom 24.
- Original: `ui/bar-fill.png`, 1024 × 1024 px.
- Prompt:

  > Use case: ui-mockup. Generate one 1024x1024 PNG game UI asset with a genuinely transparent alpha background. Style: hand-drawn storybook cartoon for the cozy casual forest lumber village mobile merge game Timber Town. Confident dark-brown #3a2212 ink outlines 5-7 px at 1024 px, slightly wobbly hand-inked character while preserving straight scalable edge middles. Flat cel colours, soft watercolor-like shading, gentle top-left light, subtle fine paper/wood grain. Chunky friendly toy-like proportions readable at 64 px. Palette: ink #3a2212, warm wood #d8a062, light wood #efcd94, dark wood #9c6031, walnut #6e4121, honey gold #f2b43d and #c7841c, parchment #fbeed2. 9-slice UI requirements: fixed-size rounded corners, perfectly straight uniform middle edges on every side, plain stretchable centre with only fine repeating texture. No text, letters, numbers, watermark, icons, ornaments, central decoration, decoration along middle edges, external drop shadow, or ground plane. Front-on orthographic flat UI shape. Shape centered horizontally and vertically, about 4% canvas margin left and right; vertical transparent margins follow the specified object aspect ratio. Do not stretch the shape to square. Subject: one horizontal progress bar fill, honey gold #f2b43d with #c7841c lower inner-edge shading and a thin uniform pale-gold top highlight band inside the outline. Shape about 8:1, approximately 942 px wide by 118 px tall, rounded end corners of roughly 32 px radius and long perfectly straight horizontal sides. One small white highlight confined to upper-left rounded end. Plain gold stretchable center. Matching geometry for a dark walnut groove track; render gold fill only, no surrounding track, no handle, no ticks.
CRITICAL CANVAS: The output image itself MUST be SQUARE, exactly 1024 pixels wide and 1024 pixels tall. Large empty transparent space above and below the subject is intentional. Object bounds x=41 to 983, y=453 to 571. Keep the bar only 118 px tall on the 1024 px tall square canvas.

### `ui.rope-vertical`

- File: `features/ui/assets/rope-vertical.webp`, 5 × 256 px.
- Original: `ui/rope-vertical.png`, 1024 × 1024 px.
- Prompt:

  > Create one 1024x1024 transparent PNG game UI asset for Timber Town, a cozy forest lumber village merge game. Hand-drawn storybook cartoon, confident dark-brown #3a2212 ink outlines 5-7 px at 1024 px with subtly wobbly hand-inked character, flat cel colours with soft watercolor-like shading, gentle top-left light, subtle fine paper/wood grain. Chunky friendly toy-like proportions, readable at 64 px. Palette: ink #3a2212, wood #d8a062 / #efcd94 / #9c6031 / walnut #6e4121, honey #f2b43d / #c7841c, moss #8ab84e / #557f2d, pine #2f5a3b, berry #c93b4d / #8f2334, parchment #fbeed2, sky #cfe6ee. Genuine alpha transparency outside the object, no painted checkerboard. No text, letters, numbers, watermark, icons, ground plane, or external drop shadow. Front-on orthographic UI sprite, no perspective. Subject: rope-vertical.png, one straight vertical twisted natural honey-tan rope segment, narrow and centered, approximately 110 px wide. A seamless vertically repeatable game UI rope texture: rope runs continuously from exact top edge through exact bottom edge of the 1024x1024 canvas, cropped at both edges with no end caps, knots, tassels or fraying. Match top and bottom cross sections and twist phase exactly, use an integer number of uniform twist repeats for seamless top-to-bottom tiling. Transparent space on both sides. Repeating diagonal twisted strands, dark-brown ink outlines and restrained cel shading in wood #d8a062 / #efcd94 / #9c6031 with honey warmth. Constant width and perfectly straight vertical axis. For this repeating segment omit rounded ends and vertical margins; avoid isolated white highlight that would break the repeat.

### `ui.icon-coin`

- File: `features/ui/assets/icon-coin.webp`, 154 × 160 px.
- Original: `sprites/icon-coin.png`, 1024 × 1024 px.
- Prompt:

  > Use case: illustration-story. Create one 1024x1024 transparent PNG game icon for the cozy casual mobile merge game Timber Town, set in a forest lumber village. Style: hand-drawn storybook cartoon; confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked line; flat cel colours with soft watercolor-like shading and gentle top-left light; a single small white highlight on rounded forms; subtle paper/wood grain texture within the object. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions with a strong readable silhouette at 64 px. Object centered with approximately 8% transparent margin. Genuine transparent alpha background. No text, letters, numbers, watermark, external drop shadow, ground plane, or extra objects. Subject: a gold coin with a small pine-tree emblem embossed in the middle and a thick rim.

### `ui.icon-energy`

- File: `features/ui/assets/icon-energy.webp`, 112 × 160 px.
- Original: `sprites/icon-energy.png`, 1024 × 1024 px.
- Prompt:

  > Use case: illustration-story. Create one 1024x1024 transparent PNG game icon for the cozy casual mobile merge game Timber Town, set in a forest lumber village. Style: hand-drawn storybook cartoon; confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked line; flat cel colours with soft watercolor-like shading and gentle top-left light; a single small white highlight on rounded forms; subtle paper/wood grain texture within the object. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions with a strong readable silhouette at 64 px. Object centered with approximately 8% transparent margin. Genuine transparent alpha background. No text, letters, numbers, watermark, external drop shadow, ground plane, or extra objects. Subject: a chunky yellow lightning bolt with a dark-brown ink outline.

### `ui.icon-gear`

- File: `features/ui/assets/icon-gear.webp`, 160 × 160 px.
- Original: `sprites/icon-gear.png`, 1024 × 1024 px.
- Prompt:

  > Use case: illustration-story. Create one 1024x1024 transparent PNG game icon for the cozy casual mobile merge game Timber Town, set in a forest lumber village. Style: hand-drawn storybook cartoon; confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked line; flat cel colours with soft watercolor-like shading and gentle top-left light; a single small white highlight on rounded forms; subtle paper/wood grain texture within the object. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions with a strong readable silhouette at 64 px. Object centered with approximately 8% transparent margin. Genuine transparent alpha background. No text, letters, numbers, watermark, external drop shadow, ground plane, or extra objects. Subject: a settings cog in warm wood colours, with chunky teeth and a clear central circular hole.

### `ui.icon-home`

- File: `features/ui/assets/icon-home.webp`, 160 × 143 px.
- Original: `sprites/icon-home.png`, 1024 × 1024 px.
- Prompt:

  > Use case: illustration-story. Create one 1024x1024 transparent PNG game icon for the cozy casual mobile merge game Timber Town, set in a forest lumber village. Style: hand-drawn storybook cartoon; confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked line; flat cel colours with soft watercolor-like shading and gentle top-left light; a single small white highlight on rounded forms; subtle paper/wood grain texture within the object. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions with a strong readable silhouette at 64 px. Object centered with approximately 8% transparent margin. Genuine transparent alpha background. No text, letters, numbers, watermark, external drop shadow, ground plane, or extra objects. Subject: a small friendly cottage with a berry-red roof, warm wooden walls, a simple door and window, as a home button icon.

### `ui.icon-gift`

- File: `features/ui/assets/icon-gift.webp`, 181 × 192 px.
- Original: `sprites/icon-gift.png`, 1024 × 1024 px.
- Prompt:

  > Create one 1024x1024 PNG with a genuinely transparent background (alpha), for a cozy casual mobile merge game called Timber Town set in a forest lumber village. Style: hand-drawn storybook cartoon, confident dark-brown ink outlines (#3a2212) of 5-7 px at 1024 px with a slightly wobbly hand-inked line, flat cel colours with soft watercolor-like shading and gentle top-left light, a single small white highlight on rounded forms, subtle paper/wood grain texture. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions and a strong readable silhouette at 64 px. Object centered with approximately 8% transparent margin. No text, no letters, no numbers, no watermark, no drop shadow outside the object, no ground plane. Only the requested icon, no border or background decoration.
Subject: A berry-red gift box with a gold ribbon bow.

### `ui.icon-close`

- File: `features/ui/assets/icon-close.webp`, 128 × 127 px.
- Original: `sprites/icon-close.png`, 1024 × 1024 px.
- Prompt:

  > Create one 1024x1024 PNG with a genuinely transparent background (alpha), for a cozy casual mobile merge game called Timber Town set in a forest lumber village. Style: hand-drawn storybook cartoon, confident dark-brown ink outlines (#3a2212) of 5-7 px at 1024 px with a slightly wobbly hand-inked line, flat cel colours with soft watercolor-like shading and gentle top-left light, a single small white highlight on rounded forms, subtle paper/wood grain texture. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions and a strong readable silhouette at 64 px. Object centered with approximately 8% transparent margin. No text, no letters, no numbers, no watermark, no drop shadow outside the object, no ground plane. Only the requested icon, no border or background decoration.
Subject: A bold close symbol shaped like an X made of exactly two crossed cream-coloured wooden sticks. The X is an object symbol, not typography.

### `ui.icon-music`

- File: `features/ui/assets/icon-music.webp`, 121 × 128 px.
- Original: `sprites/icon-music.png`, 1024 × 1024 px.
- Prompt:

  > Create one 1024x1024 PNG with a genuinely transparent background (alpha), for a cozy casual mobile merge game called Timber Town set in a forest lumber village. Style: hand-drawn storybook cartoon, confident dark-brown ink outlines (#3a2212) of 5-7 px at 1024 px with a slightly wobbly hand-inked line, flat cel colours with soft watercolor-like shading and gentle top-left light, a single small white highlight on rounded forms, subtle paper/wood grain texture. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions and a strong readable silhouette at 64 px. Object centered with approximately 8% transparent margin. No text, no letters, no numbers, no watermark, no drop shadow outside the object, no ground plane. Only the requested icon, no border or background decoration.
Subject: A double musical note: two rounded noteheads with stems joined by one beam. The entire note silhouette is filled predominantly with very dark brown ink #3a2212; at least 85% of the note interior must be dark brown. Add only a small, narrow honey-gold #f2b43d highlight along its top-left edge, plus a single tiny white gleam. Do not fill the noteheads or beam with gold. Keep the soft grain, chunky friendly proportions, and subtle shading.

### `ui.icon-sound`

- File: `features/ui/assets/icon-sound.webp`, 128 × 108 px.
- Original: `sprites/icon-sound.png`, 1024 × 1024 px.
- Prompt:

  > Create one 1024x1024 PNG with a genuinely transparent background (alpha), for a cozy casual mobile merge game called Timber Town set in a forest lumber village. Style: hand-drawn storybook cartoon, confident dark-brown ink outlines (#3a2212) of 5-7 px at 1024 px with a slightly wobbly hand-inked line, flat cel colours with soft watercolor-like shading and gentle top-left light, a single small white highlight on rounded forms, subtle paper/wood grain texture. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions and a strong readable silhouette at 64 px. Object centered with approximately 8% transparent margin. No text, no letters, no numbers, no watermark, no drop shadow outside the object, no ground plane. Only the requested icon, no border or background decoration.
Subject: A speaker with exactly two sound waves, drawn as two clear curved arcs beside the speaker. Use warm wood and honey gold for the speaker, with dark-brown ink outlines.

### `ui.icon-check`

- File: `features/ui/assets/icon-check.webp`, 128 × 113 px.
- Original: `sprites/icon-check.png`, 1024 × 1024 px.
- Prompt:

  > Use case: illustration-story. Create one 1024x1024 PNG sprite with a genuinely transparent background for the cozy casual mobile merge game "Timber Town", set in a forest lumber village. STYLE: hand-drawn storybook cartoon; confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked line; flat cel colours with soft watercolor-like shading and gentle top-left light; a single small white highlight on rounded forms; subtle paper/wood grain texture within the object. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions and a strong readable silhouette at 64 px. Object centered with approximately 8% transparent margin. No text, letters, numbers, watermark, external drop shadow, ground plane, backdrop, or extra objects. Subject: one thick moss-green check mark.

### `ui.badge-level`

- File: `features/ui/assets/badge-level.webp`, 96 × 96 px.
- Original: `sprites/badge-level.png`, 1024 × 1024 px.
- Prompt:

  > Use case: illustration-story. Create one 1024x1024 PNG sprite with a genuinely transparent background for the cozy casual mobile merge game "Timber Town", set in a forest lumber village. STYLE: hand-drawn storybook cartoon; confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked line; flat cel colours with soft watercolor-like shading and gentle top-left light; a single small white highlight on rounded forms; subtle paper/wood grain texture within the object. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions and a strong readable silhouette at 64 px. Object centered with approximately 8% transparent margin. No text, letters, numbers, watermark, external drop shadow, ground plane, backdrop, or extra objects. Subject: one empty round honey-gold medallion badge with a rim, nothing printed on it.

### `ui.decor-sprig`

- File: `features/ui/assets/decor-sprig.webp`, 177 × 192 px.
- Original: `sprites/decor-sprig.png`, 1024 × 1024 px.
- Prompt:

  > Use case: illustration-story. Create one 1024x1024 PNG sprite with a genuinely transparent background for the cozy casual mobile merge game "Timber Town", set in a forest lumber village. STYLE: hand-drawn storybook cartoon; confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked line; flat cel colours with soft watercolor-like shading and gentle top-left light; a single small white highlight on rounded forms; subtle paper/wood grain texture within the object. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions and a strong readable silhouette at 64 px. Object centered with approximately 8% transparent margin. No text, letters, numbers, watermark, external drop shadow, ground plane, backdrop, or extra objects. Subject: one leafy sprig with exactly three red berries at its lower end.

### `ui.decor-clothespin`

- File: `features/ui/assets/decor-clothespin.webp`, 40 × 96 px.
- Original: `sprites/decor-clothespin.png`, 1024 × 1024 px.
- Prompt:

  > Use case: illustration-story. Create one 1024x1024 PNG sprite with a genuinely transparent background for the cozy casual mobile merge game "Timber Town", set in a forest lumber village. STYLE: hand-drawn storybook cartoon; confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked line; flat cel colours with soft watercolor-like shading and gentle top-left light; a single small white highlight on rounded forms; subtle paper/wood grain texture within the object. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions and a strong readable silhouette at 64 px. Object centered with approximately 8% transparent margin. No text, letters, numbers, watermark, external drop shadow, ground plane, backdrop, or extra objects. Subject: one wooden clothespin, vertical.

### `ui.fx-sparkle`

- File: `features/ui/assets/fx-sparkle.webp`, 85 × 96 px.
- Original: `sprites/fx-sparkle.png`, 1024 × 1024 px.
- Prompt:

  > Use case: illustration-story. Create one 1024x1024 transparent PNG game sprite for Timber Town, a cozy casual mobile merge game set in a forest lumber village. Style: hand-drawn storybook cartoon; confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked lines; flat cel colours with soft watercolor-like shading, gentle top-left light, a single small white highlight on rounded forms, subtle paper/wood grain texture. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions, strong readable silhouette at 64 px. No text, letters, numbers, watermark, drop shadow outside the object, or ground plane. Center the object with approximately 8% fully transparent margin. Background must be genuine PNG alpha transparency, not a checkerboard drawing. Subject: exactly one four-point cartoon sparkle star, pale gold. Four tapered points at top, right, bottom and left, gently concave edges, a warm pale-gold fill and one small white highlight. No extra sparkles or objects.

### `ui.fx-leaf`

- File: `features/ui/assets/fx-leaf.webp`, 58 × 64 px.
- Original: `sprites/fx-leaf.png`, 1024 × 1024 px.
- Prompt:

  > Use case: illustration-story. Create one 1024x1024 transparent PNG game sprite for Timber Town, a cozy casual mobile merge game set in a forest lumber village. Style: hand-drawn storybook cartoon; confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked lines; flat cel colours with soft watercolor-like shading, gentle top-left light, a single small white highlight on rounded forms, subtle paper/wood grain texture. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions, strong readable silhouette at 64 px. No text, letters, numbers, watermark, drop shadow outside the object, or ground plane. Center the object with approximately 8% fully transparent margin. Background must be genuine PNG alpha transparency, not a checkerboard drawing. Subject: exactly one single small green leaf particle. Simple chunky oval leaf with a pointed tip, short stem, one central vein and minimal side veins, moss green #8ab84e with #557f2d shading. Diagonal orientation, friendly curved silhouette. No other leaves or objects.

### `ui.fx-rays`

- File: `features/ui/assets/fx-rays.webp`, 504 × 512 px.
- Original: `sprites/fx-rays.png`, 1024 × 1024 px.
- Prompt:

  > Use case: illustration-story. Create one 1024x1024 transparent PNG game sprite for Timber Town, a cozy casual mobile merge game set in a forest lumber village. Style: hand-drawn storybook cartoon; confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked lines; flat cel colours with soft watercolor-like shading, gentle top-left light, a single small white highlight on rounded forms, subtle paper/wood grain texture. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions, strong readable silhouette at 64 px. No text, letters, numbers, watermark, drop shadow outside the object, or ground plane. Center the object with approximately 8% fully transparent margin. Background must be genuine PNG alpha transparency, not a checkerboard drawing. Subject: a soft pale-gold sunburst of exactly 12 evenly spaced rays radiating from the center, for placement behind a reward item. Show the effect only, without a reward item or sun face or solid central disc. Twelve broad, gently hand-shaped rays in pale honey gold and parchment tones, watercolor-soft with opacity fading smoothly to fully transparent toward their tips. Keep the rays soft: any ink treatment is very faint and also fades with the rays. Transparent gaps between rays; exactly 12 rays, no additional streaks, stars, or particles.

### `splash.bg-splash`

- File: `features/splash/assets/bg-splash.webp`, 1024 × 1536 px.
- Original: `backgrounds/bg-splash.png`, 1024 × 1536 px.
- Prompt:

  > Use case: illustration-story. Create one production-ready full-screen portrait background for the cozy casual mobile merge game Timber Town, a forest lumber village. Output exactly 1024x1536 pixels, opaque PNG, full bleed, no transparent margin. Shared visual style: hand-drawn storybook cartoon, confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px width, slightly wobbly hand-inked line; flat cel colours with soft watercolor-like shading, gentle top-left illumination, a single small white highlight on rounded forms where appropriate, subtle paper and wood grain texture. Chunky friendly toy-like proportions and strong silhouettes readable at 64 px. Palette: ink #3a2212, warm wood #d8a062, light wood #efcd94, dark wood #9c6031, walnut #6e4121, honey gold #f2b43d and #c7841c, moss green #8ab84e and #557f2d, pine #2f5a3b, berry red #c93b4d and #8f2334, parchment #fbeed2, pale sky blue #cfe6ee. No text, letters, numbers, logo, watermark, UI, border, or external object drop shadows. Keep UI areas calm and low-detail. Scene: the same forest-meadow world at golden morning light, slightly more atmospheric with soft honey-gold haze, distant blue-green hills, a band of layered pine forest below the middle, a sunny grassy meadow with tiny sparse flowers and a winding dirt path entering from the bottom centre. Pale blue and parchment sky with two soft clouds near the sides and a warm sun high at the upper right. Reserve the upper half as mostly empty, quiet sky for a future hanging logo sign; do not draw the sign or logo. Watercolor washes, ink outlines on the nearest trees only, nearest trees confined to the far side edges. Keep the centre low-detail and low-contrast for UI. Ground plane is part of this landscape. Match the storybook palette, line treatment and world of bg-forest-meadow.png. Filename: bg-splash.png.

### `home.home-sawmill-scene`

- File: `features/home/assets/home-sawmill-scene.webp`, 1024 × 1536 px.
- Original: `backgrounds/home-sawmill-scene.png`, 1024 × 1536 px.
- Prompt:

  > Use case: illustration-story. Create one production-ready full-screen portrait background for the cozy casual mobile merge game Timber Town, a forest lumber village. Output exactly 1024x1536 pixels, opaque PNG, full bleed, no transparent margin. Shared visual style: hand-drawn storybook cartoon, confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px width, slightly wobbly hand-inked line; flat cel colours with soft watercolor-like shading, gentle top-left illumination, a single small white highlight on rounded forms where appropriate, subtle paper and wood grain texture. Chunky friendly toy-like proportions and strong silhouettes readable at 64 px. Palette: ink #3a2212, warm wood #d8a062, light wood #efcd94, dark wood #9c6031, walnut #6e4121, honey gold #f2b43d and #c7841c, moss green #8ab84e and #557f2d, pine #2f5a3b, berry red #c93b4d and #8f2334, parchment #fbeed2, pale sky blue #cfe6ee. No text, letters, numbers, logo, watermark, UI, border, or external object drop shadows. Keep UI areas calm and low-detail. Scene: an opaque, full-screen home-screen illustration panel of the lumber village on a small grassy clearing over the same sunny meadow world. Pale blue sky with two soft clouds and warm sun at upper right, distant blue-green hills, soft layered pine forest, tiny sparse meadow flowers and a winding dirt path entering from bottom centre. Main subject: one friendly chunky wooden sawmill cabin with a clearly visible circular saw blade, stacked round logs, one wooden crate, and exactly two separate wooden planks. Compose the entire cabin-and-props grouping within the middle vertical third of the image (between y=512 and y=1024), horizontally centred, at a modest scale with ample surrounding meadow. Dark-brown hand-inked outlines on cabin, blade, logs, crate, planks and nearest edge trees. Background forest and hills use softer watercolor washes. Keep upper and lower thirds calm and low-detail for UI, and the clearing around the compact scene simple. The cabin grouping is the intentional home-screen central focal point. Gentle top-left light, warm wood, honey-gold accents, moss grass, pine trees, subtle wood grain, toy-like shapes. Ground plane is part of this landscape. Fully opaque everywhere, no transparent cutout, no isolated floating island, no text or sign lettering. Filename: home-sawmill-scene.png.

### `board.item-wood-1`

- File: `features/board/assets/item-wood-1.webp`, 170 × 256 px.
- Original: `sprites/item-wood-1-twig.png`, 1024 × 1024 px.
- Prompt:

  > Use case: illustration-story. Create one game sprite for the cozy casual mobile merge game "Timber Town", set in a forest lumber village. Hand-drawn storybook cartoon. Confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked line. Flat cel colours with soft watercolor-like shading, gentle top-left light, a single small white highlight on rounded forms, subtle paper/wood grain texture. Palette: ink #3a2212; warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121; honey gold #f2b43d / #c7841c; moss green #8ab84e / #557f2d; pine #2f5a3b; berry red #c93b4d / #8f2334; parchment #fbeed2; sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions, strong readable silhouette at 64 px. No text, no letters, no numbers, no watermark, no drop shadow outside the object, no ground plane. Object centered with approximately 8% transparent margin. Output exactly 1024x1024 PNG with a genuinely transparent background and alpha channel; do not draw a checkerboard. Subject: A small forked twig with two fresh green leaves.

### `board.item-wood-2`

- File: `features/board/assets/item-wood-2.webp`, 256 × 240 px.
- Original: `sprites/item-wood-2-log.png`, 1024 × 1024 px.
- Prompt:

  > Use case: illustration-story. Create one game sprite for the cozy casual mobile merge game "Timber Town", set in a forest lumber village. Hand-drawn storybook cartoon. Confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked line. Flat cel colours with soft watercolor-like shading, gentle top-left light, a single small white highlight on rounded forms, subtle paper/wood grain texture. Palette: ink #3a2212; warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121; honey gold #f2b43d / #c7841c; moss green #8ab84e / #557f2d; pine #2f5a3b; berry red #c93b4d / #8f2334; parchment #fbeed2; sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions, strong readable silhouette at 64 px. No text, no letters, no numbers, no watermark, no drop shadow outside the object, no ground plane. Object centered with approximately 8% transparent margin. Output exactly 1024x1024 PNG with a genuinely transparent background and alpha channel; do not draw a checkerboard. Subject: A short round log lying on its side, visible end rings, one small sprout.

### `board.item-wood-3`

- File: `features/board/assets/item-wood-3.webp`, 256 × 190 px.
- Original: `sprites/item-wood-3-plank.png`, 1024 × 1024 px.
- Prompt:

  > Use case: illustration-story. Create one game sprite for the cozy casual mobile merge game "Timber Town", set in a forest lumber village. Hand-drawn storybook cartoon. Confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked line. Flat cel colours with soft watercolor-like shading, gentle top-left light, a single small white highlight on rounded forms, subtle paper/wood grain texture. Palette: ink #3a2212; warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121; honey gold #f2b43d / #c7841c; moss green #8ab84e / #557f2d; pine #2f5a3b; berry red #c93b4d / #8f2334; parchment #fbeed2; sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions, strong readable silhouette at 64 px. No text, no letters, no numbers, no watermark, no drop shadow outside the object, no ground plane. Object centered with approximately 8% transparent margin. Output exactly 1024x1024 PNG with a genuinely transparent background and alpha channel; do not draw a checkerboard. Subject: A single clean sawn plank, light wood with grain and two nail holes, lying at a slight angle.

### `board.item-wood-4`

- File: `features/board/assets/item-wood-4.webp`, 256 × 249 px.
- Original: `sprites/item-wood-4-crate.png`, 1024 × 1024 px.
- Prompt:

  > Use case: illustration-story. Create one game sprite for the cozy casual mobile merge game "Timber Town", set in a forest lumber village. Hand-drawn storybook cartoon. Confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked line. Flat cel colours with soft watercolor-like shading, gentle top-left light, a single small white highlight on rounded forms, subtle paper/wood grain texture. Palette: ink #3a2212; warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121; honey gold #f2b43d / #c7841c; moss green #8ab84e / #557f2d; pine #2f5a3b; berry red #c93b4d / #8f2334; parchment #fbeed2; sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions, strong readable silhouette at 64 px. No text, no letters, no numbers, no watermark, no drop shadow outside the object, no ground plane. Object centered with approximately 8% transparent margin. Output exactly 1024x1024 PNG with a genuinely transparent background and alpha channel; do not draw a checkerboard. Subject: A sturdy wooden crate made of planks with corner braces.

### `board.generator`

- File: `features/board/assets/generator.webp`, 288 × 261 px.
- Original: `sprites/generator-sawmill.png`, 1024 × 1024 px.
- Prompt:

  > Use case: illustration-story. Create one game sprite for the cozy casual mobile merge game "Timber Town", set in a forest lumber village. Hand-drawn storybook cartoon. Confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked line. Flat cel colours with soft watercolor-like shading, gentle top-left light, a single small white highlight on rounded forms, subtle paper/wood grain texture. Palette: ink #3a2212; warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121; honey gold #f2b43d / #c7841c; moss green #8ab84e / #557f2d; pine #2f5a3b; berry red #c93b4d / #8f2334; parchment #fbeed2; sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions, strong readable silhouette at 64 px. No text, no letters, no numbers, no watermark, no drop shadow outside the object, no ground plane. Object centered with approximately 8% transparent margin. Output exactly 1024x1024 PNG with a genuinely transparent background and alpha channel; do not draw a checkerboard. Subject: A tiny log cabin sawmill with a green mossy roof, a chimney and a big round steel saw blade on the right side, a few logs by the door; reads as a building, fits a square cell.

### `board.cell`

- File: `features/board/assets/cell{nine=44,52,44,52}.webp`, 224 × 219 px, 9-slice left 44, top 52, right 44, bottom 52.
- Original: `ui/cell-grass.png`, 1024 × 1024 px.
- Prompt:

  > Create one 1024x1024 transparent PNG game UI asset for Timber Town, a cozy forest lumber village merge game. Hand-drawn storybook cartoon, confident dark-brown #3a2212 ink outlines 5-7 px at 1024 px with subtly wobbly hand-inked character, flat cel colours with soft watercolor-like shading, gentle top-left light, subtle fine paper/wood grain. Chunky friendly toy-like proportions, readable at 64 px. Palette: ink #3a2212, wood #d8a062 / #efcd94 / #9c6031 / walnut #6e4121, honey #f2b43d / #c7841c, moss #8ab84e / #557f2d, pine #2f5a3b, berry #c93b4d / #8f2334, parchment #fbeed2, sky #cfe6ee. Genuine alpha transparency outside the object, no painted checkerboard. No text, letters, numbers, watermark, icons, ground plane, or external drop shadow. Front-on orthographic UI sprite, no perspective. Subject: cell-grass.png, one square board cell tile of fresh moss-green grass, softly rounded fixed-size corners, lighter green inner bevel and dark-brown ink outline. Tile fills canvas with about 4% transparent margin on all sides. Designed for 9-slice scaling: perfectly straight uniform edges along middle of every side, a plain flat moss-green stretchable centre with only fine repeating grass/paper texture; no individual grass blades, tufts, flowers, icons, decoration or marks in centre or along middle edges. Soft watercolor shading kept restrained, one small white highlight at upper-left rounded corner.

### `board.board-tray`

- File: `features/board/assets/board-tray{nine=96,96,96,96}.webp`, 640 × 631 px, 9-slice 96 on every side (72 cut through the corner joints).
- Original: `ui/board-tray.png`, 1024 × 1024 px.
- Prompt:

  > Create one 1024x1024 transparent PNG game UI asset for Timber Town, a cozy forest lumber village merge game. Hand-drawn storybook cartoon, confident dark-brown #3a2212 ink outlines 5-7 px at 1024 px with subtly wobbly hand-inked character, flat cel colours with soft watercolor-like shading, gentle top-left light, subtle fine paper/wood grain. Chunky friendly toy-like proportions, readable at 64 px. Palette: ink #3a2212, wood #d8a062 / #efcd94 / #9c6031 / walnut #6e4121, honey #f2b43d / #c7841c, moss #8ab84e / #557f2d, pine #2f5a3b, berry #c93b4d / #8f2334, parchment #fbeed2, sky #cfe6ee. Genuine alpha transparency outside the object, no painted checkerboard. No text, letters, numbers, watermark, icons, ground plane, or external drop shadow. Front-on orthographic UI sprite, no perspective. Subject: board-tray.png, one square wooden board tray with a raised warm wood plank rim and a darker inset walnut floor, dark-brown ink outline. Front-on top view, no perspective. Softly rounded fixed-size corners. Shape fills canvas with about 4% transparent margin on all sides. Designed for 9-slice scaling: perfectly straight uniform rim edges along middle of every side, consistent rim width, a plain stretchable dark inset floor with only fine repeating wood texture. No centre decoration, knots, bolts, nails, icons or plank seams, and no decoration or interruptions along middle edges. Corner joints may remain within fixed corner areas. Gentle inner shading conveys rim height, one small white highlight confined to upper-left corner.

### `board.bg-forest-meadow`

- File: `features/board/assets/bg-forest-meadow.webp`, 1024 × 1536 px.
- Original: `backgrounds/bg-forest-meadow.png`, 1024 × 1536 px.
- Prompt:

  > Use case: illustration-story. Create one production-ready full-screen portrait background for the cozy casual mobile merge game Timber Town, a forest lumber village. Output exactly 1024x1536 pixels, opaque PNG, full bleed, no transparent margin. Shared visual style: hand-drawn storybook cartoon, confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px width, slightly wobbly hand-inked line; flat cel colours with soft watercolor-like shading, gentle top-left illumination, a single small white highlight on rounded forms where appropriate, subtle paper and wood grain texture. Chunky friendly toy-like proportions and strong silhouettes readable at 64 px. Palette: ink #3a2212, warm wood #d8a062, light wood #efcd94, dark wood #9c6031, walnut #6e4121, honey gold #f2b43d and #c7841c, moss green #8ab84e and #557f2d, pine #2f5a3b, berry red #c93b4d and #8f2334, parchment #fbeed2, pale sky blue #cfe6ee. No text, letters, numbers, logo, watermark, UI, border, or external object drop shadows. Keep UI areas calm and low-detail. Scene: pale sky with exactly two soft clouds and a warm sun at the upper right; distant blue-green hills; a band of layered pine forest across the middle; a sunny meadow with tiny sparse flowers in the lower half and a winding dirt path entering from the bottom centre. Watercolor washes and ink outlines on the nearest trees only. Frame nearest trees along the far side edges. Keep the centre broad, quiet, low-contrast, and free of strong shapes for the game board and home-screen UI. Ground plane is part of this landscape. Filename: bg-forest-meadow.png.

### `orders.card-order`

- File: `features/orders/assets/card-order{nine=40,40,40,40}.webp`, 214 × 300 px, 9-slice 40 on every side (no punched hole: the clothespin covers the top).
- Original: `fix1/card-order.png`, 1024 × 1024 px, drawn by Astra (gpt-6-astra, codex backend) on 2026-09-23.
- Prompt:

  > Create one 1024x1024 PNG with genuinely transparent alpha background. Style: hand-drawn storybook cartoon for a cozy casual mobile merge game called Timber Town, set in a forest lumber village. Confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked line; flat cel colours with soft watercolor-like shading and gentle top-left light; a single small white highlight on rounded forms; subtle paper/wood grain texture. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions, strong readable silhouettes at 64 px. No text, letters, numbers, watermark, or drop shadow outside the object. No ground plane unless specifically requested below. Transparent pixels outside the object, never a checkerboard illustration. A blank parchment price-tag card for an order, portrait shape about 3:4 inside the square canvas, centered with about 8% transparent top and bottom margin. Rounded corners, thin dark-brown ink outline, parchment #fbeed2, faint paper grain, perfectly uniform edges for 9-slice scaling. NO hole and NO marks at the top: a separate clothespin will cover the top centre, but do not draw the clothespin. Front-facing blank card only.

### `home.home-yard`

- File: `features/home/assets/home-yard.webp`, 960 × 924 px, the sawmill yard of Home without a background.
- Original: `fix1/home-yard.png`, 1024 × 1024 px, drawn by Astra (gpt-6-astra, codex backend) on 2026-09-23.
- Prompt:

  > Create one 1024x1024 PNG with genuinely transparent alpha background. Style: hand-drawn storybook cartoon for a cozy casual mobile merge game called Timber Town, set in a forest lumber village. Confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked line; flat cel colours with soft watercolor-like shading and gentle top-left light; a single small white highlight on rounded forms; subtle paper/wood grain texture. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions, strong readable silhouettes at 64 px. No text, letters, numbers, watermark, or drop shadow outside the object. No ground plane unless specifically requested below. Transparent pixels outside the object, never a checkerboard illustration. An isolated illustration of the Timber Town sawmill yard standing on a round sandy dirt patch: a small log cabin with a moss-green roof, a brick chimney with a little smoke puff, a round attic window and an arched door; a big round circular-saw blade with a honey-gold hub on its right side; a stack of three logs with little sprouting leaves on the right; a wooden crate and two loose planks on the left. No sky and no background scenery, transparent around the dirt patch and objects. Centered, filling about 90% of the width, front three-quarter view.

### `home.sign-post`

- File: `features/home/assets/sign-post.webp`, 64 × 530 px, one post of the Play sign.
- Original: `fix1/sign-post.png`, 1024 × 1024 px, drawn by Astra (gpt-6-astra, codex backend) on 2026-09-23.
- Prompt:

  > Create one 1024x1024 PNG with genuinely transparent alpha background. Style: hand-drawn storybook cartoon for a cozy casual mobile merge game called Timber Town, set in a forest lumber village. Confident dark-brown ink outlines (#3a2212), 5-7 px at 1024 px, slightly wobbly hand-inked line; flat cel colours with soft watercolor-like shading and gentle top-left light; a single small white highlight on rounded forms; subtle paper/wood grain texture. Palette: ink #3a2212, warm wood #d8a062 / light #efcd94 / dark #9c6031 / walnut #6e4121, honey gold #f2b43d / #c7841c, moss green #8ab84e / #557f2d, pine #2f5a3b, berry red #c93b4d / #8f2334, parchment #fbeed2, sky pale blue #cfe6ee. Chunky, friendly, toy-like proportions, strong readable silhouettes at 64 px. No text, letters, numbers, watermark, or drop shadow outside the object. No ground plane unless specifically requested below. Transparent pixels outside the object, never a checkerboard illustration. One straight vertical wooden sign post only: a square beam of warm wood with visible grain and ink outline, narrow and tall, centered, occupying about 12% of the canvas width and 90% of the height. A slightly darker lower end as if set into the ground, but no ground visible. The top is flat because it will hold up a sign; do not draw the sign itself.

### `ui.link-wave`

- File: `features/ui/assets/link-wave.webp`, 400 × 16 px: the wavy underline of a text link, berry `#c93b4d`, 3 px stroke, period 24 px, amplitude 4 px.
- Drawn with ImageMagick (a sine path), not by Astra.

## Fonts

- `features/ui/assets/font-display.fnt` with its page `font-display.png` (key `ui.font-display`):
  Rubik ExtraBold, for titles, buttons, numbers and item names.
- `features/ui/assets/font-body.fnt` with its page `font-body.png` (key `ui.font-body`): Pangolin
  Regular, for body lines.
- Source: the Google Fonts TTFs `Rubik-ExtraBold.ttf` and `Pangolin-Regular.ttf`, both under the
  SIL Open Font License 1.1 (the texts are in `LICENSE-fonts.txt`).
- Built on 2026-09-23 with `msdf-bmfont-xml`: MSDF, distance range 6, export size 48
  (display) and 44 (body), one 512 × 512 page each, 174 glyphs (Latin, Cyrillic, digits and
  punctuation), BMFont XML.

## Sounds

Real recordings from Kenney (www.kenney.nl), licence Creative Commons Zero (CC0 1.0), "free to use
in personal, educational and commercial projects"; credit is not required. Downloaded on 2026-09-23
and converted with ffmpeg (effects mono 44.1 kHz 96 kbps, music stereo 44.1 kHz 128 kbps).

| Key | File | Source pack | Source file |
|---|---|---|---|
| `ui.click` | `features/ui/assets/click.mp3` | Interface Sounds 1.0 | `click_001.ogg` |
| `ui.popup` | `features/ui/assets/popup.mp3` | Interface Sounds 1.0 | `maximize_006.ogg` |
| `ui.coins` | `features/ui/assets/coins.mp3` | Casino Audio | `chips-stack-3.ogg` |
| `board.merge` | `features/board/assets/merge.mp3` | Interface Sounds 1.0 | `confirmation_002.ogg` |
| `board.spawn` | `features/board/assets/spawn.mp3` | Interface Sounds 1.0 | `pluck_002.ogg` |
| `orders.complete` | `features/orders/assets/complete.mp3` | Music Jingles | `Pizzicato jingles/jingles_PIZZI07.ogg` |
| `ui.theme` | `features/ui/assets/theme.mp3` | Music Loops (Kenney's Sound Pack) | `Farm Frolics.ogg`, the 10.7 s loop repeated four times (42.7 s) |

`board.theme` is the last placeholder tone (a 220 Hz sine); the board moves to `ui.theme` and the
file is removed with it.
