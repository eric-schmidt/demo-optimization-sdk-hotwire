# Contentful Personalization on Hotwire: SDK fit assessment

**Status: implemented 2026-08-25 — superseded in part.** The opening claim below is no longer true.
See [`adr/0004-optimization-sdk-integration.md`](./adr/0004-optimization-sdk-integration.md) for what
was actually built.

§1, §2 and §5's division-of-labour argument held up under implementation: the Node + Web split is the
right shape, and server-side selection genuinely needs no reactivity. **§3's code sketches and §4.3
did not** — the sketches do not match the 1.x API, and §4.3 is wrong in both of its bullets. They are
left in place with inline `> **Corrected:**` callouts rather than rewritten, because a wrong answer
that has already been proposed once tends to get proposed again.

Three things this assessment missed:

1. **Every audience in space `zh1nhbmve68h` targets the `habitat` query parameter** via
   `context_page_query`. So `eventContext.page` is load-bearing, and omitting the query string is a
   silent all-baseline failure with no error to point at. This is the highest-risk detail in the
   integration and it is not mentioned anywhere below.
2. **The preview panel is browser-only** and works by making the *browser* SDK re-resolve entries.
   There is no forced-audience option on `forRequest()` at all, so on a server-rendered page the panel
   changes state and nothing else. Audience simulation required a panel → Turbo Stream bridge that
   this document does not anticipate — the largest genuinely new piece of work.
3. **`include: 4` is one level from breaking** (§4 of the ADR). Unresolved links resolve to baseline
   silently, so a personalized hero would have rendered variant text with no image and no error.

Two things it worried about that turned out fine: `toPlainJson` preserves the whole experience graph
with no circular truncation, and the Web SDK re-observes the DOM itself.

---

**Original status:** Assessment only — 2026-08-25. **No personalization code exists in this repository.**

Written for the Allegiant Air / Apply Digital personalization implementation review. It answers
one question: given a Hotwire frontend on Node + TypeScript, which Optimization SDK packages
apply, where do they attach, and what has to be built by hand?

> **Scope note.** This is a desk assessment based on Contentful's Optimization SDK
> documentation and the architecture of this repo. Nothing here has been run. Treat the code
> sketches as shapes to validate, not as a working integration.

## 1. The short answer

Use **`@contentful/optimization-node`** for variant selection on the server and
**`@contentful/optimization-web`** for interaction tracking in the browser. This is the hybrid
Contentful's own docs recommend for server-rendered pages, and it maps onto Hotwire more
cleanly than onto most frameworks.

There is no Hotwire-specific SDK and there will not be one — Hotwire is a client-side toolkit
usable behind any server language, so there is nothing framework-specific for an SDK to bind
to. That is not a gap; the Node SDK is the correct integration point.

Packages that do **not** apply: `-react-web`, `-react-native`, `-nextjs`.

## 2. Why the Node SDK fits Hotwire well

`@contentful/optimization-node` is **stateless by design**. Per the docs: one singleton
`ContentfulOptimization` per process, each request bound with `forRequest()`, and the SDK holds
no per-visitor state between requests — it does not manage cookies, sessions, consent,
long-lived profiles, or rendering. The host application owns all of that and passes request
inputs in.

That division of labour is already how this app is built. A Hono middleware owns the request
context and cookies; `ComponentResolver` owns rendering. Nothing has to be restructured to
accommodate the SDK — which is not true of a client-first SDK, where the framework normally
has to provide a provider/context tree.

The boundary the docs draw is the one that matters:

> "The Node SDK can emit events, but it cannot observe a rendered page after the response leaves
> the server."

So the server knows which URL was requested, which profile ID arrived, which baseline entry was
fetched, which variant was selected, and which HTML it tried to send. It cannot know whether the
browser rendered it, whether a block crossed the viewport, or whether anyone clicked. Those need
`@contentful/optimization-web`, which in Hotwire is a Stimulus controller over already-rendered
DOM — a natural fit, since that is exactly what Stimulus is for.

## 3. Where it attaches in this codebase

Three touch points. Nothing else changes.

```
                        ┌─ optimization middleware (NEW) ── forRequest() per request
GET /:slug ──► page.ts ─┤
                        └─ lib/contentful.ts ──► CDA

               views/Layout ──► ComponentResolver ──► Hero | Duplex
                                      │
                                      └─ variant selection (NEW): swap entry
                                         for its selected variant before render

               client/index.ts ──► tracking controller (NEW) ── optimization-web
```

> **Corrected:** this sketch does not match the 1.x API. `profileId:` is `profile: { id }`; `url:` is
> `eventContext.page`, which the SDK does *not* derive from a framework request; `consent` is
> **required**, not optional; and `forRequest()` alone emits nothing — `page()` is what returns
> selections. Use the SDK's own `createPageContextFromUrl`, and see `src/lib/optimization.ts`.

**(a) A Hono middleware** creating the request-scoped instance:

```ts
// sketch — validate against the package README
const optimization = new ContentfulOptimization({ /* ... */ });   // once per process

app.use(async (c, next) => {
  c.set("optimization", optimization.forRequest({
    profileId: getCookie(c, PROFILE_COOKIE),
    url: c.req.url,
    consent: readConsent(c),
    locale: LOCALE,
  }));
  await next();
});
```

> **Corrected:** there is no entry-id-keyed `selectedOptimizations` map — selections are keyed by
> `experienceId`. The real call is `optimization.resolveOptimizedEntry(baselineEntry, selections)`.
> The `selected?.fields ?? entry.fields` shape below also encodes an anti-pattern: a CONTROL assignment
> returns the *baseline* entry with a defined `selectedOptimization` at `variantIndex: 0`, so inferring
> "no match" from identity loses the control arm of any experiment. Resolution also moved out of the
> component into `src/lib/optimization-render.ts`; see ADR 0004.

**(b) `ComponentResolver`** picks the selected variant instead of the baseline. This is the one
place rendering has to change, and it stays a single seam because the resolver is already the
only thing that turns an entry into a component:

```ts
const selected = c.get("optimization").selectedOptimizations?.[entry.sys.id];
const fieldsToRender = selected?.fields ?? entry.fields;
```

**(c) A Stimulus controller** initialising `optimization-web` for view/click/hover tracking on
blocks the server already rendered.

## 4. The four things to design around

### 4.1 Variant selection adds a round trip to the request path

Personalized rendering means an Experience API call *inside* the request, in series with the
Contentful content fetch. On a server-rendered page that latency is user-visible, and an
Experience API outage degrades the page rather than degrading quietly in the background.

Design implications: set an explicit timeout with a baseline fallback so an outage renders
default content rather than nothing, and consider issuing the content fetch and the
optimization call concurrently since neither depends on the other.

### 4.2 The cache profile has to split in two

Caching is currently switched off in this repo (see `backup/with-cache/`), so this is a
hazard for whenever it comes back — and it must come back *audience-aware*, not as it was.
The parked implementation caches one thing per slug; personalization breaks that, because the
response now varies by audience.

> **Note:** caching remains **off**, and no permutation caching was built. When it returns, prefer the
> first-party helpers — `createOptimizationCacheKey`, `createPublicPermutationCacheMetadata`, and
> `assertOptimizationCacheSafety` (which throws on publicly caching profile-bearing output) — over
> hand-rolled `Vary`. And note the audience dimension for this space is the **query string**, not just
> the slug, because audiences key on `habitat`. `backup/with-cache/` also would not restore cleanly: it
> imports `../lib/draft` and `./routes/draft`, which no longer exist.

Two scopes are needed, and they must not be conflated:

| Scope | What it caches | Key |
|---|---|---|
| Public permutation | rendered variant per audience combination | slug + resolved audience set |
| Private request | nothing cacheable — profile-specific | not cached |

The failure mode if this is wrong is one visitor's personalized page being served to another,
which is a correctness and privacy bug rather than a performance one. Any shared cache in front
of the app (CDN, reverse proxy) needs `Vary` or cache-key handling that reflects the audience
dimension, not just the URL. The app currently sends `Cache-Control: no-store`, which is safe by
default; the parked cached variant sets `Cache-Control: public` on published pages, and **that
becomes unsafe the moment personalization is added**. Restoring the cache and adding
personalization must happen as one change, not two.

### 4.3 Turbo Drive breaks naive page tracking

> **Corrected — this section is wrong in both directions, and it is the most consequential error here.**
>
> **On page events:** the premise holds only for a *client-emitting* design. In this app a Turbo Drive
> visit **is a server request**, so the server emits a page event for every navigation. Adding a
> `turbo:load` emitter would **double-count every navigation** — not fix under-counting — and
> over-counting silently corrupts experiment results where under-counting is at least visible. The
> browser uses `trackCurrentPage({ initialPageEvent: "skip" })` unconditionally.
>
> **On observation:** the Web SDK installs its own document-wide `MutationObserver` filtered on
> `data-ctfl-entry-id`, so Turbo body swaps and Turbo Stream morphs need no re-binding. A Stimulus
> controller that tore observation down in `disconnect()` would **disable** tracking after the first
> navigation. The tracking controller's `disconnect()` is deliberately empty.
>
> What *is* true: `connect()` is the right hook — but because Turbo replaces `<body>` and the
> controller reconnects, not because of `turbo:load`. And `turbo-cache-control: no-cache` on
> personalized responses was necessary, as suspected.

This is the Hotwire-specific issue, and the one most likely to be missed.

Turbo Drive intercepts navigation and swaps the body without a fresh document load. Scripts in
`<head>` do not re-execute. So anything that fires a `page` event on script execution fires
**once per session**, not once per page — undercounting every navigation after the first.

The fix is to drive page events from Turbo's lifecycle:

```ts
document.addEventListener("turbo:load", () => {
  // fires on initial load AND on every Turbo navigation
});
```

Related consequences worth checking during implementation:

- Element-observation (`observeElement` / automatic DOM observation) must be re-established after
  each Turbo navigation and after each Turbo Stream update. A Stimulus controller gets this for
  free through `connect()` / `disconnect()`; anything registered globally does not.
- Turbo Drive's page cache can restore a previously-rendered page, including previously
  personalized HTML, from before a profile changed. `turbo-cache-control: no-cache` on
  personalized responses is likely necessary — the same reasoning already applied to draft
  renders in this repo.
- `turbo:load` fires on restore-from-cache too, so deduplicate if double-counting matters.

### 4.4 Interaction with Live Preview

The live-update path re-renders through `/preview/render`, replacing block DOM. Any tracking
bound to those elements is torn down and re-created. Keeping tracking inside a Stimulus
controller scoped to the blocks makes this automatic; binding listeners directly to elements at
load time does not.

For authoring, variants should almost certainly render as the baseline in preview unless an
audience is explicitly simulated, otherwise editors see whichever variant their own profile
happens to match.

## 5. What is genuinely custom work

> **Corrected:** "Re-binding observation after Turbo swaps" belongs in the **SDK** column, not the app's
> (§4.3 above). Three app-owned concerns are missing from the table: assembling the page context
> *including the query string*, the preview-panel → server re-render bridge, and timeout configuration
> — the SDK provides the knob, but its default of 3000 ms × 2 attempts is unsafe inside a
> server-rendered request.

Apply Digital were previously told the React path is the happy path and that a non-React
implementation means reimplementing the reactivity the React SDK abstracts. With the
Optimization SDK's Node package that story improves substantially, because server-side variant
selection needs no reactivity at all. What remains theirs to own:

| Concern | Owner | Notes |
|---|---|---|
| Profile ID cookie lifecycle | app | SDK is stateless by design |
| Consent capture and propagation | app | passed into `forRequest()` |
| Audience-aware cache keying | app | §4.2 — the highest-risk item |
| Variant swap at the render seam | app | one place: `ComponentResolver` |
| `page` events on Turbo navigation | app | §4.3 — the Hotwire-specific gotcha |
| Re-binding observation after Turbo swaps | app | Stimulus lifecycle handles it |
| Variant selection | SDK | `optimization-node` |
| View/click/hover tracking | SDK | `optimization-web` |

## 6. Recommended next step

Extend this repo rather than starting a new one: it already has the render seam, the request
context, and the cache abstraction the integration needs. Suggested order —

> **Corrected:** step 1 was already done before this was written. The repo's
> `contentful-export-*.json` is stale — it predates `nt_audience` / `nt_experience` / `nt_mergetag` and
> the `nt_experiences` fields on **both** `hero` and `duplex` — so README setup step 7 will not
> reproduce this demo in a fresh space. Also note `optimizationContextId` is absent from all
> server-rendered tracking attributes: it is stateful-only by design, not a missing feature.

1. Configure an experience with two variants on the `hero` content type in space `zh1nhbmve68h`.
2. Add the middleware and the `ComponentResolver` variant swap. Confirm the variant renders in
   the initial HTML, with no client-side content shift.
3. Split the cache scopes (§4.2) **before** anything goes in front of a CDN.
4. Add the tracking controller and verify `page`, `track` and `component` events with
   [Live Events](https://www.contentful.com/help/personalization/live-events/) in the web app.
5. Navigate between two pages via Turbo and confirm the second `page` event fires (§4.3).

## References

- [Optimization SDK overview](https://www.contentful.com/developers/docs/personalization/optimization-sdk/overview/)
- [Choose the right SDK](https://www.contentful.com/developers/docs/personalization/optimization-sdk/choose-the-right-sdk/)
- [Integrate the Node SDK into a Node app](https://www.contentful.com/developers/docs/personalization/optimization-sdk/integrate-the-node-sdk-into-a-node-app/)
- [Interaction tracking in Node and stateless environments](https://www.contentful.com/developers/docs/personalization/optimization-sdk/interaction-tracking-in-node-and-stateless-environments/)
- [Turbo Drive lifecycle events](https://turbo.hotwired.dev/reference/events)
- Jira CCS-3189 — Hotwire signal
