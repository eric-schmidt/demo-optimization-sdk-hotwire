import { raw } from "hono/html";
import type { Child } from "hono/jsx";

export const LOCALE = "en-US";

/** DOM id of the block container. Turbo Streams morph into this element. */
export const PAGE_BLOCKS_ID = "page-blocks";

type LayoutProps = {
  children?: Child;
  /** When true, mount the Live Preview controller and load its bundle. */
  draft?: boolean;
  /**
   * The landingPage entries, serialised for the browser. The Live Preview SDK
   * patches this graph in place and hands the result back to us, so it must be
   * the untransformed CPA response — the SDK matches on its original structure.
   */
  livePreviewData?: unknown;
};

/**
 * Embed JSON for the browser.
 *
 * `raw()` is required because hono/jsx escapes text children, and HTML entities
 * are not decoded inside <script>, so escaping would corrupt the JSON. Escaping
 * `<` to its JSON unicode form instead is what prevents a `</script>` breakout.
 */
const jsonScript = (data: unknown) =>
  raw(JSON.stringify(data).replace(/</g, "\\u003c"));

export const Layout = ({ children, draft = false, livePreviewData }: LayoutProps) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Demo - Live Preview (Hotwire)</title>
      <meta name="description" content="Contentful Live Preview on Hotwire" />
      <link rel="icon" href="/favicon.ico" />

      {/* Replaces next/font/google. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"
      />

      <link rel="stylesheet" href="/assets/app.css" />

      {/*
        Turbo Drive keeps a client-side page cache that the Next.js app never had.
        Without this, an editor navigating back would see a flash of stale draft
        content restored from that cache.
      */}
      {draft && <meta name="turbo-cache-control" content="no-cache" />}

      <script type="module" src="/assets/app.js"></script>
      {draft && <script type="module" src="/assets/live-preview.js"></script>}
    </head>
    <body>
      <main class="flex min-h-screen flex-col items-center justify-between p-12 md:p-24">
        <div
          id={PAGE_BLOCKS_ID}
          class="z-10 w-full max-w-5xl items-center justify-between text-sm lg:flex flex-col"
          {...(draft
            ? {
                "data-controller": "live-preview",
                "data-live-preview-locale-value": LOCALE,
              }
            : {})}
        >
          {children}
        </div>

        {/*
          Kept as a sibling of the morph target rather than a child: the Turbo
          Stream replaces that element's children, which would otherwise delete
          this script. Sitting in <body> (not <head>) means Turbo replaces it on
          navigation instead of merging duplicates.
        */}
        {draft && livePreviewData !== undefined && (
          <script type="application/json" data-live-preview-data>
            {jsonScript(livePreviewData)}
          </script>
        )}
      </main>

      {/*
        Leaving preview mode is a state change, so it is a real form and submit
        button rather than a link. Two reasons this matters in a Hotwire app:
        Turbo 8 prefetches links on hover, which would fire a stateful GET without
        a click; and Turbo's own docs prefer forms and buttons over
        data-turbo-method for accessibility. `_method` is unwrapped by
        hono/method-override so this reaches `DELETE /preview`.
      */}
      {draft && (
        <form method="post" action="/preview" class="fixed bottom-4 right-4 z-50">
          <input type="hidden" name="_method" value="delete" />
          <button
            type="submit"
            class="btn bg-black text-white shadow-lg"
            data-turbo-submits-with="Exiting…"
          >
            Exit preview
          </button>
        </form>
      )}
    </body>
  </html>
);
