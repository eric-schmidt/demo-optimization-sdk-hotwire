import React from "react";
import Image from "next/image";

export const Duplex = ({ fields: { heading, copy, image } = {} }) => {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-12 p-6 mt-12">
      <div className="text-white flex flex-col justify-center">
        <h2 className="text-2xl mb-4">{heading || ""}</h2>

        <div>{copy || ""}</div>
      </div>

      <Image
        width={image?.fields.media.fields.file.details.image.width}
        height={image?.fields.media.fields.file.details.image.height}
        sizes="(min-width: 1280px) 416px, (min-width: 780px) calc(45.42vw - 156px), calc(100vw - 240px)"
        src={`https:${image?.fields.media.fields.file.url}` || ""}
        alt={image?.fields.media.fields.file.alternativeText || ""}
      />
    </section>
  );
};

export default Duplex;
