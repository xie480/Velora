import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { allEntities, emptyContent, entityFields } from "../src/shared/workflow.js";
import type { Blueprint, Content, WorkflowCommand, WorkflowEntity, WorkflowResponse } from "../src/shared/workflow.js";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "velora-workflow-lifecycle-"));
process.env.DATABASE_FILE = join(temporaryDirectory, "blueprint.sqlite");
const runtime = await import("../src/server/db/index.js");
const store = await import("../src/server/services/workflowStore.js");
const { createWorkflowRoutes } = await import("../src/server/routes/workflow.js");
after(() => {
  runtime.closeDatabase();
  // Only the exact directory created for this test is disposable; no user project data is touched.
  assert.equal(dirname(resolve(temporaryDirectory)), resolve(tmpdir()));
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function fixtureContent(blueprint: Blueprint, entity: WorkflowEntity): Content {
  const content = emptyContent(entity.kind);
  for (const field of entityFields[entity.kind]) {
    if (field.type === "text") content[field.key] = `${field.label}：围绕校园照片调查展开`;
    if (field.type === "textList") content[field.key] = field.required ? ["调查线"] : [];
    if (field.type === "referenceList") content[field.key] = allEntities(blueprint).filter((row) => row.kind === field.referenceKind).map((row) => row.id);
    if (field.type === "number") content[field.key] = entity.content[field.key];
  }
  if (entity.kind === "storyBible") content.locations = ["学院", "档案室"];
  if (entity.kind === "character") content.dynamicAttributes = [{ key: "trust", label: "信任", min: 0, max: 100, initial: 20 }];
  if (entity.kind === "relationships") content.relationships = [{ fromCharacterId: blueprint.characters[0].id, toCharacterId: blueprint.characters[1].id, relationship: "合作调查，尚未完全信任" }];
  if (entity.kind === "ending") content.endingType = "NORMAL";
  if (entity.kind === "chapterCharacterPlan") content.characters = blueprint.characters.map((character) => ({ characterId: character.id, startState: "谨慎", goal: "找到照片来源", mentalChange: "建立信任", relationshipChange: "愿意合作", knownInformation: ["照片存在"], forbiddenInformation: ["旧案真相"], attributeChanges: [{ key: "trust", delta: 5 }], endState: "愿意共享线索" }));
  if (entity.kind === "criticalBranch") content.choices = ["公开照片", "暂时保密"].map((label, index) => ({ id: `choice-${index}`, label, hidden: index === 1, unlockConditions: index === 1 ? ["获得保密承诺"] : [], effects: [label], relationshipEffects: ["影响信任"], futureChapterEffects: ["改变第二章调查方式"], opensRoutes: ["调查线"], closesRoutes: [], endingIds: blueprint.endings.map((ending) => ending.id) }));
  if (entity.kind === "gameSystem") content.configuration = { clueVisibility: "公开或仅本人可见" };
  if (entity.kind === "initialWorldState") {
    content.initialLocation = "学院"; content.accessibleLocations = ["学院", "档案室"];
    content.characterLocations = Object.fromEntries(blueprint.characters.map((character) => [character.id, "学院"]));
    content.characterAttributes = Object.fromEntries(blueprint.characters.map((character) => [character.id, { trust: 20 }]));
  }
  return content;
}

test("七阶段经真实 Workflow API 与 SQLite 完成 Finalize，导出重导入和历史冻结保持一致", async () => {
  let modelCalls = 0;
  const routes = createWorkflowRoutes(async (prompt) => {
    modelCalls++;
    assert.ok(prompt.includes("JSON Schema"));
    assert.ok(prompt.includes("学院照片调查"));
    const blueprint = store.getWorkingBlueprint().blueprint;
    const targetId = blueprint.workflowState.activeGeneration!.targetId;
    if (targetId === "blueprint-review") return { issues: [] };
    const plan = blueprint.workflowState.outlinePlans.find((row) => row.id === targetId);
    if (plan) {
      const kind = plan.stageId === "characters" ? "character" : plan.stageId === "endings" ? "ending" : plan.stageId === "branches" ? "criticalBranch" : "gameSystem";
      const names = kind === "character" ? ["Alice", "Bob"] : kind === "ending" ? ["Normal End"] : kind === "criticalBranch" ? ["是否公开照片"] : ["线索系统"];
      return { items: names.map((name) => ({ name, kind, source: "AI", purpose: "推进调查线并为结局提供必要依据", required: true, enabled: true, relatedIds: [], volumeNumbers: [1] })) };
    }
    return { content: fixtureContent(blueprint, allEntities(blueprint).find((row) => row.id === targetId)!) };
  });
  let state = await (await routes.request("/")).json() as WorkflowResponse;
  async function post(path: string, data: Record<string, unknown>, expectedStatus = 200): Promise<WorkflowResponse> {
    const response = await routes.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, revision: state.revision }) });
    const body = await response.json();
    assert.equal(response.status, expectedStatus, JSON.stringify(body));
    state = body as WorkflowResponse;
    return state;
  }
  async function command(command: WorkflowCommand): Promise<void> { await post("/commands", { command }); }
  async function generate(targetId: string): Promise<void> {
    await post("/generate", { targetId }, 202);
    for (let attempt = 0; attempt < 100; attempt++) {
      state = await (await routes.request("/")).json() as WorkflowResponse;
      if (!state.blueprint.workflowState.activeGeneration) break;
      await delay(5);
    }
    assert.equal(state.blueprint.workflowState.activeGeneration, null);
    const target = targetId === "blueprint-review" ? state.blueprint.workflowState.review : state.blueprint.workflowState.outlinePlans.find((row) => row.id === targetId) ?? allEntities(state.blueprint).find((row) => row.id === targetId)!;
    assert.equal(target.status, "PENDING_REVIEW", JSON.stringify(target));
  }
  async function approveEntity(id: string): Promise<void> { await generate(id); await command({ type: "approveEntity", entityId: id }); }
  async function approveOutline(id: string): Promise<void> {
    const beforeCalls = modelCalls;
    await generate(id);
    const beforeCount = allEntities(state.blueprint).length;
    await command({ type: "approveOutline", outlineId: id });
    assert.equal(modelCalls, beforeCalls + 1, "确认清单不会隐式请求生成详情");
    assert.ok(allEntities(state.blueprint).length >= beforeCount);
  }
  await command({ type: "updateStoryInput", input: { ...state.blueprint.storyInput, name: "学院照片调查", genre: "悬疑", outline: "调查照片与旧校园秘密", presetCharacters: ["Alice", "Bob"] } });
  await approveEntity("story-bible"); await command({ type: "confirmStage", stageId: "story" });
  await approveOutline("outline-characters");
  assert.equal(state.blueprint.characters.every((row) => row.status === "DRAFT"), true);
  for (const character of state.blueprint.characters) await approveEntity(character.id);
  await approveEntity("relationships"); await command({ type: "confirmStage", stageId: "characters" });
  await approveOutline("outline-endings"); for (const ending of state.blueprint.endings) await approveEntity(ending.id);
  await command({ type: "confirmStage", stageId: "endings" });
  await command({ type: "configureChapters", counts: [2] });
  assert.equal(state.blueprint.chapters.length, 2);
  for (const volume of state.blueprint.volumes) await approveEntity(volume.id);
  for (const chapter of state.blueprint.chapters) await approveEntity(chapter.id);
  await command({ type: "confirmStage", stageId: "chapters" });
  for (const chapter of state.blueprint.chapters) {
    await approveEntity(state.blueprint.chapterCharacterPlans.find((row) => row.parentId === chapter.id)!.id);
    await approveOutline(`outline-branches-${chapter.id}`);
    for (const branch of state.blueprint.criticalBranches.filter((row) => row.parentId === chapter.id)) await approveEntity(branch.id);
  }
  await command({ type: "confirmStage", stageId: "branches" });
  await approveOutline("outline-systems"); for (const system of state.blueprint.gameSystems) await approveEntity(system.id);
  await approveEntity("initial-world-state"); await command({ type: "confirmStage", stageId: "systems" });
  await generate("blueprint-review");
  assert.equal(state.blueprint.workflowState.review.issues.some((issue) => issue.severity === "ERROR"), false);
  await command({ type: "approveReview" }); await command({ type: "confirmStage", stageId: "review" });
  await post("/versions", { description: "完整七阶段蓝图", userNote: "模型响应为确定性测试夹具", finalize: true }, 201);
  assert.equal(state.versions[0].finalized, true);
  const frozen = JSON.stringify((await (await routes.request("/versions/1")).json() as { blueprint: Blueprint }).blueprint);
  const exported = await (await routes.request("/export")).json() as Blueprint;
  const preview = await (await routes.request("/import/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "blueprint", data: exported }) })).json() as { valid: boolean };
  assert.equal(preview.valid, true);
  await post("/import", { kind: "blueprint", data: exported, confirmed: true });
  assert.equal(state.blueprint.workflowState.stageConfirmations.review, true);
  const character = state.blueprint.characters[0];
  const chapterContent = JSON.stringify(state.blueprint.chapters.map((row) => row.content));
  await command({ type: "updateEntity", entityId: character.id, name: character.name, content: { ...character.content, desire: "寻找失踪的家人" } });
  assert.equal(state.blueprint.endings[0].status, "NEEDS_REVIEW");
  assert.equal(JSON.stringify(state.blueprint.chapters.map((row) => row.content)), chapterContent);
  const blocked = await routes.request("/versions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: state.revision, finalize: true }) });
  assert.equal(blocked.status, 409);
  assert.equal(JSON.stringify((await (await routes.request("/versions/1")).json() as { blueprint: Blueprint }).blueprint), frozen);
  assert.equal(store.getWorkingBlueprint().revision, state.revision);
  assert.ok(modelCalls >= 18, "全流程实际请求了独立规划、详情和检查单元");
});
