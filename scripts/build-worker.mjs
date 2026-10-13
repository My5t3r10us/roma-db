import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir("companion", { recursive: true });
await build({
  entryPoints: ["backend/worker.ts"],
  outfile: "companion/worker.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: false,
});
