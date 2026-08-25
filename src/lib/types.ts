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
};

export type BlockEntry = {
  sys: ContentfulSys;
  fields?: BlockFields;
};

export type LandingPage = {
  sys: ContentfulSys;
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
};

/** The Contentful SDK constrains `include` to 0..10. */
export type IncludeDepth = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** Hono environment. `preview` is resolved once per request by middleware. */
export type AppEnv = {
  Variables: {
    /** True when this request should read from the Preview API instead of Delivery. */
    preview: boolean;
  };
};
