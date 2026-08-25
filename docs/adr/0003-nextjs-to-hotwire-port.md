# ADR 0003: Reimplement the demo on Hotwire (Node + TypeScript)

**Status:** Accepted — 2026-08-25

**Supersedes in practice:** [ADR 0002 — Split component resolver for RSC / Client rendering
paths](./0002-split-resolver-rsc-client.md). ADR 0001 and 0002 are retained: they document the
Next.js design this replaced, and the reasoning in them is what motivates several decisions here.

**Full context, rejected alternatives and hazards:**
[`docs/plans/2026-08-25-nextjs-to-hotwire-port.md`](../plans/2026-08-25-nextjs-to-hotwire-port.md)

## Context

Allegiant Air, via Apply Digital, is standardizing their entire frontend on Hotwire — no React,
no Next.js, no SPA framework — so they can serve one web codebase across web and Hotwire Native
mobile. Contentful Personalization has no Hotwire SDK and will not get one, so a reference
implementation is needed to establish the integration patterns.

The decisive constraint is that **their Hotwire runs on Node with TypeScript, not Rails**
(confirmed in writing by Apply Digital's project lead, 2026-04-02). Hotwire is genuinely
backend-agnostic; the Rails association is convention, not requirement. Assuming Rails would
have produced a demo the customer could not use, and would also have forfeited the JavaScript
Live Preview SDK.

## Decision

Reimplement the app as a Hono server rendering HTML with `hono/jsx`, with Turbo Drive and
Stimulus on the client. Retain the `contentful` and `@contentful/live-preview` npm packages
unchanged. Preserve the existing markup, class lists, content queries, cache semantics and
webhook contract.

Three Next.js primitives have no equivalent outside the framework and were rebuilt:

- **`"use cache"` / `cacheTag` / `cacheLife` / `revalidateTag`** → `src/lib/cache.ts`. A
  tag-indexed in-process store. Critically it preserves the property ADR 0001 migrated *for*:
  tags are declared during the fetch via a `tag()` callback, so they can reference `sys.id` from
  the response rather than being derived from arguments.

  > **Amended 2026-08-25: reverted.** Caching was removed from the live code path — it made the
  > demo worse, because a reload after saving in Contentful did not show the change until
  > something invalidated the tag. The app now fetches on every request and sends
  > `Cache-Control: no-store`; `POST /api/revalidate` is gone with it. The implementation is
  > parked in `backup/with-cache/` rather than deleted, and remains the reference design for a
  > cached deployment.
- **`draftMode()` / `__prerender_bypass`** → `src/lib/preview.ts`. An HMAC cookie, keeping the
  `SameSite=None; Secure` attributes that let Contentful's iframe carry it. Resolved once per
  request by middleware (a Rails `before_action` equivalent) so every route reads the same
  boolean rather than re-deriving it.
- **`useContentfulLiveUpdates`** → a Stimulus controller plus `POST /preview/render`. The
  controller subscribes to the SDK and posts the patched entry graph back; the server re-renders
  it through the same resolver and replies with a Turbo Stream.

### Route shape follows Hotwire convention, not App Router convention

The preview endpoints are a singular RESTful resource — `GET /preview` (enter),
`DELETE /preview` (leave), `POST /preview/render` (re-render) — not `/api/draft`. In a Hotwire
app `/api/*` denotes a JSON API for external consumers; these actions set a cookie and return
HTML or a redirect, so they are ordinary controller actions. The Next.js paths existed only
because App Router route handlers must live under `app/api/`.

Three Hotwire constraints shaped the details:

- **Turbo 8 prefetches links on hover by default** (100 ms delay). That makes any stateful GET
  reachable from an in-app link genuinely unsafe. `GET /preview` is nonetheless correct, because
  Contentful opens the Content Preview URL as a top-level navigation — the verb is not ours to
  choose, no page in the app links there, and the unguessable secret is the protection. This is
  the same shape as a Rails magic-link route.
- **Leaving preview is a `DELETE` driven by a real form and submit button.** Turbo's own docs
  recommend forms and buttons over `data-turbo-method` for accessibility, and a GET link would be
  prefetchable. `hono/method-override` provides the `_method` unwrapping that Rack::MethodOverride
  provides in Rails, which is what makes RESTful verbs reachable from HTML.
- **Turbo requires a 303 See Other after a non-GET request** so the browser reissues the
  follow-up as a GET. The enter route, being a GET, redirects with a conventional 302.

## Consequences

**Positive**

- **The ADR 0002 problem disappears.** That ADR exists entirely because
  `useContentfulLiveUpdates` is a hook, which forced `"use client"` onto every content
  component, which meant every cached published render shipped Live Preview JS the visitor
  never used. The workaround was two parallel resolver modules selected at render time. Here
  there is **one** resolver: blocks always render on the server, and the Live Preview SDK is a
  separate bundle that only draft renders request. The goal is now structural rather than a
  convention contributors must remember.
- Three further ADR 0002 workarounds become unnecessary: `next/dynamic`'s client-only contagion,
  the `<Image loader={fn}>` RSC-serialization failure that forced the loader into
  `next.config.js`, and the impossibility of toggling `"use client"` at runtime.
- The published path also loses the RSC flight payload. The browser receives HTML and nothing else.
- `<Suspense fallback={null}>` in the page was a Cache Components requirement rather than a UX
  choice, and simply disappears.
- Live updates cost **zero** Contentful requests while editing, because re-rendering happens from
  data already in the browser. The previous shape and the obvious Hotwire alternative (reloading a
  Turbo Frame) both hit the Preview API per keystroke, against a 14 req/s limit.
- Inspector mode needs no field tagging. Server rendering puts the Content Source Map
  steganography directly into HTML text nodes for the browser SDK to decode.

**Negative**

- Three things Next.js did implicitly are now explicit build steps: the Tailwind build, the
  client bundle, and the font. `next/image` is the largest of these — resizing, `srcset`,
  `sizes`, lazy loading and priority hints are all hand-rolled in `src/lib/image.ts`, and the
  `sizes` strings had to be carried over verbatim to preserve layout.
- ~~The cache is per-process: it dies on restart and does not span instances.~~ Moot as of the
  amendment above — there is no cache in the live path. If it is restored, this consequence
  returns, along with the audience-keying hazard described in
  [the Optimization SDK assessment](../optimization-sdk-hotwire-fit.md) §4.2.
- Turbo Drive introduces a second, client-side page cache that did not exist before. Draft
  renders must send `turbo-cache-control: no-cache` or editors see stale draft content on
  back-navigation.
- `POST /preview/render` renders caller-supplied JSON into HTML. It is gated on the draft cookie,
  and that gate is now load-bearing.
- `hono/jsx` *reads* like React even though no React reaches the browser. Worth stating plainly
  to an audience that chose Hotwire specifically to avoid React.

## Alternatives considered

- **Ruby on Rails 8 + ERB.** The canonical Hotwire stack, with Turbo/Stimulus/Propshaft built in
  and a healthy `contentful.rb` gem. Rejected: it does not match the customer's confirmed stack,
  and it gives up the JS Live Preview SDK — meaning either reimplementing Content Source Map
  steganography in Ruby or hand-tagging every field.
- **Fastify + a template engine (Eta/Nunjucks).** Reads as unmistakably not-React, which has some
  narrative value here. Rejected because hand-translating each component into template syntax is
  where markup fidelity gets quietly lost, and fidelity is the point of this port.
- **Reload a Turbo Frame on each live update.** Two lines of client code, but one Preview API
  request per keystroke; needs debouncing and is still 429-prone.
- **Patch the DOM client-side on each live update.** Fastest, but it reimplements the templates in
  the browser — the thing Hotwire exists to avoid — and breaks on structural edits.
- **`replace` one Turbo Stream per block** instead of one `update` + `morph` on the container.
  Rejected: per-block replacement cannot express insertion, removal or reordering.

## References

- [hotwired.dev](https://hotwired.dev/), [Turbo Streams handbook](https://turbo.hotwired.dev/handbook/streams)
- Contentful — [Inspector mode / Content Source Maps](https://www.contentful.com/developers/docs/tutorials/preview/inspector-mode/)
- Contentful — [Live Preview SDK](https://github.com/contentful/live-preview) (`examples/vanilla-js`)
- Contentful — [Optimization SDK overview](https://www.contentful.com/developers/docs/personalization/optimization-sdk/overview/)
- Jira CCS-3189 — the customer signal for Hotwire support
