// Server-side personalization: the Optimization Node SDK.
//
// The division of labour is the SDK's own: `@contentful/optimization-node` is
// stateless by design — one singleton per process, one request-bound client per
// request, and no cookies, sessions, profiles or rendering of its own. The host
// app owns all of that. That happens to be exactly how this app is already
// built, which is why nothing had to be restructured to add personalization.
//
// See docs/adr/0004-optimization-sdk-integration.md.

import ContentfulOptimization from "@contentful/optimization-node";
import { createPageContextFromUrl } from "@contentful/optimization-node/core-sdk";
import type {
  CoreStatelessRequest,
  OptimizationData,
} from "@contentful/optimization-node/core-sdk";
import type { Context } from "hono";
import { LOCALE } from "./locale";
import type { ConsentDecision } from "./consent";

/**
 * Every request-path decision degrades to baseline when this is false, so the
 * app runs unchanged — and `npm run smoke` stays credential-free.
 */
export const personalizationEnabled = Boolean(
  process.env.CONTENTFUL_OPTIMIZATION_CLIENT,
);

/**
 * Renders the track/identify demo controls.
 *
 * Off by default so a plain render stays markup-identical to the Next.js version
 * this app was ported from. Turn on with CONTENTFUL_OPTIMIZATION_DEMO_CONTROLS=true.
 */
export const demoControlsEnabled =
  process.env.CONTENTFUL_OPTIMIZATION_DEMO_CONTROLS === "true";

/** Public browser value, like an analytics id. Safe to send to the client. */
export const optimizationClientId = process.env.CONTENTFUL_OPTIMIZATION_CLIENT;
export const optimizationEnvironment =
  process.env.CONTENTFUL_OPTIMIZATION_ENV_ID ?? "main";

/**
 * ONE per process.
 *
 * Safe to reuse because visitor state is bound only by `forRequest()`. Do not
 * construct this inside a handler.
 *
 * No `contentful: { client }` key on purpose: that opts into SDK-managed entry
 * fetching, and this app already fetches the whole landingPage graph — variants
 * included — in a single CDA call. Managed fetching would issue an extra request
 * per block for data we already hold.
 */
export const optimization = optimizationClientId
  ? new ContentfulOptimization({
      clientId: optimizationClientId,
      environment: optimizationEnvironment,
      locale: LOCALE,
      app: { name: "demo-optimization-sdk-hotwire", version: "0.1.0" },
      // The SDK default is requestTimeout 3000 with 1 retry, i.e. ~6s worst
      // case INSIDE a server-rendered request. On an Experience API outage that
      // is six seconds of blank browser. Bound it hard and fall back to
      // baseline instead — see emitPageEvent below.
      fetchOptions: { requestTimeout: 700, retries: 0 },
      // Fail closed. This is REQUIRED for consent to mean anything, and the
      // reason is not obvious: `consent: false` does not block events by itself.
      // The SDK's admission check is
      //
      //   if (consent === true) return true
      //   return allowedEventTypes.includes(method)
      //
      // so `false` and "no decision yet" both fall through to this allow-list —
      // and the Node default is ['identify', 'page']. Leaving it at the default
      // means a visitor who refused consent still gets a page event, an Experience
      // API round trip and a profile. Verified: with the default list a denied
      // request still hit the network; with [] it is refused in 0ms with no
      // request at all.
      //
      // Setting [] costs nothing when consent IS granted, because `consent === true`
      // short-circuits before the list is consulted.
      allowedEventTypes: [],
    })
  : undefined;

/**
 * Bind the singleton to one request.
 *
 * `eventContext.page` is the load-bearing part. Every audience in this demo
 * space targets `context_page_query` on `habitat`, so the query string has to
 * reach the Experience API or no audience can ever match and every render stays
 * baseline — silently, with no error to point at.
 *
 * `createPageContextFromUrl` is the SDK's own helper and returns
 * `{ path, query, referrer, search, url }`, so `?habitat=beach` becomes
 * `query.habitat`. Do not hand-roll this object.
 */
export const forRequestFromContext = (
  c: Context,
  profileId: string | undefined,
  consent: ConsentDecision,
): CoreStatelessRequest | undefined =>
  optimization?.forRequest({
    // Straight from the CMP cookie — see lib/consent.ts. `consent` is required by
    // forRequest(), and its two axes are passed through independently rather than
    // collapsed to one boolean, so a "personalize but don't remember me" decision
    // is expressible. `persistence: false` also makes canPersistProfile false,
    // which is what stops the profile cookie being written.
    consent: { events: consent.events, persistence: consent.persistence },
    locale: LOCALE,
    ...(profileId ? { profile: { id: profileId } } : {}),
    eventContext: {
      userAgent: c.req.header("user-agent") ?? "",
      page: createPageContextFromUrl(requestUrl(c), {
        referrer: c.req.header("referer") ?? "",
      }),
    },
    experienceOptions: {
      ip: clientIp(c),
    },
  });

/**
 * The externally-visible URL.
 *
 * Behind the ngrok tunnel the README requires for Live Preview, `c.req.url` is
 * the internal http://localhost origin. The "All Visitors" audience matches on
 * `context_page_url`, so a wrong origin can misclassify a visitor.
 */
const requestUrl = (c: Context): string => {
  const proto = c.req.header("x-forwarded-proto");
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
  if (!proto || !host) return c.req.url;
  try {
    const url = new URL(c.req.url);
    url.protocol = `${proto.split(",")[0]?.trim()}:`;
    url.host = host.split(",")[0]?.trim() ?? url.host;
    return url.toString();
  } catch {
    return c.req.url;
  }
};

const clientIp = (c: Context): string | undefined =>
  c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || undefined;

/**
 * Emit the `page` event — the ignition for the whole personalization loop.
 *
 * THIS IS THE ONLY PLACE page() IS CALLED. No accepted page event means no
 * selected optimizations, which means baseline everywhere. `forRequest()` alone
 * emits nothing; it only binds context.
 *
 * Never throws. Every failure path — unconfigured, blocked by consent, timeout,
 * Experience API 5xx — returns undefined, which resolves to baseline. The
 * sibling Next.js demo measured an Experience API outage producing HTTP 200
 * with an EMPTY personalized region rather than a fallback; this is the fix.
 */
export const emitPageEvent = async (
  request: CoreStatelessRequest | undefined,
): Promise<OptimizationData | undefined> => {
  if (!request) return undefined;

  try {
    const { accepted, data } = await request.page();

    // An accepted event may still carry no data, so check `accepted` before
    // reading it. Blocked events resolve to { accepted: false } rather than
    // throwing.
    if (!accepted) {
      console.warn("[optimization] page event was blocked; rendering baseline");
      return undefined;
    }

    return data;
  } catch (error) {
    console.error(
      "[optimization] page event failed; rendering baseline",
      error,
    );
    return undefined;
  }
};

/**
 * Stable route identity for browser-side page-event deduplication.
 *
 * Includes the query string because `?habitat=` changes the personalization
 * outcome, so two habitats are genuinely different routes. Sorted so that
 * parameter order cannot produce a spurious second page event.
 */
export const routeKeyFor = (c: Context): string => {
  const url = new URL(requestUrl(c));
  const params = [...url.searchParams.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const search = new URLSearchParams(params).toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
};
