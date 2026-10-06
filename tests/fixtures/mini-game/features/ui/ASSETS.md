# Assets of the mini game

Where every file of `assets/` came from. The folder is named after the key the `text` config reads
by default, `ui.font-body`.

| Key | File | Source |
|---|---|---|
| `ui.font-body` | `assets/font-body.fnt`, page `assets/font-body.png` | A byte copy of the engine's `fonts/`: Pangolin Regular, MSDF, one 512 × 512 page. SIL Open Font License 1.1, the text is in `LICENSE-fonts.txt`. `tests/unit/package.test.ts` keeps the two copies equal. |
| `ui.fx-spark` | `assets/fx-spark.webp`, 85 × 96 px | The sparkle of the merge game in moku-labs/demos, drawn by Astra for it. |
| `ui.popup` | `assets/popup.mp3` | Kenney (www.kenney.nl), Interface Sounds 1.0, `maximize_006.ogg`, CC0 1.0. Converted with ffmpeg, mono 44.1 kHz 96 kbps. |
