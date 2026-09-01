// Consent, as a third-party CMP would supply it.
//
// The assumption this demo models: some external consent platform owns the
// decision and publishes it as a cookie readable by both the server and the
// browser. This app never asks the visitor anything — it only reads that cookie
// and tells the SDK what it is allowed to do.
//
// Swapping in a real CMP means changing `readConsent` and nothing else.

import { getCookie } from "hono/cookie";
import type { Context } from "hono";

/** The dummy CMP cookie. Value is the string "true" or "false". */
export const CONSENT_COOKIE = "cmp-consent";

/**
 * The Optimization SDK has TWO independent consent axes, and they are worth
 * keeping separate even when one cookie drives both:
 *
 *   events      — may we emit personalization and analytics events at all?
 *   persistence — may we retain profile continuity between requests?
 *
 * A real CMP with per-purpose toggles maps its "analytics/personalization"
 * purpose onto `events` and its "functional storage" purpose onto `persistence`.
 * The two are genuinely different: a visitor can reasonably allow personalizing
 * this page view while refusing to be remembered afterwards.
 */
export type ConsentDecision = {
  events: boolean;
  persistence: boolean;
  /**
   * False when the CMP has not recorded a decision yet.
   *
   * This is NOT the same as a decision of `false`, and the SDK models the
   * difference: with no decision its consent state is `undefined`. We keep the
   * distinction so the browser can be seeded honestly rather than being told the
   * visitor said no when they have not been asked.
   */
  recorded: boolean;
};

const DENIED_UNTIL_ASKED: ConsentDecision = {
  events: false,
  persistence: false,
  recorded: false,
};

/** Read the CMP decision for this request. */
export const readConsent = (c: Context): ConsentDecision => {
  switch (getCookie(c, CONSENT_COOKIE)) {
    case "true":
      return { events: true, persistence: true, recorded: true };
    case "false":
      return { events: false, persistence: false, recorded: true };
    default:
      // No cookie: the CMP has not asked yet. Fail closed.
      return DENIED_UNTIL_ASKED;
  }
};
