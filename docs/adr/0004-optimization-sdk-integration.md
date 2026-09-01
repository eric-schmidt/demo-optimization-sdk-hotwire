# ADR 0004 — Contentful Personalization on Hotwire

**Status:** Accepted — 2026-08-25.
**Supersedes in part:** `docs/optimization-sdk-hotwire-fit.md` §3–§5 (see §"Corrections" there).

## Context

Allegiant Air, via Apply Digital, is standardising on Hotwire over Node + TypeScript
(Jira **CCS-3189**). Contentful Personalization has no Hotwire-specific SDK and will not get one —
Hotwire is a client-side toolkit usable behind any server language, so there is nothing
framework-specific to bind to. The question this ADR answers is what a first-class Personalization
integration looks like on that stack.

`docs/optimization-sdk-hotwire-fit.md` was the desk assessment. Its division-of-labour argument held
up; its code sketches did not. This records what was actually built and why.

The content side needed no work: space `zh1nhbmve68h` already has `nt_audience`, `nt_experience` and
`nt_mergetag`, both `hero` and `duplex` carry `nt_experiences`, and there are 4 audiences and 5
published `nt_personalization` experiences. **All four audiences target the `habitat` query
parameter** via `context_page_query`.

## Decision

Use **`@contentful/optimization-node`** for server-side variant selection and
**`@contentful/optimization-web`** for browser interaction tracking, plus
**`@contentful/optimization-web-preview-panel`** for audience simulation during authoring. Not
`-react-web`, `-nextjs`, or `-react-native`.

### Manual resolution, not SDK-managed fetching

The singleton is constructed **without** a `contentful: { client }` key. This app already fetches the
whole `landingPage` graph — every variant included — in one CDA call, so
`optimization.resolveOptimizedEntry(baseline, selections)` is a pure local function over data already
in hand. Managed `fetchOptimizedEntry(entryId)` would issue an extra Contentful request per block for
content we hold.

Consequence: the only per-request network cost personalization adds is one Experience API call.

*Rejected:* managed fetching, which reads better in the docs but doubles the request count here.

### Resolution happens before JSX, in a pure module

`src/lib/optimization-render.ts` turns `BlockEntry[]` into `ResolvedBlock[]`. `ComponentResolver`
remains the single *render* seam; only data preparation moved one step earlier, next to the existing
`blocksFromPages`.

Because `hono/jsx` stringifies lazily, a resolver failure inside a component would surface as a
half-streamed body. Eager resolution makes it a clean 500 through `app.onError` instead — and makes
the whole decision testable from `scripts/smoke.tsx` with no credentials.

### Values passed as props, not `hono/jsx` context

`createContext`/`useContext` *do* work here (`hono/jsx` uses `AsyncLocalStorage` via
`process.getBuiltinModule`; `.nvmrc` pins Node ≥ 22). It was still the wrong tool:

- The chain is two hops with no indifferent intermediate — `BlockList` already took `blocks`, so only
  its *type* changed. There is no prop being threaded through layers that don't use it.
- `ResolvedBlock` is a self-contained value carrying its own entry and attributes, so there is no
  ambient per-request state left to distribute.
- A context needs a Provider at **two** call sites (`routes/page.ts` and `routes/preview.ts`, which
  calls `BlockList` directly) — more plumbing, not less.
- Decisively: a missing prop fails `tsc`; a missing Provider yields the context default, which is a
  **silent baseline**. Silent baseline is the failure mode this entire integration is built to avoid.

*Revisit if* a block ever renders nested personalized sub-blocks. See "Deferred work" §1.

*Accepted cost:* `Hero`/`Duplex` must spread `trackingAttributes`, and a new component could forget.
`scripts/smoke.tsx` asserts every mapped content type emits `data-ctfl-entry-id`.

### Tracking attributes spread onto each component's existing root

Built server-side with the SDK's own `resolveOptimizedEntryTrackingAttributes`, which is isomorphic
and safe to import on the server, then normalised to strings — the SDK's click detector selects on the
literal `[data-ctfl-clickable="true"]`, so a valueless attribute would silently disable clicks.

*Rejected:* a wrapper element. `#page-blocks` is `lg:flex flex-col`, so a wrapper changes which node
is the flex item — a layout regression against ADR 0003's preserve-the-markup rule. (The SDK does
support `display: contents` tracking hosts if a wrapper is ever preferable.)

### The morph anchor always comes from the baseline

`domId` is `blockDomId(baseline)`, never the resolved entry. A variant swap that changed
`id="block-…"` would make the Turbo Stream's `update` + `morph` delete and re-insert the section
rather than patch it, losing scroll position and the Live Preview inspector overlay the morph exists
to preserve. Verified: forcing beach and forest through `/preview/render` keeps both anchors on the
baseline ids.

### The server owns page events; the browser always skips

**`emitPageEvent()` in `src/lib/optimization.ts` is the only place `page()` is called.** It is the
ignition for the whole loop: no accepted page event means no selections, which means baseline.

A Turbo Drive visit **is** a server request, so the server emits for *every* navigation, not just the
first. The browser therefore calls `trackCurrentPage({ routeKey, initialPageEvent: "skip" })`
unconditionally, and the handoff payload carries `initialPageEvent: "skip"` as part of its contract.

*Rejected:* the fit doc's `turbo:load`-driven client emission. On this architecture it would
**double-count every navigation** — the opposite of the under-counting it was written to fix, and
worse, because over-counting silently corrupts experiment results while under-counting is visible.

`connect()` is the hook rather than a `turbo:load` listener: the controller is mounted on `<main>`,
inside `<body>`, so Turbo replaces it on every navigation and the controller reconnects. It sits
*outside* `#page-blocks` so a Turbo Stream morph cannot tear the SDK down mid-session.

### The tracking controller's `disconnect()` is deliberately empty

The Web SDK installs its own document-wide `MutationObserver` filtered on `data-ctfl-entry-id`, so
Turbo body swaps and Turbo Stream morphs are picked up unaided. Tearing observation down in
`disconnect()` would **disable** tracking after the first navigation. This corrects fit doc §4.3's
second bullet. Contrast `LivePreviewController`, which must unsubscribe because it owns a real
subscription.

### Draft renders are baseline and emit nothing

Draft requests get no request-bound client at all, so no page event and `selections === undefined`.
Three reasons: an editor must see what they are editing rather than whichever variant their own
profile matched; editor traffic is not visitor traffic and should not pollute Live Events or a
visitor's profile; and it makes the panel's first override a visible baseline→variant transition,
which is the demo.

The panel bundle constructs the Web SDK with `autoTrackEntryInteraction` all-false, so a draft page
reports nothing at all. This matters more than it first appears: the server stamps `data-ctfl-*` on
draft pages too (baseline-shaped, so Live Preview morphs keep working), and the SDK's MutationObserver
would otherwise observe them and report an editor scrolling and clicking around the authoring UI as
visitor engagement.

*Rejected:* suppressing via `defaults: { consent: false }`. It would also work, and would additionally
fail-closed on `track`/`page`, but the panel reaches the SDK through a Core state interceptor and
disabling consent risks the bridge itself — a trade not worth making when the interaction flags target
exactly the events in question. Worth revisiting once the consent path is exercised in a browser.

### One writer to `#page-blocks`, carrying the full input pair

During authoring, two independent things want to re-render: the Live Preview SDK on a field edit, and
the panel on a forced audience. Racing them loses state.

So neither renders. Both push into `src/client/preview-render.ts`, which holds the pair
*(entry graph, selections)* and posts **both** on every render. A field edit re-renders under the
currently forced audience; forcing an audience re-renders with the latest patched fields. There is no
precedence question to get wrong.

> **Precedence rule.** `#page-blocks` has exactly one writer: `POST /preview/render`. Its input is the
> pair *(entry graph, selections)*. The graph is owned by the Live Preview SDK; the selections are
> owned by the Web SDK's `states.selectedOptimizations`, which the panel overrides through a Core
> state interceptor. Every render sends both, so neither input can clobber the other. The most recent
> POST wins; older in-flight responses are dropped by sequence number. A morph cannot re-trigger a
> POST, because the selections signal is not DOM-derived and a fingerprint guard absorbs the
> observable's replayed first emission.

Two implementation traps here, both found only after the panel was wired up and both worth stating
plainly because they are invisible until you exercise the real flow:

- **`ContentfulLivePreview.subscribe()` does not invoke its callback on subscribe.** It registers the
  subscription and posts a `SUBSCRIBED` message; the callback fires only from the `ENTRY_UPDATED`
  handler — i.e. once per actual edit. (`useContentfulLiveUpdates` returns initial data synchronously,
  which is where the opposite assumption comes from.) So on a freshly-loaded draft page there is no
  entry graph yet, and a panel-forced audience had nothing to render against — it silently did nothing
  until the editor typed. **The bridge therefore reads the server-embedded
  `script[data-live-preview-data]` graph itself** rather than waiting to be handed one, which removes
  the ordering dependency between the two controllers entirely.
- **The single writer's state must live on `window`, not in module scope.** `preview-render.ts` is
  imported by both `live-preview.ts` and `optimization-preview.ts`, and esbuild bundles each entrypoint
  independently — so each bundle ships its own copy. Module-level state gives the two copies separate
  `inputs`, turning the single writer back into two writers: a field edit posts
  `selectedOptimizations: undefined` and drops the forced audience, while a panel override posts a stale
  graph and drops the edit. State is shared via `window.__ctflPreviewRender`, the same trick `app.js`
  already uses to hand Turbo and Stimulus to the other bundles. **This is the second time bundle
  duplication broke a "shared" thing in this integration** — the first being `optimization-core`'s
  signals — and it is the failure mode to check first whenever something in these bundles appears not
  to be talking to something else.

`createSelectionFingerprint` is used for that guard. It is a first-party helper available on both
sides, so the server-stamped and browser-computed values agree. **It is not a cache key and nothing is
cached with it.**

`/preview/render` keeps its existing draft-cookie gate and still makes **zero Contentful requests** —
the posted graph already contains every variant, so resolution is local. That matters: re-fetching per
keystroke would run into the 14 req/s CPA limit the endpoint was created to avoid. The new
`selectedOptimizations` parameter is strictly less powerful than the entry graph the endpoint already
accepted: a selection can only pick among variants already present in the posted payload.

### Inspector outlines over the panel: `hideCoveredElementOutlines`

Live Preview's blue inspector outlines are **not drawn in this document**. `@contentful/live-preview`
creates no DOM at all — zero `createElement`, no CSS, no z-index anywhere in its dist — it posts
`MOUSE_MOVE` / `TAGGED_ELEMENTS` / `INSPECTOR_MODE_CHANGED` to the editor, and the editor paints the
overlay in the **parent frame, over the entire iframe**.

Two consequences worth stating plainly, because both were learned the hard way:

1. **No z-index can fix this.** The panel is inside the iframe; the overlay is a level above it. The
   panel's `:host` is already `z-index: 999999`. Raising anything is meaningless.
2. **The panel must stay an overlay.** It is a fixed 24rem drawer and that is its intended behaviour.

The lever used is the platform's own, one line in `ContentfulLivePreview.init()`:

```ts
experimental: { hideCoveredElementOutlines: true }
```

The SDK computes, per tagged element, whether it is covered, and the editor suppresses those outlines.

**It is partial, by design.** The implementation runs `elementFromPoint` at all four corners and
treats an element as covered only when **fewer than two** corners are its own:

```js
return [d(topLeft), d(topRight), d(bottomLeft), d(bottomRight)].filter(Boolean).length < 2
```

A block whose right edge runs under the drawer keeps both left corners, so it is still considered
visible and still gets an outline across the panel. This reliably helps elements mostly beneath the
drawer, not partially covered ones. Accepted as the best available trade rather than a complete fix.

**Alternatives tried and rejected:**

- *Reflowing the page out from under the drawer* (`body:has(ctfl-opt-preview-panel[data-open]) > main
  { margin-right: 24rem }`, keyed off the `data-open` attribute the panel reflects on its host). This
  works and is pure CSS, but it turns the drawer into a squeeze rather than an overlay, which is not
  how the panel is meant to behave.
- *Suppressing inspector mode entirely while the drawer is open* (via `toggleInspectorMode()` driven
  off `states.previewPanelOpen`). Heavy-handed — it costs click-to-edit for as long as the panel is
  open — and it did not visibly resolve the overlap.

**Note this combination is unaddressed upstream.** None of the 14 reference implementations in the
SDK monorepo pair the preview panel with Live Preview, and `implementations/PREVIEW_PANEL_SCENARIOS.md`
does not mention inspector mode. If the residual partial-overlap matters for a customer demo, the
upstream ask is a covered-region test more granular than two-of-four corners.

### The panel is fed pre-fetched entries, not a Contentful client

`GET /preview/optimization-entries`, draft-gated, returns `{ audiences, experiences }` with
`includes.Entry` preserved so variant names display. This app ships **zero** Contentful credentials to
the browser, and handing the panel a client would end that. A JSON endpoint rather than page-embedded
JSON, because two include-resolved collections would otherwise be re-serialised into every draft
response.

### Four bundles; exactly one optimization bundle per page

| Output | Contents | Loaded when |
|---|---|---|
| `app.js` | Turbo + Stimulus | always |
| `optimization.js` | Web SDK, tracking, track/identify demos | configured **and not** draft |
| `optimization-preview.js` | the same SDK **plus** panel and bridge | configured **and** draft |
| `live-preview.js` | Live Preview SDK + controller | draft |

The panel talks to the SDK through a bridge built on `optimization-core`'s module-level signals, so
**two bundled copies of core would give the panel a different signal registry** and its overrides
would never reach the SDK. Panel and SDK must therefore share a bundle. But the panel must never reach
a published visitor — hence two entry *files*: `optimization.js` never references the panel, so it
structurally cannot contain it, with no reliance on dead-code elimination reaching through a dynamic
import. Verified: zero `ctfl-opt-preview` strings and zero `customElements.define` calls in
`optimization.js`.

Loading both would throw `ContentfulOptimization is already initialized`; smoke asserts it never
happens.

### `track` and `identify` demos

Both on the Web SDK, in an env-gated `optimization-demo` control
(`CONTENTFUL_OPTIMIZATION_DEMO_CONTROLS`, **on by default**; set `false` for a render
markup-identical to the Next.js original). Both surface `{ accepted }` so the consent boundary is
visible rather than mysterious.

- **`track`** emits `demo_event` with properties. Note the pre-consent allow-list is
  `['identify', 'page']` only, so `track` is refused without consent. ⚠️ **The event name must match
  the event the experience's primary metric is configured for**, or it is delivered and counts toward
  nothing. `[Desert] Homepage Hero` carries a `primaryMetric`; confirm its event name in the web app.
- **`identify`** aliases the visitor and attaches traits. It returns *new selections*, because
  aliasing can change audience membership.

> **General rule this exposes.** In a server-rendered app, any browser-side event that mutates profile
> state needs a re-render to have visual effect. A browser-rendered app re-resolves its entries from
> the new selections; this one cannot, because the HTML already came from the server. So `identify`
> is followed by `Turbo.visit(location.href, { action: "replace" })`, and the server re-selects using
> the profile id in the `ctfl-opt-aid` cookie. `track` needs no re-render.

The production ordering for a logged-in user is server-side: `identify()` **before** `page()`, since
identify can change what `page()` selects.

### Consent comes from a third-party CMP cookie, and both SDKs fail closed

An external consent platform owns the decision and publishes it as the `cmp-consent` cookie
(`"true"` / `"false"`); `src/lib/consent.ts` is the only place that reads it, so replacing the CMP is a
one-file change. Absent cookie means "not asked", which is treated as **not granted** but is kept
distinguishable from an explicit `false`.

**`allowedEventTypes: []` on both singletons is load-bearing, and this is the non-obvious part.**
The SDK's admission check is:

```ts
if (consent === true) return true
return allowedEventTypes.some((eventType) => eventType === method)
```

So `consent: false` and `consent: undefined` behave **identically** — both fall through to the
allow-list, and the default is `['identify', 'page']` in *both* the Node and Web runtimes. Left at the
default, setting consent to `false` still emits a page event, still costs an Experience API round trip
and still mints a profile. Verified empirically against an unreachable host: with the default list a
denied request attempted the network; with `[]` it was refused in 0ms with no request. Setting `[]` is
free when consent is granted, because `consent === true` short-circuits first.

Design points:

- The two axes are passed through independently (`{ events, persistence }`) rather than collapsed to one
  boolean, so "personalize but don't remember me" is expressible. `persistence: false` makes
  `canPersistProfile` false, which is already what gates the profile cookie.
- **Withdrawal deletes the profile cookie**, rather than merely not refreshing it — a visitor who
  consented yesterday and refused today should not keep a profile with no basis.
- The decision is forwarded to the browser with a `recorded` flag so the Web SDK's `defaults` are
  seeded `undefined` when nobody has been asked, instead of asserting a refusal.
- The route **skips** `page()` when consent forbids it. The SDK would refuse anyway, but declining to
  ask keeps a routine no-consent visit out of the warning log and puts the policy in the route rather
  than implicit in the SDK's admission rules.
- `applyConsent()` in `src/client/optimization.ts` is the seam a CMP callback calls to update the live
  browser SDK without a reload. Because the *server* selects the variant, newly-granted consent becomes
  visible on the next render — inherent to server-side selection, not a wiring gap.

The demo's Grant / Deny / Unset buttons are a CMP stand-in behind
`CONTENTFUL_OPTIMIZATION_DEMO_CONTROLS`; a real integration has none of them.

**The controls default to ON, and that is a consequence of fail-closed consent.** With them hidden, a
fresh visit rendered baseline for an invisible reason and read as "personalization is broken" — it was
reported as exactly that. Fail-closed is still the right default, so the fix was to make the state
legible rather than to loosen it: the panel server-renders *why* content is baseline and offers the one
click that resolves it. The alternative — treating an absent cookie as consent granted — was rejected
because it bakes a permissive default into the very example someone is most likely to copy.

*Supersedes the earlier "demo grants consent unconditionally" posture recorded elsewhere in this ADR.*

### Degradation: baseline is structural at five layers

The sibling Next.js demo measured an Experience API outage producing HTTP 200 with an **empty**
personalized region rather than a fallback. Five independent layers prevent that here:

1. No client id ⇒ no singleton ⇒ no request client ⇒ `resolveBlocks` short-circuits ⇒ no bundle
   emitted. The app behaves exactly as it did before personalization.
2. `fetchOptions: { requestTimeout: 700, retries: 0 }`. The SDK default is 3000 ms with 1 retry, i.e.
   ~6 s inside a server-rendered request.
3. `emitPageEvent` never throws — one try/catch at the SDK/route boundary.
4. `Promise.allSettled`, so a rejected optimization call cannot fail the content fetch.
5. A per-block try/catch in `resolveBlocks`.

Verified with a garbage client id: HTTP 200, full baseline including both images and tracking
attributes, in **89 ms** — not 6 s — logging
`[optimization] page event failed; rendering baseline`. The underlying error is the same
"may not be retried" the sibling repo hit; the difference is that it is caught.

### Include depth raised from 4 to 10

Empirically the current graph resolves fully at 4, because the deepest *entry* in the chain sits at
level 4 and assets referenced by included entries return regardless of depth. That is one level of
headroom, and **a link left unresolved past the include depth resolves to baseline silently**. 10
removes the counting argument and matches the SDK's own managed fetching. Amends port-plan §8 item 1,
which pinned `include=4` as an invariant.

### Caching stays off

`Cache-Control: no-store` on every response, and `turbo-cache-control: no-cache` is now emitted for
**personalized** responses too, not only draft ones — Turbo's page cache would otherwise restore one
audience's HTML for another after a back navigation. That is a correctness bug, not a staleness
annoyance, and it costs instant back-navigation.

**No permutation caching.** No `createOptimizationCacheKey`, no
`createPublicPermutationCacheMetadata`, no `Explicit*` resolver, no cached route, and
`backup/with-cache/` is untouched. The handoff's `cache.scope` is `private-request`, which is what
lets `assertOptimizationCacheSafety` pass — the SDK actively throws on publicly caching
profile-bearing output.

### Audience matching is fully native

The app never reads `habitat` to make a decision. It passes the request's query parameters into
`eventContext.page` via the SDK's own `createPageContextFromUrl`, and the Experience API evaluates the
rules, creates or continues the profile, and returns selections. There is no app-owned targeting
logic and no query-param-to-variant mapping anywhere. `habitat` appears in app code only as cosmetic
metadata on the demo `track` event and inside the page-event `routeKey` used for dedupe — neither
influences selection.

### Profile continuity is app-owned

Cookie name from `ANONYMOUS_ID_COOKIE` (`ctfl-opt-aid`), written only when
`request.canPersistProfile`. **`httpOnly: false` is deliberate** — the browser SDK reads the same
cookie, so HttpOnly would fork the profile between server and browser from the first request. Contrast
`PREVIEW_COOKIE`, which is HttpOnly because only the server reads it. `SameSite=None; Secure` on
HTTPS (required inside Contentful's cross-site preview iframe), falling back to `Lax` on plain
localhost — where the profile therefore does not persist.

## Consequences

### Positive

- The variant is in the **initial HTML**. No client-side content shift, no flash of baseline, and only
  the chosen variant is ever sent to the browser.
- One Experience API call per page view, no matter how many runtimes are involved, because the browser
  adopts the server's handoff instead of re-resolving.
- Templates still live in exactly one place; the published render, the draft render and every Turbo
  Stream all go through the same `ComponentResolver`.
- The published path still ships no Live Preview JS and no preview panel, structurally.
- 72 credential-free smoke assertions cover selection, controls, empty variants, bundle separation and
  attribute stringification.

### Negative

- Personalized responses cost one Experience API round trip: measured ~93 ms warm, and that round trip
  is essentially all of it.
- A larger CDA payload on every request at `include: 10`, with no cache in front.
- Draft renders ship the Lit-based panel (`optimization-preview.js` is ~279 KB vs ~153 KB).
- `resolveOptimizedEntry` does not clone; the rendered entry may point into the baseline graph, so it
  must never be mutated.
- Empty variants render nothing and therefore record no view event.
- `optimizationContextId` is absent from server-rendered attributes — it is stateful-only, by design,
  not a bug.
- Turbo's page cache is disabled on personalized pages, losing instant back-navigation.

## Deferred work and future considerations

Recorded here because the research is easy to lose and expensive to redo. Each item names the
**trigger** that should make someone revisit it.

1. **Switch to `hono/jsx` context** — *trigger:* a personalized block renders nested personalized
   sub-blocks, or components far apart in the tree need optimization state. Context works here
   (`AsyncLocalStorage`, Node ≥ 22). Migration cost is two Providers, in `routes/page.ts` and
   `routes/preview.ts`; missing either yields silent baseline, so pin it with a smoke assertion first.
   The pre-pass design keeps this cheap because resolution is not entangled with rendering.
2. **Permutation caching / a public-permutation route** — *trigger:* the demo needs to show cached
   personalization, or a CDN goes in front. Use the first-party helpers
   (`createOptimizationCacheKey`, `createPublicPermutationCacheMetadata`,
   `assertOptimizationCacheSafety`) rather than hand-rolled `Vary`. **Two scopes must not be
   conflated:** public-permutation (shareable) vs private-request (profile-specific, uncacheable);
   getting it wrong serves one visitor's page to another. **The audience dimension here is the query
   string**, not just the slug — a slug-only key is silently wrong. Sibling repo measured
   private-request p50 ≈ 96 ms vs public-permutation ≈ 8 ms. `backup/with-cache/` will not restore
   cleanly: it imports `../lib/draft` and `./routes/draft`, which no longer exist, and its
   `Cache-Control: public` becomes unsafe the moment personalization is on.
3. **Turbo Frames to isolate the personalized region** — *trigger:* caching returns, or the round trip
   becomes user-visible. This app uses zero frames today. A `<turbo-frame loading="lazy">` around the
   personalized blocks would let the shell cache publicly while only the frame is per-visitor — the
   Hotwire-native equivalent of the Next.js version's Suspense boundary, and quite possibly a better
   answer than splitting into two routes. Worth prototyping *before* building permutation caching.
4. **Merge tags** — *trigger:* anyone wants profile-backed text substitution. `nt_mergetag` **already
   exists in this space** and is unused. Guard with `isMergeTagEntry`, then
   `getMergeTagValue(entry, profile)`, which returns the authored fallback when no profile value
   exists. The cheapest next increment. Merge-tag output must never be share-cached.
5. **Custom Flags** — *trigger:* feature flagging. `getFlag(name)` is side-effect free in Node;
   exposure reporting needs an explicit request-bound `trackFlagView()`, unlike stateful runtimes.
6. **Experiments as distinct from personalization** — *trigger:* the demo needs a real A/B test. All
   five experiences here are `nt_type: "nt_personalization"`. Experiments make the CONTROL-arm rule
   load-bearing rather than merely correct. `[Desert] Homepage Hero` already has
   `distribution: [0.1, 0.9]` and a `primaryMetric`, so it is the closest thing already configured —
   measured 1 baseline / 19 variant over 20 requests, matching its distribution.
7. **Real CMP consent** — *trigger:* anything beyond a demo. The two axes are independent, and with no
   decision recorded the state is `undefined`, not `false`. Tighten with `allowedEventTypes: []` for
   fail-closed behaviour. The sibling repo wires OneTrust in `src/lib/consent.js`. `reset()` clears
   profile and selection continuity but not the app's own consent record.
8. **Analytics forwarding** — *trigger:* the customer wants events in GTM/Segment.
   `@contentful/optimization-web/analytics`; dedupe by `messageId`; hook `states.eventStream` and
   `states.blockedEventStream`.
9. **Client-side rendering via Web Components** — *trigger:* a region must personalize without a
   server round trip. `@contentful/optimization-web/web-components` provides
   `<ctfl-optimization-root>` / `<ctfl-optimized-entry>`. This is also what would make the preview
   panel work *without* the Turbo Stream bridge. Rejected for now because it reintroduces client-side
   rendering and a flash of baseline. `optimizationContextId` would start appearing on this path.
10. **Smaller items.** Server-side `track()` for conversions that happen off-click. Sticky `trackView`
    can establish a profile id, where non-sticky Insights calls require one already bound.
    `display: contents` tracking hosts as a wrapper alternative. Multi-locale: `setLocale()` changes
    future Experience/event locale only, and `locale=*` payloads cannot be resolved at all. A
    structured `toPlainJson` fallback if a true reference cycle ever appears in `nt_experiences`
    (resolve against raw `response.items`, stringify only the resolved output). Wiring `--dev` through
    `build:js`, which never receives it, so bundles are always minified. Regenerating the stale
    `contentful-export-*.json`, which predates the personalization content types — and redacting the
    plaintext webhook secret the README flags.

## References

- `docs/optimization-sdk-hotwire-fit.md` — the desk assessment, with corrections
- `docs/adr/0003-nextjs-to-hotwire-port.md` — the port this builds on
- Jira CCS-3189
