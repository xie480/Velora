/** Integration checks use isolated SQLite and loopback model fixtures, never the user's presets. */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer, type Server } from "node:http";
import { mock } from "node:test";
import Database from "better-sqlite3";
import { databaseMigrations } from "../src/server/db/migrations.js";
import { emptyContent, storyInputSchema } from "../src/shared/workflow.js";
import type { Blueprint, WorkflowResponse } from "../src/shared/workflow.js";

let temporaryDirectory: string;
let runtime: typeof import("../src/server/db/index.js");
let workflow: typeof import("../src/server/routes/workflow.js");
let store: typeof import("../src/server/services/workflowStore.js");
let providers: typeof import("../src/server/routes/providers.js");
let ai: typeof import("../src/server/services/workflowAI.js");
let vault: typeof import("../src/server/services/secretVault.js");

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "velora-workflow-api-"));
  process.env.DATABASE_FILE = join(temporaryDirectory, "workflow-test.sqlite");
  runtime = await import("../src/server/db/index.js");
  workflow = await import("../src/server/routes/workflow.js");
  store = await import("../src/server/services/workflowStore.js");
  providers = await import("../src/server/routes/providers.js");
  ai = await import("../src/server/services/workflowAI.js");
  vault = await import("../src/server/services/secretVault.js");
});

after(async () => {
  runtime?.closeDatabase();
  mock.restoreAll();
  // Delete only this test's verified mkdtemp child; never remove a computed database parent.
  if (temporaryDirectory && dirname(resolve(temporaryDirectory)) === resolve(tmpdir()) && basename(temporaryDirectory).startsWith("velora-workflow-api-")) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

function requestJson(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function completeStoryBible(): Record<string, unknown> {
  return {
    ...emptyContent("storyBible"),
    premise: "在港口查明失踪事件",
    worldBackground: "封闭港口中的家族争端",
    worldRules: ["公开消息存在延迟"],
    setting: "现代城市与受限通讯",
    startingState: "主角刚返回港口",
    mainConflict: "证词彼此矛盾",
    coreSecret: "失踪与旧案有关",
    locations: ["港口"],
    themes: ["信任"],
    immutableFacts: ["主角刚返回港口"],
  };
}

async function waitUntilFinished(routes: ReturnType<typeof workflow.createWorkflowRoutes>): Promise<WorkflowResponse> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await (await routes.request("/")).json() as WorkflowResponse;
    if (!state.blueprint.workflowState.activeGeneration) return state;
    await delay(10);
  }
  throw new Error("Test generation did not reach a terminal state");
}

test("Workflow migration preserves existing data and guards immutable snapshots", () => {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  try {
    for (const migration of databaseMigrations.slice(0, 2)) database.exec(migration.sql);
    database.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)").run("existing", "preserved");
    for (const migration of databaseMigrations.slice(2)) database.exec(migration.sql);
    assert.equal((database.prepare("SELECT value FROM app_meta WHERE key = ?").get("existing") as { value: string }).value, "preserved");
    // Re-applying additive SQL also remains harmless; the startup runner additionally tracks migration IDs.
    for (const migration of databaseMigrations.slice(2)) database.exec(migration.sql);
    database.prepare(`INSERT INTO workflow_working (id, revision, blueprint_json, updated_at) VALUES (?, ?, ?, ?)`).run("working", 0, "{}", 1);
    assert.throws(() => database.prepare("INSERT INTO workflow_working (id, revision, blueprint_json, updated_at) VALUES (?, ?, ?, ?)").run("another", 0, "{}", 1));
    assert.throws(() => database.prepare("UPDATE workflow_working SET blueprint_json = ? WHERE id = ?").run("invalid json", "working"));
    const insert = database.prepare(`INSERT INTO workflow_versions (version, parent_version, created_at, description, user_note, workflow_state_json, blueprint_json) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    insert.run(1, null, 1, "first", "", "{}", "{}");
    insert.run(2, 1, 2, "second", "", "{}", "{}");
    assert.throws(() => insert.run(3, 99, 3, "invalid parent", "", "{}", "{}"));
    assert.throws(() => database.prepare("UPDATE workflow_versions SET user_note = ? WHERE version = ?").run("changed", 1), /immutable/);
    assert.throws(() => database.prepare("DELETE FROM workflow_versions WHERE version = ?").run(1), /immutable/);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM workflow_versions").get() as { count: number }).count, 2);
  } finally {
    database.close();
  }
});

test("Workflow API persists approvals, enforces CAS, and discards cancelled late AI output", async () => {
  let resolveOutput: (value: unknown) => void = () => { throw new Error("No model task is waiting"); };
  let capturedPrompt = "";
  let capturedSignal: AbortSignal | undefined;
  const routes = workflow.createWorkflowRoutes(async (prompt, signal) => {
    capturedPrompt = prompt;
    capturedSignal = signal;
    return await new Promise<unknown>((resolveResult) => { resolveOutput = resolveResult; });
  });
  let state = await (await routes.request("/")).json() as WorkflowResponse;
  assert.equal(state.revision, 0);
  assert.equal(state.blueprint.workflowState.currentStage, "story");
  assert.equal((await routes.request("/commands", requestJson({ revision: state.revision, command: { type: "confirmStage", stageId: "story" } }))).status, 409);
  assert.equal((await routes.request("/commands", requestJson({ revision: state.revision, command: { type: "unknown" } }))).status, 400);
  const input = storyInputSchema.parse({
    name: "港口谜案", genre: "悬疑", outline: "调查失踪与旧案之间的关系", locations: ["港口"],
    themes: ["信任"], coreConflict: "关键证词彼此矛盾", tone: "克制悬疑", volumeChapterCounts: [1],
  });
  const updated = await routes.request("/commands", requestJson({ revision: state.revision, command: { type: "updateStoryInput", input } }));
  assert.equal(updated.status, 200);
  state = await updated.json() as WorkflowResponse;
  assert.equal(state.blueprint.metadata.title, "港口谜案");
  const stale = await routes.request("/commands", requestJson({ revision: state.revision - 1, command: { type: "select", stageId: "story", objectId: "story-bible" } }));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json() as { errorCode: string }).errorCode, "REVISION_CONFLICT");

  const started = await routes.request("/generate", requestJson({ revision: state.revision, targetId: "story-bible", instructions: "保留港口设定", mode: "generate" }));
  assert.equal(started.status, 202);
  state = await started.json() as WorkflowResponse;
  assert.equal(state.blueprint.storyBible.status, "GENERATING");
  const stored = runtime.sqlite.prepare("SELECT blueprint_json AS json FROM workflow_working WHERE id = ?").get("working") as { json: string };
  assert.equal((JSON.parse(stored.json) as Blueprint).storyBible.status, "GENERATING");
  assert.match(capturedPrompt, /港口谜案/);
  assert.match(capturedPrompt, /worldRules/);
  assert.match(capturedPrompt, /additionalProperties/);
  assert.match(capturedPrompt, /story-bible/);
  assert.equal((await routes.request("/generate", requestJson({ revision: state.revision, targetId: "story-bible" }))).status, 409);

  // Browsing changes only selection/revision, so an otherwise current model result can still complete.
  state = await (await routes.request("/commands", requestJson({ revision: state.revision, command: { type: "select", stageId: "story", objectId: "story-bible" } }))).json() as WorkflowResponse;
  resolveOutput({ content: completeStoryBible() });
  state = await waitUntilFinished(routes);
  assert.equal(state.blueprint.storyBible.status, "PENDING_REVIEW");
  assert.equal(state.blueprint.storyBible.content.premise, "在港口查明失踪事件");
  state = await (await routes.request("/commands", requestJson({ revision: state.revision, command: { type: "approveEntity", entityId: "story-bible" } }))).json() as WorkflowResponse;
  assert.equal(state.blueprint.storyBible.status, "APPROVED");

  const regenerated = await routes.request("/generate", requestJson({ revision: state.revision, targetId: "story-bible", mode: "revise", instructions: "将矛盾调整得更清晰" }));
  assert.equal(regenerated.status, 202);
  state = await regenerated.json() as WorkflowResponse;
  state = await (await routes.request("/cancel", requestJson({ revision: state.revision }))).json() as WorkflowResponse;
  assert.equal(capturedSignal?.aborted, true);
  assert.equal(state.blueprint.storyBible.status, "APPROVED");
  const editedContent = { ...completeStoryBible(), premise: "用户手动保留的新前提" };
  state = await (await routes.request("/commands", requestJson({ revision: state.revision, command: { type: "updateEntity", entityId: "story-bible", name: "Story Bible", content: editedContent } }))).json() as WorkflowResponse;
  resolveOutput({ content: { ...completeStoryBible(), premise: "不应写入的迟到结果" } });
  await delay(20);
  const afterLateOutput = await (await routes.request("/")).json() as WorkflowResponse;
  assert.equal(afterLateOutput.revision, state.revision);
  assert.equal(afterLateOutput.blueprint.storyBible.content.premise, "用户手动保留的新前提");

  // Unknown model fields cannot become authoritative data, and failure remains visible after reloading.
  state = afterLateOutput;
  state = await (await routes.request("/generate", requestJson({ revision: state.revision, targetId: "story-bible" }))).json() as WorkflowResponse;
  resolveOutput({ content: completeStoryBible(), injectedApproval: "APPROVED" });
  state = await waitUntilFinished(routes);
  assert.equal(state.blueprint.storyBible.content.premise, "用户手动保留的新前提");
  assert.match(state.blueprint.storyBible.reviewReasons.join(" "), /Schema/);

  // Restart recovery restores the previous status and never invokes the requester again.
  const engine = await import("../src/shared/workflowEngine.js");
  const interrupted = engine.beginGeneration(state.blueprint, "story-bible", "restart-test");
  state = store.saveWorkingBlueprint(state.revision, interrupted);
  workflow.recoverInterruptedWorkflow();
  state = store.getWorkflowResponse();
  assert.equal(state.blueprint.workflowState.activeGeneration, null);
  assert.equal(state.blueprint.storyBible.status, "PENDING_REVIEW");
  assert.match(state.blueprint.storyBible.reviewReasons.join(" "), /重启/);
});

test("Workflow import requires validated confirmation and history preserves immutable parent chains", async () => {
  const routes = workflow.createWorkflowRoutes();
  let state = await (await routes.request("/")).json() as WorkflowResponse;
  const badPreview = await (await routes.request("/import/preview", requestJson({ kind: "story", data: { ...state.blueprint.storyInput, secretExtraField: "invalid" } }))).json() as { valid: boolean; warnings: string[] };
  assert.equal(badPreview.valid, false);
  assert.match(badPreview.warnings.join(" "), /secretExtraField/);
  const futurePreview = await (await routes.request("/import/preview", requestJson({ kind: "blueprint", data: { ...state.blueprint, schemaVersion: 99 } }))).json() as { valid: boolean };
  assert.equal(futurePreview.valid, false);
  assert.equal((await routes.request("/import", requestJson({ revision: state.revision, kind: "blueprint", data: state.blueprint }))).status, 400);
  assert.equal((await routes.request("/versions", requestJson({ revision: state.revision, description: "提前冻结", userNote: "", finalize: true }))).status, 409);

  state = await (await routes.request("/versions", requestJson({ revision: state.revision, description: "首次快照", userNote: "保存当前创作", finalize: false }))).json() as WorkflowResponse;
  assert.equal(state.versions[0].version, 1);
  assert.equal(state.versions[0].parentVersion, null);
  assert.equal(state.versions[0].finalized, false);
  assert.equal("blueprint" in state.versions[0], false);
  const firstSnapshot = await (await routes.request("/versions/1")).json() as { blueprint: Blueprint };
  const firstJson = JSON.stringify(firstSnapshot.blueprint);
  assert.equal((await routes.request("/versions/999")).status, 404);
  assert.throws(() => runtime.sqlite.prepare("UPDATE workflow_versions SET description = ? WHERE version = ?").run("非法修改", 1), /immutable/);

  const nextInput = { ...state.blueprint.storyInput, name: "第二版名称" };
  state = await (await routes.request("/commands", requestJson({ revision: state.revision, command: { type: "updateStoryInput", input: nextInput } }))).json() as WorkflowResponse;
  state = await (await routes.request("/versions", requestJson({ revision: state.revision, description: "第二次快照", userNote: "", finalize: false }))).json() as WorkflowResponse;
  assert.equal(state.versions[0].version, 2);
  assert.equal(state.versions[0].parentVersion, 1);
  const restoreResponse = await routes.request("/versions/1/restore", requestJson({ revision: state.revision, confirmed: true }));
  assert.equal(restoreResponse.status, 200);
  state = await restoreResponse.json() as WorkflowResponse;
  assert.equal(state.blueprint.metadata.title, firstSnapshot.blueprint.metadata.title);
  assert.equal(state.versions.length, 2);
  state = await (await routes.request("/versions", requestJson({ revision: state.revision, description: "从 v1 派生", userNote: "", finalize: false }))).json() as WorkflowResponse;
  assert.equal(state.versions[0].version, 3);
  assert.equal(state.versions[0].parentVersion, 1);
  assert.equal(JSON.stringify((await (await routes.request("/versions/1")).json() as { blueprint: Blueprint }).blueprint), firstJson);

  const exported = await routes.request("/export");
  assert.match(exported.headers.get("Content-Disposition") ?? "", /game-blueprint\.json/);
  const blueprint = await exported.json() as Blueprint;
  const preview = await (await routes.request("/import/preview", requestJson({ kind: "blueprint", data: blueprint }))).json() as { valid: boolean };
  assert.equal(preview.valid, true);
  state = await (await routes.request("/import", requestJson({ revision: state.revision, kind: "blueprint", data: blueprint, confirmed: true }))).json() as WorkflowResponse;
  assert.equal(state.versions.length, 3);
  const hugeBody = JSON.stringify({ kind: "story", data: "x".repeat(5 * 1024 * 1024 + 65 * 1024) });
  assert.equal((await routes.request("/import/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: hugeBody })).status, 413);
});

test("OpenAI-compatible generation uses the saved preset and validates complete JSON responses", async () => {
  let payload: { model?: string; temperature?: number; messages?: Array<{ content: string }> } = {};
  let finishReason = "stop";
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(request.url, "/v1/chat/completions");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "mock-response", object: "chat.completion", created: 1, model: "mock-medium", choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content: '{"content":{"premise":"model fixture"}}' } }] }));
  });
  await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const created = await providers.providerRoutes.request("/profiles", requestJson({ name: "隔离模型", providerType: "openai_compatible", baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "test-only-key", models: { small: "mock-small", medium: "mock-medium", large: "mock-large" }, temperature: 0.4 }));
    assert.equal(created.status, 201);
    const output = await ai.requestStructuredWorkflowOutput("只输出 JSON 的模型桥接测试");
    assert.deepEqual(output, { content: { premise: "model fixture" } });
    assert.equal(payload.model, "mock-medium");
    assert.equal(payload.temperature, 0.4);
    assert.match(payload.messages?.[0]?.content ?? "", /模型桥接测试/);
    finishReason = "length";
    await assert.rejects(() => ai.requestStructuredWorkflowOutput("只输出 JSON"), /未完整结束/);
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(() => ai.requestStructuredWorkflowOutput("只输出 JSON", aborted.signal), /取消/);
  } finally {
    await new Promise<void>((resolveClosed, reject) => server.close((error) => error ? reject(error) : resolveClosed()));
  }
});

test("ChatGPT plan generation requires a completed SSE event and never trusts partial JSON", async () => {
  const created = await providers.providerRoutes.request("/profiles", requestJson({ name: "隔离ChatGPT", providerType: "chatgpt_plan", baseUrl: "", apiKey: "", models: { small: "mock-small", medium: "mock-chatgpt", large: "mock-large" }, temperature: 0.7 }));
  const profile = (await created.json() as { profile: { id: string } }).profile;
  runtime.sqlite.prepare("UPDATE provider_profiles SET chatgpt_client_id = ?, chatgpt_access_token_ciphertext = ?, chatgpt_scopes = ?, chatgpt_expires_at = ? WHERE id = ?")
    .run("test-client", vault.encryptSecret("test-only-oauth-token"), "chatgpt.tokens.use.direct", Date.now() + 3_600_000, profile.id);
  assert.equal((await providers.providerRoutes.request(`/profiles/${profile.id}/activate`, { method: "POST" })).status, 200);
  let terminal: "completed" | "incomplete" | "none" = "completed";
  let sentBody: { store?: boolean; stream?: boolean; model?: string } = {};
  const mockedFetch = mock.method(globalThis, "fetch", async (request: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(request), "https://api.openai.com/v1/responses");
    sentBody = JSON.parse(String(init?.body));
    const events: unknown[] = [{ type: "response.output_text.delta", delta: '{"content":{"premise":"SSE fixture"}}' }];
    if (terminal === "completed") events.push({ type: "response.completed", response: { status: "completed", output: [] } });
    if (terminal === "incomplete") events.push({ type: "response.incomplete", response: { status: "incomplete", output: [] } });
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
  });
  try {
    assert.deepEqual(await ai.requestStructuredWorkflowOutput("返回 JSON"), { content: { premise: "SSE fixture" } });
    assert.equal(sentBody.store, false);
    assert.equal(sentBody.stream, true);
    assert.equal(sentBody.model, "mock-chatgpt");
    terminal = "incomplete";
    await assert.rejects(() => ai.requestStructuredWorkflowOutput("返回 JSON"), /未完成/);
    terminal = "none";
    await assert.rejects(() => ai.requestStructuredWorkflowOutput("返回 JSON"), /中断/);
  } finally {
    mockedFetch.mock.restore();
  }
});
