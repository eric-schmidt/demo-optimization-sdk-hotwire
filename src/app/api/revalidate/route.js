import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

// Contentful webhook target. Tags applied to cached fetches are the sys.id of
// every entry / asset in the response graph, so the webhook payload's sys.id
// maps directly to a tag — no link-walking, no content-type allowlist.
// Configure a webhook in Contentful for Entry + Asset publish/unpublish/delete
// events pointing at:
//   POST https://<host>/api/revalidate?secret=<CONTENTFUL_REVALIDATION_SECRET>
export const POST = async (request) => {
  const secret = request.nextUrl.searchParams.get("secret");

  if (secret !== process.env.CONTENTFUL_REVALIDATION_SECRET) {
    return NextResponse.json({ message: "Invalid secret." }, { status: 401 });
  }

  const payload = await request.json();

  // Unpublish / delete webhooks send sys.type = "DeletedEntry" | "DeletedAsset"
  // with no `fields`. We only need sys.id in either case.
  const entryId = payload?.sys?.id;
  if (!entryId) {
    return NextResponse.json(
      { message: "Missing sys.id in payload." },
      { status: 400 }
    );
  }

  const tags = [entryId];
  revalidateTag(entryId);

  // If the payload carries a slug + content type, also invalidate the
  // slug-scoped tag. This handles the case where an earlier request cached
  // an empty result (no items to tag by sys.id) at that slug.
  const contentTypeId = payload?.sys?.contentType?.sys?.id;
  const slug = payload?.fields?.slug;
  const slugValue =
    typeof slug === "string" ? slug : slug && Object.values(slug)[0];
  if (contentTypeId && typeof slugValue === "string") {
    const slugTag = `${contentTypeId}:${slugValue}`;
    revalidateTag(slugTag);
    tags.push(slugTag);
  }

  return NextResponse.json({ revalidated: true, tags });
};
