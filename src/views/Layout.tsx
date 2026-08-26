import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { LOCALE } from "../lib/locale";
import { DemoControls } from "./DemoControls";
import type { ConsentDecision } from "../lib/consent";

// Re-exported for the many call sites that already import LOCALE from here.
// It is declared in lib/locale so server-side libraries can read it without
// pulling in a JSX module.
export { LOCALE };

/** DOM id of the block container. Turbo Streams morph into this element. */
export const PAGE_BLOCKS_ID = "page-blocks";

/**
 * Everything the browser needs to run personalization. Absent when
 * CONTENTFUL_OPTIMIZATION_CLIENT is unset, in which case no bundle is emitted at
 * all and the page behaves exactly as it did before personalization existed.
 */
type PersonalizationProps = {
  /** Public browser credential, like an analytics id. */
  clientId: string;
  environment: string;
  /** Stable route identity for browser-side page-event deduplication. */
  routeKey: string;
  /** Lets the draft bridge tell "the server already rendered this" from a change. */
  selectionFingerprint: string;
  /**
   * The CMP decision this render used, forwarded so the browser SDK starts from
   * the same answer the server did instead of defaulting to something else.
   */
  consent: ConsentDecision;
  demoControls: boolean;
  /**
   * Server-rendered optimization state. Carries `initialPageEvent: "skip"`, which
   * is what stops the browser re-emitting the page event the server already sent.
   * Undefined on draft renders, which emit no page event.
   */
  handoff?: unknown;
};

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
  personalization?: PersonalizationProps;
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

export const Layout = ({
  children,
  draft = false,
  livePreviewData,
  personalization,
}: LayoutProps) => (
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
      {/*
        Also applied to personalized renders, not just draft ones: Turbo's page
        cache would otherwise restore HTML personalized for one audience and show
        it to another after a back navigation. Correctness over instant restore.
      */}
      {(draft || personalization !== undefined) && (
        <meta name="turbo-cache-control" content="no-cache" />
      )}

      <script type="module" src="/assets/app.js"></script>
      {draft && <script type="module" src="/assets/live-preview.js"></script>}

      {/*
        Exactly ONE optimization bundle per page, never both — constructing the
        Web SDK twice throws "ContentfulOptimization is already initialized".
        The draft bundle additionally carries the preview panel, which must share
        a single copy of optimization-core with the SDK to reach its signals, and
        which must never ship to a published visitor.
      */}
      {personalization !== undefined && (
        <script
          type="module"
          src={draft ? "/assets/optimization-preview.js" : "/assets/optimization.js"}
        ></script>
      )}
    </head>
    <body>
      {/*
        The optimization controllers mount on <main>, deliberately: it sits inside
        <body>, so Turbo Drive replaces it on every navigation and the controller
        reconnects — which is what makes connect() the page-event hook. It is also
        OUTSIDE #page-blocks, so a Turbo Stream morph of the blocks cannot tear the
        SDK down mid-session.
      */}
      <main
        class="flex min-h-screen flex-col items-center justify-between p-12 md:p-24"
        {...(personalization !== undefined
          ? {
              "data-controller": draft ? "optimization-panel" : "optimization",
              "data-optimization-client-id-value": personalization.clientId,
              "data-optimization-environment-value": personalization.environment,
              "data-optimization-locale-value": LOCALE,
              "data-optimization-route-key-value": personalization.routeKey,
              "data-optimization-consent-events-value": String(
                personalization.consent.events,
              ),
              "data-optimization-consent-persistence-value": String(
                personalization.consent.persistence,
              ),
              // "recorded" is deliberately distinct from a decision of false: it
              // lets the browser seed consent as `undefined` (not yet asked)
              // rather than asserting the visitor declined.
              "data-optimization-consent-recorded-value": String(
                personalization.consent.recorded,
              ),
              "data-optimization-demo-controls-value": String(
                personalization.demoControls,
              ),
              "data-optimization-panel-client-id-value": personalization.clientId,
              "data-optimization-panel-environment-value": personalization.environment,
              "data-optimization-panel-locale-value": LOCALE,
              "data-optimization-panel-fingerprint-value":
                personalization.selectionFingerprint,
            }
          : {})}
      >
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

        {/*
          The optimization handoff: the profile and selections this render used.
          The browser adopts them instead of asking the Experience API again, so a
          page view costs exactly one Experience API call no matter how many
          runtimes are involved. Re-serialised on every Turbo navigation because
          Turbo replaces <body>, which is what keeps it in step with the DOM.
        */}
        {personalization?.handoff !== undefined && (
          <script type="application/json" data-optimization-handoff>
            {jsonScript(personalization.handoff)}
          </script>
        )}
        {personalization?.demoControls && !draft && <DemoControls />}
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
