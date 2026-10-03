import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  audioName,
  contentHash,
  fontName,
  fontPageName,
  looseName,
  pageId,
  pageName
} from "../../scan/pack/names";

describe("contentHash", () => {
  it("is the first 10 hex characters of the SHA-256 of the bytes", () => {
    const bytes = new TextEncoder().encode("abc");

    expect(contentHash(bytes)).toBe("ba7816bf8f");
    expect(contentHash(bytes)).toBe(createHash("sha256").update(bytes).digest("hex").slice(0, 10));
  });

  it("changes with one byte", () => {
    expect(contentHash(new Uint8Array([1, 2, 3]))).not.toBe(contentHash(new Uint8Array([1, 2, 4])));
  });
});

describe("the name rules", () => {
  it("names a page by its bundle, group and index", () => {
    expect(pageId("ui", "main", 0)).toBe("ui/main-0");
    expect(pageName("ui", "fx", 1, "2a7f9c04e1")).toBe("ui/fx-1-2a7f9c04e1.webp");
  });

  it("names a loose texture by its key, in its bundle folder", () => {
    expect(looseName("ui", "ui.bg-splash", "5e0a71bd42", "webp")).toBe(
      "ui/ui.bg-splash-5e0a71bd42.webp"
    );
  });

  it("names a font and its pages by the key of the font", () => {
    expect(fontName("ui", "ui.font-body", "7d2c90f1ab")).toBe("ui/ui.font-body-7d2c90f1ab.fnt");
    expect(fontPageName("ui", "ui.font-body", 0, "c81f3e2d55", "png")).toBe(
      "ui/ui.font-body-0-c81f3e2d55.png"
    );
  });

  it("names a sound by its key", () => {
    expect(audioName("ui", "ui.click", "9c4e2b7a10")).toBe("ui/ui.click-9c4e2b7a10.mp3");
  });

  it("keeps a bundle name with a dot as one folder", () => {
    expect(pageId("board.rings", "main", 0)).toBe("board.rings/main-0");
  });
});
