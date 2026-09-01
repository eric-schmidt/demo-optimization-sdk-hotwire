import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { methodOverride } from "hono/method-override";
import { pageRoutes } from "./routes/page";
import { previewRoutes } from "./routes/preview";
import { isPreviewRequest } from "./lib/preview";
import { forRequestFromContext, personalizationEnabled } from "./lib/optimization";
import { readProfileId } from "./lib/profile-cookie";
import { readConsent } from "./lib/consent";
import { optimizationRoutes } from "./routes/optimization";
import { Layout } from "./views/Layout";
import { NotFound } from "./views/NotFound";
import type { AppEnv } from "./lib/types";

const app = new Hono<AppEnv>();

// Built assets, served from /assets the way Propshaft does in a Rails app.
app.use("/assets/*", serveStatic({ root: "./public" }));
app.get("/favicon.ico", serveStatic({ path: "./public/favicon.ico" }));

// Lets a <form method="post"> carrying _method=delete reach a DELETE route —
// the same job Rack::MethodOverride does in Rails. Turbo submits real forms, and
// browsers only speak GET and POST, so this is what makes RESTful verbs usable
// from HTML without falling back to a stateful GET link.
app.use("/preview", methodOverride({ app }));

// Resolve the Delivery/Preview API swap once per request, like a Rails
// before_action, so every route reads the same answer rather than each one
// re-deriving it from the cookie.
//
// The request-bound Optimization client is resolved in the same pass, because it
// is the same kind of thing: one per-request value every route should agree on.
// Draft renders deliberately get `undefined` — editors see baseline content, and
// editor traffic never reaches the Experience API. See ADR 0004.
app.use("*", async (c, next) => {
  const preview = isPreviewRequest(c);
  c.set("preview", preview);
  const consent = readConsent(c);
  c.set("consent", consent);
  c.set(
    "optimization",
    preview ? undefined : forRequestFromContext(c, readProfileId(c), consent),
  );
  await next();
});

// Registered before the /:slug catch-all so /preview is not swallowed by it.
app.route("/", previewRoutes);
app.route("/", optimizationRoutes);
app.route("/", pageRoutes);

app.notFound((c) => c.html(Layout({ children: NotFound() }) as never, 404));

app.onError((error, c) => {
  console.error(error);
  return c.text("Internal Server Error", 500);
});

const required = [
  "CONTENTFUL_SPACE_ID",
  "CONTENTFUL_ENV_ID",
  "CONTENTFUL_DELIVERY_KEY",
  "CONTENTFUL_PREVIEW_KEY",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.warn(`[server] missing env vars: ${missing.join(", ")}`);
}

// Personalization is optional: with no client id every render serves baseline
// and no browser bundle is emitted, so this warns rather than joining `required`.
if (!personalizationEnabled) {
  console.warn(
    "[server] CONTENTFUL_OPTIMIZATION_CLIENT is not set; personalization is off and all renders will be baseline",
  );
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] listening on http://localhost:${info.port}`);
});
