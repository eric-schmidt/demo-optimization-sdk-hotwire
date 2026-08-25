import { createClient } from "contentful";
import safeJsonStringify from "safe-json-stringify";
import { cached } from "./cache";
import type { IncludeDepth, LandingPage } from "./types";

// Retrieve a Contentful client with various configured options.
export const getClient = ({ preview = false }: { preview?: boolean }) => {
  try {
    // If `preview` is true, use the Preview domain + API key, otherwise use Delivery.
    const domain = preview ? "preview.contentful.com" : "cdn.contentful.com";
    const apiKey = preview
      ? process.env.CONTENTFUL_PREVIEW_KEY
      : process.env.CONTENTFUL_DELIVERY_KEY;

    return createClient({
      space: process.env.CONTENTFUL_SPACE_ID!,
      environment: process.env.CONTENTFUL_ENV_ID!,
      accessToken: apiKey!,
      host: domain,
      // Content Source Maps prevent the need for manually tagging components for
      // Live Preview Inspector Mode, but these are only available on the Preview API.
      //
      // Because this app renders server-side, the steganographic characters the
      // API embeds in field values travel straight into the HTML text nodes, and
      // the browser SDK decodes them off the DOM. That is why Hero/Duplex carry
      // no data-contentful-* attributes.
      includeContentSourceMaps: preview,
    });
  } catch (error) {
    console.error("Error initializing Contentful client:", error);
    throw error;
  }
};

// Walk the Contentful response and collect every Entry/Asset id that appears
// anywhere in the tree — as a resolved entity (`sys.type: 'Entry' | 'Asset'`)
// or as an unresolved link stub (`sys.type: 'Link'` with a matching
// `linkType`). Link stubs let us tag references one level deeper than the
// query's `include` depth resolved.
export const collectContentfulIds = (
  node: unknown,
  ids: Set<string> = new Set(),
): Set<string> => {
  if (!node || typeof node !== "object") return ids;
  if (Array.isArray(node)) {
    for (const item of node) collectContentfulIds(item, ids);
    return ids;
  }

  const record = node as Record<string, unknown>;
  const sys = record.sys as
    | { id?: unknown; type?: unknown; linkType?: unknown }
    | undefined;

  if (sys && typeof sys.id === "string") {
    if (
      sys.type === "Entry" ||
      sys.type === "Asset" ||
      (sys.type === "Link" &&
        (sys.linkType === "Entry" || sys.linkType === "Asset"))
    ) {
      ids.add(sys.id);
    }
  }

  for (const key of Object.keys(record)) {
    if (key === "sys") continue;
    collectContentfulIds(record[key], ids);
  }
  return ids;
};

type QueryArgs = {
  contentType: string;
  slug: string;
  includeDepth?: IncludeDepth;
};

/** Break the SDK's circular link graph and reduce it to plain JSON. */
const toPlainJson = <T>(value: unknown): T =>
  JSON.parse(safeJsonStringify(value)) as T;

// Cached fetch used for the public Delivery API. `cached()` keys on the
// arguments; the `tag` callback is invoked with every referenced entry's sys.id
// so that a webhook publish for any of them invalidates this page cache.
const getPublishedEntriesBySlug = async ({
  contentType,
  slug,
  includeDepth = 10,
}: QueryArgs): Promise<LandingPage[]> =>
  cached(
    `entries:${contentType}:${slug}:${includeDepth}`,
    "contentful",
    async (tag) => {
      // Tag the query itself so an empty-result cache entry (miss before publish)
      // can still be invalidated once content appears at this slug.
      tag(`${contentType}:${slug}`);

      const client = getClient({ preview: false });

      try {
        const response = await client.getEntries({
          content_type: contentType,
          include: includeDepth,
          "fields.slug": slug,
        });
        // Prevent circular reference errors.
        const items = toPlainJson<LandingPage[]>(response.items);

        // Tag every Entry/Asset that appears anywhere in the response tree,
        // including unresolved link stubs — so references one level deeper than
        // the query's `include` still invalidate the parent when they publish.
        const ids = new Set<string>();
        collectContentfulIds(items, ids);
        collectContentfulIds(response.includes?.Entry, ids);
        collectContentfulIds(response.includes?.Asset, ids);
        for (const id of ids) {
          tag(id);
        }

        return items;
      } catch (error) {
        console.error("Error fetching entries:", error);
        throw error;
      }
    },
  );

// Public API: dispatches on preview. Preview / Draft Mode reads bypass the cache
// entirely — the Contentful Preview API must not be cached.
export const getEntriesBySlug = async ({
  preview = false,
  contentType,
  slug,
  includeDepth = 10,
}: QueryArgs & { preview?: boolean }): Promise<LandingPage[]> => {
  if (preview) {
    const client = getClient({ preview: true });
    try {
      const response = await client.getEntries({
        content_type: contentType,
        include: includeDepth,
        "fields.slug": slug,
      });
      return toPlainJson<LandingPage[]>(response.items);
    } catch (error) {
      console.error("Error fetching preview entries:", error);
      throw error;
    }
  }

  return getPublishedEntriesBySlug({ contentType, slug, includeDepth });
};
