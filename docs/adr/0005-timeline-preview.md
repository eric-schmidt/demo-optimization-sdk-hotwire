# ADR 0005 — Timeline Preview on Hotwire

**Status:** Accepted — 2026-09-01.
**Builds on:** `docs/adr/0003-nextjs-to-hotwire-port.md` (the preview handshake),
`docs/adr/0004-optimization-sdk-integration.md` (the draft render path).

## Context

Contentful **Timeline** lets an editor scroll forward in time and preview content as of a scheduled
Release. The web app hands the front end a token in the Content Preview URL's `{timeline}`
placeholder; the front end is responsible for scoping its Preview API reads to it. Nothing else about
the integration is automatic.

Before this change the app was already being handed that token and **silently discarding it**: the
space's Hotwire content preview (`034duluBFEqsWnJpuDYj4r` in `zh1nhbmve68h`) carries
`&timeline={timeline}`, and the CPA `/timeline/entries` endpoints respond on this space, but no code
in this repository referenced a release. A grep for `timeline|releas` returned only unrelated hits.

The question raised when this work started was whether a non-React stack is excluded from Timeline.
It is not, and the reason is worth recording: **what decides the integration route is how the app
fetches, not what renders the HTML.** This app fetches through `contentful.js`, which is
framework-agnostic, so the SDK route applies unchanged — no GraphQL `@timeline` directive, no
hand-rolled `/timeline/` REST calls. Hotwire required no creativity at all. The real work was
plumbing the token through the Hono preview handshake, and three properties of this codebase made
even that small:

- **`getClient()` builds a fresh client per call** — no singleton. The single most common way Timeline
  integrations break is a client constructed once *without* `timelinePreview` and then reused for
  requests that carry a token. That cannot happen here.
- **Nothing is cached.** `Cache-Control: no-store` on every response, and `backup/with-cache/` is
  parked. The standard "bypass framework caching for Timeline requests" gotcha was already satisfied.
- **`POST /preview/render` needed no change.** It resolves a browser-posted entry graph through the
  pure `resolveBlocks()` and makes zero Contentful requests. That graph *originates* from the
  timeline-scoped fetch, so release content flows through the morph path for free and the
  zero-requests invariant survives untouched. `optimization-render.ts` is likewise pure and
  preview-agnostic, so audience simulation composes with Timeline for nothing.

## The property that shapes every decision below

**Timeline fails silently by design.** Resolution falls back: requested release → previous scheduled
release → currently published content. So a 200 with plausible content is *not* evidence that the
release you asked for answered. There is exactly one loud failure — a malformed, deleted, or
non-Timeline release id, which makes the Preview API answer **404** rather than falling back. Probed
against this space: `/timeline/entries` with a bogus `release[lte]` → 404; with no scope parameter at
all → 500.

Two failure modes, opposite in character. The design has to handle both: degrade the loud one instead
of breaking a shared link, and make the quiet one *visible on screen*.

## Decision

Pass `timelinePreview` to `createClient()` on the **preview branch only**, resolve the release scope
once per request in the existing middleware, forward the token across the preview redirect as a query
parameter, and state the active scope on every draft render.

### The token is parsed and validated in one module

`src/lib/timeline.ts` is the whole trust boundary. It uses `@contentful/timeline-preview`'s
`parseTimelinePreviewToken` — the token shape (`releaseId;timestamp`, empty for current content) is
not a documented contract, so the official parser is the right dependency even though its
implementation is three lines.

That parser is `split(';')` and little more, which means three values look like tokens and are not:
`'{timeline}'` (an unexpanded placeholder), `'undefined'` (a stringified missing param), and
`'null'`. All three reach the CPA and 404. The sibling Next.js repo ships the second bug at
`app/[[...slug]]/page.tsx`, where the parser's argument is a template literal wrapping
`searchParams.timeline`. `isRealValue` rejects all three. Version 1.1.1 additionally calls
`decodeURIComponent` internally, which **throws `URIError` on a malformed percent sequence**, so the
parse is wrapped in a try/catch: a junk query parameter must not 500 the page.

*Rejected:* hand-parsing the token, which trades a 1 kB dependency for a guess about a private format.

### `timelinePreview` is a client option, gated on `preview`

It is **not** a `getEntries` query option — the SDK rewrites the request path itself
(`entries` → `timeline/entries`, likewise for assets, and `getEntry` routes through the same internal
call so there is no un-scoped side door). Passing it as a query option yields *"Objects are not
supported as value for the `timelinePreview` query parameter."*

The gate matters because the host check **throws**: a valid config paired with a Delivery host raises
`ValidationError` rather than being ignored. The config is also re-validated on *every* request and
throws on a malformed one, so the code only ever spreads a real, non-empty string — never an empty
object, never `{ release: { lte: undefined } }`. This sits beside the existing
`includeContentSourceMaps: preview`, which is the established precedent for a preview-host-only
option.

Consequence, and it is a feature: a `timeline` parameter on a **published** URL is ignored, not
honoured. The middleware resolves the scope only when `preview` is true.

### Release scope only — never release plus timestamp

The docs permit both together "if the release is scheduled". In the field, sending both 404s for an
*unscheduled* release and whenever the timestamp does not line up with the release's scheduled date.
A release id alone resolves correctly. When the token carries a timestamp it is still shown in the
banner, because it is what the editor selected — it just is not sent.

*Rejected:* forwarding both, which is the documented shape and the more fragile one.

### The token crosses the redirect as a query parameter

`GET /preview` validates the secret, confirms the slug exists, sets the preview cookie, and **302s to
a bare path** — dropping every query parameter it was given. The release scope has to survive that
hop or it is lost between the handshake and the render.

A query parameter rather than a payload in the preview cookie: that cookie is a bare HMAC of the
fixed string `"preview"` with **no payload**, so carrying a release there would mean signing a payload
and touching `previewToken` / `isPreviewRequest` / `enablePreview` — a change to the auth primitive
for a display concern. A query parameter also keeps shared preview links correct and makes it obvious
from the URL that you are looking at future content. The usual cost — Turbo Drive drops query
parameters when navigating to internal links — does not apply: this app has one page and no
inter-page links.

The **raw validated token** is forwarded rather than rebuilt with `buildTimelinePreviewToken`, which
appends a trailing `;` to a release-only scope. Fidelity to what the web app sent is worth more than
canonical form.

*Rejected:* signing a payload into the preview HMAC.

### The slug-existence check is release-scoped, with an un-scoped retry

A release can **introduce** a page: its slug does not exist in current draft content, and an
un-scoped existence check would 401 a perfectly good preview link. So that check is scoped too. If
the scoped call throws, it retries once un-scoped before deciding — a stale release id should not
make a preview link unopenable. The retry fires only when a scope was set, so a genuine Contentful
outage still surfaces.

### A 404 degrades and announces; it does not 500

`GET /:slug` previously rethrew any rejected content fetch, which under Timeline means a link with a
since-deleted release id becomes a broken page. It now drops the release scope, re-fetches current
preview content, and sets a `degraded` flag that the banner renders. The same degradation covers the
preview panel's entries endpoint, where losing the whole panel over a stale id would be worse than
showing it with current-content audiences.

*Rejected:* a 500, which is honest about the release and useless about the page.

### The active scope is stated on every draft render

A small fixed pill at `bottom-4 left-4`, mirroring the Exit-preview form at `bottom-4 right-4`.
Three states: `Timeline: current content`; `Timeline: release <id>` plus `as of <timestamp>` when the
token carried one; and an amber `Release not found — showing current preview content`.

The always-on neutral state is the point, not decoration. Because resolution falls back silently,
naming the scope on screen is the only thing that turns an invisible misconfiguration into something
an editor can report. Published renders show nothing, which is also the proof that no release config
reached a Delivery client.

*Rejected:* showing the banner only when a release is active — which is exactly the case where a
silent fallback is invisible.

### The preview panel's fetch is scoped too

`/preview/optimization-entries` now honours the request's scope, and the browser forwards the token
onto that fetch from `location.search`. Un-scoped, the panel would offer **current** audiences and
experiences against a page built from release content, so a forced audience could name a variant the
page has no entry for. Keeping the whole draft render on one scope avoids the partial-staleness trap
that any hardcoded-scope fetcher walks into.

### The Contentful web app drives release selection

No in-page release picker. The editor uses Contentful's own timeline selector; the web app reloads
the preview iframe with a new token and the server re-fetches. This needs no CMA credential and never
trades away the "`POST /preview/render` makes zero Contentful requests" invariant.

*Rejected:* an in-page picker, which needs the CMA to list releases and would force a re-fetch
through the render endpoint.

### `TimelinePreview` is declared locally

The type is real — `contentful@11.12.9` ships it at `dist/types/types/timeline-preview.d.ts` — but
`dist/types/types/index.d.ts` does not re-export it and the deep path is not in the package's
`exports` map, so it is not importable. `src/lib/timeline.ts` declares the two shapes this app
constructs, with a comment recording why.

### Live Preview needed no change

Inspector mode is already release-aware with no app code: the editor sends `releaseId` alongside
`isInspectorActive` and the SDK echoes it in its tagged-field messages, so clicking an outline on a
release preview opens the release-scoped editor. Live updates arrive as `ENTRY_UPDATED` for whichever
version the editor has open. `src/client/live-preview.ts` is untouched.

## Consequences

- The declared `contentful` floor moved to `^11.9.0`, the first version where `timelinePreview`
  exists. The lockfile already pinned 11.12.9, so nothing changed on install — but a lockfile-less
  checkout could otherwise have resolved a version where the option is silently inert, which is the
  worst possible failure for this feature.
- `AppEnv.Variables` gained a fourth per-request value. Middleware resolves it in the same pass as
  `preview`, `consent` and `optimization`.
- Published Delivery renders are untouched: Timeline is CPA-only.
- **The banner shows an opaque release id, not a title.** Resolving a title needs the CMA, and this
  app ships no management credential — the one in `.env.local` currently returns 401.
- **No automated proof ships in this repo.** `scripts/smoke.tsx` gained pure `Layout` assertions for
  the banner's four states, which is real cover for the visibility mechanism but says nothing about
  release resolution. That is verified manually against a real release, per the README, plus the
  out-of-repo `~/Projects/clients/Allegiant/timeline-preview-reference.mjs` (Route 4), which exits
  non-zero when the scoped and un-scoped views match.
- **The whole feature depends on an out-of-repo setting no code review can catch.** If the space's
  Content Preview URL loses `&timeline={timeline}`, every render silently becomes current content and
  the banner correctly, unhelpfully, says "current content". Check the preview configuration before
  reading any code.
- Related, and also out of repo: the Hotwire content preview hardcodes `slug=home` where the Next.js
  one uses `{entry.fields.slug}`. Previewing any other `landingPage` would render `home`.

## Verification that actually proves something

Compare the two views rather than checking for a 200 — **pass is that they differ**:

```bash
curl -sc jar "https://<host>/preview?secret=$SECRET&type=landingPage&slug=home" -o /dev/null
curl -sb jar "https://<host>/home?timeline=<releaseId>;" | grep -o '<h1[^>]*>[^<]*'
curl -sb jar "https://<host>/home"                       | grep -o '<h1[^>]*>[^<]*'
```

Identical output means one of: the preview URL lost its `timeline` parameter; the id is a Launch
release rather than a Timeline (`Release.v2`) release; or the release contains no changed entries.
None of those announce themselves.

## References

- `docs/adr/0003-nextjs-to-hotwire-port.md` — the preview handshake this extends
- `docs/adr/0004-optimization-sdk-integration.md` — the draft render path and the panel
- `src/lib/timeline.ts` — token parsing and the three bogus values
- Jira CCS-3189
