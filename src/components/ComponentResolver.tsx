import chalk from "chalk";
import { ComponentMap } from "./ComponentMap";
import type { ResolvedBlock } from "../lib/optimization-render";

/**
 * The single component resolver.
 *
 * The Next.js app needed two of these (ADR 0002): because
 * `useContentfulLiveUpdates` is a React hook, any component using it had to be
 * marked `"use client"`, which dragged the whole render subtree into the browser
 * bundle — so every cached, published page shipped Live Preview JS that the
 * visitor never used. The workaround was two parallel resolver modules picked at
 * render time from draftMode().
 *
 * Hotwire has no client render layer, so that entire problem disappears. Blocks
 * render on the server in both cases; the draft/published difference is only
 * whether the Layout mounts a Stimulus controller. Published pages ship zero
 * Live Preview JS structurally rather than by discipline.
 */
export const ComponentResolver = ({ block }: { block: ResolvedBlock }) => {
  const contentTypeId = block.entry?.sys?.contentType?.sys?.id;
  const Component = contentTypeId ? ComponentMap[contentTypeId] : undefined;

  if (!Component) {
    console.log(chalk.red(`No Mapping for: ${contentTypeId ?? "unknown"}`));
    return null;
  }

  // An empty variant is the author choosing to show nothing to this audience.
  // `block.entry` still holds the baseline because the SDK keeps it for tracking
  // context, so rendering it here would show baseline content to precisely the
  // audience that was meant to see none.
  if (block.isEmptyVariant) return null;

  return Component({
    fields: block.entry.fields ?? {},
    id: block.domId,
    trackingAttributes: block.trackingAttributes,
  }) as never;
};

/** Renders an ordered list of blocks. Used for the initial page and every Turbo Stream. */
export const BlockList = ({ blocks }: { blocks: ResolvedBlock[] }) => (
  <>
    {blocks.map((block) => (
      <ComponentResolver block={block} />
    ))}
  </>
);
