/** @type {import('next').NextConfig} */
const nextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  cacheLife: {
    contentful: {
      stale: 300,
      revalidate: 900,
      expire: 3600,
    },
  },
  images: {
    loader: "custom",
    loaderFile: "./src/lib/imageLoader.js",
  },
};

module.exports = nextConfig;
