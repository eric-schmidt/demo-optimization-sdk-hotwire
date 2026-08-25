// Loaded on every page. Turbo Drive turns full navigations into HTML fragment
// swaps; Stimulus provides the controller layer for the little JS that remains.
//
// Deliberately does NOT import @contentful/live-preview: that ships in a separate
// bundle which only draft renders load.

import "@hotwired/turbo";
import { Application } from "@hotwired/stimulus";

declare global {
  interface Window {
    Stimulus: Application;
  }
}

const application = Application.start();

// Exposed so the live-preview bundle can register its controller without
// bundling a second copy of Stimulus.
window.Stimulus = application;

export { application };
