import { Hono } from "hono";
import { createRequestHandoffFromData } from "@contentful/optimization-node";
import { createSelectionFingerprint } from "@contentful/optimization-node/core-sdk";
import { BlockList } from "../components/ComponentResolver";
import { Layout } from "../views/Layout";
import { NotFound } from "../views/NotFound";
import { blocksFromPages } from "../lib/blocks";
import { getEntriesBySlug } from "../lib/contentful";
import {
  demoControlsEnabled,
  emitPageEvent,
  optimizationClientId,
  optimizationEnvironment,
  routeKeyFor,
} from "../lib/optimization";
import { resolveBlocks } from "../lib/optimization-render";
import { clearProfileId, writeProfileId } from "../lib/profile-cookie";
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

// Deep enough to resolve baseline -> nt_experiences -> nt_variants -> the variant
// entry -> its image mediaWrapper -> the asset.
//
// Measured: the current graph happens to resolve fully at 4, because the deepest
// ENTRY in that chain sits at level 4 and assets referenced by included entries
// are returned regardless of depth. That is one level of headroom, and a link
// left unresolved past the include depth resolves to BASELINE silently, with no
// error to point at. 10 removes the counting argument entirely and matches what
// the SDK's own managed fetching uses. Supersedes the include=4 invariant in
// docs/plans/2026-08-25-nextjs-to-hotwire-port.md §8.
const INCLUDE_DEPTH = 10;

pageRoutes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  // Both resolved once per request by the middleware in server.ts.
  const preview = c.get("preview");
  const requestOptimization = c.get("optimization");
  const consent = c.get("consent");

  // Concurrent on purpose: the content fetch and the Experience API call do not
  // depend on each other, so serialising them would add the round trip straight
  // onto the response time.
  //
  // allSettled rather than all: an Experience API failure must degrade to
  // baseline, never fail the page. emitPageEvent already swallows its own
  // errors, so this is belt-and-braces for anything thrown outside it.
  const [contentResult, optimizationResult] = await Promise.allSettled([
    getEntriesBySlug({
      preview,
      contentType: "landingPage",
      slug,
      includeDepth: INCLUDE_DEPTH,
    }),
    // Don't ask for what consent does not permit. The SDK would refuse the event
    // anyway (allowedEventTypes is []), but declining to call it keeps a routine
    // no-consent visit off the warning log and makes the policy explicit here
    // rather than implicit in the SDK's admission rules.
    consent.events ? emitPageEvent(requestOptimization) : Promise.resolve(undefined),
  ]);

  // A Contentful failure is still a 500, exactly as before personalization.
  if (contentResult.status === "rejected") throw contentResult.reason;
  const landingPages = contentResult.value;

  if (landingPages.length === 0) {
    return c.html(Layout({ children: NotFound() }) as never, 404);
  }

  const data =
    optimizationResult.status === "fulfilled"
      ? optimizationResult.value
      : undefined;
  const selectedOptimizations = data?.selectedOptimizations;

  // Profile continuity is the app's job — the SDK stores nothing. `canPersistProfile`
  // is derived from the persistence axis of the consent passed to forRequest(), so
  // this single condition already honours the CMP.
  if (requestOptimization?.canPersistProfile && requestOptimization.profile?.id) {
    writeProfileId(c, requestOptimization.profile.id);
  } else if (!consent.persistence) {
    // Withdrawn or never granted: actively remove any profile left from an
    // earlier visit rather than just declining to refresh it.
    clearProfileId(c);
  }

  const blocks = resolveBlocks(blocksFromPages(landingPages), selectedOptimizations);

  // Nothing is cached server-side, so tell the browser not to cache either.
  // Otherwise a reload could be answered from the browser's own cache and a
  // freshly-saved entry would appear not to have changed. With personalization
  // this is also a correctness requirement: a cached response is one audience's
  // content, and it must not be replayed for another.
  c.header("Cache-Control", "no-store");

  return c.html(
    Layout({
      draft: preview,
      livePreviewData: preview ? landingPages : undefined,
      // Absent on draft renders: no page event was emitted, so there is no
      // state to hand off and no tracking to do.
      personalization: optimizationClientId
        ? {
            clientId: optimizationClientId,
            environment: optimizationEnvironment,
            routeKey: routeKeyFor(c),
            consent,
            selectionFingerprint: createSelectionFingerprint(selectedOptimizations),
            demoControls: demoControlsEnabled,
            // `initialPageEvent: "skip"` is the contract that stops the browser
            // re-emitting the page event this request already sent. The SDK
            // validates both fields and throws if either is missing.
            handoff: preview
              ? undefined
              : {
                  ...createRequestHandoffFromData({ data }),
                  hydration: "preserve-server",
                  initialPageEvent: "skip",
                },
          }
        : undefined,
      children: BlockList({ blocks }),
    }) as never,
  );
});
