import { Hono } from "hono";
import { BlockList } from "../components/ComponentResolver";
import { Layout } from "../views/Layout";
import { NotFound } from "../views/NotFound";
import { blocksFromPages } from "../lib/blocks";
import { PROFILES, lastOutcome } from "../lib/cache";
import { getEntriesBySlug } from "../lib/contentful";
import { isDraft } from "../lib/draft";

// Port of src/app/[slug]/page.jsx.
//
// The <Suspense fallback={null}> boundary the Next.js version needed is gone: it
// existed because Cache Components requires any request-time read to sit inside
// one, not for any UX reason. Hotwire's equivalent for genuinely deferred content
// is <turbo-frame loading="lazy">, which nothing here needs.

export const pageRoutes = new Hono();

// `/` was untouched create-next-app boilerplate (Next.js + Vercel logos, the
// Docs/Learn/Deploy cards) and nested a second <main>. Porting Next.js marketing
// chrome into a Hotwire demo would undercut the point, so it redirects to the
// only slug that exists.
pageRoutes.get("/", (c) => c.redirect("/home", 302));

pageRoutes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const preview = isDraft(c);

  const landingPages = await getEntriesBySlug({
    preview,
    contentType: "landingPage",
    slug,
    includeDepth: 4,
  });

  if (landingPages.length === 0) {
    return c.html(Layout({ children: NotFound() }) as never, 404);
  }

  const blocks = blocksFromPages(landingPages);

  if (preview) {
    // The Preview API must never be cached, by us or by anything downstream.
    c.header("Cache-Control", "private, no-store");
  } else {
    console.log(`[cache] ${lastOutcome} landingPage:${slug}`);
    c.header(
      "Cache-Control",
      `public, max-age=${PROFILES.contentful.stale}, stale-while-revalidate=${
        PROFILES.contentful.revalidate - PROFILES.contentful.stale
      }`,
    );
  }

  return c.html(
    Layout({
      draft: preview,
      livePreviewData: preview ? landingPages : undefined,
      children: BlockList({ blocks }),
    }) as never,
  );
});
