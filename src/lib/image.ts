import type { MediaWrapper } from "./types";

// Replacement for next/image plus src/lib/imageLoader.js.
//
// next/image was doing four jobs: rewriting the URL through the Contentful Images
// API, generating a srcset, applying `sizes`, and emitting loading/priority
// hints. Only the first was ours; the rest now has to be explicit.

/** Ported verbatim from the old imageLoader.js. */
export const imageUrl = (src: string, width: number, quality = 75): string =>
  `${src}?w=${width}&q=${quality}&fm=avif`;

/** Mirrors Next's default deviceSizes so output is comparable side by side. */
export const DEFAULT_WIDTHS = [640, 828, 1080, 1200, 1920, 2048] as const;

export const imageSrcSet = (
  src: string,
  widths: readonly number[] = DEFAULT_WIDTHS,
): string => widths.map((w) => `${imageUrl(src, w)} ${w}w`).join(", ");

/** `sizes` strings lifted verbatim from the Next.js components — they encode the layout math. */
export const HERO_SIZES =
  "(min-width: 1280px) 1024px, (min-width: 780px) calc(90.83vw - 121px), calc(100vw - 96px)";
export const DUPLEX_SIZES =
  "(min-width: 1280px) 416px, (min-width: 780px) calc(45.42vw - 156px), calc(100vw - 240px)";

export type ResolvedImage = {
  src: string;
  srcset: string;
  width?: number;
  height?: number;
  alt: string;
};

/**
 * Safely unwrap a `mediaWrapper` entry into everything an <img> needs.
 *
 * Returns undefined rather than throwing when the reference is unresolved or the
 * asset is unpublished — both routine on the Preview API. The Next.js components
 * only guarded the first hop (`image?.fields.media...`), so they threw here, and
 * their `|| ""` fallbacks were dead code because `https:${undefined}` is truthy.
 *
 * `alt` comes from the wrapper's own `alternativeText` field, which is where
 * Contentful actually stores it.
 */
export const resolveImage = (
  image: MediaWrapper | undefined,
): ResolvedImage | undefined => {
  const url = image?.fields?.media?.fields?.file?.url;
  if (!url) return undefined;

  // Contentful asset URLs are protocol-relative (//images.ctfassets.net/...).
  const src = url.startsWith("//") ? `https:${url}` : url;
  const dimensions = image?.fields?.media?.fields?.file?.details?.image;

  return {
    src,
    srcset: imageSrcSet(src),
    width: dimensions?.width,
    height: dimensions?.height,
    alt: image?.fields?.alternativeText ?? "",
  };
};
