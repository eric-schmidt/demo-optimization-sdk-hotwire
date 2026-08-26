// Browser globals shared across the client bundles.
//
// Declared once, here, because three bundles reach for them and duplicate
// `declare global` blocks with differing shapes would conflict. The sharing is
// deliberate: app.js owns Turbo and Stimulus, and the other bundles reuse those
// instances off `window` rather than shipping second copies.

import type { Application } from "@hotwired/stimulus";
import type ContentfulOptimization from "@contentful/optimization-web";

declare global {
  interface Window {
    /** Set by @hotwired/turbo in the app bundle. */
    Turbo?: {
      renderStreamMessage: (html: string) => void;
      visit: (location: string, options?: { action?: "advance" | "replace" | "restore" }) => void;
    };
    /** Set by the app bundle so other bundles register controllers on it. */
    Stimulus: Application;
    /** Registered by the Optimization Web SDK on construction. */
    contentfulOptimization?: ContentfulOptimization;
    /** Read by Lit for CSP nonces; used by the preview panel. */
    litNonce?: string;
  }
}
