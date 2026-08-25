import { createHmac, timingSafeEqual } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";

// Preview mode: the Delivery-vs-Preview API swap.
//
// This is the plain server-rendered pattern — the same shape a Rails app uses for
// CMS preview. State lives in one signed cookie, a middleware resolves it once per
// request, and the content fetch picks its client from that boolean. Nothing about
// it is Turbo- or Stimulus-specific, because deciding which API to read from is a
// server concern; Hotwire has no opinion on it.
//
// Next.js called this Draft Mode and set an opaque signed `__prerender_bypass`
// cookie. We mint the equivalent: an HMAC of a fixed message under the preview
// secret, so the cookie cannot be forged and carries no server-side state.

export const PREVIEW_COOKIE = "__contentful_preview";

const previewSecret = () => {
  const secret = process.env.CONTENTFUL_PREVIEW_SECRET;
  if (!secret) throw new Error("CONTENTFUL_PREVIEW_SECRET is not set");
  return secret;
};

const previewToken = () =>
  createHmac("sha256", previewSecret()).update("preview").digest("hex");

/** Constant-time string compare that tolerates length mismatch. */
export const secretsMatch = (a: string | undefined, b: string): boolean => {
  if (!a) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

/** Read the cookie. Use `c.get("preview")` in routes — the middleware calls this. */
export const isPreviewRequest = (c: Context): boolean => {
  try {
    return secretsMatch(getCookie(c, PREVIEW_COOKIE), previewToken());
  } catch {
    // No preview secret configured — preview mode is simply unavailable.
    return false;
  }
};

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "None",
  path: "/",
} as const;

/**
 * Enter preview mode.
 *
 * `SameSite=None` plus `Secure` is not optional: Contentful renders the preview
 * inside an iframe on app.contentful.com, and a Lax cookie is dropped on that
 * cross-site request. Because `Secure` requires HTTPS, local preview must be
 * reached through the ngrok HTTPS URL rather than http://localhost.
 * @see https://www.contentful.com/developers/docs/tutorials/preview/live-preview/#my-page-has-an-authorization-cookie-for-logging-in
 */
export const enablePreview = (c: Context): void => {
  setCookie(c, PREVIEW_COOKIE, previewToken(), COOKIE_OPTIONS);
};

export const disablePreview = (c: Context): void => {
  deleteCookie(c, PREVIEW_COOKIE, COOKIE_OPTIONS);
};
