// Draft-only bundle: the Web SDK plus the first-party preview panel.
//
// Why one bundle rather than two scripts: the panel talks to the SDK through a
// preview bridge built on optimization-core's module-level signals. Two bundled
// copies of core would give the panel a different signal registry than the SDK,
// so its audience overrides would never reach states.selectedOptimizations and
// the panel would appear to work while changing nothing. Sharing one bundle is
// what makes the bridge possible.
//
// This import also registers the "optimization" controller, which is harmless
// here: draft renders mount "optimization-panel" instead.

import { Controller } from "@hotwired/stimulus";
import attachOptimizationPreviewPanel from "@contentful/optimization-web-preview-panel";
import { createSelectionFingerprint } from "@contentful/optimization-web/core-sdk";
import { getSdk } from "./optimization";
import { seedFingerprint, setSelections, shouldRender } from "./preview-render";

/**
 * Bridges the browser-side panel to the server-side renderer.
 *
 * The panel is designed for integrations where the BROWSER resolves entries; it
 * forces an audience by mutating the SDK's selection state and letting the UI
 * re-resolve. This app renders on the server, and the Node SDK has no
 * forced-audience option at all, so on its own the panel would change state and
 * nothing on screen. Watching the selection signal and re-rendering through
 * /preview/render is what closes that gap.
 */
export class OptimizationPanelController extends Controller<HTMLElement> {
  static values = {
    clientId: String,
    environment: String,
    locale: { type: String, default: "en-US" },
    fingerprint: { type: String, default: "" },
  };

  declare clientIdValue: string;
  declare environmentValue: string;
  declare localeValue: string;
  declare fingerprintValue: string;

  private subscription?: { unsubscribe: () => void };

  async connect(): Promise<void> {
    const sdk = getSdk({
      clientId: this.clientIdValue,
      environment: this.environmentValue,
      locale: this.localeValue,
      // Draft pages report nothing. No page event is emitted server-side either,
      // so an authoring session leaves no trace in Live Events or in the
      // editor's own visitor profile.
      tracking: false,
      // Draft renders emit nothing regardless, so there is no consent decision to
      // honour here — the panel only reads and writes local selection state.
      consent: undefined,
    });

    // What the server already rendered. Without this the observable's replayed
    // first emission would look like a change and start a render loop.
    seedFingerprint(this.fingerprintValue || createSelectionFingerprint(undefined));

    this.subscription = sdk.states.selectedOptimizations.subscribe((selections) => {
      if (!shouldRender(createSelectionFingerprint(selections))) return;
      setSelections(selections);
    });

    // `entries` rather than a `contentful` client, deliberately: this app ships
    // zero Contentful credentials to the browser today, and handing the panel a
    // client would end that. The panel's own docs bless this path for SSR.
    try {
      const response = await fetch("/preview/optimization-entries");
      if (!response.ok) {
        console.error(
          `[optimization-panel] could not load panel entries: ${response.status}`,
        );
        return;
      }

      // Attachment is idempotent, so a Turbo navigation reconnecting this
      // controller does not stack panels.
      await attachOptimizationPreviewPanel({
        entries: (await response.json()) as never,
      });
    } catch (error) {
      console.error("[optimization-panel] panel attach failed", error);
    }
  }

  /** Unlike the tracking controller, this owns a real subscription. */
  disconnect(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
  }
}

if (!window.Stimulus) {
  throw new Error(
    "[optimization-panel] assets/app.js must load before assets/optimization-preview.js",
  );
}

window.Stimulus.register("optimization-panel", OptimizationPanelController);
