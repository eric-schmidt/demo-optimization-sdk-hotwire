// Browser-side personalization: interaction tracking, plus the track/identify demos.
//
// The server already chose the variant and rendered it, so this file never
// resolves entries. Its jobs are narrower: adopt the server's profile and
// selections, keep page events correct across Turbo navigations, and let the SDK
// observe the data-ctfl-* elements the server stamped.

import { Controller } from "@hotwired/stimulus";
import ContentfulOptimization from "@contentful/optimization-web";
import { hydrateOptimizationHandoff } from "@contentful/optimization-web/handoff";

/**
 * Module-level singleton, deliberately created OUTSIDE the controller.
 *
 * The Web SDK throws "ContentfulOptimization is already initialized" on a second
 * construction, and Stimulus connect() fires again on every Turbo Drive body
 * swap — so constructing it in connect() would break the second navigation.
 */
let instance: ContentfulOptimization | undefined;

type SdkConfig = {
  clientId: string;
  environment: string;
  locale: string;
  /**
   * The CMP decision the SERVER used for this render, so both runtimes start from
   * the same answer. `undefined` means the CMP has not asked yet — which the SDK
   * treats as distinct from an explicit `false`, so it is passed through as
   * undefined rather than coerced.
   */
  consent: { events: boolean; persistence: boolean } | undefined;
  /**
   * Whether this page's entries should emit view/click Insights events.
   *
   * False on draft renders. The server stamps `data-ctfl-*` on draft pages too
   * (baseline-shaped, so Live Preview morphs keep working), and the SDK's
   * MutationObserver would happily observe them — which would report an editor
   * scrolling and clicking around the authoring UI as visitor engagement. Editor
   * traffic is not visitor traffic.
   */
  tracking: boolean;
};

const getSdk = ({ clientId, environment, locale, tracking, consent }: SdkConfig) => {
  const existing = instance ?? window.contentfulOptimization;
  if (existing) return (instance = existing);

  return (instance = new ContentfulOptimization({
    clientId,
    environment,
    locale,
    app: { name: "demo-optimization-sdk-hotwire", version: "0.1.0" },
    // Hovers are noisy and nothing in this demo reports on them.
    autoTrackEntryInteraction: tracking
      ? { views: true, clicks: true, hovers: false }
      : { views: false, clicks: false, hovers: false },
    // Seeded from the CMP cookie the server already read, rather than assumed.
    defaults: {
      consent: consent?.events,
      persistenceConsent: consent?.persistence,
    },
    // Fail closed, for the same non-obvious reason as the server (see
    // lib/optimization.ts): `consent: false` does NOT block events on its own,
    // because the SDK falls through to this allow-list whenever consent is not
    // exactly `true` — and the Web default is ['identify', 'page']. Left at the
    // default, a visitor who refused consent would still emit a page event.
    allowedEventTypes: [],
  }));
};

const readHandoff = (): unknown => {
  const script = document.querySelector<HTMLScriptElement>(
    "script[data-optimization-handoff]",
  );
  if (!script?.textContent) return undefined;
  try {
    return JSON.parse(script.textContent);
  } catch (error) {
    console.error("[optimization] could not parse the handoff payload", error);
    return undefined;
  }
};

export class OptimizationController extends Controller<HTMLElement> {
  static targets = ["status", "consentStatus"];
  static values = {
    clientId: String,
    environment: String,
    locale: { type: String, default: "en-US" },
    routeKey: String,
    demoControls: { type: Boolean, default: false },
    consentEvents: { type: Boolean, default: false },
    consentPersistence: { type: Boolean, default: false },
    consentRecorded: { type: Boolean, default: false },
  };

  declare clientIdValue: string;
  declare environmentValue: string;
  declare localeValue: string;
  declare routeKeyValue: string;
  declare consentEventsValue: boolean;
  declare consentPersistenceValue: boolean;
  declare consentRecordedValue: boolean;
  declare readonly hasStatusTarget: boolean;
  declare readonly statusTarget: HTMLElement;
  declare readonly hasConsentStatusTarget: boolean;
  declare readonly consentStatusTarget: HTMLElement;

  /**
   * Runs on the initial load AND after every Turbo Drive navigation, because
   * Turbo replaces <body> and this controller is mounted inside it. That makes
   * connect() the natural page-event hook — no turbo:load listener needed.
   */
  async connect(): Promise<void> {
    const consent = this.consentRecordedValue
      ? {
          events: this.consentEventsValue,
          persistence: this.consentPersistenceValue,
        }
      : undefined;

    const sdk = getSdk({
      clientId: this.clientIdValue,
      environment: this.environmentValue,
      locale: this.localeValue,
      tracking: true,
      consent,
    });

    // The singleton outlives a Turbo navigation, so `defaults` only apply the
    // first time. Re-apply on every connect so a CMP change picked up by the next
    // server render also reaches the live SDK instance.
    if (consent) applyConsent(sdk, consent);

    this.showConsent(
      this.consentRecordedValue
        ? `events=${this.consentEventsValue} persistence=${this.consentPersistenceValue}`
        : "not asked (fail-closed)",
    );

    // Adopt the profile and selections this render already used, rather than
    // asking the Experience API a second question we know the answer to. The
    // handoff also carries initialPageEvent, which the SDK validates.
    const handoff = readHandoff();
    if (handoff) {
      try {
        await hydrateOptimizationHandoff(sdk as never, handoff as never);
      } catch (error) {
        console.error("[optimization] handoff hydration failed", error);
      }
    }

    // 'skip' on EVERY server-rendered navigation, not just the first.
    //
    // A Turbo Drive visit is a real server request, so the middleware already
    // emitted this route's page event. Emitting again here would double-count
    // every navigation — the opposite of the undercounting a turbo:load-driven
    // emitter is usually written to fix, and worse, because over-counting
    // silently corrupts experiment results while under-counting is visible.
    //
    // 'skip' still registers the route as current, which is what keeps the
    // tracker's own deduplication meaningful for anything that follows.
    try {
      await sdk.trackCurrentPage({
        routeKey: this.routeKeyValue,
        initialPageEvent: "skip",
      });
    } catch (error) {
      console.error("[optimization] trackCurrentPage failed", error);
    }
  }

  /**
   * Deliberately empty.
   *
   * The SDK installs its own document-wide MutationObserver for data-ctfl-*
   * elements, so Turbo body swaps and Turbo Stream morphs are picked up without
   * help. Tearing observation down here would DISABLE tracking after the first
   * navigation rather than restore it. Contrast LivePreviewController, which must
   * unsubscribe because it owns a real subscription.
   */
  disconnect(): void {}

  /** `track`: a metric event from a real interaction. */
  async sendDemoEvent(): Promise<void> {
    const sdk = instance;
    if (!sdk) return;

    this.status("Sending track…");

    try {
      const { accepted } = await sdk.track({
        event: DEMO_EVENT,
        properties: {
          source: "hotwire-demo",
          // Metadata only. This is NOT how the audience is decided — the
          // Experience API matches ?habitat= itself, server-side.
          habitat: new URLSearchParams(location.search).get("habitat") ?? "none",
        },
      });

      this.status(
        accepted
          ? `track "${DEMO_EVENT}" accepted.`
          : `track "${DEMO_EVENT}" BLOCKED — consent does not admit it.`,
      );
    } catch (error) {
      this.status(`track failed: ${String(error)}`);
    }
  }

  /**
   * `identify`: alias the visitor and attach custom traits.
   *
   * Aliasing can change audience membership, so identify returns fresh
   * selections. A browser-rendered app would re-resolve its entries from them;
   * this app cannot, because the HTML already came from the server. So it
   * re-visits the current URL and lets the server select again — the profile id
   * travels in the ctfl-opt-aid cookie, so the alias is already in place.
   */
  async identifyDemoUser(): Promise<void> {
    const sdk = instance;
    if (!sdk) return;

    this.status("Sending identify…");

    try {
      const { accepted } = await sdk.identify({
        userId: DEMO_USER_ID,
        traits: { plan: "pro", loyaltyTier: "gold", demo: true },
      });

      if (!accepted) {
        this.status("identify BLOCKED by consent.");
        return;
      }

      this.status(`identify accepted as ${DEMO_USER_ID}. Re-rendering…`);

      // Server-rendered HTML cannot react to new selections on its own.
      window.Turbo?.visit(location.href, { action: "replace" });
    } catch (error) {
      this.status(`identify failed: ${String(error)}`);
    }
  }

  /**
   * The three CMP stand-in buttons.
   *
   * Each writes the cookie a real consent platform would own, applies the change
   * to the live SDK, and reloads so the SERVER re-reads it too — the server is
   * what chooses the variant, so a consent change only becomes visible in the HTML
   * on the next render.
   */
  grantConsent(): void {
    this.setConsentCookie("true");
  }

  denyConsent(): void {
    this.setConsentCookie("false");
  }

  clearConsent(): void {
    this.setConsentCookie(undefined);
  }

  private setConsentCookie(value: "true" | "false" | undefined): void {
    document.cookie =
      value === undefined
        ? `${CONSENT_COOKIE}=; Path=/; Max-Age=0`
        : `${CONSENT_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;

    const sdk = instance;
    if (sdk && value !== undefined) {
      const granted = value === "true";
      applyConsent(sdk, { events: granted, persistence: granted });
    }

    this.showConsent(value === undefined ? "not asked" : value);
    // Re-render so the server applies the same decision.
    window.Turbo?.visit(location.href, { action: "replace" });
  }

  private showConsent(state: string): void {
    if (this.hasConsentStatusTarget) {
      this.consentStatusTarget.textContent = `consent: ${state}`;
    }
  }

  private status(message: string): void {
    if (this.hasStatusTarget) this.statusTarget.textContent = message;
    console.info(`[optimization] ${message}`);
  }
}

/**
 * Apply a consent decision to the live SDK.
 *
 * This is the seam a real CMP calls. Most consent platforms expose a callback
 * ("OnConsentChanged", "OptanonWrapper", …); call this from it and the SDK picks
 * the change up immediately, with no reload:
 *
 *   window.addEventListener("cmp:changed", () =>
 *     applyConsent(window.contentfulOptimization!, readConsentCookie()));
 *
 * Note a granted decision does not retroactively personalize the HTML the server
 * already sent — the server chose the variant. Newly-granted consent takes visible
 * effect on the next navigation, which is inherent to server-side selection rather
 * than a limitation of this wiring.
 */
export const applyConsent = (
  sdk: ContentfulOptimization,
  decision: { events: boolean; persistence: boolean },
): void => {
  try {
    sdk.consent({ events: decision.events, persistence: decision.persistence });
  } catch (error) {
    console.error("[optimization] could not apply consent", error);
  }
};

/**
 * Must match the event name the experience's primary metric is configured for,
 * or the event is delivered and counts toward nothing. The demo space's
 * "[Desert] Homepage Hero" already carries a primaryMetric — confirm its event
 * name in the Contentful web app before relying on this.
 */
const DEMO_EVENT = "demo_event";
/** Must match CONSENT_COOKIE in src/lib/consent.ts. */
const CONSENT_COOKIE = "cmp-consent";
const DEMO_USER_ID = "demo-user-123";

if (!window.Stimulus) {
  throw new Error(
    "[optimization] assets/app.js must load before the optimization bundle",
  );
}

window.Stimulus.register("optimization", OptimizationController);

export { getSdk };
