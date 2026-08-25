# Cached variant (parked)

Snapshot of the files that implemented tag-based caching, taken 2026-08-25 before caching was
removed from the live code path.

**Why it was removed.** For a rendering demo, the cache was doing more harm than good: after
saving in Contentful you had to think about invalidation before a reload showed the change. The
app now fetches from Contentful on every request. Nothing to clear, nothing to configure.

These files are kept verbatim rather than as commented-out code so `src/` stays readable. They
are not compiled or bundled — `tsconfig.json` only includes `src/` and `scripts/`.

## What this variant contained

- `src/lib/cache.ts` — an in-process tag-indexed store reimplementing Next.js Cache Components:
  `"use cache"`, `cacheTag`, `cacheLife` and `revalidateTag`, with the
  `{ stale: 300, revalidate: 900, expire: 3600 }` profile from the original `next.config.js`,
  plus stale-while-revalidate and single-flight de-duplication.
- `src/lib/contentful.ts` — the same client, but with the published branch wrapped in `cached()`.
  It also contains `collectContentfulIds`, the recursive walker that tagged a cached page with
  the `sys.id` of every entry and asset in the response graph, including unresolved `Link` stubs.
  That walker exists **only** to support tagging, which is why it is gone from the live file.
- `src/routes/revalidate.ts` — the `POST /api/revalidate` Contentful webhook target.
- `src/routes/page.ts` / `src/server.ts` — the versions that set `Cache-Control` from the cache
  profile and registered the revalidate route.
- `scripts/smoke.tsx` — includes the cache assertions (hit/miss, tag eviction, tag-index
  unlinking, concurrent-miss coalescing) that the current smoke check drops.

## Restoring

```bash
cp -R backup/with-cache/src backup/with-cache/scripts .
npm run build          # typecheck + assets
npm run smoke          # cache assertions come back with the file
```

Then re-add the webhook described in git history for this file's README section — Entry **and**
Asset `Create` / `Archive` / `Unarchive` / `Publish` / `Unpublish` / `Delete` pointing at
`/api/revalidate?secret=<CONTENTFUL_REVALIDATION_SECRET>`. `CONTENTFUL_REVALIDATION_SECRET`
is unused while caching is off.

The design rationale is in [`../../docs/plans/2026-08-25-nextjs-to-hotwire-port.md`](../../docs/plans/2026-08-25-nextjs-to-hotwire-port.md) §D3
and [`../../docs/adr/0003-nextjs-to-hotwire-port.md`](../../docs/adr/0003-nextjs-to-hotwire-port.md).
