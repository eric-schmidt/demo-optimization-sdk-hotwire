import { Hono } from "hono";
import { revalidateTag } from "../lib/cache";
import { secretsMatch } from "../lib/draft";

// Port of src/app/api/revalidate/route.js.
//
// Contentful webhook target. Tags applied to cached fetches are the sys.id of
// every entry / asset in the response graph, so the webhook payload's sys.id
// maps directly to a tag — no link-walking, no content-type allowlist.
// Configure a webhook in Contentful for Entry + Asset publish/unpublish/delete
// events pointing at:
//   POST https://<host>/api/revalidate?secret=<CONTENTFUL_REVALIDATION_SECRET>

export const revalidateRoutes = new Hono();

type WebhookPayload = {
  sys?: { id?: string; contentType?: { sys?: { id?: string } } };
  fields?: { slug?: string | Record<string, string> };
};

revalidateRoutes.post("/api/revalidate", async (c) => {
  const secret = c.req.query("secret");
  const expected = process.env.CONTENTFUL_REVALIDATION_SECRET;

  if (!expected || !secretsMatch(secret, expected)) {
    return c.json({ message: "Invalid secret." }, 401);
  }

  let payload: WebhookPayload;
  try {
    payload = await c.req.json<WebhookPayload>();
  } catch {
    return c.json({ message: "Invalid JSON body." }, 400);
  }

  // Unpublish / delete webhooks send sys.type = "DeletedEntry" | "DeletedAsset"
  // with no `fields`. We only need sys.id in either case.
  const entryId = payload?.sys?.id;
  if (!entryId) {
    return c.json({ message: "Missing sys.id in payload." }, 400);
  }

  const tags = [entryId];
  let evicted = revalidateTag(entryId);

  // If the payload carries a slug + content type, also invalidate the
  // slug-scoped tag. This handles the case where an earlier request cached
  // an empty result (no items to tag by sys.id) at that slug.
  const contentTypeId = payload?.sys?.contentType?.sys?.id;
  const slug = payload?.fields?.slug;
  const slugValue =
    typeof slug === "string" ? slug : slug && Object.values(slug)[0];
  if (contentTypeId && typeof slugValue === "string") {
    const slugTag = `${contentTypeId}:${slugValue}`;
    evicted += revalidateTag(slugTag);
    tags.push(slugTag);
  }

  console.log(`[revalidate] evicted ${evicted} entry/entries for tags ${tags.join(", ")}`);
  return c.json({ revalidated: true, tags, evicted });
});
