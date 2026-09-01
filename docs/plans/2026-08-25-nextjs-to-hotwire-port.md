# Port plan: Next.js → Hotwire

**Status:** Accepted — 2026-08-25
**Supersedes nothing. Related:** [ADR 0001](../adr/0001-cache-components-migration.md),
[ADR 0002](../adr/0002-split-resolver-rsc-client.md)

This document is the durable record of the port: what we're building, and — more importantly —
_why each choice was made and what was rejected_. It is written to be read cold, months later,
by someone asking "why is it like this?"

---

## 1. Why this port exists

Allegiant Air, via implementation partner Apply Digital, is standardizing their entire
frontend on [Hotwire](https://hotwired.dev/) — HTML over the wire, no React, no Next.js, no SPA
framework. Contentful Personalization has no Hotwire SDK and will not get one, so we need a
reference implementation that proves the integration patterns work in that architecture.

Provenance of the requirement (all internal, captured here because these sources rot):

- **Jira CCS-3189** — "Hotwire Native Optimization SDK", the customer signal filed Dec 2025.
- **Discovery call, 2025-12-15** — Allegiant stated "no React". Apply Digital was on the call
  and did not contradict it.
- **Planning sync, 2026-07-28** — action item: _"Eric Schmidt to collaborate on new
  Optimization SDK integration with Hotwire framework"_ and _"Apply Digital tech lead to
  connect with Contentful regarding Hotwire and SDK implementation details."_ Also recorded:
  Allegiant chose Hotwire so they could ship a few native home screens and serve everything
  else as web from one codebase (Hotwire Native), rather than maintain 2–3 codebases.
- **Salesforce renewal record** — flags the risk explicitly: personalization "carries added
  technical uncertainty because the team must validate its custom Hotwire-based architecture
  against Contentful's newly released Optimization SDK before implementation."

### The decisive fact: this is not a Rails port

Hotwire is strongly associated with Rails (37signals built it), and "port to Hotwire" reads as
"port to Rails" by default. That default is **wrong here**, and getting it wrong would have
produced a demo the customer could not use.

> **Email from Arveen Ahluwalia (Apply Digital), 2026-04-02:**
> _"Confirming yesterday's question, the team plans to use Hotwire with TypeScript for the code
> which is JS."_

Corroborated in the `#nt-product` Slack thread of 2026-04-07, where Charles Hudson made the
same point from the SDK side: _"Since Hotwire is a server-side toolkit/ecosystem that can be
used in many different server-side languages and frameworks, it's really hard to say without
knowing their actual platform… I see they're using Stimulus, but we need to determine whether
they're using it in a Node or Rails app."_

Hotwire is genuinely backend-agnostic — Turbo and Stimulus are client-side libraries that
know nothing about the server. **The target is Node + TypeScript.**

This single fact drives most of what follows, because it means the `contentful` and
`@contentful/live-preview` npm packages keep working. A Rails port would have had to give up
the JS Live Preview SDK's steganographic content-source-map encoding and hand-tag every field.

---

## 2. What is actually being ported

Despite the directory name `demo-optimization-sdk-hotwire`, the app is `demo-live-preview` and
contains **zero** personalization code. Verified absent: `@contentful/optimization*`,
`@ninetailed/*`, any middleware, any variant/audience/experiment logic.

Personalization appears only as: two unused env vars, a 240KB `content-model.json` that
**does not match the code**, and the directory name. The name describes intended future work.

The real app is a single route rendering one `landingPage` as a `hero` plus a list of `duplex`
blocks, with Live Preview, Draft Mode, and webhook-driven tag invalidation.

---

## 3. Decision log

Each decision records what was chosen, what was rejected, and why. Alternatives are kept
because the rejected ones are the questions that get re-asked later.

### D1 — Server + templating: Hono + `hono/jsx`

**Chosen.** A Hono app on `@hono/node-server`, rendering HTML with `hono/jsx` — which compiles
JSX to a server-side HTML string with **no React runtime shipped to the browser**.

_Why:_ it is the closest possible 1:1 port. `Hero.jsx` and `Duplex.jsx` are already pure
presentational functions with no hooks, no state, and no event handlers (see ADR 0002 — they
were deliberately made "shared modules"), so they become `.tsx` files with `className` → `class`
and essentially nothing else. It also matches the customer's confirmed TypeScript stack and
keeps the Contentful JS SDKs in play.

_Rejected — Fastify + Eta templates._ Reads as unmistakably "not React", which has some
demo-narrative value given Allegiant's "no React" position. Rejected because hand-translating
every component into template syntax is where markup fidelity gets quietly lost, and fidelity
is the entire point of a 1:1 port.

_Rejected — Rails 8 + ERB._ The canonical Hotwire stack, with Turbo/Stimulus/Propshaft
built in and a healthy `contentful.rb` gem (v2.20.0, June 2026). Rejected on the D-decisive
fact above: it does not match the customer's stack, and it forfeits content-source-map
encoding on the server.

_Known objection, accepted:_ `hono/jsx` code _looks_ like React to a reader skimming it, which
is slightly awkward in front of a customer who said "no React". Mitigation is to say it
plainly — zero React ships, JSX here is a template syntax. If this proves distracting in the
workshop, D1 is the reversible decision; the components are small.

### D2 — Live Preview updates: patched JSON → server re-render → Turbo Stream

**Chosen.** A Stimulus controller calls `ContentfulLivePreview.subscribe()`, then POSTs the
patched entry JSON to `/preview/render`. The server re-renders through the _same_
`ComponentResolver` and replies `text/vnd.turbo-stream.html` with
`<turbo-stream action="replace" method="morph">` per block.

_Why:_ it is the only option that keeps rendering in exactly one place, which is the whole
premise of Hotwire. It costs **zero Contentful requests per keystroke**, so the Content Preview
API's **14 req/s** rate limit is never in play and no debounce is needed. `method="morph"`
patches in place, preserving scroll position and the inspector-mode overlay through an edit.

_Rejected — `frame.reload()` per update._ Two lines of client code, but every keystroke becomes
a CPA request. Mandatory debouncing, still 429-prone, and visibly laggier.

_Rejected — client-side DOM patching._ Fastest and zero-network, but it reimplements rendering
in the browser — precisely what Hotwire exists to avoid — and breaks on structural change
(adding a reference, reordering blocks).

_Consequence to remember:_ `/preview/render` renders caller-supplied JSON into HTML. It **must**
be gated on the draft cookie, and the template layer's escaping must be verified, not assumed.

### D3 — Cache: in-process tag-indexed `Map`

> **Amended 2026-08-25 (same day, after first run): caching was removed from the live code
> path.** In practice the cache worked against the demo — after saving in Contentful you had to
> reason about invalidation before a reload showed the change, which is friction in exactly the
> moment the demo is trying to make look effortless. The app now fetches on every request and
> sends `Cache-Control: no-store`. The implementation below was not deleted: it is parked
> verbatim in `backup/with-cache/`, along with `POST /api/revalidate` and the
> `collectContentfulIds` walker that existed only to feed it. The reasoning below still stands
> as the design for a cached deployment, and is the version worth walking Apply Digital through.

**Chosen.** ~70 lines: a `Map` of cache key → value + expiries, plus a `Map` of tag → set of
keys. `revalidateTag(tag)` evicts every key under that tag.

_Why:_ it reproduces the current semantics exactly with zero infrastructure, which is right for
a demo. Critically it preserves the property ADR 0001 migrated _for_ — tags declared **during**
the fetch, so they can reference `sys.id` from the response rather than being derived from
arguments. That is what makes slug renames safe and keeps the webhook handler a one-liner.

_Rejected — Redis._ What Allegiant would actually need in production (survives restarts, spans
instances) but adds a service to run and obscures the demo's point.

_Rejected — building the Redis adapter now behind an interface._ Deferred, not dismissed. The
cache is written behind a narrow 3-method surface so the adapter stays a drop-in.

_Consequence to state in the README:_ the cache is per-process. It dies on restart and does not
span instances.

### D4 — Personalization: strict port + a written spike

**Chosen.** Port only what exists. Additionally write
`docs/optimization-sdk-hotwire-fit.md` — an assessment of how `@contentful/optimization-node`
and `-web` map onto Hotwire, with no implementation.

_Why:_ it keeps this deliverable shippable and reviewable, while still producing the workshop
material the Allegiant action item actually needs.

_Rejected — building the personalization integration now._ Roughly doubles scope and needs
personalization configured in the space. Better as a follow-up once the port is verified.

---

## 4. The structural win (put this in the workshop)

ADR 0002 exists _entirely_ to work around React's compile-time `"use client"` boundary:
`useContentfulLiveUpdates` is a hook, so every content component became a client component, so
**every cached published render shipped Live Preview JS the visitor never used**. The fix was
two parallel resolver modules selected at render time.

In Hotwire that whole class of problem evaporates:

| ADR 0002 problem                                   | In Hotwire                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Two resolvers, chosen by `draftMode()`             | **One** resolver. Draft/published is an `if` around mounting a Stimulus controller. |
| Live Preview JS on the published path              | Zero, **structurally** — not by discipline.                                         |
| `next/dynamic` drags importers to the client       | Static imports, always.                                                             |
| `<Image loader={fn}>` can't cross the RSC boundary | It's a plain function call during rendering.                                        |
| `"use client"` can't be toggled at runtime         | There is no client render layer to toggle.                                          |

The published path also loses the RSC flight payload — the browser receives HTML and nothing
else. This is the substantive argument that Hotwire is not a compromise for this use case.

---

## 5. Deliberate deviations from 1:1

> **Amended 2026-08-25: the preview routes moved off `/api/`.** An idiom review found the
> `/api/draft` paths were an App Router artifact rather than a Hotwire pattern — `/api/*` means a
> JSON API in a Hotwire app, and these actions return HTML and a redirect. They are now a
> singular `preview` resource: `GET /preview`, `DELETE /preview`, `POST /preview/render`. The
> exit route changed from a GET link to a form-driven DELETE because **Turbo 8 prefetches links
> on hover**, which makes stateful GET links fire without a click. See ADR 0003.
> **Action required in Contentful:** the Content Preview URL must be updated from `/api/draft` to
> `/preview`.

Everything not listed here is a faithful port.

| #   | Change                                                                               | Why                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `alt` reads `image.fields.alternativeText`, not `…media.fields.file.alternativeText` | The current path is wrong — `alternativeText` is a field on the `mediaWrapper` **entry**, not on the asset's `file` object — so every `alt` renders empty. Real values exist ("Trees in Forest with Sun Rays"). Porting a known a11y defect into a customer-facing reference implementation is worse than deviating. |
| 2   | Real null guards on the image chain                                                  | `image?.fields.media.fields.file` throws on an unresolved link; and `` `https:${undefined}` \|\| "" `` is dead code because the template literal is always truthy, so a missing image yields a request for `https:undefined`.                                                                                        |
| 3   | `/` redirects to `/home`                                                             | Today `/` is untouched create-next-app boilerplate — Next.js and Vercel logos, Docs/Learn/Deploy cards — and nests a second `<main>` inside the layout's. Porting Next.js marketing chrome into a Hotwire demo would undercut the point of the demo.                                                                 |
| 4   | Added an Exit preview button (`DELETE /preview`)                                                       | No exit-preview route exists today. With Turbo Drive's client-side page cache layered on top, a stuck draft cookie is materially more confusing than it was in Next.                                                                                                                                                 |
| 5   | README corrections                                                                   | Three existing inaccuracies: `type=page` → `type=landingPage`; `CONTENTFUL_REVALIDATE_SECRET` → `CONTENTFUL_REVALIDATION_SECRET`; and step 8 imports `content-model.json`, which is the **wrong model** (see §6).                                                                                                    |
| 6   | Webhook topics documented as Entry **+ Asset**                                       | The revalidate handler's comment claims both, but the exported webhook subscribes only `Entry.*`, so asset republishes never invalidate a page.                                                                                                                                                                      |

**Deliberately not fixed**, to preserve visual fidelity: Duplex's `text-white` on a light
gradient background (invisible in light mode), and `text-md` (not a real Tailwind class, a
silent no-op).

---

## 6. Hazards found while surveying (independent of the port)

These are pre-existing and worth fixing regardless of whether the port ships.

1. **A live secret is committed.** `contentful-export-zh1nhbmve68h-master-2026-08-11T09-14-44.json`
   contains a webhook definition whose URL embeds a plaintext revalidation secret
   (`https://kit-singular-subtly.ngrok-free.app/api/revalidate?secret=…`). **Rotate the secret
   and redact the file** before this repo is shared.
2. **The two content models disagree.** `content-model.json` is a Ninetailed-era personalization
   model (`page` / `componentHeroBanner` / `componentDuplex`, 25 types, 42 tags, 5 locales). The
   code queries `landingPage` / `hero` / `duplex` / `mediaWrapper`, which exist **only** in
   `contentful-export-…json`. Following README step 8 produces an app that renders nothing.
3. **`tailwind.config.js` is inert.** Tailwind v4 does not read it without an `@config`
   directive, so its `content` globs (pointing at a nonexistent `./src/pages/**`) and its
   `bg-gradient-radial` / `bg-gradient-conic` extensions do nothing — which is why those classes
   on the `/` boilerplate silently have no effect.
4. **`?type=` is caller-controlled** in `/preview` (was `/api/draft`) and is passed straight into a CDA query.
   Tightened to an allowlist during the port.
5. **Unused dependencies:** `@contentful/rich-text-react-renderer`, `contentful-resolve-response`,
   and `autoprefixer` (not even registered in `postcss.config.js`) have zero imports.

---

## 7. Mapping table

| Next.js                                                   | Hotwire / Hono                                                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/app/layout.jsx`                                      | `src/views/Layout.tsx`                                                                                                       |
| `src/app/providers.jsx` (`ContentfulLivePreviewProvider`) | `src/client/controllers/live_preview_controller.ts` — `ContentfulLivePreview.init()`, mounted on draft renders only          |
| `src/app/[slug]/page.jsx`                                 | `src/routes/page.ts`                                                                                                         |
| `src/app/[slug]/layout.jsx`                               | _deleted_ — a pass-through fragment with no purpose                                                                          |
| `<Suspense fallback={null}>`                              | _deleted_ — a Cache Components requirement, not UX. Hotwire's analog for deferred content is `<turbo-frame loading="lazy">`. |
| `ComponentResolver` + `LivePreviewResolver`               | one `src/components/ComponentResolver.tsx` (see §4)                                                                          |
| `"use cache"` + `cacheLife` + `cacheTag`                  | `src/lib/cache.ts`                                                                                                           |
| `revalidateTag`                                           | `src/lib/cache.ts`                                                                                                           |
| `draftMode()` / `__prerender_bypass`                      | `src/lib/preview.ts` — HMAC cookie, `SameSite=None; Secure; HttpOnly`, resolved by middleware                               |
| `useContentfulLiveUpdates`                                | `subscribe()` → `POST /preview/render` → Turbo Stream (D2)                                                                   |
| `next/image` + `src/lib/imageLoader.js`                   | `src/lib/image.ts` — hand-built `srcset`/`sizes`                                                                             |
| `next/font/google` (Inter)                                | self-hosted woff2 in `public/`                                                                                               |
| `next.config.js` `cacheLife.contentful`                   | `PROFILES.contentful` — `{ stale: 300, revalidate: 900, expire: 3600 }`                                                      |
| Vercel zero-config deploy                                 | long-running Node process, any container host                                                                                |

Build steps Next.js was doing implicitly, now explicit: Tailwind v4 via `@tailwindcss/cli`,
client bundle via `esbuild` (Turbo + Stimulus, with `@contentful/live-preview` as a lazy chunk
so published renders don't pay for it).

---

## 8. Load-bearing details that must not drift

1. Query: `content_type=landingPage&fields.slug=:slug&include=4`. Iterate **all** matched items,

   > **Amended 2026-08-25 (ADR 0004):** the include depth is now **10**, not 4. Personalization needs
   > baseline → `nt_experiences` → `nt_variants` → the variant entry → its image → the asset. The graph
   > happens to resolve at 4 today, because the deepest *entry* in that chain sits at level 4 and assets
   > referenced by included entries return regardless — but that is one level of headroom, and a link
   > left unresolved past the depth resolves to **baseline silently, with no error**. The rest of this
   > invariant (iterate all matched items, one locale, plain JSON) still holds.

   not just `[0]`. Render `fields.hero` first, then each of `fields.content[]`, resolved through
   `ComponentMap` keyed on `entry.sys.contentType.sys.id` (`hero`, `duplex`). Unmapped →
   `chalk.red` log + skip. Empty result → 404.
2. `image` is a resolved **`mediaWrapper` entry**, so the asset path is
   `image.fields.media.fields.file.{url, details.image.width, details.image.height}`. Asset URLs
   are protocol-relative, hence the required `https:` prefix.
3. `sizes` strings, verbatim (they encode the layout math):
   - Hero: `(min-width: 1280px) 1024px, (min-width: 780px) calc(90.83vw - 121px), calc(100vw - 96px)`
   - Duplex: `(min-width: 1280px) 416px, (min-width: 780px) calc(45.42vw - 156px), calc(100vw - 240px)`
4. Image URL transform, unchanged from `imageLoader.js`: `?w=<width>&q=<quality ?? 75>&fm=avif`.
5. Hero replicates `next/image` `fill` + `priority`; Duplex uses intrinsic `width`/`height` from
   `file.details.image` + lazy loading.
6. Cache tags per page: `` `${contentType}:${slug}` `` (so a cached **empty** result is still
   invalidatable) **plus** every id `collectContentfulIds` finds — including `sys.type: "Link"`
   stubs, which is how references one level deeper than `include` resolved still invalidate
   the parent.
7. Draft cookie must be `HttpOnly; Secure; SameSite=None; Path=/` or Contentful's iframe drops
   it. `SameSite=None` requires `Secure`, so **local Live Preview needs the ngrok HTTPS URL**,
   not `localhost`.
8. `GET /preview` redirects to the **fetched entry's** slug, never the query param — open-redirect
   guard, preserved deliberately.
9. Webhook slug may be locale-keyed:
   `typeof slug === "string" ? slug : Object.values(slug)[0]`.
10. Preview reads are **never** cached.

### Fixture data for smoke tests

Space `zh1nhbmve68h`, env `master`, single locale `en-US`. The only slug in the system is
**`home`**.

| Entry          | id                       | Notable fields                                     |
| -------------- | ------------------------ | -------------------------------------------------- |
| `landingPage`  | `4TJUjKjRgGaAV2qkGmiW1E` | `slug: "home"`, hero → below, `content: [duplex]`  |
| `hero`         | `4lNp8bpdfk8JITgwZNpbMj` | `heading: "Ea Est Voluptate"`                      |
| `duplex`       | `2TrERRUR7e3OE1RA5Zqttp` | `heading: "Praesentium Harum Repellat"`            |
| `mediaWrapper` | `3Lh9LG662ZDCWW7WaILBba` | `alternativeText: "Trees in Forest with Sun Rays"` |
| `mediaWrapper` | `6JCj4ceIpYx4l3csDUr8Nc` | `alternativeText: "Pine Trees Field Sunset"`       |

Env vars carried over: `CONTENTFUL_SPACE_ID`, `CONTENTFUL_ENV_ID`, `CONTENTFUL_DELIVERY_KEY`,
`CONTENTFUL_PREVIEW_KEY`, `CONTENTFUL_PREVIEW_SECRET`, `CONTENTFUL_REVALIDATION_SECRET`.
Dropped as unused: `CONTENTFUL_MANAGEMENT_KEY`, `CONTENTFUL_OPTIMIZATION_CLIENT`,
`CONTENTFUL_OPTIMIZATION_ENV_ID`.

---

## 9. Optimization SDK fit — the short version

Full assessment in `docs/optimization-sdk-hotwire-fit.md`. The headline: the architecture
Contentful's own docs recommend for SSR maps onto Hotwire almost too neatly.

`@contentful/optimization-node` is **stateless** — one singleton per process, `forRequest()` per
request — and explicitly expects the host app to own cookies, consent, profile, and rendering.
That is already the division of labor a Hono middleware plus a server-side resolver has.
`@contentful/optimization-web` then covers the one thing a server provably cannot know: whether
a rendered block was actually seen, clicked, or hovered. In Hotwire that is a Stimulus
controller over already-rendered DOM.

Two real frictions to design around:

1. Variant selection puts a second API round trip in the request path, so the cache profile
   needs a public-permutation vs private-request split.
2. Turbo Drive navigations do not fire a fresh page load, so `page` events must be wired to
   `turbo:load` rather than relying on script execution.

---

## 10. Verification

1. `npm run build && npm start`; `GET /home` renders hero + duplex. View source is complete HTML
   with no serialized data payload. Compare against the Next app at 375 / 780 / 1280 / 1920px.
2. **Published path ships no Live Preview JS** — Network on `/home` shows `app.css` and the
   Turbo/Stimulus core only. This is the ADR 0002 goal, now structural.
3. **Cache** — request `/home` twice, confirm a hit. Then
   `curl -X POST 'http://localhost:3000/api/revalidate?secret=$SECRET' -H 'content-type: application/json' -d '{"sys":{"id":"4lNp8bpdfk8JITgwZNpbMj"}}'`
   → `{"revalidated":true}`, next request refetches. Repeat with a `DeletedEntry`-shaped body
   (no `fields`) and a locale-keyed slug (`{"fields":{"slug":{"en-US":"home"}}}`).
4. **Preview mode** — `GET /preview?secret=$SECRET&type=landingPage&slug=home` → 302 to `/home`
   with the cookie set `HttpOnly; Secure; SameSite=None`. Confirm uncached CPA data by editing
   without publishing. Bad secret → 401; `slug=does-not-exist` → 401 with no cookie set.
5. **Live updates** — `ngrok http 3000`, point the space's Content Preview URL at the HTTPS host,
   open `landingPage` `4TJUjKjRgGaAV2qkGmiW1E`, edit `heading`. Expect a POST to
   `/preview/render` returning `text/vnd.turbo-stream.html`, the hero morphing in place, **no**
   `preview.contentful.com` request per keystroke, and scroll position held.
6. **Inspector mode / content source maps** — in the same iframe, hover the heading. If the blue
   edit affordance appears with **no** `data-contentful-*` attributes in the DOM, steganographic
   encoding survived server rendering _and_ the Turbo Stream round trip. This is an assumption
   worth confirming empirically, not asserting. Fallback: explicit tagging on `Hero`/`Duplex`.
7. **Security** — `POST /preview/render` without the draft cookie must 401/403. With a valid
   cookie, `{"fields":{"heading":"<img src=x onerror=alert(1)>"}}` must render as text.
8. `npx tsc --noEmit` clean.
