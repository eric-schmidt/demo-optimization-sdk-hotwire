import { Hono } from "hono";
import { getPersonalizationEntries } from "../lib/contentful";
import type { AppEnv } from "../lib/types";

// The preview panel's data feed.
//
// The panel accepts either a Contentful client or pre-fetched entries. This app
// serves entries, for one reason worth preserving: it currently ships ZERO
// Contentful credentials to the browser, and handing the panel a client would end
// that. The panel's own documentation blesses this path for server-rendered apps.
//
// A JSON endpoint rather than JSON embedded in the page, because these are two
// include-resolved collections that would otherwise be re-serialised into every
// draft response — including on each keystroke-driven Turbo navigation.

export const optimizationRoutes = new Hono<AppEnv>();

optimizationRoutes.get("/preview/optimization-entries", async (c) => {
  // Same gate as /preview/render. This is authoring data, not visitor data.
  if (!c.get("preview")) {
    return c.text("Preview mode required", 403);
  }

  try {
    const entries = await getPersonalizationEntries();
    return c.json(entries, 200, { "Cache-Control": "private, no-store" });
  } catch (error) {
    console.error("[optimization] could not load panel entries", error);
    return c.text("Could not load personalization entries", 502);
  }
});
