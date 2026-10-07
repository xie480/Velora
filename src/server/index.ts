import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { localApiPort } from "./services/config.js";
import { getDiagnosticReport } from "./services/diagnostics.js";
import { preloadLocalEmbeddingModel } from "./services/localEmbedding.js";

const host = "127.0.0.1";
const port = localApiPort;
const app = new Hono();

try {
  await import("./db/index.js");
} catch {
  console.error("SQLite/Drizzle initialization failed; local diagnostics remain available.");
}

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
  // OAuth returns through a cross-site top-level navigation; its handler verifies one-time state and PKCE.
  const isChatGPTOAuthCallback =
    context.req.method === "GET" && context.req.path === "/api/providers/chatgpt/callback";
  if (
    !requestHost ||
    !allowedHosts.has(requestHost) ||
    (!isChatGPTOAuthCallback && origin && !allowedOrigins.has(origin)) ||
    (!isChatGPTOAuthCallback && fetchSite === "cross-site")
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

try {
  const { workflowRoutes, recoverInterruptedWorkflow } = await import("./routes/workflow.js");
  recoverInterruptedWorkflow();
  app.route("/api/workflow", workflowRoutes);
} catch {
  const unavailableWorkflowRoutes = new Hono();
  unavailableWorkflowRoutes.all("*", (context) =>
    context.json({ error: "SQLite 或本地 Blueprint 未能初始化，前置创作暂不可用。" }, 503),
  );
  app.route("/api/workflow", unavailableWorkflowRoutes);
}

app.all("/api/*", (context) => context.json({ error: "API route not found." }, 404));

const clientDirectory = resolve(process.cwd(), "dist/client");
const clientIndex = resolve(clientDirectory, "index.html");
if (existsSync(clientIndex)) {
  app.use("/*", serveStatic({ root: clientDirectory }));
  app.get("*", (context) => context.html(readFileSync(clientIndex, "utf8")));
}

const server = serve({ fetch: app.fetch, hostname: host, port }, (address) => {
  console.info(`Project Chronicle local API listening at http://${host}:${address.port}`);
  preloadLocalEmbeddingModel();
});
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Project Chronicle local API cannot bind ${host}:${port}; set API_PORT in .env to an available port.`);
  } else {
    console.error(`Project Chronicle local API failed to listen: ${error.code ?? error.name}.`);
  }
  process.exitCode = 1;
});

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
