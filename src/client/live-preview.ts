// Loaded ONLY on draft renders. This is the file that replaces
// useContentfulLiveUpdates and ContentfulLivePreviewProvider.

import { Controller } from "@hotwired/stimulus";
import { ContentfulLivePreview } from "@contentful/live-preview";

declare global {
  interface Window {
    // Set by @hotwired/turbo in the app bundle.
    Turbo: { renderStreamMessage: (html: string) => void };
  }
}

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
    });

    // Called once immediately with the restored data, then once per edit.
    this.unsubscribe = ContentfulLivePreview.subscribe({
      data: data as never,
      locale: this.localeValue,
      callback: (updated: unknown) => {
        void this.rerender(updated);
      },
    });
  }

  disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /**
   * Hand the patched graph back to the server and let it re-render.
   *
   * The alternative — patching the DOM here — would mean reimplementing the
   * templates in the browser, which is exactly what Hotwire exists to avoid, and
   * would break as soon as an edit changes structure rather than just text.
   */
  private async rerender(updated: unknown): Promise<void> {
    try {
      const response = await fetch("/preview/render", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/vnd.turbo-stream.html",
        },
        body: JSON.stringify(updated),
      });

      if (!response.ok) {
        console.error(
          `[live-preview] render failed: ${response.status} ${response.statusText}`,
        );
        return;
      }

      window.Turbo.renderStreamMessage(await response.text());
    } catch (error) {
      console.error("[live-preview] render request failed", error);
    }
  }
}

// app.js runs first (both are deferred module scripts in document order) and puts the
// Stimulus application on window. Fail loudly rather than silently if that ever changes.
if (!window.Stimulus) {
  throw new Error("[live-preview] assets/app.js must load before assets/live-preview.js");
}

window.Stimulus.register("live-preview", LivePreviewController);
