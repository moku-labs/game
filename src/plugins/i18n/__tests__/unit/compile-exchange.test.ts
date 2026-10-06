import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportStrings, importStrings } from "../../compile/exchange";
import { createIntlKit } from "../../intl";
import { evaluateModule } from "./evaluate";

const ORDERS_RU = "{n, plural, one {# заказ} few {# заказа} many {# заказов} other {# заказа}}";

const ORDERS_EN = "{n, plural, one {# order} other {# orders}}";

const NOTE = "Button on an order card, max 10 chars";

/**
 * Creates an empty folder in the system temp folder.
 *
 * @returns The path of the folder.
 */
async function createFolder(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "moku-i18n-exchange-"));
}

/**
 * Writes one JSON file, creating its folder.
 *
 * @param file - Path of the file.
 * @param table - The content, or the raw text of the file.
 */
async function writeJson(file: string, table: Record<string, unknown> | string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    typeof table === "string" ? table : `${JSON.stringify(table, undefined, 2)}\n`
  );
}

/**
 * The path of one string file of one feature.
 *
 * @param root - The game source root.
 * @param feature - Name of the feature.
 * @param locale - The locale.
 * @returns The path of the file.
 */
function stringFile(root: string, feature: string, locale: string): string {
  return path.join(root, "features", feature, "strings", `${locale}.json`);
}

/**
 * The text a file of a table is written with: 2-space indent, trailing newline.
 *
 * @param table - The content.
 * @returns The text of the file.
 */
function jsonText(table: Record<string, unknown>): string {
  return `${JSON.stringify(table, undefined, 2)}\n`;
}

/**
 * Writes the fixture game: `hud` in English and Russian, with a note in each, and `orders` in
 * English only. Russian lacks three keys.
 *
 * @returns The game source root and a folder for the translation files.
 */
async function fixture(): Promise<{ root: string; dir: string }> {
  const root = await createFolder();

  await writeJson(stringFile(root, "hud", "en"), {
    "hud.deliver": { text: "Deliver", note: NOTE },
    "hud.orders": ORDERS_EN,
    "hud.title": "Orders",
    "hud.bonus": "Bonus",
    "hud.coins": "{n, number} coins"
  });
  await writeJson(stringFile(root, "hud", "ru"), {
    "hud.orders": ORDERS_RU,
    "hud.title": { text: "Заказы", note: "Screen title" },
    "hud.deliver": "Отдать"
  });
  await writeJson(stringFile(root, "orders", "en"), {
    "orders.coins": "Reward: {n, number} coins"
  });

  return { root, dir: path.join(await createFolder(), "translations") };
}

/**
 * Reads every string file of the game, so a test can tell the tree was not touched.
 *
 * @param root - The game source root.
 * @returns The text of each file by its path.
 */
async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  for (const feature of await readdir(path.join(root, "features"))) {
    const folder = path.join(root, "features", feature, "strings");

    for (const name of await readdir(folder)) {
      files[path.join(feature, name)] = await readFile(path.join(folder, name), "utf8");
    }
  }

  return files;
}

describe("exportStrings", () => {
  it("writes one file per locale, the source included, and counts the missing keys", async () => {
    const { root, dir } = await fixture();
    const report = await exportStrings(root, dir);

    const written = await readdir(dir);

    expect(report).toEqual({ locales: ["en", "ru"], missing: { en: 0, ru: 3 } });
    expect(written.toSorted()).toEqual(["en.json", "ru.json"]);
  });

  it("writes the locale's text, the source text and the note of each key", async () => {
    const { root, dir } = await fixture();

    await exportStrings(root, dir);

    expect(await readFile(path.join(dir, "ru.json"), "utf8")).toBe(
      jsonText({
        "hud.bonus": { text: "", source: "Bonus" },
        "hud.coins": { text: "", source: "{n, number} coins" },
        "hud.deliver": { text: "Отдать", source: "Deliver", note: NOTE },
        "hud.orders": { text: ORDERS_RU, source: ORDERS_EN },
        "hud.title": { text: "Заказы", source: "Orders", note: "Screen title" },
        "orders.coins": { text: "", source: "Reward: {n, number} coins" }
      })
    );
    expect(await readFile(path.join(dir, "en.json"), "utf8")).toBe(
      jsonText({
        "hud.bonus": { text: "Bonus", source: "Bonus" },
        "hud.coins": { text: "{n, number} coins", source: "{n, number} coins" },
        "hud.deliver": { text: "Deliver", source: "Deliver", note: NOTE },
        "hud.orders": { text: ORDERS_EN, source: ORDERS_EN },
        "hud.title": { text: "Orders", source: "Orders" },
        "orders.coins": { text: "Reward: {n, number} coins", source: "Reward: {n, number} coins" }
      })
    );
  });

  it("swaps the roles with another source locale", async () => {
    const { root, dir } = await fixture();
    const report = await exportStrings(root, dir, { source: "ru" });
    const english: unknown = JSON.parse(await readFile(path.join(dir, "en.json"), "utf8"));

    expect(report.missing).toEqual({ en: 0, ru: 3 });
    expect(english).toMatchObject({
      "hud.bonus": { text: "Bonus", source: "" },
      "hud.deliver": { text: "Deliver", source: "Отдать", note: NOTE },
      "hud.title": { text: "Orders", source: "Заказы", note: "Screen title" }
    });
  });

  it("refuses a source locale no feature brings", async () => {
    const { root, dir } = await fixture();

    await expect(exportStrings(root, dir, { source: "de" })).rejects.toThrow(
      '[game] i18n: the source locale "de" has no string file.\n  Pass "--source <locale>".'
    );
  });

  it("writes the same bytes on a second run and leaves the game tree as it was", async () => {
    const { root, dir } = await fixture();
    const before = await snapshot(root);

    await exportStrings(root, dir);

    const first = await readFile(path.join(dir, "ru.json"), "utf8");

    await exportStrings(root, dir);

    expect(await readFile(path.join(dir, "ru.json"), "utf8")).toBe(first);
    expect(await snapshot(root)).toEqual(before);
    await expect(readdir(path.join(root, "generated"))).rejects.toThrow();
  });

  it("refuses a game whose strings do not compile", async () => {
    const { root, dir } = await fixture();

    await writeJson(stringFile(root, "orders", "ru"), { "orders.coins": "{n, number, currency}" });

    await expect(exportStrings(root, dir)).rejects.toThrow(
      'the number style "currency" is not supported'
    );
  });
});

describe("importStrings", () => {
  it("rewrites a changed key in place, keeping the key order and the note", async () => {
    const { root, dir } = await fixture();

    await writeJson(path.join(dir, "ru.json"), {
      "hud.title": { text: "Список заказов", source: "Orders", note: "ignored" }
    });

    const report = await importStrings(root, dir);

    expect(report).toEqual({ locales: ["ru"], keys: 1, files: ["features/hud/strings/ru.json"] });
    expect(await readFile(stringFile(root, "hud", "ru"), "utf8")).toBe(
      jsonText({
        "hud.orders": ORDERS_RU,
        "hud.title": { text: "Список заказов", note: "Screen title" },
        "hud.deliver": "Отдать"
      })
    );
  });

  it("appends new keys sorted, and creates a locale file a feature lacks", async () => {
    const { root, dir } = await fixture();

    await writeJson(path.join(dir, "ru.json"), {
      "orders.coins": { text: "Награда: {n, number} монет", source: "Reward: {n, number} coins" },
      "hud.coins": { text: "{n, number} монет", source: "{n, number} coins" },
      "hud.bonus": { text: "Бонус", source: "Bonus" }
    });

    const report = await importStrings(root, dir);

    expect(report).toEqual({
      locales: ["ru"],
      keys: 3,
      files: ["features/hud/strings/ru.json", "features/orders/strings/ru.json"]
    });
    expect(await readFile(stringFile(root, "hud", "ru"), "utf8")).toBe(
      jsonText({
        "hud.orders": ORDERS_RU,
        "hud.title": { text: "Заказы", note: "Screen title" },
        "hud.deliver": "Отдать",
        "hud.bonus": "Бонус",
        "hud.coins": "{n, number} монет"
      })
    );
    expect(await readFile(stringFile(root, "orders", "ru"), "utf8")).toBe(
      jsonText({ "orders.coins": "Награда: {n, number} монет" })
    );
  });

  it("skips an empty text and a text equal to the current message", async () => {
    const { root, dir } = await fixture();
    const before = await snapshot(root);

    await writeJson(path.join(dir, "ru.json"), {
      "hud.orders": { text: ORDERS_RU, source: ORDERS_EN },
      "hud.title": { text: "Заказы" },
      "hud.bonus": { text: "", source: "Bonus" }
    });

    expect(await importStrings(root, dir)).toEqual({ locales: ["ru"], keys: 0, files: [] });
    expect(await snapshot(root)).toEqual(before);
  });

  it("takes a translated copy of the source back as a new locale", async () => {
    const { root, dir } = await fixture();

    await exportStrings(root, dir);
    await writeJson(path.join(dir, "de.json"), {
      "hud.title": { text: "Aufträge", source: "Orders" },
      "orders.coins": { text: "Belohnung: {n, number} Münzen", source: "Reward" }
    });

    const report = await importStrings(root, dir);

    expect(report).toEqual({
      locales: ["de", "en", "ru"],
      keys: 2,
      files: ["features/hud/strings/de.json", "features/orders/strings/de.json"]
    });
    expect(await readFile(stringFile(root, "hud", "de"), "utf8")).toBe(
      jsonText({ "hud.title": "Aufträge" })
    );
  });

  it("compiles into the generated folder of the root after writing", async () => {
    const { root, dir } = await fixture();

    await writeJson(path.join(dir, "ru.json"), { "hud.title": { text: "Список заказов" } });
    await importStrings(root, dir);

    const russian = evaluateModule(
      await readFile(path.join(root, "generated", "strings.ru.ts"), "utf8")
    );

    expect(russian["hud.title"]?.({}, createIntlKit("ru"))).toEqual([
      { kind: "text", text: "Список заказов" }
    ]);
  });

  it("compiles into the folder it is told, with the pseudo-locale on request", async () => {
    const { root, dir } = await fixture();
    const out = path.join(root, "src", "generated");

    await writeJson(path.join(dir, "ru.json"), { "hud.title": { text: "Список заказов" } });
    await importStrings(root, dir, { out, pseudo: true });

    const generated = await readdir(out);

    expect(generated.toSorted()).toEqual([
      "strings.en-XA.ts",
      "strings.en.ts",
      "strings.ru.ts",
      "strings.ts"
    ]);
    await expect(readdir(path.join(root, "generated"))).rejects.toThrow();
  });

  it("names an unknown key", async () => {
    const { root, dir } = await fixture();
    const file = path.join(dir, "ru.json");

    await writeJson(file, { "hud.delivr": { text: "Сдать" } });

    await expect(importStrings(root, dir)).rejects.toThrow(
      `[game] i18n: "hud.delivr" in ${file} is not a key of this game.\n` +
        "  Fix the file and import again."
    );
  });

  it.each([
    ["a string", '"Сдать"'],
    ["an object without text", '{ "source": "Deliver" }'],
    ["a text that is not a string", '{ "text": 3 }'],
    ["null", "null"]
  ])("names an entry that is %s", async (_shape, entry) => {
    const { root, dir } = await fixture();
    const file = path.join(dir, "ru.json");

    await writeJson(file, `{ "hud.deliver": ${entry} }\n`);

    await expect(importStrings(root, dir)).rejects.toThrow(
      `[game] i18n: "hud.deliver" in ${file}: an entry is { "text": string }.\n` +
        "  Fix the file and import again."
    );
  });

  it("lists every problem in one error and writes nothing", async () => {
    const { root, dir } = await fixture();
    const file = path.join(dir, "ru.json");
    const before = await snapshot(root);

    await writeJson(file, {
      "hud.delivr": { text: "Сдать" },
      "hud.bonus": { text: "Бонус" },
      "hud.deliver": "Сдать",
      "hud.title": { text: "Заказы {n, number, currency}" }
    });

    const failure = await importStrings(root, dir).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toBe(
      "Error: [game] i18n: the import found 3 problems.\n" +
        `  "hud.delivr" in ${file} is not a key of this game.\n` +
        `  "hud.deliver" in ${file}: an entry is { "text": string }.\n` +
        `  "hud.title" in ${file}: the number style "currency" is not supported.\n` +
        "  Fix the files and import again."
    );
    expect(await snapshot(root)).toEqual(before);
  });

  it("writes nothing when one imported text does not parse", async () => {
    const { root, dir } = await fixture();
    const file = path.join(dir, "ru.json");
    const before = await snapshot(root);

    await writeJson(file, { "hud.deliver": { text: "Сдать" }, "hud.title": { text: "Заказы {" } });

    await expect(importStrings(root, dir)).rejects.toThrow(`"hud.title" in ${file}: `);
    expect(await snapshot(root)).toEqual(before);
  });

  it("names an import file that is not an object of entries", async () => {
    const { root, dir } = await fixture();
    const file = path.join(dir, "ru.json");

    await writeJson(file, '["hud.title"]\n');

    await expect(importStrings(root, dir)).rejects.toThrow(
      `[game] i18n: ${file}: an import file is an object of key to entry.\n` +
        "  Fix the file and import again."
    );
  });

  it("names an import file it could not read", async () => {
    const { root, dir } = await fixture();
    const file = path.join(dir, "ru.json");

    await writeJson(file, "{ not json\n");

    await expect(importStrings(root, dir)).rejects.toThrow(`${file} could not be read`);
  });

  it("names a folder it could not read", async () => {
    const { root, dir } = await fixture();

    await expect(importStrings(root, dir)).rejects.toThrow(
      `[game] i18n: the folder ${dir} could not be read`
    );
  });

  it("keeps the files written when the compile after them finds a problem", async () => {
    const { root, dir } = await fixture();

    await writeJson(path.join(dir, "ru.json"), {
      "hud.orders": { text: "{n, select, few {Несколько} other {Много}}" }
    });

    await expect(importStrings(root, dir)).rejects.toThrow(
      '"hud.orders": the parameter "n" is a number in features/hud/strings/en.json ' +
        "and a select in features/hud/strings/ru.json."
    );
    expect(await readFile(stringFile(root, "hud", "ru"), "utf8")).toContain("Несколько");
  });
});

/** The layer of the layer tests: `shared/` keeps the `ui.*` keys. */
const LAYERS = { shared: "ui" };

/**
 * The fixture game with a `shared/` layer that brings one English key.
 *
 * @returns The game source root and a folder for the translation files.
 */
async function layeredFixture(): Promise<{ root: string; dir: string }> {
  const game = await fixture();

  await writeJson(path.join(game.root, "shared", "strings", "en.json"), { "ui.ok": "OK" });

  return game;
}

describe("exchange with layers", () => {
  it("exports the keys of a layer with the rest", async () => {
    const { root, dir } = await layeredFixture();
    const report = await exportStrings(root, dir, { layers: LAYERS });
    const russian: unknown = JSON.parse(await readFile(path.join(dir, "ru.json"), "utf8"));

    expect(report.missing).toEqual({ en: 0, ru: 4 });
    expect(russian).toMatchObject({ "ui.ok": { text: "", source: "OK" } });
  });

  it("exports no key of a layer by default", async () => {
    const { root, dir } = await layeredFixture();

    await exportStrings(root, dir);

    expect(await readFile(path.join(dir, "ru.json"), "utf8")).not.toContain("ui.ok");
  });

  it("imports a translated layer text into the layer's string file and reports that path", async () => {
    const { root, dir } = await layeredFixture();

    await writeJson(path.join(dir, "ru.json"), { "ui.ok": { text: "ОК" } });

    const report = await importStrings(root, dir, { layers: LAYERS });
    const russian = evaluateModule(
      await readFile(path.join(root, "generated", "strings.ru.ts"), "utf8")
    );

    expect(report).toEqual({ locales: ["ru"], keys: 1, files: ["shared/strings/ru.json"] });
    expect(await readFile(path.join(root, "shared", "strings", "ru.json"), "utf8")).toBe(
      jsonText({ "ui.ok": "ОК" })
    );
    expect(russian["ui.ok"]?.({}, createIntlKit("ru"))).toEqual([{ kind: "text", text: "ОК" }]);
  });

  it("keeps a feature's file and a layer's file apart on import", async () => {
    const { root, dir } = await layeredFixture();

    await writeJson(path.join(dir, "ru.json"), {
      "hud.title": { text: "Список заказов" },
      "ui.ok": { text: "ОК" }
    });

    const report = await importStrings(root, dir, { layers: LAYERS });

    expect(report).toEqual({
      locales: ["ru"],
      keys: 2,
      files: ["features/hud/strings/ru.json", "shared/strings/ru.json"]
    });
    expect(await readFile(stringFile(root, "hud", "ru"), "utf8")).toContain("Список заказов");
    expect(await readFile(path.join(root, "shared", "strings", "ru.json"), "utf8")).not.toContain(
      "hud.title"
    );
  });

  it("refuses a layer folder that leads out of the root: the import writes nothing there", async () => {
    const outside = await createFolder();
    const root = path.join(outside, "game");
    const dir = path.join(outside, "translations");
    const other = path.join(outside, "other", "strings");

    await writeJson(stringFile(root, "hud", "en"), { "hud.title": "Orders" });
    await writeJson(path.join(other, "en.json"), { "ui.ok": "OK" });
    await writeJson(path.join(dir, "ru.json"), { "ui.ok": { text: "ОК" } });

    await expect(importStrings(root, dir, { layers: { "../other": "ui" } })).rejects.toThrow(
      '[game] i18n: the layer "../other" is not a folder name.\n' +
        String.raw`  Use a name without "/", "\" or ".".`
    );
    await expect(exportStrings(root, dir, { layers: { "../other": "ui" } })).rejects.toThrow(
      'the layer "../other" is not a folder name.'
    );
    expect(await readdir(other)).toEqual(["en.json"]);
  });

  it("writes into the features folder the options name", async () => {
    const root = await createFolder();
    const dir = path.join(await createFolder(), "translations");

    await writeJson(path.join(root, "mods", "hud", "strings", "en.json"), {
      "hud.title": "Orders"
    });
    await writeJson(path.join(dir, "ru.json"), { "hud.title": { text: "Заказы" } });

    const report = await importStrings(root, dir, { features: "mods" });

    expect(report.files).toEqual(["mods/hud/strings/ru.json"]);
    expect(await readFile(path.join(root, "mods", "hud", "strings", "ru.json"), "utf8")).toBe(
      jsonText({ "hud.title": "Заказы" })
    );
  });
});
