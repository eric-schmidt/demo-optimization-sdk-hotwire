import { DUPLEX_SIZES, resolveImage } from "../lib/image";
import type { BlockProps } from "../lib/types";

/**
 * Port of src/components/Duplex.jsx. Markup and classes unchanged.
 *
 * `text-white` is preserved even though it renders invisibly against the light
 * gradient body background — this is a faithful port, and the bug is visual
 * rather than functional. See docs/plans/2026-08-25-nextjs-to-hotwire-port.md §5.
 */
export const Duplex = ({ fields, id }: BlockProps) => {
  const { heading, copy, image } = fields;
  const resolved = resolveImage(image);

  return (
    <section
      id={id}
      class="grid grid-cols-1 md:grid-cols-2 gap-12 p-6 mt-12"
    >
      <div class="text-white flex flex-col justify-center">
        <h2 class="text-2xl mb-4">{heading || ""}</h2>

        <div>{copy || ""}</div>
      </div>

      {resolved && (
        <img
          width={resolved.width}
          height={resolved.height}
          loading="lazy"
          decoding="async"
          sizes={DUPLEX_SIZES}
          src={resolved.src}
          srcset={resolved.srcset}
          alt={resolved.alt}
        />
      )}
    </section>
  );
};

export default Duplex;
