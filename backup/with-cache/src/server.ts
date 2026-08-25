import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { draftRoutes } from "./routes/draft";
import { pageRoutes } from "./routes/page";
import { previewRoutes } from "./routes/preview";
import { revalidateRoutes } from "./routes/revalidate";
import { Layout } from "./views/Layout";
import { NotFound } from "./views/NotFound";

const app = new Hono();

// Built assets. Scoped to /assets so the catch-all page route keeps /:slug.
app.use("/assets/*", serveStatic({ root: "./public" }));
app.get("/favicon.ico", serveStatic({ path: "./public/favicon.ico" }));

// API routes are registered before the /:slug catch-all.
app.route("/", draftRoutes);
app.route("/", revalidateRoutes);
app.route("/", previewRoutes);
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

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] listening on http://localhost:${info.port}`);
});
