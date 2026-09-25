// Timeline Preview: rendering a scheduled Release instead of current content.
//
// Contentful hands the app one opaque query parameter. The Content Preview URL in
// the space carries `&timeline={timeline}`, and the web app expands that token to
// `releaseId;timestamp` when an editor selects a release — or to an EMPTY string
// when they are looking at current content.
//
// This module is the whole trust boundary for that token. Everything downstream
// consumes `TimelineScope` and never touches the raw string, because the two
// interesting failure modes both live here:
//
//   - a value that LOOKS like a token but isn't one (see `isRealValue`), which the
//     parser passes through happily and the API then 404s on;
//   - a config the SDK considers invalid, which throws on every single request
//     rather than degrading (see `timelinePreviewFor`).

import { parseTimelinePreviewToken } from "@contentful/timeline-preview";

/**
 * Mirrors contentful@11.12.9 `dist/types/types/timeline-preview.d.ts`.
 *
 * Declared locally on purpose: the type is real, but it is not on the package's
 * public surface — `dist/types/types/index.d.ts` does not re-export it and the
 * deep path is not in the package's `exports` map, so it cannot be imported.
 * Narrowed to the two shapes this app actually constructs.
 */
export type TimelinePreview =
  | { release: { lte: string } }
  | { timestamp: { lte: string } };

/** A validated release scope for one request. */
export type TimelineScope = {
  /**
   * The raw token exactly as Contentful sent it, kept for forwarding through the
   * `/preview` redirect. Round-tripping what the web app produced beats
   * re-deriving it: `buildTimelinePreviewToken` appends a trailing `;` for a
   * release-only scope, so a rebuild would not be byte-identical.
   */
  token: string;
  releaseId?: string;
  timestamp?: string;
  /** What gets handed to `createClient({ timelinePreview })`. */
  preview: TimelinePreview;
};

/**
 * Reject values that look like a token but are not one.
 *
 * `parseTimelinePreviewToken` is `decodeURIComponent().split(';')` and nothing
 * more, so three values sail straight through it and reach the Preview API,
 * which answers 404:
 *
 *   `{timeline}`  — the placeholder, unexpanded because the space's Content
 *                   Preview URL was mis-typed or the feature is off
 *   `undefined`   — a missing parameter that something stringified on the way
 *   `null`        — the same, from a different accessor
 *
 * The second is not hypothetical: the Next.js sibling demo does
 * `parseTimelinePreviewToken(`${searchParams.timeline}`)`, which produces exactly
 * that when the parameter is absent.
 */
const isRealValue = (value: string | undefined): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value !== "undefined" &&
  value !== "null" &&
  !value.startsWith("{");

/**
 * Turn the raw `timeline` query parameter into a validated scope.
 *
 * Returns undefined for every "no release selected" case — an absent parameter,
 * the empty token Contentful sends for current content, a placeholder, or a
 * malformed one. That is the common path, not an error path: most draft renders
 * are of current content.
 */
export const timelineFromToken = (
  raw: string | undefined,
): TimelineScope | undefined => {
  if (!isRealValue(raw)) return undefined;

  let parsed;
  try {
    parsed = parseTimelinePreviewToken(raw);
  } catch {
    // The parser calls decodeURIComponent, which throws URIError on a malformed
    // percent sequence (`%zz`, or a bare `%` in a hand-typed URL). A junk
    // parameter must not 500 the page.
    return undefined;
  }

  const { releaseId, timestamp } = parsed;

  // Release wins, and both are never sent together. The docs permit
  // release + timestamp "if the release is scheduled", but in the field sending
  // both 404s for an UNSCHEDULED release and whenever the timestamp does not line
  // up with the release's scheduled date. A release id alone resolves correctly,
  // so the timestamp is kept for display only.
  if (isRealValue(releaseId)) {
    return {
      token: raw,
      releaseId,
      ...(isRealValue(timestamp) ? { timestamp } : {}),
      preview: { release: { lte: releaseId } },
    };
  }

  // A timestamp on its own is legitimate: "show me the site as of this moment",
  // which resolves through whichever releases are scheduled before it.
  if (isRealValue(timestamp)) {
    return { token: raw, timestamp, preview: { timestamp: { lte: timestamp } } };
  }

  return undefined;
};

/**
 * The `timelinePreview` option for `createClient`, or nothing.
 *
 * Gated on `preview` because Timeline Preview is Preview-API-only, and the SDK
 * does not degrade quietly when that is violated: `checkEnableTimelinePreviewIsAllowed`
 * THROWS a ValidationError when a valid config meets a Delivery host. So a token
 * arriving on a published request has to be dropped here rather than passed along.
 */
export const timelinePreviewFor = (
  preview: boolean,
  scope: TimelineScope | undefined,
): { timelinePreview: TimelinePreview } | undefined =>
  preview && scope ? { timelinePreview: scope.preview } : undefined;

/**
 * One line describing why a release scope was rejected.
 *
 * The SDK throws a rich object whose `toString` dumps the entire failed request —
 * including its own partially-redacted `Authorization` header. That is useful when
 * you are debugging the SDK and pure noise for a condition this app HANDLES, so the
 * useful part is extracted: the release id, and whether the release simply does not
 * exist (the ordinary stale-link case) or something worse happened.
 */
export const describeTimelineFailure = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);

  // contentful.js does not expose `status` or `details` as properties — it packs the
  // whole report into `message` as a JSON string. So this parses rather than reads.
  try {
    const report = JSON.parse(message) as {
      status?: number;
      details?: { message?: string };
      message?: string;
    };
    const detail = report.details?.message ?? report.message;
    if (typeof detail === "string") {
      return report.status === undefined ? detail : `${report.status} ${detail}`;
    }
  } catch {
    // Not a Contentful error report — some other failure reached us.
  }

  return message.replace(/\s+/g, " ").slice(0, 200);
};
