import { Hono } from "hono";
import { BlockList } from "../components/ComponentResolver";
import { Layout } from "../views/Layout";
import { NotFound } from "../views/NotFound";
import { blocksFromPages } from "../lib/blocks";
import { getEntriesBySlug } from "../lib/contentful";
import type { AppEnv } from "../lib/types";

// Port of src/app/[slug]/page.jsx.
//
// The <Suspense fallback={null}> boundary the Next.js version needed is gone: it
// existed because Cache Components requires any request-time read to sit inside
// one, not for any UX reason. Hotwire's equivalent for genuinely deferred content
// is <turbo-frame loading="lazy">, which nothing here needs.

export const pageRoutes = new Hono<AppEnv>();

// `/` was untouched create-next-app boilerplate (Next.js + Vercel logos, the
// Docs/Learn/Deploy cards) and nested a second <main>. Porting Next.js marketing
// chrome into a Hotwire demo would undercut the point, so it redirects to the
// only slug that exists.
pageRoutes.get("/", (c) => c.redirect("/home", 302));

pageRoutes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  // Resolved once per request by the middleware in server.ts.
  const preview = c.get("preview");

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

  // Nothing is cached server-side, so tell the browser not to cache either.
  // Otherwise a reload could be answered from the browser's own cache and a
  // freshly-saved entry would appear not to have changed.
  c.header("Cache-Control", "no-store");

  return c.html(
    Layout({
      draft: preview,
      livePreviewData: preview ? landingPages : undefined,
      children: BlockList({ blocks }),
    }) as never,
  );
});
