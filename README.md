# Demo - Live Preview (Hotwire)

A Contentful Live Preview demo built with [Hotwire](https://hotwired.dev/) — Turbo and
Stimulus over server-rendered HTML. This is a one-to-one reimplementation of the Next.js
version of this demo; it renders the same content, the same markup, and the same classes.

**Stack:** Node + TypeScript, [Hono](https://hono.dev/) for routing and server-side HTML
rendering via `hono/jsx`, Turbo Drive for navigation, Stimulus for the small amount of
remaining JS, Tailwind v4. **No React is shipped to the browser.**

Why Node rather than Rails — and the rationale behind every other significant choice — is in
[`docs/plans/2026-08-25-nextjs-to-hotwire-port.md`](./docs/plans/2026-08-25-nextjs-to-hotwire-port.md).
Read that first if you are picking this up cold.

## Initial Setup

1. Run `nvm use` to ensure you are on the correct version of node.
2. Run `npm install` to install all dependencies.
3. Copy `.env.local.example` and rename to `.env.local`.
4. Populate `.env.local` with values for `CONTENTFUL_SPACE_ID`, `CONTENTFUL_ENV_ID`,
   `CONTENTFUL_DELIVERY_KEY`, and `CONTENTFUL_PREVIEW_KEY`.
5. `CONTENTFUL_PREVIEW_SECRET` is a key you invent; it gates the Content Preview URL.
6. `CONTENTFUL_OPTIMIZATION_CLIENT` and `CONTENTFUL_OPTIMIZATION_ENV_ID` are used for the
   forthcoming Contentful Optimization SDK integration.
7. Import the content model with the Contentful CLI:

   ```bash
   contentful space import \
     --space-id <YOUR SPACE ID> \
     --environment-id <YOUR ENVIRONMENT ID> \
     --content-file contentful-export-zh1nhbmve68h-master-2026-08-11T09-14-44.json
   ```

   > Use the export file, **not** `content-model.json`. That file is an unrelated
   > Ninetailed-era model (`page` / `componentHeroBanner` / `componentDuplex`); this app
   > queries `landingPage` / `hero` / `duplex` / `mediaWrapper`, so importing it leaves the
   > app rendering nothing. The Next.js README pointed at the wrong file.

8. Configure a Content Preview URL in Contentful:

   ```
   https://<YOUR HTTPS HOST>/preview?secret=<CONTENTFUL_PREVIEW_SECRET>&type=landingPage&slug={entry.fields.slug}
   ```

   > `type` must be `landingPage`. Note this has to be an **HTTPS** host — see
   > [Live Preview locally](#live-preview-locally) below.

No webhook is needed. Nothing is cached, so there is nothing to invalidate.

## Getting Started

```bash
npm run dev     # build assets, then start with watch
npm start       # build assets, then start once
npm run build   # build assets + typecheck
npm run smoke   # render invariant checks (no credentials needed)
```

Then open <http://localhost:3000>. `/` redirects to `/home`, the only slug in the demo space.

## How it works

```
GET /:slug ──► routes/page.ts ──► lib/contentful.ts ──► CDA  (published)
                     │                              └──► CPA  (draft)
                     └──► views/Layout ──► components/ComponentResolver ──► Hero | Duplex
```

Requests are served as complete HTML. Turbo Drive then intercepts subsequent navigations and
swaps the body rather than reloading, and Stimulus attaches behaviour to what is already
there. There is no client-side rendering and no hydration.

### Routes

```
GET    /                 redirect to /home
GET    /:slug            render a landingPage
GET    /preview          enter preview mode, then redirect to the entry's slug
DELETE /preview          leave preview mode
POST   /preview/render   re-render blocks as a Turbo Stream (preview only)
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

This is deliberate for a rendering demo. A tag-indexed cache reproducing what Next.js Cache
Components provided — `cacheTag` by `sys.id`, `cacheLife` profiles, stale-while-revalidate, and
a `POST /api/revalidate` webhook target — is parked verbatim in
[`backup/with-cache/`](./backup/with-cache) with restore instructions, because it is the part of
this port most worth showing in an architecture conversation even though it gets in the way here.

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
- [`docs/optimization-sdk-hotwire-fit.md`](./docs/optimization-sdk-hotwire-fit.md) — how
  Contentful Personalization would be added. No personalization code exists in this repo yet.
- [`backup/with-cache/`](./backup/with-cache) — the tag-based caching implementation, parked.

## Security note

`contentful-export-zh1nhbmve68h-master-2026-08-11T09-14-44.json` contains a webhook definition
with a **plaintext revalidation secret in its URL**. Rotate that secret and redact the file
before sharing this repository.
