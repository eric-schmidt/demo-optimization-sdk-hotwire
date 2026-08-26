import { HERO_SIZES, resolveImage } from "../lib/image";
import type { BlockProps } from "../lib/types";

/**
 * Port of src/components/Hero.jsx.
 *
 * The markup and class lists are unchanged. Two differences, both forced:
 *
 * 1. next/image's `fill` injected `position:absolute; inset:0; width:100%;
 *    height:100%` as inline styles, so those are now explicit classes.
 * 2. `priority` became `fetchpriority="high"`, which is what it compiled to.
 *
 * The `id` is the Turbo morph anchor. It lives on the <section> rather than a
 * wrapper element so the DOM stays identical to the Next.js output.
 */
export const Hero = ({ fields, id, trackingAttributes }: BlockProps) => {
  const { heading, copy, image } = fields;
  const resolved = resolveImage(image);

  return (
    <section id={id} class="container relative" {...trackingAttributes}>
      <div class="relative z-10 md:max-w-lg px-10 py-20 md:px-10 md:py-40">
        <h1 class="drop-shadow-lg mb-4">{heading || ""}</h1>

        {copy && <div class="text-md lg:text-lg mb-4">{copy}</div>}
      </div>

      {resolved && (
        <img
          class="absolute inset-0 h-full w-full object-cover"
          // Prevent Largest Contentful Paint issues.
          fetchpriority="high"
          decoding="async"
          sizes={HERO_SIZES}
          src={resolved.src}
          srcset={resolved.srcset}
          alt={resolved.alt}
        />
      )}
    </section>
  );
};

export default Hero;
