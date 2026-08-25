// Registered globally via next.config.js `images.loaderFile`, so <Image>
// picks it up automatically in both Server and Client Components. Must be a
// default export.
export default function imageLoader({ src, width, quality }) {
  return `${src}?w=${width}&q=${quality || 75}&fm=avif`;
}
