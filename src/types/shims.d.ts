// safe-json-stringify ships no types. It is retained from the Next.js app because
// the Contentful SDK returns a link-resolved graph with circular references, and
// this is what breaks the cycles before the response is cached or serialised.
declare module "safe-json-stringify" {
  const safeJsonStringify: (input: unknown) => string;
  export default safeJsonStringify;
}
