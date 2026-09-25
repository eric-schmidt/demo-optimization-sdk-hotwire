import { Hono } from "hono";
import { getPersonalizationEntries } from "../lib/contentful";
import { describeTimelineFailure } from "../lib/timeline";
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

  // Scoped to the release the page itself was rendered from, forwarded by the
  // browser off the current URL. Without this the panel would offer the CURRENT
  // audiences and experiences against a page built from release content, so a
  // forced audience could name a variant the page has no entry for.
  const timeline = c.get("timeline");

  try {
    const entries = await getPersonalizationEntries({ timeline });
    return c.json(entries, 200, { "Cache-Control": "private, no-store" });
  } catch (error) {
    // Same degradation as the page render: a stale release id makes the Preview
    // API answer 404, and losing the whole panel over it is worse than showing it
    // with current-content audiences. Only the release scope is retried, so a
    // genuine outage still reaches the 502 below.
    if (timeline) {
      console.warn(
        `[timeline] release scope rejected for panel entries; retrying un-scoped: ${describeTimelineFailure(error)}`,
      );
      try {
        const entries = await getPersonalizationEntries();
        return c.json(entries, 200, { "Cache-Control": "private, no-store" });
      } catch (retryError) {
        console.error("[optimization] could not load panel entries", retryError);
        return c.text("Could not load personalization entries", 502);
      }
    }
    console.error("[optimization] could not load panel entries", error);
    return c.text("Could not load personalization entries", 502);
  }
});
