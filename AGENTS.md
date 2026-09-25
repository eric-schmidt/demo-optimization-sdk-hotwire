# AGENTS.md

Working notes for AI agents and engineers picking this repo up cold. `README.md` explains what the
app does; this file covers **what will bite you**.

## Orientation, in order

1. `README.md` §"What this demonstrates" and §"Where things live".
2. `docs/adr/0004-optimization-sdk-integration.md` — the personalization design of record, every
   rejected alternative, and a deferred-work section with triggers.
   `docs/adr/0005-timeline-preview.md` — the Timeline design of record, and why a non-React stack
   needed no special treatment for it.
3. `docs/plans/2026-08-25-nextjs-to-hotwire-port.md` §8 — load-bearing details that must not drift.
4. `docs/optimization-sdk-hotwire-fit.md` — the original desk assessment. **Superseded in part** and
   annotated with inline `> **Corrected:**` callouts. Do not follow its code sketches; they predate
   the 1.x API and its §4.3 is wrong in both directions.

## Commands

```bash
npm run dev        # build assets + tsx watch
npm start          # build assets + run once
npm run build      # build assets + typecheck
npm run typecheck  # tsc --noEmit (strict, noUncheckedIndexedAccess, verbatimModuleSyntax)
npm run smoke      # 104 assertions, NO credentials needed — run this first, always
```

`npm run smoke` is the fastest useful signal in the repo: it renders fixtures through the real
resolver and asserts variant selection, control arms, empty variants, bundle separation, consent
forwarding, and the preview bridge. **If you change rendering or selection, run it before anything
else.**

Server code runs through `tsx` directly — there is no server build step. Env comes from Node's own
`--env-file-if-exists=.env.local`, so a new variable needs no code change to be picked up.

## The six traps

These each cost real debugging time. They are ordered by how much.

### 1. Per-entrypoint bundling duplicates "shared" modules

`scripts/build-client.mjs` builds four independent entrypoints. **Anything imported by two entrypoints
is duplicated, with separate module state.** This has bitten this repo three times:

- `optimization-core`'s signals are module-level, and the preview panel reaches them through a bridge —
  two copies means the panel's overrides never reach the SDK. That is why the panel and the Web SDK
  must share **one** bundle (`optimization-preview.js`).
- `client/preview-render.ts` is imported by both draft bundles, so its state lives on
  `window.__ctflPreviewRender`. Module-level state there silently turns the single writer into two
  writers, and a field edit drops the forced audience.
- `@contentful/live-preview`'s `static inspectorModeEnabled` would duplicate the same way, which is
  why nothing outside `client/live-preview.ts` imports that package.

**Rule:** before sharing state between client bundles, put it on `window` (as `app.js` already does
for Turbo and Stimulus) or keep it in one bundle. Check the built output with
`grep -c '<marker>' public/assets/*.js`.

### 2. `consent: false` does not block anything by itself

The SDK's admission check is:

```ts
if (consent === true) return true
return allowedEventTypes.some((eventType) => eventType === method)
```

`false` and `undefined` behave identically — both fall through to the allow-list, whose default is
`['identify', 'page']` in **both** runtimes. Both singletons therefore set `allowedEventTypes: []`.
**Do not remove that**, or a visitor who refused consent still emits a page event and gets a profile.
It is free when consent is granted, because `consent === true` short-circuits first.

### 3. The `page` event is the ignition, and the query string is load-bearing

`emitPageEvent()` in `src/lib/optimization.ts` is the **only** place `page()` is called. No accepted
page event ⇒ no `selectedOptimizations` ⇒ baseline everywhere.

Every audience in the demo space targets the **`habitat` query parameter** (`context_page_query`), so
`eventContext.page` must carry the query string. Use the SDK's own `createPageContextFromUrl` — do not
hand-roll that object. Getting this wrong makes every render silently baseline with no error.

Diagnostic: `curl -s 'localhost:3000/home?habitat=beach' | grep -o 'data-ctfl-entry-id="[^"]*"'`.
If that matches the no-query result, the page context is the bug and nothing else.

### 4. `ContentfulLivePreview.subscribe()` never fires on subscribe

It registers the subscription and posts `SUBSCRIBED`; the callback runs only on an `ENTRY_UPDATED`
message, i.e. once per real edit. (`useContentfulLiveUpdates` returns initial data synchronously — that
is where the opposite assumption comes from.) So never gate a render path on that callback having
fired; read the server-embedded `script[data-live-preview-data]` graph instead, as
`client/preview-render.ts` does.

### 5. Variant resolution has three outcomes that all "look like" baseline

`resolveOptimizedEntry` can return the baseline entry for three different reasons, and they are not
interchangeable:

| Outcome | `selectedOptimization` | Render |
| --- | --- | --- |
| No experience matched | undefined | baseline |
| **Control arm** (`variantIndex: 0`) | **defined** | baseline, **still tracked** |
| **Empty variant** (`isEmptyVariant`) | defined | **render nothing** |

Never infer "no match" from `resolved.entry === baselineEntry`. Dropping the control arm's
`data-ctfl-*` attributes silently destroys one half of any experiment.

Also: `resolveOptimizedEntry` **does not clone** — never mutate its result.

### 6. Timeline fails silently by design — a 200 proves nothing

Timeline resolution **falls back**: requested release → previous scheduled release → currently
published content. So a release preview that renders plausible content is *not* evidence that the
release you asked for answered. **The only real signal is a difference from the un-scoped view.** Never
"verify" Timeline by checking that the page rendered, or that the request returned 200 — both are true
in every failure case except one.

That one exception is worth knowing precisely, because the two failure modes are opposites:

| Wrong how | What happens |
| --- | --- |
| Malformed / stale / deleted / non-Timeline release id | Preview API **404s** — loud. The app degrades to un-scoped preview and shows the amber banner. |
| Valid release that changes nothing, or an unexpanded `{timeline}` in the preview URL | **Silently** resolves to current content. Looks perfect. |

Three corollaries:

- The scope banner (`TimelineBanner` in `views/Layout.tsx`) exists *because* of this, and shows on
  every draft render including "current content". Do not make it conditional on a release being
  active — that is exactly the case where a silent fallback is invisible.
- `parseTimelinePreviewToken` is `split(';')` plus a `decodeURIComponent`. It happily returns
  `releaseId: '{timeline}'` or `'undefined'`, and it **throws `URIError`** on a malformed percent
  sequence. `timelineFromToken` in `lib/timeline.ts` is the guard; do not call the parser directly.
- Before reading any code when Timeline looks broken, **check the space's Content Preview URL for
  `&timeline={timeline}`**. That setting lives outside this repo, and its absence is indistinguishable
  from "no release selected".

## Invariants worth protecting

- **`ComponentResolver` is the single render seam.** The published page, the draft page, and every
  Turbo Stream all go through it, so templates exist in exactly one place. Keep it that way.
- **The Turbo morph anchor is derived from the BASELINE id**, never the resolved entry. If a variant
  swap changed `id="block-…"`, `update` + `morph` would delete-and-insert instead of patching, losing
  scroll position and the inspector overlay.
- **The published path ships no Live Preview JS and no preview panel** — structurally, not by
  discipline. `smoke.tsx` asserts it. Never emit both optimization bundles: constructing the Web SDK
  twice throws.
- **`POST /preview/render` makes zero Contentful requests.** The posted graph already contains every
  variant, and resolution is local. Re-fetching per keystroke would hit a 14 req/s CPA limit.
- **`ctfl-opt-aid` is deliberately NOT `httpOnly`** — the browser SDK reads the same cookie. Making it
  HttpOnly forks the profile between server and browser. Contrast `PREVIEW_COOKIE`, which *is*
  HttpOnly because only the server reads it.
- **Baseline is the structural default.** Unconfigured, no consent, timeout, or an Experience API
  outage all render baseline, never an empty region. Resolution is eager (outside JSX) so a failure is
  a clean 500 rather than a truncated body.
- **A `timeline` parameter is honoured only on preview requests.** Not a style choice: the SDK's host
  check **throws** when a release config meets a Delivery host, and it re-validates on every request.
  So `timelinePreview` is spread only on the `preview` branch of `getClient`, and only ever with a
  real non-empty string.
- **The whole draft render sits on one release scope** — page content, the slug-existence check, and
  the preview panel's audience/experience feed. A fetcher that ignores the scope mixes current and
  future content into one page, which is the partial-staleness trap and looks like a caching bug.
- **Caching stays off**, and `backup/with-cache/` stays parked. It also would not restore cleanly: it
  imports `../lib/draft` and `./routes/draft`, which no longer exist.

## Content model

Space `zh1nhbmve68h`, env `master`, locale `en-US`, one slug: `home`.

`landingPage` → `hero` + `content[]` (`duplex`), images via `mediaWrapper` → asset. Both `hero` and
`duplex` carry `nt_experiences`. 4 audiences, all keyed on `?habitat=`; 5 `nt_personalization`
experiences.

Deterministic for testing: `?habitat=beach` and `?habitat=forest` are `distribution: [0, 1]`.
**`?habitat=desert` is `[0.1, 0.9]`** — ~1 request in 10 legitimately returns baseline, so never gate a
test on a single desert request.

> ⚠️ `contentful-export-*.json` is **stale**: it predates the Personalization app install and has no
> `nt_*` content types. `content-model.json` is an unrelated Ninetailed-era model. Neither will
> reproduce this demo in a fresh space.

## Gotchas that look like bugs but are not

- **`?habitat=` does nothing on a fresh clone.** Consent is fail-closed, so with no `cmp-consent`
  cookie there is no `page` event and therefore no selections. Grant consent in the demo panel, or
  `document.cookie = "cmp-consent=true; Path=/"`. This was reported as "personalization is broken"
  once; the panel now server-renders a notice explaining it.

- `data-action="click-&gt;optimization#..."` in the HTML source — `hono/jsx` escapes `>` in attribute
  values; the parser decodes it before Stimulus reads it. Correct as-is.
- `optimizationContextId` absent from server-rendered `data-ctfl-*` — it is stateful-only by design.
- The Experience API returns selections for experiences that do not exist in this space — the
  optimization environment is shared across demos. Resolution only matches by `experienceId` present
  on the entry, so it is harmless.
- Client bundles are always minified: `build:js` never receives `--dev` (nothing passes it).
- Inspector outlines over the preview panel — see the known issue in the README.
- `ValidationError` from `createClient` when you thought you were configuring Timeline — the host gate
  is Preview-API-only (`preview.contentful.com`, `preview.eu.contentful.com`, or a non-`.contentful.com`
  custom host) and it **throws** rather than ignoring the option. Passing `timelinePreview` alongside a
  Delivery host is the cause.
- `timelinePreview` rejected as a query parameter (*"Objects are not supported as value…"*) — it is a
  `createClient()` option, not a `getEntries` one. The SDK rewrites its own paths to `timeline/entries`
  and `timeline/assets`, and `getEntry` routes through the same internal call, so there is no un-scoped
  side door to plug.
- The Timeline banner shows an opaque release id rather than the release title — resolving a title needs
  the CMA, and this app ships no management credential. Deliberate; see ADR 0005.
- The space's Hotwire content preview hardcodes `slug=home` where the Next.js one uses
  `{entry.fields.slug}`. Previewing any other `landingPage` would render `home`. Out-of-repo config.

## House style

Match the surrounding code. This repo comments the *why*, not the *what*, and specifically records
rejected alternatives inline where a reader would otherwise "fix" something back. Preserve those
comments; several exist because the obvious change is wrong.
