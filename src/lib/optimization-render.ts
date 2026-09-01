// Variant selection: the entire personalization decision, in one pure module.
//
// Nothing here touches the network. `resolveOptimizedEntry` is a local function
// over an entry graph the app has already fetched, so this file is synchronous,
// eagerly evaluated, and testable from scripts/smoke.tsx with no credentials.
//
// It deliberately runs BEFORE JSX rather than inside a component. Two reasons:
// a resolver failure becomes a clean 500 through app.onError instead of a
// half-streamed body (hono/jsx stringifies lazily), and the result is a plain
// value that can be asserted on in tests.

import { resolveOptimizedEntryTrackingAttributes } from "@contentful/optimization-web/tracking-attributes";
import type { SelectedOptimizationArray } from "@contentful/optimization-node/core-sdk";
import { optimization } from "./optimization";
import { blockDomId } from "./blocks";
import type { BlockEntry } from "./types";

/** A block plus everything the renderer needs to display and track it. */
export type ResolvedBlock = {
  /** The entry to render: the baseline, or the selected variant. */
  entry: BlockEntry;
  /**
   * Turbo morph anchor. ALWAYS derived from the baseline — see resolveBlock.
   */
  domId: string;
  /** `data-ctfl-*` attributes for the Web SDK's automatic interaction tracking. */
  trackingAttributes: Record<string, string>;
  /**
   * The author chose to render nothing for this audience. The `entry` field
   * still holds the baseline (the SDK keeps it for tracking context), so the
   * renderer must check this rather than rendering `entry` unconditionally.
   */
  isEmptyVariant: boolean;
};

/**
 * Tracking attribute values arrive as `string | boolean | number | undefined`.
 *
 * They must reach the DOM as strings: the Web SDK's click detector selects on
 * the literal `[data-ctfl-clickable="true"]`, and its sticky check compares
 * `dataset.ctflSticky?.toLowerCase() === "true"`. hono/jsx happens to render
 * unknown attributes via `String(value)`, but relying on that would make an
 * upgrade to its boolean-attribute handling a silent tracking outage.
 */
const toStringAttributes = (
  attributes: Record<string, string | boolean | number | undefined>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(attributes)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );

/** Baseline-shaped attributes, for every path where no selection applies. */
const baselineAttributes = (baseline: BlockEntry): Record<string, string> =>
  toStringAttributes({
    "data-ctfl-entry-id": baseline.sys.id,
    "data-ctfl-baseline-id": baseline.sys.id,
  });

const asBaseline = (baseline: BlockEntry): ResolvedBlock => ({
  entry: baseline,
  domId: blockDomId(baseline),
  trackingAttributes: baselineAttributes(baseline),
  isEmptyVariant: false,
});

const resolveBlock = (
  baseline: BlockEntry,
  selectedOptimizations: SelectedOptimizationArray | undefined,
): ResolvedBlock => {
  // Unconfigured, or no page event was accepted. Both mean baseline.
  if (!optimization || !selectedOptimizations?.length) return asBaseline(baseline);

  try {
    const resolved = optimization.resolveOptimizedEntry(
      baseline as never,
      selectedOptimizations,
    );

    return {
      entry: resolved.entry as unknown as BlockEntry,
      // The anchor comes from the BASELINE, never the resolved entry. If a
      // variant swap changed id="block-…", the Turbo Stream's `update` + `morph`
      // on #page-blocks would delete and re-insert the section instead of
      // patching it, losing scroll position and the Live Preview inspector
      // overlay that the morph exists to preserve.
      domId: blockDomId(baseline),
      // Note this reads `resolved`, never `resolved.entry === baseline`. A
      // CONTROL assignment returns the baseline entry WITH a defined
      // selectedOptimization at variantIndex 0, and so does a broken variant
      // link. Both must still be tracked, or an experiment loses its control arm.
      trackingAttributes: toStringAttributes(
        resolveOptimizedEntryTrackingAttributes(baseline as never, resolved),
      ),
      isEmptyVariant: resolved.isEmptyVariant === true,
    };
  } catch (error) {
    // One malformed nt_experiences payload degrades ITS block to baseline
    // rather than failing the whole page.
    console.error(
      `[optimization] could not resolve ${baseline.sys.id}; rendering baseline`,
      error,
    );
    return asBaseline(baseline);
  }
};

/**
 * Resolve every block against the selections returned by the page event.
 *
 * `selectedOptimizations` of undefined is a normal outcome, not an error: no
 * consent, no matching audience, an Experience API failure, or personalization
 * being unconfigured all land here and all render baseline.
 */
export const resolveBlocks = (
  blocks: BlockEntry[],
  selectedOptimizations: SelectedOptimizationArray | undefined,
): ResolvedBlock[] =>
  blocks.map((block) => resolveBlock(block, selectedOptimizations));
