import { defineConfig } from "vitest/config";

// Spike-only config: the repo projects do not collect spikes/.
export default defineConfig({
  test: {
    root: new URL("../..", import.meta.url).pathname,
    include: ["spikes/p17-stack-trace/*.probe.ts"],
    testTimeout: 60_000
  }
});
