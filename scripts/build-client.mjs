// Builds the browser bundles that Next.js used to produce implicitly.
//
// Two separate entry points, deliberately:
//
//   assets/app.js                 Turbo + Stimulus. Loaded on every page.
//   assets/live-preview.js        The Live Preview SDK + its Stimulus controller.
//                                 Loaded ONLY on draft renders.
//   assets/optimization.js        Optimization Web SDK: tracking + track/identify.
//                                 Loaded on PUBLISHED renders only.
//   assets/optimization-preview.js The same SDK PLUS the preview panel and its
//                                 server bridge. Loaded on DRAFT renders only.
//
// This split is the whole point of ADR 0002, achieved structurally rather than
// through a compiler directive: a visitor hitting a published page never
// downloads @contentful/live-preview at all.
//
// The two optimization bundles are two entry FILES rather than one bundle behind a
// build-time flag, for two reasons. The preview panel must share a single copy of
// optimization-core with the SDK to reach its signals, so it cannot be split out.
// And it must never reach a published visitor. Because optimization.js never
// references the panel, it structurally cannot contain it — no reliance on
// dead-code elimination reaching through a dynamic import. Layout emits exactly
// one of the two, which matters: constructing the Web SDK twice throws.

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
  build({
    ...shared,
    entryPoints: { optimization: "src/client/optimization.ts" },
    outdir: "public/assets",
    external: ["@hotwired/turbo"],
  }),
  build({
    ...shared,
    entryPoints: { "optimization-preview": "src/client/optimization-preview.ts" },
    outdir: "public/assets",
    external: ["@hotwired/turbo"],
  }),
]);
