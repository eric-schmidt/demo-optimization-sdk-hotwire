// Smoke check for the invariants that matter in this port. Run: npm run smoke
//
// Runs without Contentful credentials, by rendering fixture data shaped like
// space zh1nhbmve68h:
//
//   - the published render ships NO Live Preview JS (the ADR 0002 goal)
//   - Hero/Duplex class lists and `sizes` strings still match the Next.js output
//   - the alt-text fix and the missing-image guard both hold
//   - field values are HTML-escaped, and embedded JSON cannot break out of <script>
//
// Cache assertions used to live here too; they moved with the code into
// backup/with-cache/scripts/smoke.tsx.
//
import { BlockList } from "../src/components/ComponentResolver";
import { Layout } from "../src/views/Layout";
import { blocksFromPages } from "../src/lib/blocks";
import type { LandingPage } from "../src/lib/types";

const media = (id: string, url: string, w: number, h: number, alt: string) => ({
  sys: { id, type: "Entry", contentType: { sys: { id: "mediaWrapper" } } },
  fields: {
    alternativeText: alt,
    media: {
      sys: { id: `asset-${id}`, type: "Asset" },
      fields: { file: { url, details: { image: { width: w, height: h } } } },
    },
  },
});

const page: LandingPage = {
  sys: { id: "4TJUjKjRgGaAV2qkGmiW1E", type: "Entry", contentType: { sys: { id: "landingPage" } } },
  fields: {
    adminTitle: "Homepage",
    slug: "home",
    hero: {
      sys: { id: "4lNp8bpdfk8JITgwZNpbMj", type: "Entry", contentType: { sys: { id: "hero" } } },
      fields: {
        heading: "Ea Est Voluptate",
        copy: "Sed id modi dolorum modi architecto voluptas nemo accusamus.",
        image: media("3Lh9LG662ZDCWW7WaILBba", "//images.ctfassets.net/zh1nhbmve68h/1us78025JtB6lUou2oFlBC/x/Trees.jpg", 2400, 1600, "Trees in Forest with Sun Rays"),
      },
    },
    content: [
      {
        sys: { id: "2TrERRUR7e3OE1RA5Zqttp", type: "Entry", contentType: { sys: { id: "duplex" } } },
        fields: {
          heading: "Praesentium Harum Repellat",
          copy: "Et rem dolores harum similique exercitationem eaque.",
          image: media("6JCj4ceIpYx4l3csDUr8Nc", "//images.ctfassets.net/zh1nhbmve68h/01dIV2Yik4oNqB9V7XA29D/y/Pine.jpg", 2400, 1350, "Pine Trees Field Sunset"),
        },
      },
      // Unmapped content type -> should log + skip, not throw.
      { sys: { id: "unmapped1", type: "Entry", contentType: { sys: { id: "componentQuote" } } }, fields: {} },
      // Missing image -> should render section without <img>, not "https:undefined".
      { sys: { id: "noimg1", type: "Entry", contentType: { sys: { id: "duplex" } } }, fields: { heading: "No Image" } },
    ],
  },
};

const render = async (node: unknown) => {
  const out = (node as { toString(): string | Promise<string> }).toString();
  return typeof out === "string" ? out : await out;
};

const blocks = blocksFromPages([page]);
console.log(`blocks resolved: ${blocks.length} (expect 4: hero, duplex, unmapped, noimg)`);

const published = await render(Layout({ draft: false, children: BlockList({ blocks }) }));
const draft = await render(Layout({ draft: true, livePreviewData: [page], children: BlockList({ blocks }) }));

const check = (label: string, cond: boolean) =>
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);

console.log("\n--- published render ---");
check("no live-preview bundle", !published.includes("live-preview.js"));
check("no data-controller", !published.includes("data-controller"));
check("no embedded entry JSON", !published.includes("data-live-preview-data"));
check("no turbo-cache-control", !published.includes("turbo-cache-control"));
check("no exit-preview form on published", !published.includes('action="/preview"'));
check("has app.js", published.includes("/assets/app.js"));
check("hero section id", published.includes('id="block-4lNp8bpdfk8JITgwZNpbMj"'));
check("duplex section id", published.includes('id="block-2TrERRUR7e3OE1RA5Zqttp"'));
check("morph target container", published.includes('id="page-blocks"'));
check("hero classes verbatim", published.includes('class="container relative"'));
check("hero inner classes verbatim", published.includes('class="relative z-10 md:max-w-lg px-10 py-20 md:px-10 md:py-40"'));
check("duplex classes verbatim", published.includes('class="grid grid-cols-1 md:grid-cols-2 gap-12 p-6 mt-12"'));
check("duplex text-white preserved", published.includes('class="text-white flex flex-col justify-center"'));
check("alt fixed (hero)", published.includes('alt="Trees in Forest with Sun Rays"'));
check("alt fixed (duplex)", published.includes('alt="Pine Trees Field Sunset"'));
check("images api transform", published.includes("?w=1080&amp;q=75&amp;fm=avif"));
check("srcset built", published.includes("2048w"));
check("hero fill+priority", published.includes('class="absolute inset-0 h-full w-full object-cover"') && published.includes('fetchpriority="high"'));
check("duplex intrinsic dims", published.includes('width="2400"') && published.includes('height="1350"'));
check("duplex lazy", published.includes('loading="lazy"'));
check("hero sizes verbatim", published.includes("calc(90.83vw - 121px)"));
check("duplex sizes verbatim", published.includes("calc(45.42vw - 156px)"));
check("no https:undefined", !published.includes("https:undefined"));
check("missing-image block still renders", published.includes('id="block-noimg1"'));
check("unmapped block skipped", !published.includes("unmapped1"));

console.log("\n--- draft render ---");
check("loads live-preview bundle", draft.includes("live-preview.js"));
check("mounts controller", draft.includes('data-controller="live-preview"'));
check("locale value", draft.includes('data-live-preview-locale-value="en-US"'));
check("embeds entry JSON", draft.includes("data-live-preview-data"));
check("turbo-cache-control no-cache", draft.includes('content="no-cache"'));
check("exit-preview is a form, not a link", draft.includes('<form method="post" action="/preview"') && draft.includes('value="delete"'));
check("no stateful GET link anywhere", !draft.includes('href="/preview'));
check("JSON script escapes <", !/<script type="application\/json"[^>]*>[^<]*<\/(?!script)/.test(draft));

console.log("\n--- escaping ---");
const xss = await render(BlockList({ blocks: [{
  sys: { id: "x", type: "Entry", contentType: { sys: { id: "duplex" } } },
  fields: { heading: '<img src=x onerror=alert(1)>', copy: '"><script>bad()</script>' },
}]}));
check("heading escaped", !xss.includes("<img src=x") && xss.includes("&lt;img"));
check("copy escaped", !xss.includes("<script>bad()"));

console.log("\n--- JSON breakout ---");
const evil = await render(Layout({ draft: true, livePreviewData: { s: "</script><script>bad()</script>" }, children: null }));
check("no </script> breakout", !evil.includes("</script><script>bad()"));
check("escaped as \\u003c", evil.includes("\\u003c/script"));
