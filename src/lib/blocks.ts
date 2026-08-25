import type { BlockEntry, LandingPage } from "./types";

/**
 * Flatten a landingPage into its ordered list of renderable blocks:
 * the hero first, then each entry in `content`.
 *
 * Shared by the page route and the Live Preview render endpoint so that the
 * initial HTML and every subsequent Turbo Stream are produced by identical
 * logic. If these two ever diverge, a live edit will silently reshape the page.
 */
export const topLevelBlocks = (page: LandingPage): BlockEntry[] => {
  const blocks: BlockEntry[] = [];
  if (page?.fields?.hero) blocks.push(page.fields.hero);
  for (const entry of page?.fields?.content ?? []) {
    if (entry) blocks.push(entry);
  }
  return blocks;
};

export const blocksFromPages = (pages: LandingPage[]): BlockEntry[] =>
  pages.flatMap(topLevelBlocks);

/** Turbo morph anchor for a block. Stable across edits because sys.id is. */
export const blockDomId = (entry: BlockEntry): string =>
  `block-${entry.sys.id}`;
