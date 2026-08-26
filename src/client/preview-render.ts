// The single writer to #page-blocks.
//
// Two independent things want to re-render the blocks during authoring:
//
//   1. the Live Preview SDK, when an editor changes a field;
//   2. the preview panel, when someone forces an audience.
//
// Racing them produces flicker and lost state. So neither of them renders. Both
// push into this module, which holds the FULL input pair — (entry graph,
// selections) — and posts both on every render. A field edit therefore re-renders
// under the currently forced audience, and forcing an audience re-renders with the
// latest patched fields. Neither input can clobber the other, and there is no
// precedence question to get wrong.

type RenderState = {
  inputs: { pages?: unknown; selectedOptimizations?: unknown };
  scheduled: boolean;
  /**
   * Monotonic request id. A slow response whose sequence is no longer current is
   * dropped rather than applied, so an earlier render cannot overwrite a later one.
   */
  sequence: number;
  /**
   * The selection fingerprint already reflected in the DOM.
   *
   * Seeded from a server-stamped value because the Web SDK's observable replays
   * its current value to every new subscriber. That first replayed emission
   * equals what the server already rendered, and without this guard it would
   * trigger a POST, whose morph would reconnect the controller, which would
   * subscribe again — an endless loop.
   */
  renderedFingerprint?: string;
};

/**
 * State lives on `window`, not in module scope — and that is load-bearing.
 *
 * This module is imported by BOTH src/client/live-preview.ts and
 * src/client/optimization-preview.ts, and esbuild bundles each entrypoint
 * independently, so each bundle ships its own copy of this file. Module-level
 * state would therefore give the two copies separate `inputs`, and the
 * "single writer" would silently become two writers: a field edit would post
 * `selectedOptimizations: undefined` and drop the forced audience, while a panel
 * override would post a stale graph and drop the edit.
 *
 * Sharing through `window` is the same trick app.js already uses to hand Turbo
 * and Stimulus to the other bundles rather than shipping second copies.
 */
const state = ((): RenderState => {
  const host = window as typeof window & { __ctflPreviewRender?: RenderState };
  return (host.__ctflPreviewRender ??= {
    inputs: {},
    scheduled: false,
    sequence: 0,
  });
})();

export const seedFingerprint = (fingerprint: string | undefined): void => {
  state.renderedFingerprint = fingerprint;
};

/** True (and records the new value) only when the selections actually changed. */
export const shouldRender = (fingerprint: string): boolean => {
  if (fingerprint === state.renderedFingerprint) return false;
  state.renderedFingerprint = fingerprint;
  return true;
};

export const setPages = (pages: unknown): void => {
  state.inputs = { ...state.inputs, pages };
  schedule();
};

export const setSelections = (selectedOptimizations: unknown): void => {
  state.inputs = { ...state.inputs, selectedOptimizations };
  schedule();
};

/**
 * Coalesce within a microtask so two inputs changing together produce one POST
 * rather than two renders and a visible flicker.
 */
const schedule = (): void => {
  if (state.scheduled) return;
  state.scheduled = true;
  queueMicrotask(() => {
    void flush();
  });
};

/**
 * The entry graph the server serialised into the page.
 *
 * The bridge reads this itself rather than waiting for the Live Preview
 * controller to hand it over, and that is load-bearing:
 * `ContentfulLivePreview.subscribe()` does **not** invoke its callback on
 * subscribe — only when the editor sends an ENTRY_UPDATED message. So on a
 * freshly-loaded draft page no entry graph exists yet, and a panel-forced
 * audience had nothing to render against. Reading the embedded script removes
 * the ordering dependency between the two controllers entirely.
 */
const readEmbeddedPages = (): unknown => {
  const script = document.querySelector<HTMLScriptElement>(
    "script[data-live-preview-data]",
  );
  if (!script?.textContent) return undefined;
  try {
    return JSON.parse(script.textContent);
  } catch (error) {
    console.error("[preview-render] could not parse the embedded entry graph", error);
    return undefined;
  }
};

const flush = async (): Promise<void> => {
  state.scheduled = false;

  // Fall back to the server-rendered graph when no edit has arrived yet.
  const pages = state.inputs.pages ?? readEmbeddedPages();
  if (pages === undefined) {
    console.warn("[preview-render] no entry graph available; nothing to render");
    return;
  }
  state.inputs = { ...state.inputs, pages };

  const mine = ++state.sequence;

  try {
    const response = await fetch("/preview/render", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/vnd.turbo-stream.html",
      },
      body: JSON.stringify(state.inputs),
    });

    // A newer render superseded this one while it was in flight.
    if (mine !== state.sequence) return;

    if (!response.ok) {
      console.error(
        `[preview-render] render failed: ${response.status} ${response.statusText}`,
      );
      return;
    }

    window.Turbo?.renderStreamMessage(await response.text());
  } catch (error) {
    console.error("[preview-render] render request failed", error);
  }
};
