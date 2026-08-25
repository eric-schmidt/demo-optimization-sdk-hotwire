# ADR 0001: Migrate Contentful caching to Next.js Cache Components

**Status:** Accepted — 2026-07-15

**See also:** [ADR 0002 — Split component resolver for RSC / Client rendering paths](./0002-split-resolver-rsc-client.md)

## Context

Data reads from Contentful were cached using Next.js's legacy `unstable_cache` primitive from `next/cache`, wrapped inside `getEntriesBySlug` in `src/lib/client.js`. Revalidation ran through `src/app/api/revalidate/route.js`, a webhook endpoint that received an entry ID and recursively walked the reference tree via `getEntryById` + `getLinksToEntryById` to find any ancestor "page-like" entry (from a hard-coded `["category","page","post"]` allowlist), then called `revalidateTag(entry.fields.slug)`.

Three limitations of that design pushed the migration:

1. **The Contentful JS SDK uses Axios, not `fetch`.** Next.js's original caching model was built around `fetch` options (`next: { revalidate, tags }`). `unstable_cache` was the escape hatch for non-`fetch` data sources; it required explicit `keyParts` and could only tag from inputs known at wrap time.
2. **Tags were declared before the fetch, so they had to be derived from arguments — slugs.** A slug rename in Contentful stranded the old cache entry with a tag no webhook payload could match.
3. **Nested-entry invalidation required the webhook handler to reconstruct the reference graph** at revalidation time (recursive `findPageToRevalidate`) — network-heavy and dependent on a content-type allowlist that has to be kept in sync with the model.

There was also a `cacheHandler` override in `next.config.js` swapping in the file-system cache handler to work around the 2MB value limit in `unstable_cache` (vercel/next.js#48324).

Next.js 16 introduces **Cache Components**, gated behind `cacheComponents: true` in `next.config`. Under this flag the `"use cache"` directive caches the return value of any async function; `cacheTag` and `cacheLife` are called *inside* the cached function so tags can reference response data (e.g. `sys.id`). Contentful published guidance for this exact pattern in November 2025.

## Decision

Migrate to Next.js 16 Cache Components:

- Enable `cacheComponents: true` in `next.config.js`; define a `cacheLife` profile named `"contentful"` (`stale: 300, revalidate: 900, expire: 3600`); remove the `cacheHandler` override (its `unstable_cache`-specific rationale no longer applies).
- Split `getEntriesBySlug` in `src/lib/client.js` into an internal cached function (`getPublishedEntriesBySlug`, starting with `"use cache"` and calling `cacheLife('contentful')`) and a public dispatcher that bypasses the cache when `preview: true`.
- **Tag by `sys.id`** — of the page entry *and* every entry/asset in `response.includes` — so any referenced-entry publish invalidates the parent page cache.
- Rewrite `src/app/api/revalidate/route.js` to read `payload.sys.id` and call `revalidateTag(payload.sys.id)`. Drop `getEntryById`, `getLinksToEntryById`, `findPageToRevalidate`, and the `pageContentTypes` allowlist.
- Wrap the `draftMode()` + fetch in `src/app/[slug]/page.jsx` in a `<Suspense>` boundary (required by Cache Components for any request-time read).
- Remove the `await draftMode()` call in `src/app/layout.jsx` — it forced the whole layout onto the dynamic path for a prop that `providers.jsx` was ignoring (`enableInspectorMode={true || draftModeEnabled}`).

## Consequences

**Positive**

- The Axios/`fetch` mismatch disappears. `"use cache"` wraps any async function, so SDK calls get the same ergonomics as `fetch` — no Axios-adapter workarounds, no manual `keyParts`.
- Tag identity is stable across slug renames (`sys.id` never changes).
- Referenced-entry invalidation is automatic — no recursive link-walking in the webhook handler, and no content-type allowlist to maintain.
- The revalidate route collapses from ~50 lines to a single `revalidateTag(payload.sys.id)` call.
- The root layout prerenders fully; individual pages hit the static shell + Suspense pattern, enabling Partial Prerendering.

**Negative**

- Higher tag cardinality per cached page (one tag per included entry/asset). Fine at typical CMS scale; monitor if pages routinely include thousands of entries.
- First navigation to `/<slug>` briefly renders the Suspense fallback. Ship a lightweight skeleton if the flash is noticeable.
- Slugs are no longer surfaced in cache-debug tooling; tags are opaque IDs.
- `cacheHandler` override was removed. If the new cache backend surfaces a value-size ceiling under real content graphs, re-add it.

## Alternatives considered

- **Tag by slug (keep legacy shape).** Retains the recursive `findPageToRevalidate` walk and the `pageContentTypes` allowlist; still brittle to slug renames. Rejected — the primary wins of Cache Components (post-fetch tagging, stable tag identity, one-line webhook handler) all depend on tagging by `sys.id`.
- **Hybrid: page slug + include `sys.id`s.** Considered for a hypothetical future case (e.g. a sitemap that revalidates by URL). No current call site benefits; declined until a concrete need surfaces.

## References

- Next.js docs — [Caching](https://nextjs.org/docs/app/getting-started/caching), [Caching without Cache Components (legacy)](https://nextjs.org/docs/app/guides/caching-without-cache-components).
- Contentful blog — *Integrate Contentful with Next.js 16 Cache Components* (Nov 2025).
- vercel/next.js#48324 — the 2MB `unstable_cache` limit that motivated the removed `cacheHandler` override.
