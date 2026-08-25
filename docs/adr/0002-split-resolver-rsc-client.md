# ADR 0002: Split component resolver for RSC / Client rendering paths

**Status:** Accepted — 2026-07-16

**Related:** [ADR 0001 — Migrate Contentful caching to Next.js Cache Components](./0001-cache-components-migration.md)

## Context

After ADR 0001 landed, page data was cached at the server via `"use cache"` — but *every* content component (`Hero`, `Duplex`) was still marked `"use client"` because each one called `useContentfulLiveUpdates(entry)` directly. `ComponentResolver` imported them via `next/dynamic`, and the whole render subtree crossed the client boundary. Two consequences:

1. **Every cached, published page render still shipped Live Preview + component render JS to the browser.** Live Preview only matters when `draftMode().isEnabled` is true. Users hitting a cached Delivery-API page paid for a subscription they never used.
2. **`useContentfulLiveUpdates` was called N times per page** (once per top-section component). It's cheap, but semantically wrong — one page-level subscription is the pattern Contentful's own App Router example demonstrates ("Renderer → HeroSection / BodySection").

`"use client"` is a compile-time directive; there is no runtime "conditionally client-render if draft mode." The way to opt out on the published path is to route through a different module entirely.

A secondary constraint surfaced during implementation: `<Image loader={imageLoader}>` cannot cross an RSC → Client boundary — function props aren't serializable — so any solution that turns content components into RSCs also has to relocate the loader.

## Decision

**Two resolvers, chosen at render time from `draftMode()`.**

- **`src/components/ComponentResolver.jsx`** — plain React Server Component. No `"use client"`, no Live Preview subscription. Reads `entry.fields` from the cached fetch and renders the mapped component directly. This is the *published* path.
- **`src/components/LivePreviewResolver.jsx`** — `"use client"`. Calls `useContentfulLiveUpdates(entry)` once per component and passes the updated `fields` down. This is the *draft* path.
- **`src/app/[slug]/page.jsx`** — picks `const Resolver = isEnabled ? LivePreviewResolver : ComponentResolver;` inside the `<Suspense>`-bounded `<PageBody>`.

**`src/components/ComponentMap.js`** — swapped `next/dynamic` for plain static imports. `next/dynamic` is a client-only helper; using it forced anything importing the map onto the client. Static imports make the map RSC-safe. Content components (`Hero`, `Duplex`) are now "shared modules": bundled server-side when reached via `ComponentResolver`, and client-side when reached via `LivePreviewResolver`. Next's compiler handles the split automatically.

**Image loader relocated to `next.config.js` `images.loaderFile`.** With `Hero` / `Duplex` no longer client-only, passing `loader={imageLoader}` as a prop broke serialization. Registering the loader globally (`images: { loader: "custom", loaderFile: "./src/lib/imageLoader.js" }`) lets `<Image>` pick it up automatically in both render contexts with no function prop.

## Consequences

**Positive**

- **Zero Live Preview JS on the published path.** Cached page renders no longer ship `useContentfulLiveUpdates`, `ContentfulLivePreviewProvider`-related client code, or the `Hero` / `Duplex` render code — those components render entirely server-side. Faster first paint, less hydration, smaller bundle for the visitor-facing case.
- **One live-updates subscription per entry.** Matches Contentful's canonical App Router example.
- **Content components become "shared" modules.** They can be authored once and reached from either resolver; the compiler decides where they run.

**Negative**

- Two resolver files instead of one. Whoever adds a new content component must remember: no hooks in the leaf (or the RSC path breaks); any client-only side-effects belong in the `LivePreviewResolver`.
- Global image loader is a project-wide config: every `<Image>` in the app now uses it. Fine here — the loader appends Contentful-image-API query params to the `src` URL, and non-Contentful images aren't used in this project.
- Live Preview no longer works on cached Delivery-API renders. That was true before too, but is now enforced structurally.

## Alternatives considered

- **Single client resolver (the previous shape).** Simpler, but pays the Live Preview JS cost on every cached render. Rejected once the caching migration in ADR 0001 exposed how much of that cost was pure waste on the published path.
- **Pass components as `children` into a client wrapper.** React's standard escape hatch for RSC → Client — children props stay RSC even when the parent is a client component. Doesn't help here because the resolver picks components *dynamically* from a map (`ComponentMap[contentTypeId]`), so it has to *import* them, which pulls them into the client bundle.
- **Runtime `"use client"` toggling.** Not possible — the directive is a bundler input, not a runtime switch.
- **Keep the image loader as a prop and mark it with `"use server"`.** Would work only if the loader itself ran server-side; it doesn't — `<Image>` invokes it in both contexts to build `srcset`. Global registration is cleaner.

## References

- Contentful — [Live Updates docs](https://www.contentful.com/developers/docs/tutorials/preview/live-updates/) (App Router `Renderer` example)
- Contentful — [Live Preview examples on GitHub](https://github.com/contentful/live-preview/tree/main/examples)
- Next.js — [`images.loaderFile` config](https://nextjs.org/docs/app/api-reference/components/image#loaderfile)
- Next.js — [Composing Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) (children-as-slots pattern)
