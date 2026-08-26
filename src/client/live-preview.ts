// Loaded ONLY on draft renders. This is the file that replaces
// useContentfulLiveUpdates and ContentfulLivePreviewProvider.

import { Controller } from "@hotwired/stimulus";
import { ContentfulLivePreview } from "@contentful/live-preview";
import { setPages } from "./preview-render";

/**
 * Reads the entry graph the server serialised into the page.
 *
 * The data must stay exactly as the Content Preview API returned it — the SDK
 * matches updates against its original structure, which is why transforming the
 * response (as gatsby-source-contentful does) breaks live updates.
 */
const readInitialData = (): unknown => {
  const script = document.querySelector<HTMLScriptElement>(
    "script[data-live-preview-data]",
  );
  if (!script?.textContent) return undefined;
  try {
    return JSON.parse(script.textContent);
  } catch (error) {
    console.error("[live-preview] could not parse embedded entry data", error);
    return undefined;
  }
};

export class LivePreviewController extends Controller<HTMLElement> {
  static values = { locale: { type: String, default: "en-US" } };

  declare localeValue: string;

  private unsubscribe?: () => void;

  connect(): void {
    const data = readInitialData();
    if (data === undefined) {
      console.warn("[live-preview] no entry data on the page; not subscribing");
      return;
    }

    ContentfulLivePreview.init({
      locale: this.localeValue,
      enableInspectorMode: true,
      enableLiveUpdates: true,
      experimental: {
        // Inspector outlines are drawn by the Contentful editor in the PARENT
        // frame, over the whole iframe — this SDK creates no DOM and ships no
        // z-index — so nothing in this document can be stacked above them. That
        // matters here because the preview panel is a fixed 24rem drawer that
        // page content sits underneath, and the outline for that content is
        // painted straight across the panel.
        //
        // This is the platform's own lever: the SDK reports, per tagged element,
        // whether it is covered, and the editor suppresses those outlines.
        //
        // PARTIAL BY DESIGN. The check is `elementFromPoint` at all four corners
        // and an element counts as covered only when FEWER THAN TWO corners are
        // its own. A block whose right edge runs under the drawer keeps both left
        // corners, so it is still considered visible and still gets an outline.
        // It reliably helps blocks mostly beneath the drawer, not partially
        // covered ones. See ADR 0004 for the alternatives and why they were
        // rejected.
        hideCoveredElementOutlines: true,
      },
    });

    // Called ONLY when the editor sends an ENTRY_UPDATED message — i.e. once per
    // edit, and NOT on subscribe. (useContentfulLiveUpdates returns initial data
    // synchronously; the imperative subscribe does not.) That is why
    // preview-render reads the embedded entry graph itself rather than waiting
    // for this callback: otherwise nothing works until the first keystroke.
    this.unsubscribe = ContentfulLivePreview.subscribe({
      data: data as never,
      locale: this.localeValue,
      callback: (updated: unknown) => {
        setPages(updated);
      },
    });
  }

  disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}

// app.js runs first (both are deferred module scripts in document order) and puts the
// Stimulus application on window. Fail loudly rather than silently if that ever changes.
if (!window.Stimulus) {
  throw new Error("[live-preview] assets/app.js must load before assets/live-preview.js");
}

window.Stimulus.register("live-preview", LivePreviewController);
