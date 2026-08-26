// Visitor profile continuity.
//
// The Node SDK is stateless: it stores nothing between requests and manages no
// cookies. Profile continuity is therefore the application's job, and this file
// is the whole of it.

import { ANONYMOUS_ID_COOKIE } from "@contentful/optimization-node/constants";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";

// Re-exported so the value appears in exactly one place. It is 'ctfl-opt-aid';
// the constant is imported rather than hardcoded so an SDK rename cannot
// silently fork the profile between server and browser.
export { ANONYMOUS_ID_COOKIE };

export const readProfileId = (c: Context): string | undefined =>
  getCookie(c, ANONYMOUS_ID_COOKIE);

/**
 * Persist the anonymous profile id.
 *
 * `httpOnly: false` is deliberate and load-bearing — do not "harden" it. The
 * browser SDK reads and writes this same cookie, so making it HttpOnly would
 * give the server and the browser two different profiles from the first request
 * onward, and personalization would appear to work while reporting against the
 * wrong visitor. Contrast PREVIEW_COOKIE in lib/preview.ts, which IS HttpOnly
 * because only the server ever reads it.
 *
 * SameSite: Contentful renders preview inside a cross-site iframe, where a Lax
 * cookie is dropped — so HTTPS requests get `None; Secure` to match the preview
 * cookie. Plain http://localhost cannot set a Secure cookie at all, so it falls
 * back to Lax. Consequence, documented in the README: browsing published pages
 * over http://localhost does not persist a profile. Variants still work, because
 * this demo's audiences are query-parameter driven and need no history, but
 * sticky assignment does not survive a reload.
 */
export const writeProfileId = (c: Context, id: string): void => {
  const secure = isHttps(c);

  setCookie(c, ANONYMOUS_ID_COOKIE, id, {
    httpOnly: false,
    secure,
    sameSite: secure ? "None" : "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
};

const isHttps = (c: Context): boolean => {
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Drop the stored profile.
 *
 * Called when persistence consent is absent or withdrawn. The SDK's
 * `canPersistProfile` already stops us WRITING the cookie, but a visitor who
 * consented yesterday and refused today would otherwise keep a profile cookie
 * that no longer has a basis — so actively remove it rather than merely stop
 * refreshing it.
 */
export const clearProfileId = (c: Context): void => {
  if (getCookie(c, ANONYMOUS_ID_COOKIE) === undefined) return;
  deleteCookie(c, ANONYMOUS_ID_COOKIE, { path: "/" });
};
