// Smoke check for the invariants that matter in this port. Run: npm run smoke
//
// Runs without Contentful credentials, by rendering fixture data shaped like
// space zh1nhbmve68h:
//
//   - the published render ships NO Live Preview JS or preview panel (ADR 0002/0004)
//   - Hero/Duplex class lists and `sizes` strings still match the Next.js output
//   - the alt-text fix and the missing-image guard both hold
//   - field values are HTML-escaped, and embedded JSON cannot break out of <script>
//   - variant selection picks the variant, controls still track, and every failure
//     path lands on baseline (ADR 0004)
//
// Cache assertions used to live here too; they moved with the code into
// backup/with-cache/scripts/smoke.tsx.
//
import { BlockList } from "../src/components/ComponentResolver";
import { Layout } from "../src/views/Layout";
import { blocksFromPages } from "../src/lib/blocks";
import type { BlockEntry, LandingPage } from "../src/lib/types";

// src/lib/optimization.ts builds its singleton at module load, so a client id has
// to exist BEFORE that module is first evaluated. A plain statement above the
// imports would not do it — ESM hoists all static imports above top-level code —
// so the resolver is pulled in dynamically, after this assignment.
//
// Constructing the SDK is synchronous and does no network, and
// resolveOptimizedEntry is a pure local function, so this stays offline and
// credential-free while still exercising the real code path rather than a stand-in.
process.env.CONTENTFUL_OPTIMIZATION_CLIENT ??=
  "00000000-0000-0000-0000-000000000000";

const { resolveBlocks } = await import("../src/lib/optimization-render");

/**
 * Every CDA entry carries `metadata`, and the SDK's entry type guard requires it.
 * Fixtures without it resolve to baseline — so these assertions would pass for
 * entirely the wrong reason. Do not drop it.
 */
const META = { tags: [] as unknown[] };

const media = (id: string, url: string, w: number, h: number, alt: string) => ({
  sys: { id, type: "Entry", contentType: { sys: { id: "mediaWrapper" } } },
  metadata: META,
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
    metadata: META,
  fields: {
    adminTitle: "Homepage",
    slug: "home",
    hero: {
      sys: { id: "4lNp8bpdfk8JITgwZNpbMj", type: "Entry", contentType: { sys: { id: "hero" } } },
    metadata: META,
      fields: {
        heading: "Ea Est Voluptate",
        copy: "Sed id modi dolorum modi architecto voluptas nemo accusamus.",
        image: media("3Lh9LG662ZDCWW7WaILBba", "//images.ctfassets.net/zh1nhbmve68h/1us78025JtB6lUou2oFlBC/x/Trees.jpg", 2400, 1600, "Trees in Forest with Sun Rays"),
      },
    },
    content: [
      {
        sys: { id: "2TrERRUR7e3OE1RA5Zqttp", type: "Entry", contentType: { sys: { id: "duplex" } } },
    metadata: META,
        fields: {
          heading: "Praesentium Harum Repellat",
          copy: "Et rem dolores harum similique exercitationem eaque.",
          image: media("6JCj4ceIpYx4l3csDUr8Nc", "//images.ctfassets.net/zh1nhbmve68h/01dIV2Yik4oNqB9V7XA29D/y/Pine.jpg", 2400, 1350, "Pine Trees Field Sunset"),
        },
      },
      // Unmapped content type -> should log + skip, not throw.
      { sys: { id: "unmapped1", type: "Entry", contentType: { sys: { id: "componentQuote" } } }, metadata: META, fields: {} },
      // Missing image -> should render section without <img>, not "https:undefined".
      { sys: { id: "noimg1", type: "Entry", contentType: { sys: { id: "duplex" } } }, metadata: META, fields: { heading: "No Image" } },
    ],
  },
};

const render = async (node: unknown) => {
  const out = (node as { toString(): string | Promise<string> }).toString();
  return typeof out === "string" ? out : await out;
};

const blocks = resolveBlocks(blocksFromPages([page]), undefined);
console.log(`blocks resolved: ${blocks.length} (expect 4: hero, duplex, unmapped, noimg)`);

const GRANTED = { events: true, persistence: true, recorded: true };
const NOT_ASKED = { events: false, persistence: false, recorded: false };

const personalization = {
  clientId: "00000000-0000-0000-0000-000000000000",
  environment: "main",
  routeKey: "/home",
  selectionFingerprint: "none",
  demoControls: false,
  consent: GRANTED,
};

const published = await render(
  Layout({
    draft: false,
    personalization: { ...personalization, handoff: { cache: { scope: "private-request" } } },
    children: BlockList({ blocks }),
  }),
);
const draft = await render(
  Layout({
    draft: true,
    livePreviewData: [page],
    personalization,
    children: BlockList({ blocks }),
  }),
);
// A render with personalization switched off entirely, to prove the app is
// unchanged when CONTENTFUL_OPTIMIZATION_CLIENT is absent.
const plain = await render(Layout({ draft: false, children: BlockList({ blocks }) }));

const check = (label: string, cond: boolean) =>
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);

console.log("\n--- published render ---");
check("no live-preview bundle", !published.includes("live-preview.js"));
check("no preview panel bundle", !published.includes("optimization-preview.js"));
check("loads the tracking bundle", published.includes("/assets/optimization.js"));
check(
  "never both optimization bundles",
  !(published.includes("optimization.js") && published.includes("optimization-preview.js")),
);
check("no live-preview controller", !published.includes('data-controller="live-preview"'));
check("no embedded entry JSON", !published.includes("data-live-preview-data"));
check("embeds the optimization handoff", published.includes("data-optimization-handoff"));
// Personalized responses opt out of Turbo's page cache: restoring one audience's
// HTML for another would be a correctness bug, not a stale-content annoyance.
check("turbo-cache-control on personalized render", published.includes('content="no-cache"'));
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
check("loads the preview panel bundle", draft.includes("/assets/optimization-preview.js"));
check("no published tracking bundle on draft", !draft.includes('src="/assets/optimization.js"'));
check("mounts the panel controller", draft.includes('data-controller="optimization-panel"'));
// Draft emits no page event, so there is nothing to hand off.
check("no handoff on draft", !draft.includes("data-optimization-handoff"));
check("mounts controller", draft.includes('data-controller="live-preview"'));
check("locale value", draft.includes('data-live-preview-locale-value="en-US"'));
check("embeds entry JSON", draft.includes("data-live-preview-data"));
check("turbo-cache-control no-cache", draft.includes('content="no-cache"'));
check("exit-preview is a form, not a link", draft.includes('<form method="post" action="/preview"') && draft.includes('value="delete"'));
check("no stateful GET link anywhere", !draft.includes('href="/preview'));
check("JSON script escapes <", !/<script type="application\/json"[^>]*>[^<]*<\/(?!script)/.test(draft));

console.log("\n--- demo controls ---");
const withDemo = await render(
  Layout({
    draft: false,
    personalization: { ...personalization, demoControls: true },
    children: BlockList({ blocks }),
  }),
);
const withDemoDenied = await render(
  Layout({
    draft: false,
    personalization: { ...personalization, demoControls: true, consent: NOT_ASKED },
    children: BlockList({ blocks }),
  }),
);
check("hidden when explicitly disabled", !published.includes("Experience API demo"));
check("rendered when enabled", withDemo.includes("Experience API demo"));
// The whole point of flipping the default: a fresh visit must SAY why it is
// baseline, rather than silently looking broken.
check("explains why personalization is off", withDemoDenied.includes("Personalization is off."));
check("names the not-asked case specifically", withDemoDenied.includes("No consent decision has been recorded"));
check("no scary notice once consent is granted", !withDemo.includes("Personalization is off."));
check("consent state is server-rendered", withDemo.includes("consent: events=true"));
check("not-asked state is server-rendered", withDemoDenied.includes("consent: not asked"));
check("track button wired", withDemo.includes("optimization#sendDemoEvent"));
check("identify button wired", withDemo.includes("optimization#identifyDemoUser"));
check("status target present", withDemo.includes('data-optimization-target="status"'));
check("consent status target present", withDemo.includes('data-optimization-target="consentStatus"'));
// hono/jsx escapes `>` inside attribute values, so the action ships as
// `click-&gt;...`. The HTML parser decodes it before Stimulus reads the attribute,
// so this is correct — asserted here so nobody "fixes" it into raw() output.
check("action arrow is HTML-escaped, as it should be", withDemo.includes("click-&gt;optimization#sendDemoEvent"));
// Demo controls are a published-page affordance; draft gets the panel instead.
check("absent on draft", !draft.includes("Experience API demo"));

console.log("\n--- consent ---");
const denied = await render(
  Layout({
    draft: false,
    personalization: { ...personalization, consent: NOT_ASKED },
    children: BlockList({ blocks }),
  }),
);
// The decision the server used is forwarded so the browser SDK starts from the
// same answer instead of defaulting to something more permissive.
check("granted consent forwarded", published.includes('data-optimization-consent-events-value="true"'));
check("granted marked as recorded", published.includes('data-optimization-consent-recorded-value="true"'));
check("denied consent forwarded", denied.includes('data-optimization-consent-events-value="false"'));
// "not asked" must stay distinguishable from an explicit no, so the browser can
// seed consent as undefined rather than asserting the visitor declined.
check("not-asked is not reported as a decision", denied.includes('data-optimization-consent-recorded-value="false"'));
check("persistence axis is separate", denied.includes("data-optimization-consent-persistence-value"));
// Content still renders without consent — personalization degrades to baseline,
// it does not blank the page.
check("renders content without consent", denied.includes("Ea Est Voluptate"));
check("still ships the tracking bundle", denied.includes("/assets/optimization.js"));

console.log("\n--- personalization off ---");
check("no optimization bundle at all", !plain.includes("optimization"));
check("no turbo-cache-control", !plain.includes("turbo-cache-control"));
check("still renders content", plain.includes("Ea Est Voluptate"));

console.log("\n--- variant selection ---");

const VARIANT_ID = "5YZqmZHMn0UQZPEO52stMH";
const BASELINE_ID = "4lNp8bpdfk8JITgwZNpbMj";
const EXPERIENCE_ID = "2L7dNNqp6L6Zz0lHvaQ5ty";

/** Shaped like the real nt_experience graph the CDA returns for this space. */
const experienceFor = (variants: { id: string; hidden: boolean }[], variantEntries: BlockEntry[]) => ({
  sys: { id: "expEntry", type: "Entry", contentType: { sys: { id: "nt_experience" } } },
  metadata: META,
  fields: {
    nt_name: "[Forest] Homepage Hero",
    nt_type: "nt_personalization",
    nt_experience_id: EXPERIENCE_ID,
    nt_config: {
      traffic: 1,
      distribution: [0, 1],
      components: [{ type: "EntryReplacement", baseline: { id: BASELINE_ID }, variants }],
    },
    nt_variants: variantEntries,
  },
});

const variantHero: BlockEntry = {
  sys: { id: VARIANT_ID, type: "Entry", contentType: { sys: { id: "hero" } } },
  metadata: META,
  fields: { heading: "Silvae Umbra Alta" },
};

const optimizedHero = (variants: { id: string; hidden: boolean }[], variantEntries: BlockEntry[]): BlockEntry => ({
  sys: { id: BASELINE_ID, type: "Entry", contentType: { sys: { id: "hero" } } },
  metadata: META,
  fields: {
    heading: "[Baseline] Ea Est Voluptate",
    nt_experiences: [experienceFor(variants, variantEntries)],
  },
});

const hero = optimizedHero([{ id: VARIANT_ID, hidden: false }], [variantHero]);

const renderWith = async (block: BlockEntry, selections: unknown) =>
  render(BlockList({ blocks: resolveBlocks([block], selections as never) }));

// The headline behaviour: a selection swaps the entry server-side.
const variantHtml = await renderWith(hero, [{ experienceId: EXPERIENCE_ID, variantIndex: 1 }]);
check("variant heading rendered", variantHtml.includes("Silvae Umbra Alta"));
check("baseline heading gone", !variantHtml.includes("[Baseline] Ea Est Voluptate"));
check("entry id is the VARIANT", variantHtml.includes(`data-ctfl-entry-id="${VARIANT_ID}"`));
check("baseline id retained", variantHtml.includes(`data-ctfl-baseline-id="${BASELINE_ID}"`));
check("variant index stamped", variantHtml.includes('data-ctfl-variant-index="1"'));
// The morph anchor must stay on the BASELINE id, or a Turbo Stream would
// delete-and-insert the section instead of patching it in place.
check("morph anchor is the baseline id", variantHtml.includes(`id="block-${BASELINE_ID}"`));
check("morph anchor is NOT the variant id", !variantHtml.includes(`id="block-${VARIANT_ID}"`));

// A CONTROL assignment returns the baseline entry but is still a real assignment.
// Failing to track it loses the control arm of any experiment.
const controlHtml = await renderWith(hero, [{ experienceId: EXPERIENCE_ID, variantIndex: 0 }]);
check("control renders baseline", controlHtml.includes("[Baseline] Ea Est Voluptate"));
check("control still tracked", controlHtml.includes('data-ctfl-variant-index="0"'));
check("control entry id is the baseline", controlHtml.includes(`data-ctfl-entry-id="${BASELINE_ID}"`));

// No selections is the outage / no-consent / no-match path. It must be baseline,
// never a blank region.
const baselineHtml = await renderWith(hero, undefined);
check("no selections renders baseline", baselineHtml.includes("[Baseline] Ea Est Voluptate"));
check("baseline still carries tracking", baselineHtml.includes(`data-ctfl-entry-id="${BASELINE_ID}"`));

// A selection naming an experience absent from the graph must not throw.
const unknownHtml = await renderWith(hero, [{ experienceId: "nope", variantIndex: 1 }]);
check("unknown experience -> baseline", unknownHtml.includes("[Baseline] Ea Est Voluptate"));

// An empty variant is the author choosing to show nothing to this audience. The
// resolved entry still holds the baseline for tracking context, so rendering it
// would show baseline content to exactly the audience meant to see none.
const emptyHero = optimizedHero([{ id: "", hidden: true }], []);
const emptyHtml = await renderWith(emptyHero, [{ experienceId: EXPERIENCE_ID, variantIndex: 1 }]);
check("empty variant renders nothing", !emptyHtml.includes("[Baseline] Ea Est Voluptate"));
check("empty variant emits no section", !emptyHtml.includes("<section"));

console.log("\n--- tracking attributes ---");
// The SDK's click detector selects on the literal [data-ctfl-clickable="true"] and
// its sticky check compares the string "true", so booleans must not render as
// bare valueless attributes.
const boolAttrs = /data-ctfl-[a-z-]*=""/.test(variantHtml);
check("no valueless data-ctfl attributes", !boolAttrs);
check("every mapped type is trackable", (() => {
  const sections = published.match(/<section[^>]*>/g) ?? [];
  return sections.length > 0 && sections.every((tag) => tag.includes("data-ctfl-entry-id"));
})());

console.log("\n--- escaping ---");
const xss = await render(
  BlockList({
    blocks: resolveBlocks(
      [{
        sys: { id: "x", type: "Entry", contentType: { sys: { id: "duplex" } } },
        metadata: META,
        fields: { heading: "<img src=x onerror=alert(1)>", copy: '"><script>bad()</script>' },
      }],
      undefined,
    ),
  }),
);
check("heading escaped", !xss.includes("<img src=x") && xss.includes("&lt;img"));
check("copy escaped", !xss.includes("<script>bad()"));

console.log("\n--- JSON breakout ---");
const evil = await render(Layout({ draft: true, livePreviewData: { s: "</script><script>bad()</script>" }, children: null }));
check("no </script> breakout", !evil.includes("</script><script>bad()"));
check("escaped as \\u003c", evil.includes("\\u003c/script"));

// ---------------------------------------------------------------------------
// Preview bridge (browser logic, stubbed DOM)
//
// Regression cover for the bug where forcing an audience in the preview panel
// did nothing on a freshly-loaded draft page. `ContentfulLivePreview.subscribe`
// does NOT invoke its callback on subscribe — only on an actual ENTRY_UPDATED
// message from the editor — so the entry graph was absent until the first edit,
// and the bridge silently dropped every render before then.
//
// Runs last: it installs global DOM stubs.
// ---------------------------------------------------------------------------
console.log("\n--- preview bridge ---");

const GRAPH = [{ sys: { id: "page1" }, fields: { slug: "home" } }];

const posts: { pages?: unknown; selectedOptimizations?: unknown }[] = [];
let streamCount = 0;

(globalThis as Record<string, unknown>).document = {
  querySelector: (selector: string) =>
    selector.includes("live-preview-data")
      ? { textContent: JSON.stringify(GRAPH) }
      : null,
};
(globalThis as Record<string, unknown>).window = {
  Turbo: { renderStreamMessage: () => { streamCount += 1; } },
};
(globalThis as Record<string, unknown>).fetch = async (_url: string, init: { body: string }) => {
  posts.push(JSON.parse(init.body));
  return { ok: true, status: 200, statusText: "OK", text: async () => "<turbo-stream></turbo-stream>" };
};

const bridge = await import("../src/client/preview-render");
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// The exact failing scenario: the panel forces an audience and NOTHING has
// supplied an entry graph, because no field has been edited yet.
bridge.seedFingerprint("baseline-fingerprint");
if (bridge.shouldRender("beach-fingerprint")) {
  bridge.setSelections([{ experienceId: "EXP_BEACH", variantIndex: 1 }]);
}
await settle();

check("panel-only change still POSTs", posts.length === 1);
check("POST carries the forced selections", JSON.stringify(posts[0]?.selectedOptimizations ?? "").includes("EXP_BEACH"));
check("POST carries the embedded entry graph", JSON.stringify(posts[0]?.pages ?? "").includes("page1"));
check("morphs the response into the DOM", streamCount === 1);

// An unchanged fingerprint must not render — this is what stops the
// subscribe-replay feedback loop.
const before = posts.length;
if (bridge.shouldRender("beach-fingerprint")) bridge.setSelections([{ experienceId: "EXP_BEACH", variantIndex: 1 }]);
await settle();
check("identical fingerprint does not re-render", posts.length === before);

// A live edit after a forced audience must keep the audience.
bridge.setPages([{ sys: { id: "page1" }, fields: { slug: "home", edited: true } }]);
await settle();
check("edit re-renders", posts.length === before + 1);
check("edit preserves the forced audience", JSON.stringify(posts[before]?.selectedOptimizations ?? "").includes("EXP_BEACH"));
check("edit uses the patched graph", JSON.stringify(posts[before]?.pages ?? "").includes("edited"));

// Cross-bundle state sharing.
//
// preview-render is imported by BOTH src/client/live-preview.ts and
// src/client/optimization-preview.ts, and esbuild bundles each entrypoint
// independently — so each bundle carries its own copy of this module. Its state
// must therefore live somewhere both copies can reach, exactly as app.js shares
// Turbo and Stimulus on `window`. Otherwise the "single writer" is two writers
// with separate inputs, and a field edit silently drops the forced audience.
//
// Two `import()` calls with distinct query strings give two module instances,
// which is what a second bundle amounts to at runtime.
// Variable specifiers: a literal with a query string is unresolvable to tsc.
const specifierA = "../src/client/preview-render?instance=a";
const specifierB = "../src/client/preview-render?instance=b";
const bridgeA = (await import(specifierA)) as typeof bridge;
const bridgeB = (await import(specifierB)) as typeof bridge;

posts.length = 0;
bridgeA.seedFingerprint("shared-seed");
// Instance A learns the patched graph (as the live-preview bundle would)...
bridgeA.setPages([{ sys: { id: "pageX" }, fields: { slug: "home", edited: true } }]);
await settle();
posts.length = 0;
// ...and instance B forces an audience (as the panel bundle would).
if (bridgeB.shouldRender("forest-fingerprint")) {
  bridgeB.setSelections([{ experienceId: "EXP_FOREST", variantIndex: 1 }]);
}
await settle();

check("a second instance still renders", posts.length === 1);
check(
  "audience from one instance reaches the other's graph",
  JSON.stringify(posts[0]?.pages ?? "").includes("edited") &&
    JSON.stringify(posts[0]?.selectedOptimizations ?? "").includes("EXP_FOREST"),
);
// And the fingerprint guard must be shared too, or each bundle re-renders
// changes the other already applied.
const sharedBefore = posts.length;
if (bridgeA.shouldRender("forest-fingerprint")) bridgeA.setSelections([{ experienceId: "EXP_FOREST", variantIndex: 1 }]);
await settle();
check("fingerprint guard is shared across instances", posts.length === sharedBefore);
