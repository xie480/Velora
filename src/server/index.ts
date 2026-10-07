import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { getDiagnosticReport } from "./services/diagnostics.js";
import { preloadLocalEmbeddingModel } from "./services/localEmbedding.js";

const host = "127.0.0.1";
const port = 4310;
const app = new Hono();

try {
  await import("./db/index.js");
} catch {
  console.error("SQLite/Drizzle initialization failed; local diagnostics remain available.");
}

preloadLocalEmbeddingModel();

const allowedHosts = new Set([`${host}:${port}`, `localhost:${port}`]);
const allowedOrigins = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  `http://${host}:${port}`,
  `http://localhost:${port}`,
]);

app.use("/api/*", async (context, next) => {
  const requestHost = context.req.header("host")?.toLowerCase();
  const origin = context.req.header("origin");
  const fetchSite = context.req.header("sec-fetch-site");
  if (
    !requestHost ||
    !allowedHosts.has(requestHost) ||
    (origin && !allowedOrigins.has(origin)) ||
    fetchSite === "cross-site"
  ) {
    return context.json({ error: "Local API request rejected." }, 403);
  }
  await next();
});

app.get("/api/health", (context) =>
  context.json({ status: "ok", service: "project-chronicle-local" }),
);

app.get("/api/system/diagnostics", async (context) =>
  context.json(await getDiagnosticReport()),
);

try {
  const { providerRoutes } = await import("./routes/providers.js");
  app.route("/api/providers", providerRoutes);
} catch {
  const unavailableProviderRoutes = new Hono();
  unavailableProviderRoutes.all("*", (context) =>
    context.json({ error: "SQLite 未能初始化，本机 API 配置暂不可用。" }, 503),
  );
  app.route("/api/providers", unavailableProviderRoutes);
}

app.all("/api/*", (context) => context.json({ error: "API route not found." }, 404));

const clientDirectory = resolve(process.cwd(), "dist/client");
const clientIndex = resolve(clientDirectory, "index.html");
if (existsSync(clientIndex)) {
  app.use("/*", serveStatic({ root: clientDirectory }));
  app.get("*", (context) => context.html(readFileSync(clientIndex, "utf8")));
}

const server = serve({ fetch: app.fetch, hostname: host, port });
console.info(`Project Chronicle local API listening at http://${host}:${port}`);

function shutdown(): void {
  server.close(() => {
    void import("./db/index.js")
      .then(({ closeDatabase }) => closeDatabase())
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
