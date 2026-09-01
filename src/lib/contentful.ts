import { createClient } from "contentful";
import safeJsonStringify from "safe-json-stringify";
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

/** Break the SDK's circular link graph and reduce it to plain JSON. */
const toPlainJson = <T>(value: unknown): T =>
  JSON.parse(safeJsonStringify(value)) as T;

/**
 * Fetch entries of `contentType` matching `fields.slug`.
 *
 * Nothing is cached. Every request goes to Contentful, so saving an entry and
 * reloading the page is enough to see the change — there is no invalidation step.
 * A tag-based cache implementation is parked in backup/with-cache/ if this demo
 * ever needs one again.
 */
/**
 * Audiences and experiences for the preview panel.
 *
 * Unlike getEntriesBySlug this keeps the whole EntryCollection rather than just
 * `items`: the panel reads `experiences.includes.Entry` to show variant names, and
 * discarding `includes` would leave every variant unlabelled.
 *
 * Read through the Preview API because this is an authoring tool and unpublished
 * audiences should be visible.
 */
export const getPersonalizationEntries = async (): Promise<{
  audiences: unknown;
  experiences: unknown;
}> => {
  const client = getClient({ preview: true });

  const [audiences, experiences] = await Promise.all([
    client.getEntries({ content_type: "nt_audience", include: 1, limit: 200 }),
    client.getEntries({ content_type: "nt_experience", include: 2, limit: 200 }),
  ]);

  return {
    audiences: toPlainJson(audiences),
    experiences: toPlainJson(experiences),
  };
};

export const getEntriesBySlug = async ({
  preview = false,
  contentType,
  slug,
  includeDepth = 10,
}: {
  preview?: boolean;
  contentType: string;
  slug: string;
  includeDepth?: IncludeDepth;
}): Promise<LandingPage[]> => {
  const client = getClient({ preview });

  try {
    const response = await client.getEntries({
      content_type: contentType,
      include: includeDepth,
      "fields.slug": slug,
    });
    // Prevent circular reference errors.
    return toPlainJson<LandingPage[]>(response.items);
  } catch (error) {
    console.error("Error fetching entries:", error);
    throw error;
  }
};
