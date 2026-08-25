// Builds the browser bundles that Next.js used to produce implicitly.
//
// Two separate entry points, deliberately:
//
//   assets/app.js          Turbo + Stimulus. Loaded on every page.
//   assets/live-preview.js The Live Preview SDK + its Stimulus controller.
//                          Loaded ONLY on draft renders.
//
// This split is the whole point of ADR 0002, achieved structurally rather than
// through a compiler directive: a visitor hitting a published page never
// downloads @contentful/live-preview at all.

import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

const dev = process.argv.includes("--dev");

await mkdir("public/assets", { recursive: true });

const shared = {
  bundle: true,
  format: "esm",
  target: ["es2022"],
  platform: "browser",
  minify: !dev,
  sourcemap: dev,
  logLevel: "info",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: { app: "src/client/index.ts" },
    outdir: "public/assets",
  }),
  build({
    ...shared,
    entryPoints: { "live-preview": "src/client/live-preview.ts" },
    outdir: "public/assets",
    // Turbo is already on window from app.js — don't ship it twice.
    external: ["@hotwired/turbo"],
  }),
]);
