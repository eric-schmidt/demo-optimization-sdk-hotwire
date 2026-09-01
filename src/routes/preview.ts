import { Hono } from "hono";
import { BlockList } from "../components/ComponentResolver";
import { PAGE_BLOCKS_ID } from "../views/Layout";
import { blocksFromPages } from "../lib/blocks";
import { getEntriesBySlug } from "../lib/contentful";
import { resolveBlocks } from "../lib/optimization-render";
import { disablePreview, enablePreview, secretsMatch } from "../lib/preview";
import type { AppEnv, LandingPage } from "../lib/types";
import type { SelectedOptimizationArray } from "@contentful/optimization-node/core-sdk";

// The `preview` resource. In Rails terms this is a PreviewsController with
// create / destroy plus one member action, routed as a singular resource:
//
//   GET    /preview          enter preview mode   (create)
//   DELETE /preview          leave preview mode   (destroy)
//   POST   /preview/render   re-render blocks as a Turbo Stream
//
// Deliberately NOT under /api. In a Hotwire app `/api/*` means a JSON API for
// external consumers; these are ordinary controller actions that drive browser
// navigation and return HTML. The Next.js original used /api/draft only because
// App Router route handlers live in app/api/.

export const previewRoutes = new Hono<AppEnv>();

/**
 * Content types this endpoint is allowed to look up. The Next.js version passed
 * `?type=` straight into a CDA query, so the content type was caller-controlled.
 */
const ALLOWED_TYPES = new Set(["landingPage"]);

/**
 * Enter preview mode.
 *
 * GET is normally the wrong verb for something that mutates state, and Turbo 8
 * prefetches links on hover, which makes stateful GETs genuinely dangerous inside
 * an app. It is correct here for one reason: the request does not originate from a
 * link in this app at all — Contentful opens the Content Preview URL directly as a
 * top-level navigation, so the verb is not ours to choose. This is the same shape
 * as a Rails magic-link or email-confirmation route, and the unguessable secret is
 * what makes it safe. No page in this app ever links here, so prefetch cannot
 * reach it.
 */
previewRoutes.get("/preview", async (c) => {
  const secret = c.req.query("secret");
  const type = c.req.query("type") ?? "landingPage";
  const slug = c.req.query("slug");

  // This secret should only be known to this route handler and the CMS.
  const expected = process.env.CONTENTFUL_PREVIEW_SECRET;
  if (!expected || !secretsMatch(secret, expected) || !slug) {
    return c.text("Invalid token", 401);
  }

  if (!ALLOWED_TYPES.has(type)) {
    return c.text("Invalid type", 400);
  }

  const entries = await getEntriesBySlug({ preview: true, contentType: type, slug });

  // If the slug doesn't exist prevent preview mode from being enabled.
  const target = entries[0]?.fields?.slug;
  if (!entries.length || !target) {
    return c.text("Invalid slug", 401);
  }

  enablePreview(c);

  // Redirect to the path from the fetched entry, not the slug query parameter,
  // which would be an open redirect. 302 is the conventional status for a
  // redirect following a GET.
  return c.redirect(`/${target}`, 302);
});

/**
 * Leave preview mode.
 *
 * DELETE rather than GET, reached from a real form and submit button in the
 * layout. Turbo Drive requires a 303 See Other after a non-GET request so the
 * browser reissues the follow-up as a GET.
 */
previewRoutes.delete("/preview", (c) => {
  disablePreview(c);
  return c.redirect("/", 303);
});

const TURBO_STREAM_MIME = "text/vnd.turbo-stream.html";

/** hono/jsx nodes stringify to HTML; async children would yield a promise. */
const renderNode = async (node: unknown): Promise<string> => {
  const rendered = (node as { toString: () => string | Promise<string> }).toString();
  return typeof rendered === "string" ? rendered : await rendered;
};

/**
 * The body this endpoint accepts.
 *
 * The object form carries the full authoring state — the patched entry graph AND
 * the currently forced audience — so a field edit cannot drop a panel override and
 * vice versa. The bare-array/object form is the original contract and still works.
 */
type RenderPayload =
  | LandingPage
  | LandingPage[]
  | {
      pages: LandingPage | LandingPage[];
      selectedOptimizations?: SelectedOptimizationArray;
    };

const normalisePayload = (payload: RenderPayload) => {
  if (payload && !Array.isArray(payload) && "pages" in payload) {
    const { pages, selectedOptimizations } = payload;
    return {
      pages: Array.isArray(pages) ? pages : [pages],
      selectedOptimizations,
    };
  }

  return {
    pages: Array.isArray(payload) ? payload : [payload],
    selectedOptimizations: undefined,
  };
};

/**
 * Re-render the blocks from a patched entry graph and reply with a Turbo Stream.
 *
 * This is the piece with no Next.js counterpart, because useContentfulLiveUpdates
 * is a React hook and there is no client renderer here to replace it with. The
 * Stimulus controller receives the Live Preview SDK's patched data and posts it
 * here; the server re-renders through the SAME resolver the initial page used. So
 * templates live in exactly one place, which is the point of Hotwire.
 *
 * Turbo Streams are usually the response to a form submission. Reaching one from
 * `fetch()` + `Turbo.renderStreamMessage()` is the documented path for updates
 * that originate in the browser rather than from a user-submitted form, which is
 * the case here: the trigger is a postMessage from the Contentful editor.
 */
previewRoutes.post("/preview/render", async (c) => {
  // This endpoint renders caller-supplied JSON into HTML, so it must never be
  // reachable outside preview mode. The same gate now also covers caller-supplied
  // selections, which are strictly less powerful than the entry graph it already
  // accepted: a selection can only pick among variants already present in the
  // posted graph. No Experience API write, no server-side fetch, no id the caller
  // did not already send.
  if (!c.get("preview")) {
    return c.text("Preview mode required", 403);
  }

  let payload: RenderPayload;
  try {
    payload = await c.req.json<RenderPayload>();
  } catch {
    return c.text("Invalid JSON body", 400);
  }

  const { pages, selectedOptimizations } = normalisePayload(payload);
  // Resolution is local and pure, so this endpoint still makes ZERO Contentful
  // requests: the posted graph already contains every variant. That matters —
  // re-fetching per keystroke would run straight into the 14 req/s CPA limit.
  const blocks = resolveBlocks(blocksFromPages(pages), selectedOptimizations);
  const html = await renderNode(BlockList({ blocks }));

  // One `update` on the container rather than a `replace` per block: `update`
  // swaps children, and `morph` patches them in place by id. That covers field
  // edits, reordering, additions and removals in a single stream, and preserves
  // scroll position and the inspector-mode overlay across a keystroke.
  const stream =
    `<turbo-stream action="update" method="morph" target="${PAGE_BLOCKS_ID}">` +
    `<template>${html}</template>` +
    `</turbo-stream>`;

  return c.body(stream, 200, {
    "Content-Type": `${TURBO_STREAM_MIME}; charset=utf-8`,
    "Cache-Control": "private, no-store",
  });
});
