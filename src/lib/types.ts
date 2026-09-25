import type { CoreStatelessRequest } from "@contentful/optimization-node/core-sdk";
import type { ConsentDecision } from "./consent";
import type { TimelineScope } from "./timeline";

// Shapes of the Contentful entries this demo renders.
//
// Deliberately loose: Preview API responses can carry unresolved links and
// partially-filled entries, and the Live Preview SDK patches this data in the
// browser before handing it back to us. Optional-everything is honest here.

export type ContentfulSys = {
  id: string;
  type?: string;
  contentType?: { sys: { id: string } };
};

export type ContentfulAsset = {
  sys: ContentfulSys;
  fields?: {
    title?: string;
    file?: {
      url?: string;
      contentType?: string;
      details?: { image?: { width?: number; height?: number } };
    };
  };
};

/**
 * The `mediaWrapper` content type. Note that `alternativeText` lives HERE, on
 * the wrapper entry — not on the asset's `file` object. The Next.js app read
 * `image.fields.media.fields.file.alternativeText`, which is always undefined,
 * so every `alt` rendered empty. See docs/plans/2026-08-25-nextjs-to-hotwire-port.md §5.
 */
export type MediaWrapper = {
  sys: ContentfulSys;
  fields?: {
    adminTitle?: string;
    media?: ContentfulAsset;
    alternativeText?: string;
  };
};

/** Shared field shape of the `hero` and `duplex` content types. */
export type BlockFields = {
  adminTitle?: string;
  heading?: string;
  copy?: string;
  image?: MediaWrapper;
  /**
   * Added to `hero` and `duplex` by the Contentful Personalization app. Left
   * deliberately untyped: the SDK validates its shape structurally, and a local
   * mirror of the nt_* schema would rot without ever being read by this app.
   */
  nt_experiences?: unknown;
};

export type BlockEntry = {
  sys: ContentfulSys;
  fields?: BlockFields;
  /**
   * Present on every CDA response. The Optimization SDK's entry type guard
   * requires it (`isRecord(metadata)`), so an entry without it resolves to
   * baseline — which is why scripts/smoke.tsx fixtures must include it.
   */
  metadata?: { tags?: unknown[]; concepts?: unknown[] };
};

export type LandingPage = {
  sys: ContentfulSys;
  /** See BlockEntry.metadata — every CDA entry carries it. */
  metadata?: { tags?: unknown[]; concepts?: unknown[] };
  fields?: {
    adminTitle?: string;
    slug?: string;
    hero?: BlockEntry;
    content?: BlockEntry[];
  };
};

/** Props every mapped content component receives from the resolver. */
export type BlockProps = {
  fields: BlockFields;
  /** DOM id used as the Turbo morph anchor for this block. */
  id: string;
  /**
   * `data-ctfl-*` attributes the Web SDK observes for view/click tracking.
   * Spread these onto the component's root element. A component that forgets to
   * is invisible to Insights — scripts/smoke.tsx asserts every mapped type
   * emits `data-ctfl-entry-id`.
   */
  trackingAttributes?: Record<string, string>;
};

/** The Contentful SDK constrains `include` to 0..10. */
export type IncludeDepth = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** Hono environment. Every value is resolved once per request by middleware. */
export type AppEnv = {
  Variables: {
    /** True when this request should read from the Preview API instead of Delivery. */
    preview: boolean;
    /**
     * Request-bound Optimization client. Undefined on draft renders (editors get
     * baseline) and when personalization is unconfigured.
     */
    optimization: CoreStatelessRequest | undefined;
    /** The CMP decision for this request, read once from the consent cookie. */
    consent: ConsentDecision;
    /**
     * Release scope for this request, from the `timeline` query parameter.
     *
     * Undefined unless a PREVIEW request carried a real token — Timeline is a
     * Preview API feature, and the SDK throws rather than degrading if a config
     * reaches a Delivery client, so published requests never resolve one.
     */
    timeline: TimelineScope | undefined;
  };
};
