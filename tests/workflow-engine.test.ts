import assert from "node:assert/strict";
import test from "node:test";
import { allEntities, blueprintSchema, emptyContent, entityFields, previewImport, storyInputSchema } from "../src/shared/workflow.js";
import type { Blueprint, Content, OutlineItem, StageId, WorkflowEntity } from "../src/shared/workflow.js";
import {
  applyWorkflowCommand, assertCanGenerate, beginGeneration, canFinalize, completeGeneration,
  createBlueprint, failGeneration, getGenerationTarget, getStageStatus, runBlueprintChecks,
} from "../src/shared/workflowEngine.js";

function generated(bp: Blueprint, targetId: string, result: unknown): Blueprint {
  const token = `token-${crypto.randomUUID()}`;
  return completeGeneration(beginGeneration(bp, targetId, token), targetId, result, token);
}
function contentFor(bp: Blueprint, row: WorkflowEntity): Content {
  const content = emptyContent(row.kind);
  for (const field of entityFields[row.kind]) {
    if (field.type === "text") content[field.key] = `已明确${field.label}`;
    if (field.type === "textList") content[field.key] = field.required ? ["主线"] : [];
    if (field.type === "referenceList") content[field.key] = allEntities(bp).filter((item) => item.kind === field.referenceKind).map((item) => item.id);
    if (field.type === "number") content[field.key] = row.content[field.key];
  }
  if (row.kind === "storyBible") content.locations = ["学院"];
  if (row.kind === "character") content.dynamicAttributes = [{ key: "trust", label: "信任", min: 0, max: 100, initial: 10 }];
  if (row.kind === "ending") content.endingType = "NORMAL";
  if (row.kind === "relationships") content.relationships = bp.characters.length > 1 ? [{ fromCharacterId: bp.characters[0].id, toCharacterId: bp.characters[1].id, relationship: "尚待建立信任" }] : [];
  if (row.kind === "chapterCharacterPlan") content.characters = bp.characters.map((character) => ({ characterId: character.id, startState: "谨慎", goal: "寻找线索", mentalChange: "开始信任", relationshipChange: "建立合作", knownInformation: ["照片"], forbiddenInformation: ["核心秘密"], attributeChanges: [{ key: "trust", delta: 5 }], endState: "愿意合作" }));
  if (row.kind === "criticalBranch") content.choices = ["公开", "保留"].map((label, index) => ({ id: `choice-${index}`, label, hidden: false, unlockConditions: [], effects: [`${label}情报`], relationshipEffects: ["改变信任"], futureChapterEffects: ["改变后续调查"], opensRoutes: ["主线"], closesRoutes: [], endingIds: bp.endings.map((ending) => ending.id) }));
  if (row.kind === "initialWorldState") {
    content.initialTime = "第一日早晨"; content.initialLocation = "学院"; content.accessibleLocations = ["学院"];
    content.characterLocations = Object.fromEntries(bp.characters.map((character) => [character.id, "学院"]));
    content.characterAttributes = Object.fromEntries(bp.characters.map((character) => [character.id, { trust: 10 }]));
  }
  return content;
}
function approve(bp: Blueprint, id: string): Blueprint {
  const row = allEntities(bp).find((item) => item.id === id)!;
  return applyWorkflowCommand(generated(bp, id, { content: contentFor(bp, row) }), { type: "approveEntity", entityId: id });
}
function confirm(bp: Blueprint, stageId: StageId): Blueprint { return applyWorkflowCommand(bp, { type: "confirmStage", stageId }); }
function planResult(kind: OutlineItem["kind"], names = [kind]): { items: unknown[] } {
  return { items: names.map((name) => ({ name, kind, source: "AI", purpose: "推进调查主线", required: true, enabled: true, relatedIds: [], volumeNumbers: [] })) };
}
function approvePlan(bp: Blueprint, id: string, result: unknown): Blueprint {
  return applyWorkflowCommand(generated(bp, id, result), { type: "approveOutline", outlineId: id });
}
function base(counts = [2]): Blueprint {
  const bp = createBlueprint();
  return applyWorkflowCommand(bp, { type: "updateStoryInput", input: storyInputSchema.parse({ name: "学院调查", genre: "悬疑", outline: "从照片开始寻找过去的秘密", volumeChapterCounts: counts }) });
}
function completedCharacters(counts = [2]): Blueprint {
  let bp = confirm(approve(base(counts), "story-bible"), "story");
  bp = approvePlan(bp, "outline-characters", planResult("character", ["Alice", "Bob"]));
  for (const character of bp.characters) bp = approve(bp, character.id);
  return confirm(approve(bp, "relationships"), "characters");
}
function completedChapters(): Blueprint {
  let bp = completedCharacters();
  bp = approvePlan(bp, "outline-endings", planResult("ending", ["Normal End"]));
  for (const ending of bp.endings) bp = approve(bp, ending.id);
  bp = confirm(bp, "endings");
  for (const volume of bp.volumes) bp = approve(bp, volume.id);
  for (const chapter of bp.chapters) bp = approve(bp, chapter.id);
  return confirm(bp, "chapters");
}
function completedContent(): Blueprint {
  let bp = completedChapters();
  for (const chapter of bp.chapters) {
    bp = approve(bp, bp.chapterCharacterPlans.find((row) => row.parentId === chapter.id)!.id);
    bp = approvePlan(bp, `outline-branches-${chapter.id}`, { items: [] });
  }
  bp = confirm(bp, "branches");
  bp = approvePlan(bp, "outline-systems", planResult("gameSystem", ["线索系统"]));
  for (const system of bp.gameSystems) bp = approve(bp, system.id);
  return confirm(approve(bp, "initial-world-state"), "systems");
}

test("固定结构从用户数量展开，初始化与命令不修改原对象", () => {
  const original = createBlueprint();
  assert.equal(blueprintSchema.safeParse(original).success, true);
  const configured = applyWorkflowCommand(original, { type: "configureChapters", counts: [2, 1] });
  assert.equal(original.volumes.length, 0);
  assert.equal(configured.volumes.length, 2);
  assert.deepEqual(configured.chapters.map((row) => row.parentId), ["volume-1", "volume-1", "volume-2"]);
  assert.equal(configured.chapterCharacterPlans.length, 3);
  assert.equal(configured.workflowState.outlinePlans.filter((row) => row.stageId === "branches").length, 3);
  assert.throws(() => assertCanGenerate(configured, "outline-characters"), /前置阶段/);
  assert.throws(() => applyWorkflowCommand(original, { type: "confirmStage", stageId: "story" }), /必需内容/);
});

test("AI 清单先审批再建实体，每次只能生成一个单元并按必需项审批", () => {
  let bp = confirm(approve(base(), "story-bible"), "story");
  bp = generated(bp, "outline-characters", planResult("character", ["Alice", "Bob"]));
  assert.equal(bp.characters.length, 0);
  assert.equal(getStageStatus(bp, "characters"), "OUTLINE_REVIEW");
  bp = applyWorkflowCommand(bp, { type: "approveOutline", outlineId: "outline-characters" });
  assert.deepEqual(bp.characters.map((row) => row.status), ["DRAFT", "DRAFT"]);
  assert.throws(() => assertCanGenerate(bp, bp.characters[1].id), /之前的必需/);
  const generating = beginGeneration(bp, bp.characters[0].id, "token-a");
  assert.throws(() => assertCanGenerate(generating, bp.characters[1].id), /正在生成/);
  assert.throws(() => applyWorkflowCommand(generating, { type: "updateEntity", entityId: bp.characters[0].id, name: "Alice", content: {} }), /正在生成/);
  bp = approve(bp, bp.characters[0].id);
  assert.doesNotThrow(() => assertCanGenerate(bp, bp.characters[1].id));
  assert.throws(() => assertCanGenerate(bp, "relationships"), /之前的必需/);
  assert.throws(() => applyWorkflowCommand(bp, { type: "confirmStage", stageId: "characters" }), /必需内容/);
  bp = approve(bp, bp.characters[1].id); bp = approve(bp, "relationships");
  assert.equal(getStageStatus(bp, "characters"), "READY_TO_CONFIRM");
});

test("未配置卷章时允许规划预计卷号，用户预设人物必须保留 USER 来源", () => {
  let bp = base([]);
  bp = applyWorkflowCommand(bp, { type: "updateStoryInput", input: { ...bp.storyInput, presetCharacters: ["Alice"] } });
  bp = confirm(approve(bp, "story-bible"), "story");
  const result = { items: [{ name: "Bob", kind: "character", source: "AI", purpose: "连接过去事件", required: true, enabled: true, relatedIds: [], volumeNumbers: [1] }] };
  bp = generated(bp, "outline-characters", result);
  const items = bp.workflowState.outlinePlans.find((row) => row.id === "outline-characters")!.items;
  assert.equal(items.find((row) => row.name === "Alice")?.source, "USER");
  assert.equal(bp.characters.length, 0);
});

test("卷全部审批后才逐章生成，第五阶段必须按本章人物和分支清单顺序", () => {
  let bp = completedCharacters([1, 1]);
  bp = approvePlan(bp, "outline-endings", planResult("ending")); bp = approve(bp, bp.endings[0].id); bp = confirm(bp, "endings");
  bp = approve(bp, bp.volumes[0].id);
  assert.throws(() => assertCanGenerate(bp, bp.chapters[0].id), /之前的必需/);
  bp = approve(bp, bp.volumes[1].id);
  bp = approve(bp, bp.chapters[0].id); bp = approve(bp, bp.chapters[1].id); bp = confirm(bp, "chapters");
  const chapter = bp.chapters[0]; const nextPlan = bp.chapterCharacterPlans[1];
  assert.throws(() => assertCanGenerate(bp, `outline-branches-${chapter.id}`), /之前的必需/);
  bp = approve(bp, bp.chapterCharacterPlans[0].id);
  bp = approvePlan(bp, `outline-branches-${chapter.id}`, planResult("criticalBranch", ["公开照片"]));
  assert.throws(() => assertCanGenerate(bp, nextPlan.id), /之前的必需/);
  bp = approve(bp, bp.criticalBranches[0].id);
  assert.doesNotThrow(() => assertCanGenerate(bp, nextPlan.id));
});

test("修改前置人物保留所有后续内容，传播复审并使总体检查过期", () => {
  let bp = completedContent();
  bp = generated(bp, "blueprint-review", { issues: [] });
  bp = applyWorkflowCommand(bp, { type: "approveReview" }); bp = confirm(bp, "review");
  assert.equal(canFinalize(bp), true);
  const before = structuredClone(bp);
  const alice = bp.characters[0];
  bp = applyWorkflowCommand(bp, { type: "updateEntity", entityId: alice.id, name: alice.name, content: { ...alice.content, desire: "找到失踪的家人" } });
  assert.equal(bp.endings[0].status, "NEEDS_REVIEW");
  assert.equal(bp.relationships?.status, "NEEDS_REVIEW");
  assert.equal(bp.chapterCharacterPlans[0].status, "NEEDS_REVIEW");
  assert.deepEqual(bp.chapters[0].content, before.chapters[0].content);
  assert.equal(bp.workflowState.review.status, "NEEDS_REVIEW");
  assert.equal(bp.workflowState.review.basedOnContentRevision, null);
  assert.equal(canFinalize(bp), false);
  assert.throws(() => applyWorkflowCommand(bp, { type: "approveReview" }), /前置阶段|过期/);
  bp = applyWorkflowCommand(bp, { type: "approveEntity", entityId: alice.id });
  bp = applyWorkflowCommand(bp, { type: "approveEntity", entityId: "relationships" });
  assert.equal(bp.relationships?.status, "APPROVED");
});

test("AI 输出、人工修改和审批均检查 Schema、引用、属性与必填字段", () => {
  let bp = confirm(approve(base(), "story-bible"), "story");
  const badOutline = { items: [{ name: "越界", kind: "ending", source: "AI", purpose: "不合法", required: true, enabled: true, relatedIds: [], volumeNumbers: [] }] };
  assert.throws(() => generated(bp, "outline-characters", badOutline), /类型范围/);
  assert.throws(() => generated(bp, "outline-characters", { ...planResult("character"), characters: [] }));
  bp = approvePlan(bp, "outline-characters", planResult("character"));
  const id = bp.characters[0].id;
  assert.throws(() => generated(bp, id, { content: {} }), /不完整/);
  assert.throws(() => applyWorkflowCommand(bp, { type: "updateEntity", entityId: id, name: "角色", content: { dynamicAttributes: [{ key: "trust", label: "信任", min: 0, max: 10, initial: 20 }] } }));
  bp = applyWorkflowCommand(bp, { type: "updateEntity", entityId: id, name: "角色", content: {} });
  assert.throws(() => applyWorkflowCommand(bp, { type: "approveEntity", entityId: id }), /基础资料|请填写/);
  assert.equal(bp.characters[0].status, "PENDING_REVIEW");
  assert.equal(getGenerationTarget(bp, id).schema.safeParse({ content: contentFor(bp, bp.characters[0]), characters: [] }).success, false);
});

test("生成取消保留之前数据与状态，陈旧 token 不可回写", () => {
  const bp = completedCharacters();
  const target = bp.characters[0];
  const generating = beginGeneration(bp, target.id, "current-token");
  assert.throws(() => completeGeneration(generating, target.id, { content: target.content }, "stale-token"), /过期/);
  const recovered = failGeneration(generating, "服务重启中断");
  assert.equal(recovered.characters[0].status, "APPROVED");
  assert.deepEqual(recovered.characters[0].content, bp.characters[0].content);
  assert.equal(recovered.workflowState.activeGeneration, null);
  assert.throws(() => completeGeneration(recovered, target.id, { content: target.content }, "current-token"), /过期/);
});

test("Finalize 拒绝 ERROR 与陈旧报告，WARNING 不阻塞有效审批", () => {
  let bp = completedContent();
  bp = generated(bp, "blueprint-review", { issues: [{ severity: "ERROR", category: "Story", message: "主线冲突", entityIds: [bp.storyBible.id], suggestion: "完善主线" }] });
  assert.throws(() => applyWorkflowCommand(bp, { type: "approveReview" }), /ERROR/);
  assert.equal(canFinalize(bp), false);
  bp = generated(bp, "blueprint-review", { issues: [{ severity: "WARNING", category: "Characters", message: "人物成长需再核对", entityIds: [bp.characters[0].id], suggestion: "检查人物目标" }] });
  bp = applyWorkflowCommand(bp, { type: "approveReview" }); bp = confirm(bp, "review");
  assert.equal(canFinalize(bp), true);
  assert.equal(runBlueprintChecks(bp).some((issue) => issue.severity === "ERROR"), false);
  const malicious = structuredClone(bp); malicious.workflowState.contentRevision += 1;
  assert.equal(canFinalize(malicious), false);
});

test("结构缩减保护已创作内容，清单删除保留内容和其他阶段数据", () => {
  let bp = completedCharacters();
  bp = approvePlan(bp, "outline-endings", planResult("ending")); bp = approve(bp, bp.endings[0].id); bp = confirm(bp, "endings");
  bp = approve(bp, bp.volumes[0].id); bp = approve(bp, bp.chapters[0].id); bp = approve(bp, bp.chapters[1].id);
  assert.throws(() => applyWorkflowCommand(bp, { type: "configureChapters", counts: [1] }), /缩减卷章/);
  const outline = bp.workflowState.outlinePlans.find((row) => row.id === "outline-characters")!;
  const removedId = outline.items[1].id;
  const changed = applyWorkflowCommand(bp, { type: "updateOutline", outlineId: outline.id, items: [outline.items[0]] });
  assert.equal(changed.characters.length, 2);
  assert.deepEqual(changed.characters.find((row) => row.id === removedId)?.content, bp.characters.find((row) => row.id === removedId)?.content);
  assert.equal(changed.workflowState.outlinePlans.find((row) => row.id === outline.id)?.items.find((row) => row.id === removedId)?.enabled, false);
  assert.equal(changed.chapters.length, bp.chapters.length);
});

test("JSON 导入拒绝未来版本、未知字段及非法引用", () => {
  const bp = completedCharacters();
  assert.equal(previewImport("blueprint", JSON.stringify(bp)).valid, true);
  assert.equal(previewImport("blueprint", { ...bp, schemaVersion: 999 }).valid, false);
  assert.equal(previewImport("story", { name: "故事", genre: "悬疑", outline: "调查", runtime: true }).valid, false);
  const invalid = structuredClone(bp); invalid.relationships!.content.relationships = [{ fromCharacterId: "missing", toCharacterId: bp.characters[1].id, relationship: "测试" }];
  assert.equal(previewImport("blueprint", invalid).valid, false);
});
