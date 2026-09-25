# Demo — Contentful Live Preview + Personalization on Hotwire

A Contentful **Live Preview, Personalization and Timeline** demo built with
[Hotwire](https://hotwired.dev/) — Turbo and Stimulus over server-rendered HTML. It began as a
one-to-one reimplementation of the Next.js version of this demo, rendering the same content, markup and
classes, and now also does server-side variant selection with the Contentful Optimization SDK and
previews scheduled Release content with Timeline.

**Stack:** Node + TypeScript, [Hono](https://hono.dev/) for routing and server-side HTML
rendering via `hono/jsx`, Turbo Drive for navigation, Stimulus for the small amount of
remaining JS, Tailwind v4. **No React is shipped to the browser.**

Why Node rather than Rails — and the rationale behind every other significant choice — is in
[`docs/plans/2026-08-25-nextjs-to-hotwire-port.md`](./docs/plans/2026-08-25-nextjs-to-hotwire-port.md)
(the port), [`docs/adr/0004-optimization-sdk-integration.md`](./docs/adr/0004-optimization-sdk-integration.md)
(personalization) and [`docs/adr/0005-timeline-preview.md`](./docs/adr/0005-timeline-preview.md)
(Timeline). Read those if you are picking this up cold. Agents should start with
[`AGENTS.md`](./AGENTS.md).

## What this demonstrates

The point of this repo: **a non-React, server-rendered stack is a first-class Contentful target, not a
compromise.** Variant selection happens on the server, so personalized content is in the initial HTML —
no client-side swap, no flash of baseline, and only the selected variant is ever sent to the browser.

| Capability | Status |
| --- | --- |
| **Live Preview** — preview mode, inspector mode, live updates | ✅ |
| **Timeline** — preview content as of a scheduled Release | ✅ |
| **Variant selection** — server-side, in the initial HTML | ✅ |
| **`page` tracking** — the event that returns the selections | ✅ |
| **Interaction tracking** — views + clicks on `data-ctfl-*` | ✅ |
| **`track`** — custom metric events from a real interaction | ✅ |
| **`identify`** — profile aliasing + custom traits | ✅ |
| **Consent** — third-party CMP cookie, fail-closed | ✅ |
| **Audience simulation** — first-party preview panel, bridged to the server | ⚠️ partial |
| **Caching / permutation caching** | ❌ deliberate — parked in [`backup/with-cache/`](./backup/with-cache) |
| **Merge tags, Custom Flags, experiments** | ❌ not built — see [ADR 0004](./docs/adr/0004-optimization-sdk-integration.md) deferred work |

### How each piece works

Symbol names rather than line numbers, so these pointers do not rot silently as the code moves.

#### Live Preview — preview mode, inspector mode, live updates

Three independent mechanisms, covered in detail in [§Live Preview](#live-preview) below: an HMAC preview
cookie selects the Preview API; `includeContentSourceMaps` embeds steganographic metadata that lands in
the server-rendered HTML, so **inspector mode needs no field tagging at all**; and live updates round-trip
the patched entry graph back through the same server templates as a Turbo Stream.

- [`lib/preview.ts`](./src/lib/preview.ts) — `isPreviewRequest()` / `enablePreview()`, the cookie
- [`routes/preview.ts`](./src/routes/preview.ts) — enter/leave preview, `POST /preview/render`
- [`client/live-preview.ts`](./src/client/live-preview.ts) — `LivePreviewController`

#### Timeline — previewing a scheduled Release

The Contentful web app's timeline selector reloads the preview iframe with a `timeline` token
(`releaseId;timestamp`, **empty** when the editor is on current content). `timelineFromToken()` parses and
validates it; `getClient()` passes it to `createClient({ timelinePreview })` on the **preview branch only**,
and the SDK rewrites its own request paths to `/timeline/entries` and `/timeline/assets`. No GraphQL
directive and no hand-rolled REST calls — `contentful.js` is framework-agnostic, so **Hotwire needed no
special treatment here at all**.

Because the preview handshake 302s to a bare path, the token is forwarded on that redirect as a query
parameter, and the panel's entries fetch carries it too, so the whole draft render sits on one scope.

**Every draft render states its scope on screen** — including "current content". That is the feature, not
decoration: Timeline resolution falls back silently (requested release → previous scheduled release →
published), so a page that renders proves nothing. See [§Timeline preview](#timeline-preview).

- [`lib/timeline.ts`](./src/lib/timeline.ts) — `timelineFromToken()`, and the three values that look like
  tokens but are not
- [`lib/contentful.ts`](./src/lib/contentful.ts) — `getClient()`, where `timelinePreview` is gated on `preview`
- [`views/Layout.tsx`](./src/views/Layout.tsx) — `TimelineBanner`

#### Variant selection — server-side

The Contentful fetch returns the whole `landingPage` graph *including every variant*, so
`resolveOptimizedEntry(baseline, selections)` is a **pure, local, network-free** call — no managed
fetching and no extra request per block. Resolution happens in one module *before* JSX, so a resolver
failure is a clean 500 rather than a half-streamed body, and the whole decision is unit-testable without
credentials. `ComponentResolver` remains the single render seam for the published page, the draft page
and every Turbo Stream.

- [`lib/optimization-render.ts`](./src/lib/optimization-render.ts) — `resolveBlocks()`, the entire decision
- [`lib/optimization.ts`](./src/lib/optimization.ts) — the process singleton (no `contentful` client, deliberately)
- [`components/ComponentResolver.tsx`](./src/components/ComponentResolver.tsx) — the render seam

#### `page` tracking — the event that returns the selections

Emitted **server-side, once per render, from exactly one call site**. Its return value *is*
`selectedOptimizations`, so no accepted page event means baseline everywhere. It runs concurrently with
the content fetch (`Promise.allSettled`, so an Experience API failure cannot fail the page), and the
request is bound with `forRequest()` whose `eventContext.page` carries the query string the audiences
match on.

- [`lib/optimization.ts`](./src/lib/optimization.ts) — `emitPageEvent()`, the only `page()` call in the repo; `forRequestFromContext()` builds the page context
- [`routes/page.ts`](./src/routes/page.ts) — the concurrent fetch + event
- [`client/optimization.ts`](./src/client/optimization.ts) — the browser passes `initialPageEvent: "skip"` on **every** navigation, because a Turbo visit is itself a server request

#### Interaction tracking — views and clicks

The **server** stamps `data-ctfl-*` onto each block, built with the SDK's own isomorphic
`resolveOptimizedEntryTrackingAttributes` and normalised to strings (the click detector selects on the
literal `[data-ctfl-clickable="true"]`). The browser SDK then observes those elements with its own
document-wide `MutationObserver` — which is why Turbo swaps and Turbo Stream morphs need no re-binding,
and why the controller's `disconnect()` is deliberately empty.

- [`lib/optimization-render.ts`](./src/lib/optimization-render.ts) — attributes built server-side
- [`components/Hero.tsx`](./src/components/Hero.tsx) — spread onto the existing `<section>` (no wrapper: `#page-blocks` is a flex column)
- [`client/optimization.ts`](./src/client/optimization.ts) — `getSdk()` + `autoTrackEntryInteraction`, and the empty `disconnect()`

#### `track` — a custom metric event from a real interaction

A CTA wired through a Stimulus action calls `sdk.track({ event, properties })` and surfaces the returned
`{ accepted }`, which makes the consent boundary visible rather than mysterious — `track` is refused
before consent, unlike `page` and `identify`.

- [`client/optimization.ts`](./src/client/optimization.ts) — `sendDemoEvent()`
- [`views/DemoControls.tsx`](./src/views/DemoControls.tsx) — the button (env-gated)

#### `identify` — profile aliasing and custom traits

`sdk.identify({ userId, traits })` aliases the visitor. Because aliasing can change audience membership,
identify returns *new* selections — and a server-rendered page cannot react to those on its own, so an
accepted identify is followed by a Turbo visit and the **server** re-selects using the `ctfl-opt-aid`
cookie. The general rule: browser-side profile mutations need a re-render to have visible effect.

- [`client/optimization.ts`](./src/client/optimization.ts) — `identifyDemoUser()` and the re-render
- [`lib/profile-cookie.ts`](./src/lib/profile-cookie.ts) — the cookie carrying the alias forward

#### Consent — third-party CMP cookie, fail-closed

One module reads the `cmp-consent` cookie and returns a decision with **two independent axes**
(`events`, `persistence`) plus a `recorded` flag, so "not asked" stays distinguishable from an explicit
no. It is passed into `forRequest()` server-side and seeded into the browser SDK's `defaults`. Both
runtimes set `allowedEventTypes: []`, which is what makes refusal actually mean refusal — see
[§Consent](#consent) for why that is required rather than defensive. The `persistence` axis flows into
`canPersistProfile`, which gates the profile cookie; withdrawal actively deletes it.

- [`lib/consent.ts`](./src/lib/consent.ts) — `readConsent()`, the only place the CMP is read
- [`lib/optimization.ts`](./src/lib/optimization.ts) — `allowedEventTypes: []` and both axes into `forRequest()`
- [`client/optimization.ts`](./src/client/optimization.ts) — browser `defaults` seeded from the server's decision; `applyConsent()` is the seam a CMP callback calls
- [`lib/profile-cookie.ts`](./src/lib/profile-cookie.ts) — `clearProfileId()` on withdrawal

#### Audience simulation — the preview panel, bridged to the server

The first-party panel is a browser micro-frontend that forces an audience by mutating the SDK's selection
signal — which does nothing on its own here, because the **server** renders. A bridge subscribes to that
signal and posts the forced selections to `POST /preview/render`, which resolves them against the
already-embedded entry graph and replies with a Turbo Stream that morphs the blocks in place.
**One writer owns `#page-blocks`** and always posts *both* the entry graph and the selections, so a field
edit cannot drop a forced audience or vice versa. Zero Contentful requests, and the panel is fed
pre-fetched entries so no Contentful credential ever reaches the browser.

- [`client/optimization-preview.ts`](./src/client/optimization-preview.ts) — subscribes to the selection signal
- [`client/preview-render.ts`](./src/client/preview-render.ts) — the single writer (state on `window` — see [AGENTS.md](./AGENTS.md) trap 1)
- [`routes/preview.ts`](./src/routes/preview.ts) — `POST /preview/render`, resolves and returns the Turbo Stream
- [`routes/optimization.ts`](./src/routes/optimization.ts) — draft-gated audience/experience feed for the panel

#### Supporting pieces

| Piece | How | Code |
| --- | --- | --- |
| Four client bundles, one optimization bundle per page | Separate esbuild entry *files*, so the panel structurally cannot reach the published bundle | [`scripts/build-client.mjs`](./scripts/build-client.mjs) |
| Baseline on outage | `requestTimeout: 700, retries: 0` + try/catch + `allSettled` + a per-block catch | [`lib/optimization.ts`](./src/lib/optimization.ts) |
| Handoff to the browser | Server embeds profile + selections so the browser adopts them instead of re-resolving | [`views/Layout.tsx`](./src/views/Layout.tsx) |
| Credential-free test suite | 104 assertions rendering fixtures through the real resolver | [`scripts/smoke.tsx`](./scripts/smoke.tsx) |

> **⚠️ Known issue.** Live Preview's inspector outlines are drawn by the Contentful editor in the
> *parent* frame, over the whole iframe, so they render on top of the preview panel and no z-index in
> this app can change that. `hideCoveredElementOutlines` is enabled, which helps only for elements
> mostly covered. Rejected alternatives and the reasoning are in ADR 0004.

### Where things live

```
src/
  server.ts                      Hono app + the single per-request middleware
                                 (preview flag, consent decision, optimization
                                 client, Timeline release scope)
  routes/
    page.ts                      GET /:slug — the whole request path
    preview.ts                   preview mode + POST /preview/render (Turbo Stream)
    optimization.ts              GET /preview/optimization-entries (panel data)
  lib/
    contentful.ts                CDA/CPA clients, the one query, toPlainJson
    optimization.ts              SDK singleton, forRequest(), emitPageEvent()  ← page event lives here
    optimization-render.ts       PURE variant selection + data-ctfl-* attributes
    consent.ts                   reads the third-party CMP cookie
    profile-cookie.ts            ctfl-opt-aid lifecycle (app-owned by design)
    timeline.ts                  parses/validates the timeline token (the whole trust boundary)
    blocks.ts  image.ts  preview.ts  locale.ts  types.ts
  components/
    ComponentResolver.tsx        the single render seam (entry -> component)
    ComponentMap.ts  Hero.tsx  Duplex.tsx
  views/
    Layout.tsx                   <head>, bundles, handoff JSON, controller mounts,
                                 the Timeline scope banner
    DemoControls.tsx  NotFound.tsx
  client/                        four esbuild entrypoints -> public/assets/
    index.ts                     app.js                  Turbo + Stimulus (every page)
    optimization.ts              optimization.js         Web SDK, tracking, track/identify
    optimization-preview.ts      optimization-preview.js Web SDK + preview panel (DRAFT only)
    live-preview.ts              live-preview.js         Live Preview SDK (DRAFT only)
    preview-render.ts            the single writer to #page-blocks (shared via window)
scripts/
  smoke.tsx                      104 credential-free render/logic assertions
  build-client.mjs               the four-bundle esbuild config
```

## Initial Setup

1. Run `nvm use` to ensure you are on the correct version of node.
2. Run `npm install` to install all dependencies.
3. Copy `.env.local.example` and rename to `.env.local`.
4. Populate `.env.local` with values for `CONTENTFUL_SPACE_ID`, `CONTENTFUL_ENV_ID`,
   `CONTENTFUL_DELIVERY_KEY`, and `CONTENTFUL_PREVIEW_KEY`.
5. `CONTENTFUL_PREVIEW_SECRET` is a key you invent; it gates the Content Preview URL.
6. `CONTENTFUL_OPTIMIZATION_CLIENT` and `CONTENTFUL_OPTIMIZATION_ENV_ID` configure
   personalization (the environment is `main` for this demo). Both are optional: without a client id
   every render serves baseline content and no personalization JS is sent at all.
   `CONTENTFUL_OPTIMIZATION_DEMO_CONTROLS` controls the demo panel (consent / `track` / `identify`).
   It is **on by default**; set it to `false` for a clean render.
7. Import the content model with the Contentful CLI:

   ```bash
   contentful space import \
     --space-id <YOUR SPACE ID> \
     --environment-id <YOUR ENVIRONMENT ID> \
     --content-file contentful-export-zh1nhbmve68h-master-2026-08-11T09-14-44.json
   ```

   > ⚠️ **This export is stale and will not reproduce the personalization demo.** It predates the
   > Personalization app install, so it has no `nt_audience` / `nt_experience` / `nt_mergetag` content
   > types and no `nt_experiences` field on `hero` or `duplex`. Importing it into a fresh space gives
   > you the Live Preview demo only. Re-export from `zh1nhbmve68h` if you need the full thing — and
   > read the security note at the bottom of this file first.

   > Use the export file, **not** `content-model.json`. That file is an unrelated
   > Ninetailed-era model (`page` / `componentHeroBanner` / `componentDuplex`); this app
   > queries `landingPage` / `hero` / `duplex` / `mediaWrapper`, so importing it leaves the
   > app rendering nothing. The Next.js README pointed at the wrong file.

8. Configure a Content Preview URL in Contentful:

   ```
   https://<YOUR HTTPS HOST>/preview?secret=<CONTENTFUL_PREVIEW_SECRET>&type=landingPage&slug={entry.fields.slug}&timeline={timeline}
   ```

   > `type` must be `landingPage`. Note this has to be an **HTTPS** host — see
   > [Live Preview locally](#live-preview-locally) below.

   > **`&timeline={timeline}` is what makes Timeline work, and its absence is invisible.** Contentful
   > expands the placeholder to `releaseId;timestamp` when the editor has a release selected, and to an
   > empty string on current content. Without it every preview silently renders current content and the
   > on-screen banner will — correctly, unhelpfully — say "current content". This lives in space
   > configuration, so no code review in this repo can catch it: check it first when Timeline looks
   > broken.

No webhook is needed. Nothing is cached, so there is nothing to invalidate.

## Getting Started

```bash
npm run dev     # build assets, then start with watch
npm start       # build assets, then start once
npm run build   # build assets + typecheck
npm run smoke   # render invariant checks (no credentials needed)
```

Then open <http://localhost:3000>. `/` redirects to `/home`, the only slug in the demo space.

> **First run shows baseline content.** Consent is fail-closed and no CMP decision exists yet, so no
> `page` event is sent and every block renders its baseline. Click **Grant** in the demo panel
> (bottom-left) and `?habitat=beach` / `?habitat=forest` will start swapping variants. See
> [§Consent](#consent).

## How it works

```
GET /:slug ──► routes/page.ts ──┬─► lib/contentful.ts ────► CDA (published) / CPA (draft)
                                └─► lib/optimization.ts ──► Experience API  (published only)
                                       emitPageEvent()
                     │
                     ├─► lib/optimization-render.ts  resolveBlocks(blocks, selections)
                     └─► views/Layout ──► components/ComponentResolver ──► Hero | Duplex
```

The content fetch and the Experience API call run concurrently — neither depends on the other. The
`page` event is what returns the variant selections, so it is the ignition for the whole
personalization loop, and it is emitted in exactly one place: `emitPageEvent()` in
`src/lib/optimization.ts`.

Requests are served as complete HTML. Turbo Drive then intercepts subsequent navigations and
swaps the body rather than reloading, and Stimulus attaches behaviour to what is already
there. There is no client-side rendering and no hydration.

### Routes

```
GET    /                 redirect to /home
GET    /:slug            render a landingPage
GET    /preview          enter preview mode, then redirect to the entry's slug
                         (forwards ?timeline= so the release scope survives the redirect)
DELETE /preview          leave preview mode
POST   /preview/render   re-render blocks as a Turbo Stream (preview only)
GET    /preview/optimization-entries    audiences + experiences for the preview panel
```

Nothing lives under `/api`. In a Hotwire app `/api/*` signals a JSON API for external
consumers; these are ordinary controller actions that set a cookie and return HTML or a
redirect. The Next.js original used `/api/draft` only because App Router route handlers have to
live in `app/api/`. Modelled the Rails way, this is a singular `preview` resource with
create/destroy plus one member action.

Three Hotwire-specific details that shaped this:

- **`GET /preview` mutates state, which is normally wrong** — and Turbo 8 prefetches links on
  hover, so a stateful GET can fire without a click. It is correct here because the request
  never originates from a link in this app: Contentful opens the Content Preview URL as a
  top-level navigation, so the verb isn't ours to choose. Same shape as a Rails magic-link
  route; the unguessable secret is the protection. No page here links to it, so prefetch cannot
  reach it.
- **Leaving preview is `DELETE`, from a real form and button.** Turbo's docs prefer forms and
  buttons over `data-turbo-method` for accessibility, and a GET link would be prefetchable.
  `hono/method-override` unwraps the `_method` field, which is the job Rack::MethodOverride does
  in Rails.
- **Redirect codes follow Turbo's rules.** 302 after the GET that enters preview; **303 See
  Other** after the DELETE, which Turbo requires so the browser reissues the follow-up as a GET.

The Delivery-vs-Preview swap itself is resolved once per request by middleware in
`src/server.ts` — the equivalent of a Rails `before_action` — and every route reads
`c.get("preview")` rather than re-deriving it from the cookie.

### Caching: there isn't any

Every request fetches from Contentful. Save an entry, reload the page, see the change — no
invalidation step, no webhook, no cache to clear. Responses are sent `Cache-Control: no-store`
so the browser does not hold onto them either.

Personalized responses additionally send `turbo-cache-control: no-cache`, because Turbo Drive's page
cache would otherwise restore one audience's HTML and show it to another after a back navigation. That
is a correctness bug rather than a staleness annoyance, and it costs instant back-navigation.

**No permutation caching.** The Optimization SDK can precompute and share a finite set of public
permutations; this demo deliberately does not, to keep one selection path. If caching is ever restored
it must become audience-aware in the same change — and note the audience dimension here is the **query
string**, not just the slug. See ADR 0004's deferred-work section.

This is deliberate for a rendering demo. A tag-indexed cache reproducing what Next.js Cache
Components provided — `cacheTag` by `sys.id`, `cacheLife` profiles, stale-while-revalidate, and
a `POST /api/revalidate` webhook target — is parked verbatim in
[`backup/with-cache/`](./backup/with-cache) with restore instructions, because it is the part of
this port most worth showing in an architecture conversation even though it gets in the way here.

### Personalization

Variant selection happens **on the server**, so the personalized content is in the initial HTML —
there is no client-side swap and no flash of baseline. Only the selected variant is ever sent to the
browser. Full rationale in
[ADR 0004](./docs/adr/0004-optimization-sdk-integration.md).

|                        | Where                                                            | How                                                                                    |
| ---------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Variant selection**  | `src/lib/optimization.ts` + `src/lib/optimization-render.ts`      | `page()` returns selections; `resolveOptimizedEntry` swaps the entry. Pure, no network  |
| **Interaction tracking** | `src/client/optimization.ts`                                    | The server stamps `data-ctfl-*`; the Web SDK observes them with its own MutationObserver |
| **Audience simulation**  | `src/client/optimization-preview.ts` (draft only)               | The first-party preview panel, bridged to the server via a Turbo Stream                |

#### Driving the demo

Every audience in the demo space targets the **`habitat` query parameter**, so the URL is the control
surface. There is deliberately no switcher UI on published pages — audience simulation is the preview
panel's job.

```bash
curl -s 'http://localhost:3000/home'                | grep -o 'data-ctfl-entry-id="[^"]*"'
curl -s 'http://localhost:3000/home?habitat=beach'  | grep -o 'data-ctfl-entry-id="[^"]*"'
curl -s 'http://localhost:3000/home?habitat=forest' | grep -o 'data-ctfl-entry-id="[^"]*"'
```

| URL | Hero | Duplex |
| --- | --- | --- |
| `/home` | `[Baseline] Ea Est Voluptate` | `[Baseline] Praesentium Harum Repellat` |
| `/home?habitat=beach` | `Litora Maris Aestivum` | `Harena Palmae Otium` |
| `/home?habitat=forest` | `Silvae Umbra Alta` | `Semita Arborum Viridis` |
| `/home?habitat=desert` | `Ea Est Voluptate` (90% of the time) | *no experience* |

> **`?habitat=desert` is not deterministic.** That experience is configured
> `distribution: [0.1, 0.9]`, so roughly 1 request in 10 legitimately returns the baseline. Measured
> 1/19 over 20 requests. Beach and Forest are `[0, 1]` and always return their variant. Don't file a
> bug against the Desert hero without looping it first.

If both the plain and the `?habitat=` URLs return baseline ids, the page context is not reaching the
Experience API — that is the one failure this whole integration has to get right, and it is silent.

#### Audience simulation in preview

Draft renders deliberately show **baseline** content: an editor should see what they are editing, not
whichever variant their own profile happens to match. To view a variant in preview, open the preview
panel (its toggle button attaches itself to the page) and force an audience. The panel is
Contentful's own; it changes the browser SDK's selection state, and because this app renders on the
server, a small bridge posts those selections back to `/preview/render`, which replies with a Turbo
Stream that morphs the blocks in place.

A forced audience and a live field edit compose: editing a field re-renders under the currently forced
audience, and switching audience keeps the edited field. That works because both go through a single
writer that always sends the full state. Draft renders emit no analytics events at all.

#### Demo events (`track` and `identify`)

The demo panel renders two buttons on published pages (set
`CONTENTFUL_OPTIMIZATION_DEMO_CONTROLS=false` to hide it):

- **`track`** sends a `demo_event`. ⚠️ For it to count toward an experience's metric, the event name
  must match what that metric is configured for — check it in the Contentful web app.
- **`identify`** aliases the visitor to `demo-user-123` with custom traits. Because aliasing can change
  audience membership, and this app renders on the server, an accepted `identify` is followed by a
  Turbo visit so the server re-selects. Both buttons show whether the event was `accepted`, which makes
  the consent boundary visible — `track` is refused before consent, `identify` and `page` are not.

> **Consent in this demo is granted unconditionally.** A real integration wires a CMP here. The two
> axes are independent: `events` admits analytics and personalization, `persistence` allows profile
> continuity.

#### Consent

Consent is modelled the way a real deployment works: a **third-party CMP owns the decision** and
publishes it as a cookie that both the server and the browser can read. This app never asks the
visitor anything — it reads `cmp-consent` (`"true"` / `"false"`) and tells both SDKs what they may do.
Swapping in a real CMP means changing `readConsent` in
[`src/lib/consent.ts`](./src/lib/consent.ts) and nothing else.

| `cmp-consent` | Personalization | Profile cookie | Experience API |
| --- | --- | --- | --- |
| `true` | variant selected | written | one call per render |
| `false` | baseline | deleted | not called |
| *absent* (not asked) | baseline | not written | not called |

Three details that are easy to get wrong:

- **`consent: false` does not block anything on its own.** The SDK's admission check is
  `if (consent === true) return true; return allowedEventTypes.includes(method)` — so `false` and
  "not asked" both fall through to the allow-list, whose default is `['identify', 'page']` in **both**
  runtimes. Left at the default, a visitor who refused consent still emits a page event, still costs a
  round trip and still gets a profile. Both SDKs are therefore configured
  `allowedEventTypes: []`, which is what makes refusal actually mean refusal. It costs nothing when
  consent is granted, because `consent === true` short-circuits before the list is read.
- **"Not asked" is not "no".** The SDK's consent state is `undefined` until a decision exists, and that
  is distinct from `false`. The decision is forwarded to the browser with a `recorded` flag so the
  Web SDK is seeded as `undefined` rather than being told the visitor declined.
- **The two axes are independent.** `events` (may we emit?) and `persistence` (may we remember?) are
  passed through separately, so "personalize this page but don't remember me" is expressible.
  `persistence: false` makes the SDK's `canPersistProfile` false, which is what stops the profile
  cookie being written — and withdrawal actively deletes an existing one rather than just letting it
  go stale.

Because the **server** selects the variant, newly-granted consent takes visible effect on the next
render, not retroactively on HTML already sent. `applyConsent()` in
[`src/client/optimization.ts`](./src/client/optimization.ts) is the seam a CMP callback calls to update
the live browser SDK immediately.

The demo panel's **Grant / Deny / Unset** buttons flip that cookie so this is demonstrable without
installing a CMP. They stand in for the third party and would not exist in a real integration.

> **Because consent is fail-closed, a fresh clone shows baseline content until you grant it.** That is
> correct behaviour, not a bug — so the demo panel renders a notice saying exactly that, rather than
> leaving you to wonder why `?habitat=` appears to do nothing. Grant consent and the variants appear.

#### Profile continuity

The visitor profile id lives in the `ctfl-opt-aid` cookie, which is deliberately **not** `HttpOnly`
because the browser SDK shares it. Over plain `http://localhost` the cookie cannot be `Secure`, so it
falls back to `SameSite=Lax`; inside Contentful's cross-site preview iframe it needs `None; Secure`,
which is another reason preview needs the HTTPS tunnel below.

### Live Preview

Three independent mechanisms:

|                    | Where                                                  | How                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Preview mode**   | `src/lib/preview.ts`                                   | HMAC cookie, `HttpOnly; Secure; SameSite=None; Path=/`                                                                                                                                                              |
| **Inspector mode** | nothing to build                                       | `includeContentSourceMaps` embeds steganographic metadata in field values; because we render server-side it lands in the HTML and the browser SDK decodes it off the DOM. No `data-contentful-*` attributes needed. |
| **Live updates**   | `src/client/live-preview.ts` + `src/routes/preview.ts` | Stimulus subscribes, POSTs the patched JSON, the server re-renders and replies with a Turbo Stream                                                                                                                  |

Live updates are the only piece with no Next.js counterpart, because
`useContentfulLiveUpdates` is a React hook. The flow:

1. Draft renders embed the entry graph as `<script type="application/json" data-live-preview-data>`
   and mount `data-controller="live-preview"`.
2. The controller calls `ContentfulLivePreview.subscribe()`. The SDK patches that graph
   in-browser on every keystroke.
3. The controller POSTs the patched graph to `/preview/render`.
4. That route runs it through the **same** `ComponentResolver` the initial page used and
   returns `text/vnd.turbo-stream.html`:
   `<turbo-stream action="update" method="morph" target="page-blocks">`.

So templates exist in exactly one place. `update` + `morph` handles text edits, reordering,
additions and removals in a single stream, and patches in place so scroll position and the
inspector overlay survive an edit.

This makes **zero Contentful requests while editing**, which matters: reloading a Turbo Frame
instead would issue one Content Preview API request per keystroke against a 14 req/s limit.

`/preview/render` renders caller-supplied JSON, so it is gated on the draft cookie.

**Both work unchanged under a Timeline release**, with no app code. The editor sends `releaseId`
alongside `isInspectorActive` and the SDK echoes it back in its tagged-field messages, so clicking an
inspector outline on a release preview opens the **release-scoped** editor. Live updates arrive as
`ENTRY_UPDATED` for whichever version is open, and the graph they patch came from the release-scoped
fetch, so a keystroke morphs the blocks with the rest of the release content intact.

### Timeline preview

Timeline previews content **as of a scheduled Release** — an editor scrolls forward in time and sees the
page as it will look when that release ships.

Contentful drives the selection: the editor picks a release in the web app's timeline selector, and the
preview iframe reloads with a `timeline` token in the URL. There is no release picker in this app — that
would need a management credential to list releases, and none is shipped. The token is
`releaseId;timestamp`, and **empty** when the editor is viewing current content.

| Piece | What it does |
| --- | --- |
| `timelineFromToken()` in [`lib/timeline.ts`](./src/lib/timeline.ts) | Parses the token with `@contentful/timeline-preview` and rejects the three values that look like tokens but are not: `{timeline}` (unexpanded placeholder), `undefined` and `null` (stringified misses). All three otherwise reach the API and 404. |
| Middleware in [`server.ts`](./src/server.ts) | Resolves the scope once per request — **only on preview requests**. A `timeline` parameter on a published URL is ignored, not honoured. |
| `getClient()` in [`lib/contentful.ts`](./src/lib/contentful.ts) | Passes `timelinePreview` to `createClient()`, beside the existing `includeContentSourceMaps: preview`. |
| `GET /preview` in [`routes/preview.ts`](./src/routes/preview.ts) | Scopes the slug-existence check (a release can *introduce* a page, whose slug does not exist in current content) and forwards the token across the 302. |
| `TimelineBanner` in [`views/Layout.tsx`](./src/views/Layout.tsx) | States the active scope on every draft render. |

#### It fails silently by design — which is what the banner is for

Timeline resolution **falls back**: requested release → previous scheduled release → currently published
content. So a preview that renders plausible content is *not* evidence that the release you selected
answered the request. Every draft render therefore says which scope it used, bottom-left:

- `Timeline: current content` — no release selected (**or** the preview URL is missing
  `&timeline={timeline}`, which looks identical from here)
- `Timeline: release <id>` — plus `as of <timestamp>` when the token carried one
- amber `Release not found — showing current preview content` — the scope was rejected and dropped

The banner shows the release **id**, not its title: a title needs the CMA, and this app ships no
management credential.

There is exactly one *loud* failure. A malformed, deleted, or non-Timeline release id makes the Preview
API answer **404** rather than falling back. Rather than 500 a link someone shared last week, the app
drops the release scope, re-fetches current preview content, logs one `[timeline]` warning, and shows the
amber banner. The retry only fires when a scope was set, so a genuine Contentful outage still surfaces as
an error.

#### Verifying it — compare the two views, don't check for a 200

Because of that fallback, the only assertion that proves anything is a **difference**:

```bash
# Enter preview once, keeping the cookie jar. Read the release id off the preview
# iframe's URL in Contentful, with a release selected in the timeline selector.
curl -sc jar "https://<ngrok-host>/preview?secret=$SECRET&type=landingPage&slug=home" -o /dev/null
curl -sb jar "https://<ngrok-host>/home?timeline=<releaseId>;" | grep -o '<h1[^>]*>[^<]*'
curl -sb jar "https://<ngrok-host>/home"                       | grep -o '<h1[^>]*>[^<]*'
```

**Pass is that the two differ.** Identical output means one of three things, none of which announce
themselves: the preview URL lost its `timeline` parameter; the id is a Launch release rather than a
Timeline (`Release.v2`) release; or the release contains no changed entries.

Degradation is worth checking too — `?timeline=deadbeef;` must render the page **200 with the amber
banner**, not 500, and `?timeline={timeline}` / `?timeline=undefined` must both be treated as no token at
all. And because `timeline/assets` is a separately rewritten path, a release that swaps a hero image is
its own check: the release's asset URL should appear, not the current one.

`npm run smoke` covers the banner's four states (including that a published render never shows one), but
it is credential-free and says nothing about release resolution — that part is manual.

### Live Preview locally

`SameSite=None` requires `Secure`, and `Secure` requires HTTPS, so the draft cookie is dropped
if Contentful iframes an `http://localhost` URL. Contentful also cannot POST webhooks to
localhost. Use a tunnel for both:

```bash
ngrok http 3000
```

Then point both the Content Preview URL and the webhook at the HTTPS ngrok host.

To leave preview mode, use the **Exit preview** button the layout renders on draft pages. It
submits a form to `DELETE /preview`.

## Notable differences from the Next.js version

The full list with reasoning is in §5 of the
[port plan](./docs/plans/2026-08-25-nextjs-to-hotwire-port.md). In brief:

- **One resolver, not two.** ADR 0002's split existed to keep Live Preview JS off the published
  path, which React's compile-time `"use client"` boundary made hard. Here published renders
  ship zero Live Preview JS structurally — it is a separate bundle only draft pages load. See
  [ADR 0003](./docs/adr/0003-nextjs-to-hotwire-port.md).
- **`alt` text now works.** The old components read `alternativeText` off the asset's `file`
  object, where it does not exist, so every `alt` was empty.
- **`/` redirects to `/home`** instead of serving create-next-app boilerplate.
- **Added an Exit preview button** (`DELETE /preview`), because Turbo Drive's page cache makes a
  stuck preview cookie harder to diagnose than it was before. It is a form and submit button
  rather than a link — see [Routes](#routes).
- Kept deliberately, for visual fidelity: Duplex's `text-white` (invisible against the light
  gradient background) and `text-md` (not a real Tailwind class).

## Architecture Decisions

- [`docs/plans/2026-08-25-nextjs-to-hotwire-port.md`](./docs/plans/2026-08-25-nextjs-to-hotwire-port.md)
  — the port: decisions, rejected alternatives, and hazards found on the way.
- [`docs/adr/`](./docs/adr) — ADRs 0001 and 0002 describe the Next.js design this replaced and
  are retained because they explain _why_ the code looked the way it did. ADR 0003 records the
  port itself.
- [`docs/adr/0004-optimization-sdk-integration.md`](./docs/adr/0004-optimization-sdk-integration.md)
  — the personalization integration: every decision, its rejected alternative, and a deferred-work
  section covering caching, merge tags, flags, experiments and Turbo Frames.
- [`docs/optimization-sdk-hotwire-fit.md`](./docs/optimization-sdk-hotwire-fit.md) — the original desk
  assessment, now **superseded in part** and annotated with what it got wrong. Kept because its
  division-of-labour reasoning held up and its mistakes are the ones most likely to be re-proposed.
- [`backup/with-cache/`](./backup/with-cache) — the tag-based caching implementation, parked.

## Security note

`contentful-export-zh1nhbmve68h-master-2026-08-11T09-14-44.json` contains a webhook definition
with a **plaintext revalidation secret in its URL**. Rotate that secret and redact the file
before sharing this repository.
