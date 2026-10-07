/** Scoped form assistance is tested against an isolated SQLite file and deterministic model boundary. */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { allEntities, emptyContent, entityFields, storyInputSchema } from "../src/shared/workflow.js";
import type { Blueprint, Content, WorkflowEntity, WorkflowResponse } from "../src/shared/workflow.js";
import {
  applyWorkflowCommand, beginGeneration, completeGeneration, createBlueprint,
} from "../src/shared/workflowEngine.js";
import { beginFormFill, getFormFillFields, getFormFillTarget } from "../src/shared/workflowFormAI.js";

let temporaryDirectory: string;
let database: typeof import("../src/server/db/index.js");
let api: typeof import("../src/server/routes/workflow.js");
let store: typeof import("../src/server/services/workflowStore.js");

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "velora-form-api-"));
  process.env.DATABASE_FILE = join(temporaryDirectory, "form-test.sqlite");
  database = await import("../src/server/db/index.js");
  api = await import("../src/server/routes/workflow.js");
  store = await import("../src/server/services/workflowStore.js");
});

after(async () => {
  database?.closeDatabase();
  if (temporaryDirectory && dirname(resolve(temporaryDirectory)) === resolve(tmpdir()) && basename(temporaryDirectory).startsWith("velora-form-api-")) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

function request(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function working(blueprint = createBlueprint()): WorkflowResponse {
  const current = store.getWorkingBlueprint();
  return store.saveWorkingBlueprint(current.revision, blueprint);
}

async function finished(routes: ReturnType<typeof api.createWorkflowRoutes>): Promise<WorkflowResponse> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await (await routes.request("/")).json() as WorkflowResponse;
    if (!state.blueprint.workflowState.activeGeneration) return state;
    await delay(10);
  }
  throw new Error("Form fill did not reach a terminal state");
}

function completeBibleContent(row: WorkflowEntity): Content {
  const content = emptyContent(row.kind);
  for (const field of entityFields[row.kind]) {
    if (field.type === "text") content[field.key] = `已明确 ${field.label}`;
    if (field.type === "textList") content[field.key] = field.required ? ["前置事实"] : [];
  }
  content.locations = ["港口"];
  return content;
}

function characterDrafts(): Blueprint {
  let blueprint = createBlueprint();
  blueprint = applyWorkflowCommand(blueprint, { type: "updateStoryInput", input: storyInputSchema.parse({ name: "港口创作", genre: "悬疑", outline: "从失踪案追查旧案" }) });
  blueprint = applyWorkflowCommand(blueprint, { type: "updateEntity", entityId: "story-bible", name: "Story Bible", content: completeBibleContent(blueprint.storyBible) });
  blueprint = applyWorkflowCommand(blueprint, { type: "approveEntity", entityId: "story-bible" });
  blueprint = applyWorkflowCommand(blueprint, { type: "confirmStage", stageId: "story" });
  const token = "outline-fixture";
  blueprint = completeGeneration(beginGeneration(blueprint, "outline-characters", token), "outline-characters", {
    items: ["Alice", "Bob"].map((name) => ({ name, kind: "character", source: "AI", purpose: "推进调查主线", required: true, enabled: true, relatedIds: [], })),
  }, token);
  return applyWorkflowCommand(blueprint, { type: "approveOutline", outlineId: "outline-characters" });
}

test("Empty StoryInput fill requires selected keys, preserves unselected fields, and persists a virtual task", async () => {
  let resolveOutput: (output: unknown) => void = () => { throw new Error("No pending form request"); };
  let prompt = "";
  const routes = api.createWorkflowRoutes(async (value) => {
    prompt = value;
    return new Promise<unknown>((resolveResult) => { resolveOutput = resolveResult; });
  });
  const initial = createBlueprint();
  initial.storyInput.notes = "必须原样保留的说明";
  let state = working(initial);
  assert.equal((await routes.request("/fill", request({ revision: state.revision, targetId: "story-input", prompt: " ", fields: ["name"] }))).status, 400);
  assert.equal((await routes.request("/fill", request({ revision: state.revision, targetId: "story-input", prompt: "填写", fields: [] }))).status, 400);
  assert.equal((await routes.request("/fill", request({ revision: state.revision, targetId: "story-input", prompt: "填写", fields: ["volumeChapterCounts"] }))).status, 409);
  const started = await routes.request("/fill", request({ revision: state.revision, targetId: "story-input", prompt: "填写海港悬疑故事的名称和类型", fields: ["name", "genre"] }));
  assert.equal(started.status, 202);
  state = await started.json() as WorkflowResponse;
  assert.equal(state.blueprint.workflowState.activeGeneration?.targetId, "story-input");
  assert.equal(state.blueprint.workflowState.selectedObjectId, "story-input");
  assert.equal(state.blueprint.storyBible.status, "DRAFT");
  assert.match(prompt, /必须原样保留的说明/);
  assert.doesNotMatch(prompt, /volumeChapterCounts/);
  const persisted = database.sqlite.prepare("SELECT blueprint_json AS json FROM workflow_working WHERE id = ?").get("working") as { json: string };
  assert.equal((JSON.parse(persisted.json) as Blueprint).workflowState.activeGeneration?.targetId, "story-input");
  resolveOutput({ name: "灯塔谜案", genre: "悬疑" });
  state = await finished(routes);
  assert.equal(state.blueprint.storyInput.name, "灯塔谜案");
  assert.equal(state.blueprint.storyInput.genre, "悬疑");
  assert.equal(state.blueprint.storyInput.outline, "");
  assert.equal(state.blueprint.storyInput.notes, "必须原样保留的说明");
  assert.equal(state.blueprint.storyBible.status, "DRAFT");
  const stale = await routes.request("/fill", request({ revision: state.revision - 1, targetId: "story-input", prompt: "填写", fields: ["name"] }));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json() as { errorCode: string }).errorCode, "REVISION_CONFLICT");
  const schema = getFormFillTarget(state.blueprint, "story-input", ["name", "genre"]).schema;
  assert.equal(schema.safeParse({ name: "missing genre" }).success, false);
  assert.equal(schema.safeParse({ name: "n", genre: "g", notes: "未选择的覆盖" }).success, false);
});

test("Entity name-only and partial fills preserve content/source without requiring previous same-stage approval", async () => {
  const initial = characterDrafts();
  const bob = initial.characters[1];
  let output: unknown = { name: "新的 Bob 名称" };
  let capturedPrompt = "";
  const routes = api.createWorkflowRoutes(async (prompt) => { capturedPrompt = prompt; return output; });
  let state = working(initial);
  const before = structuredClone(bob);
  const started = await routes.request("/fill", request({ revision: state.revision, targetId: bob.id, prompt: "为这个人物起一个中文名字", fields: ["name"] }));
  assert.equal(started.status, 202);
  state = await finished(routes);
  const changed = state.blueprint.characters.find((row) => row.id === bob.id)!;
  assert.equal(changed.name, "新的 Bob 名称");
  assert.deepEqual(changed.content, before.content);
  assert.equal(changed.source, before.source);
  assert.equal(changed.userModified, before.userModified);
  const matchingItem = state.blueprint.workflowState.outlinePlans.find((plan) => plan.id === "outline-characters")!.items.find((item) => item.id === bob.id)!;
  const previousItem = initial.workflowState.outlinePlans.find((plan) => plan.id === "outline-characters")!.items.find((item) => item.id === bob.id)!;
  assert.equal(matchingItem.name, changed.name);
  assert.equal(matchingItem.source, previousItem.source);
  assert.equal(matchingItem.userModified, previousItem.userModified);
  assert.equal(changed.status, "PENDING_REVIEW");
  assert.equal(state.blueprint.characters[0].status, "DRAFT");
  assert.doesNotMatch(capturedPrompt, /volumeChapterCounts/);
  output = { content: { identity: "失踪者的同事" } };
  assert.equal((await routes.request("/fill", request({ revision: state.revision, targetId: bob.id, prompt: "填写身份", fields: ["identity"] }))).status, 202);
  state = await finished(routes);
  assert.equal(state.blueprint.characters.find((row) => row.id === bob.id)!.content.identity, "失踪者的同事");
  assert.equal(state.blueprint.characters.find((row) => row.id === bob.id)!.content.personality, "");
  const nameOnly = getFormFillTarget(state.blueprint, bob.id, ["name"]).schema;
  assert.equal(nameOnly.safeParse({ name: "合适姓名" }).success, true);
  assert.equal(nameOnly.safeParse({ name: "姓名", content: { identity: "多余修改" } }).success, false);
  output = { content: { identity: "不应写入", personality: "未选字段" } };
  await routes.request("/fill", request({ revision: state.revision, targetId: bob.id, prompt: "填写身份", fields: ["identity"] }));
  state = await finished(routes);
  assert.equal(state.blueprint.characters.find((row) => row.id === bob.id)!.content.identity, "失踪者的同事");
  assert.match(state.blueprint.workflowState.generationError ?? "", /Schema/);
});

test("Outline column fill retains original IDs, count, ordering and metadata and never starts details", async () => {
  const initial = characterDrafts();
  const plan = initial.workflowState.outlinePlans.find((row) => row.id === "outline-characters")!;
  let output: unknown = { items: [...plan.items].reverse().map((item) => ({ id: item.id, purpose: `${item.name} 提供调查证据` })) };
  const routes = api.createWorkflowRoutes(async () => output);
  let state = working(initial);
  assert.equal((await routes.request("/fill", request({ revision: state.revision, targetId: plan.id, prompt: "补充清单条目作用", fields: ["purpose"] }))).status, 202);
  state = await finished(routes);
  const changed = state.blueprint.workflowState.outlinePlans.find((row) => row.id === plan.id)!;
  assert.equal(changed.status, "PENDING_REVIEW");
  assert.equal(changed.items.length, plan.items.length);
  assert.deepEqual(changed.items.map((item) => [item.id, item.name, item.source, item.userModified]), plan.items.map((item) => [item.id, item.name, item.source, item.userModified]));
  assert.match(changed.items[0].purpose, /调查证据/);
  assert.equal(state.blueprint.characters.length, initial.characters.length);
  assert.ok(state.blueprint.characters.every((row) => row.status === "DRAFT"));
  const schema = getFormFillTarget(state.blueprint, plan.id, ["purpose"]).schema;
  assert.equal(schema.safeParse({ items: [{ id: plan.items[0].id, purpose: "p" }] }).success, false);
  assert.equal(schema.safeParse({ items: plan.items.map((item) => ({ id: item.id, purpose: "p", name: "不允许额外名称" })) }).success, false);
  assert.equal(schema.safeParse({ items: [{ id: plan.items[0].id, purpose: "p" }, { id: "new-item", purpose: "p" }] }).success, false);
  output = { items: [{ id: plan.items[0].id, purpose: "p" }, { id: plan.items[0].id, purpose: "p" }] };
  await routes.request("/fill", request({ revision: state.revision, targetId: plan.id, prompt: "补充定位", fields: ["purpose"] }));
  state = await finished(routes);
  assert.deepEqual(state.blueprint.workflowState.outlinePlans.find((row) => row.id === plan.id)!.items, changed.items);
});

test("Form context excludes future/unadopted entities and rejects unsafe selected references", async () => {
  const initial = characterDrafts();
  const bible = getFormFillTarget(initial, "story-bible", ["premise"]);
  assert.doesNotMatch(JSON.stringify(bible.context), new RegExp(initial.characters[0].id));
  assert.doesNotMatch(JSON.stringify(bible.context), /volumeChapterCounts/);
  const relationshipContext = getFormFillTarget(initial, "relationships", ["summary"]).context as { referenceEntities: WorkflowEntity[] };
  assert.equal(relationshipContext.referenceEntities.some((row) => row.kind === "character"), false);
  const routes = api.createWorkflowRoutes(async () => ({ content: { relationships: [{ fromCharacterId: initial.characters[0].id, toCharacterId: initial.characters[1].id, relationship: "合作" }] } }));
  let state = working(initial);
  await routes.request("/fill", request({ revision: state.revision, targetId: "relationships", prompt: "关联未审批人物", fields: ["relationships"] }));
  state = await finished(routes);
  assert.deepEqual(state.blueprint.relationships?.content.relationships, []);
  assert.equal(state.blueprint.relationships?.status, "DRAFT");
  assert.ok(state.blueprint.workflowState.generationError);
  const withoutConfirmedStory = structuredClone(initial);
  withoutConfirmedStory.workflowState.stageConfirmations.story = false;
  state = working(withoutConfirmedStory);
  assert.equal((await routes.request("/fill", request({ revision: state.revision, targetId: initial.characters[0].id, prompt: "填写身份", fields: ["identity"] }))).status, 409);
  assert.throws(() => getFormFillTarget(initial, initial.characters[0].id, ["id"]));
  assert.equal(getFormFillFields(initial, "outline-endings").length, 0);
  const fixed = structuredClone(initial);
  fixed.volumes.push({ ...initial.storyBible, id: "volume-test", kind: "volume", parentId: null, content: emptyContent("volume") });
  assert.throws(() => getFormFillTarget(fixed, "volume-test", ["volumeNumber"]));
});

test("Virtual StoryInput tasks cancel and recover without changing Bible approval or applying late patches", async () => {
  let resolveOutput: (output: unknown) => void = () => { throw new Error("No waiting fill"); };
  let signal: AbortSignal | undefined;
  const routes = api.createWorkflowRoutes(async (_prompt, currentSignal) => {
    signal = currentSignal;
    return new Promise<unknown>((resolveResult) => { resolveOutput = resolveResult; });
  });
  const initial = characterDrafts();
  let state = working(initial);
  const started = await routes.request("/fill", request({ revision: state.revision, targetId: "story-input", prompt: "补充故事背景", fields: ["background"] }));
  state = await started.json() as WorkflowResponse;
  assert.equal(state.blueprint.storyBible.status, "APPROVED");
  state = await (await routes.request("/cancel", request({ revision: state.revision }))).json() as WorkflowResponse;
  assert.equal(signal?.aborted, true);
  assert.equal(state.blueprint.storyBible.status, "APPROVED");
  resolveOutput({ background: "不应写入的晚到背景" });
  await delay(20);
  assert.equal(store.getWorkflowResponse().revision, state.revision);
  assert.equal(store.getWorkflowResponse().blueprint.storyInput.background, initial.storyInput.background);
  const interrupted = beginFormFill(state.blueprint, "story-input", "restart-form", ["background"]);
  store.saveWorkingBlueprint(state.revision, interrupted);
  api.recoverInterruptedWorkflow();
  state = store.getWorkflowResponse();
  assert.equal(state.blueprint.workflowState.activeGeneration, null);
  assert.equal(state.blueprint.storyBible.status, "APPROVED");
  assert.match(state.blueprint.workflowState.generationError ?? "", /重启/);
  assert.equal(allEntities(state.blueprint).some((row) => row.status === "GENERATING"), false);
});
