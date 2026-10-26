/**
 * @file The child of the plain-Bun test in `app-keys.test.ts`: runs `watchKeys` on a copy of the
 * mini game outside vitest's module runner, saves the interface's bundle description twice, and
 * prints the tier the manifest holds after each save as one JSON line, `["lazy","feature"]` when
 * every save was read. Run as `bun keys-watch-child.ts <game> <wait ms>`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { watchKeys } from "../../src/cli";

/** How often the child looks at the manifest while it waits for a scan. */
const POLL_MS = 100;

const [root = "", waitText = "8000"] = process.argv.slice(2);
const waitMs = Number(waitText);
const description = path.join(root, "features/ui/assets.ts");

/**
 * The tier of the interface's bundle in the dev manifest.
 *
 * @returns The tier.
 */
function tier(): string {
  const manifest = JSON.parse(readFileSync(path.join(root, "generated/manifest.json"), "utf8")) as {
    bundles: Record<string, { tier: string }>;
  };

  return manifest.bundles.ui?.tier ?? "";
}

/**
 * Saves the description with another tier and waits until the manifest shows it, or the wait ends.
 *
 * @param from - The tier the description has.
 * @param to - The tier it gets.
 * @returns The tier the manifest holds after the wait.
 */
async function save(from: string, to: string): Promise<string> {
  const text = readFileSync(description, "utf8");

  writeFileSync(description, text.replace(`{ tier: "${from}" }`, `{ tier: "${to}" }`));

  for (let waited = 0; waited < waitMs && tier() !== to; waited += POLL_MS) {
    await Bun.sleep(POLL_MS);
  }

  return tier();
}

const keys = await watchKeys(root);
const tiers = [await save("boot", "lazy"), await save("lazy", "feature")];

keys.close();
console.log(JSON.stringify(tiers));
