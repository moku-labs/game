/** P15 spike: the native packager as a library. `bun scripts/native.ts doctor|build`. */
import { createApp } from "@moku-labs/native";

const native = createApp({
  config: {
    app: { name: "P15Fixture", identifier: "dev.moku.spike.p15" },
    web: { build: "bun run build:web", devCommand: "true", devUrl: "http://localhost:5173", dist: "dist" },
    system: [],
    targets: ["ios"]
  }
});

const verb = process.argv[2] ?? "doctor";
await native.start();
if (verb === "doctor") await native.cli.doctor({ target: "ios" });
else await native.cli.build({ target: "ios", simulator: true });
await native.stop();
