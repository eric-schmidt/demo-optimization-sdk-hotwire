import type { ConsentDecision } from "../lib/consent";

/**
 * Demo affordances for the two Experience API events that need a human.
 *
 * `page` is emitted server-side on every render and needs no UI. `track` and
 * `identify` are interaction-driven, so they live in the browser and need
 * something to click. On by default; set
 * CONTENTFUL_OPTIMIZATION_DEMO_CONTROLS=false for a clean render.
 *
 * The consent state is rendered SERVER-SIDE from the decision this request used,
 * so there is no flash of the wrong state and it is still correct with JS off.
 *
 * Note the rendered `data-action` reads `click-&gt;optimization#...` in the HTML
 * source: hono/jsx escapes `>` in attribute values. That is correct and works —
 * the HTML parser decodes the character reference before Stimulus calls
 * getAttribute — so do not try to "fix" it with raw(). smoke.tsx asserts the
 * escaped form, which is the form that actually ships.
 *
 * `fixed` positioning is load-bearing: this renders inside <main>, which is a
 * flex column, and Stimulus only resolves data-action against ANCESTOR
 * controllers — the optimization controller is on <main>. Taking the element out
 * of flow lets it sit there without becoming a flex item and shifting the page.
 */
export const DemoControls = ({ consent }: { consent: ConsentDecision }) => (
  <div class="fixed bottom-4 left-4 z-50 flex max-w-72 flex-col gap-2 rounded-lg bg-black/85 p-3 text-xs text-white shadow-lg">
    <div class="font-bold uppercase tracking-wide opacity-70">
      Experience API demo
    </div>

    {/*
      Without this, a fresh visit renders baseline for a completely invisible
      reason — consent is fail-closed, so "no CMP cookie" means no page event and
      therefore no variant. Say so, rather than letting it look broken.
    */}
    {!consent.events && (
      <div class="rounded bg-amber-300 p-2 text-black">
        <strong>Personalization is off.</strong>{" "}
        {consent.recorded
          ? "Consent was declined, so no page event is sent and every block renders its baseline."
          : "No consent decision has been recorded yet, so nothing is sent and every block renders its baseline."}{" "}
        Grant consent below to see <code>?habitat=</code> take effect.
      </div>
    )}

    <button
      type="button"
      class="rounded bg-white px-3 py-1.5 text-left font-medium text-black"
      data-action="click->optimization#sendDemoEvent"
    >
      Send <code>track</code> event
    </button>

    <button
      type="button"
      class="rounded bg-white px-3 py-1.5 text-left font-medium text-black"
      data-action="click->optimization#identifyDemoUser"
    >
      Send <code>identify</code> + traits
    </button>

    <output
      class="max-w-64 whitespace-pre-line opacity-80"
      data-optimization-target="status"
    >
      Ready.
    </output>

    {/*
      Stands in for the third-party CMP. In a real integration nothing here
      exists: the consent platform owns the cookie and this app only reads it
      (src/lib/consent.ts). This just flips that cookie so the effect is
      demonstrable without installing a CMP.
    */}
    <div class="mt-1 border-t border-white/20 pt-2">
      <div class="mb-1 font-bold uppercase tracking-wide opacity-70">
        Consent (simulated CMP)
      </div>
      <div class="flex gap-1">
        <button
          type="button"
          class={`flex-1 rounded px-2 py-1 font-medium ${
            consent.events ? "bg-white text-black" : "bg-amber-300 text-black ring-2 ring-amber-100"
          }`}
          data-action="click->optimization#grantConsent"
        >
          Grant
        </button>
        <button
          type="button"
          class="flex-1 rounded bg-white px-2 py-1 font-medium text-black"
          data-action="click->optimization#denyConsent"
        >
          Deny
        </button>
        <button
          type="button"
          class="flex-1 rounded border border-white/40 px-2 py-1 font-medium"
          data-action="click->optimization#clearConsent"
        >
          Unset
        </button>
      </div>
      <output class="mt-1 block opacity-80" data-optimization-target="consentStatus">
        {consent.recorded
          ? `consent: events=${consent.events} persistence=${consent.persistence}`
          : "consent: not asked (fail-closed)"}
      </output>
    </div>
  </div>
);

export default DemoControls;
