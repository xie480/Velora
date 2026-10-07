import assert from "node:assert/strict";
import test from "node:test";
import { activeApprovedCharacters, allEntities, allowedReferenceEntities, blueprintSchema, canReferenceEntity, emptyContent, entityApprovalErrors, entityFields, migrateBlueprint, previewImport, storyInputSchema, validateBlueprintStructure } from "../src/shared/workflow.js";
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
    if (field.type === "referenceList") content[field.key] = allEntities(bp).filter((item) => item.kind === field.referenceKind && item.status === "APPROVED").map((item) => item.id);
    if (field.type === "number") content[field.key] = row.content[field.key];
  }
  if (row.kind === "storyBible") content.locations = ["学院"];
  if (row.kind === "character") content.dynamicAttributes = [{ key: "trust", label: "信任", min: 0, max: 100, initial: 10 }];
  if (row.kind === "ending") content.endingType = "NORMAL";
  const characters = activeApprovedCharacters(bp);
  if (row.kind === "relationships") content.relationships = characters.length > 1 ? [{ fromCharacterId: characters[0].id, toCharacterId: characters[1].id, relationship: "尚待建立信任" }] : [];
  if (row.kind === "chapterCharacterPlan") content.characters = characters.map((character) => ({ characterId: character.id, startState: "谨慎", goal: "寻找线索", mentalChange: "开始信任", relationshipChange: "建立合作", knownInformation: ["照片"], forbiddenInformation: ["核心秘密"], attributeChanges: [{ key: "trust", delta: 5 }], endState: "愿意合作" }));
  if (row.kind === "criticalBranch") content.choices = ["公开", "保留"].map((label, index) => ({ id: `choice-${index}`, label, hidden: false, unlockConditions: [], effects: [`${label}情报`], relationshipEffects: ["改变信任"], futureChapterEffects: ["改变后续调查"], opensRoutes: ["主线"], closesRoutes: [], endingIds: bp.endings.map((ending) => ending.id) }));
  if (row.kind === "initialWorldState") {
    content.initialTime = "第一日早晨"; content.initialLocation = "学院"; content.accessibleLocations = ["学院"];
    content.characterLocations = Object.fromEntries(characters.map((character) => [character.id, "学院"]));
    content.characterAttributes = Object.fromEntries(characters.map((character) => [character.id, { trust: 10 }]));
  }
  return content;
}
function approve(bp: Blueprint, id: string): Blueprint {
  const row = allEntities(bp).find((item) => item.id === id)!;
  return applyWorkflowCommand(generated(bp, id, { content: contentFor(bp, row) }), { type: "approveEntity", entityId: id });
}
function confirm(bp: Blueprint, stageId: StageId): Blueprint { return applyWorkflowCommand(bp, { type: "confirmStage", stageId }); }
function planResult(kind: OutlineItem["kind"], names = [kind]): { items: unknown[] } {
  return { items: names.map((name) => ({ name, kind, source: "AI", purpose: "推进调查主线", required: true, enabled: true, relatedIds: [] })) };
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
  assert.equal(original.workflowState.selectedObjectId, "story-input");
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

test("未配置卷章时仍可规划人物，用户预设人物必须保留 USER 来源", () => {
  let bp = base([]);
  bp = applyWorkflowCommand(bp, { type: "updateStoryInput", input: { ...bp.storyInput, presetCharacters: ["Alice"] } });
  bp = confirm(approve(bp, "story-bible"), "story");
  const result = { items: [{ name: "Bob", kind: "character", source: "AI", purpose: "连接过去事件", required: true, enabled: true, relatedIds: [] }] };
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
  const badOutline = { items: [{ name: "越界", kind: "ending", source: "AI", purpose: "不合法", required: true, enabled: true, relatedIds: [] }] };
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

test("总体检查生成失败持久化可见原因，重试清除旧错误且保留内容", () => {
  const blueprint = completedContent();
  const generating = beginGeneration(blueprint, "blueprint-review", "review-failure");
  const recovered = failGeneration(generating, "模型服务超时，请重试总体检查");
  assert.equal(recovered.workflowState.generationError, "模型服务超时，请重试总体检查");
  assert.equal(recovered.workflowState.review.status, "DRAFT");
  assert.equal(recovered.workflowState.activeGeneration, null);
  assert.deepEqual(recovered.storyBible.content, blueprint.storyBible.content);
  const retry = beginGeneration(recovered, "blueprint-review", "review-retry");
  assert.equal(retry.workflowState.generationError, null);
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

test("仅创建空白详情后重新规划清单会移除过期草稿并保持有效结构", () => {
  let bp = confirm(approve(base(), "story-bible"), "story");
  bp = approvePlan(bp, "outline-characters", planResult("character", ["Alice", "Bob"]));
  const oldIds = bp.characters.map((row) => row.id);
  bp = generated(bp, "outline-characters", planResult("character", ["Yuki"]));
  assert.equal(bp.characters.length, 0);
  assert.equal(bp.workflowState.outlinePlans.find((row) => row.id === "outline-characters")?.status, "PENDING_REVIEW");
  bp = applyWorkflowCommand(bp, { type: "approveOutline", outlineId: "outline-characters" });
  assert.deepEqual(bp.characters.map((row) => row.name), ["Yuki"]);
  assert.equal(bp.characters.some((row) => oldIds.includes(row.id)), false);
  assert.equal(previewImport("blueprint", bp).valid, true);
});

test("旧确认标记不能绕过真实审批状态，卷章扩展使原卷和下游复审", () => {
  let bp = completedChapters();
  const malicious = structuredClone(bp); malicious.characters[0].status = "NEEDS_REVIEW";
  assert.throws(() => assertCanGenerate(malicious, malicious.chapterCharacterPlans[0].id), /前置阶段/);
  const oldChapterContent = structuredClone(bp.chapters[0].content);
  bp = applyWorkflowCommand(bp, { type: "configureChapters", counts: [3] });
  assert.equal(bp.volumes[0].status, "NEEDS_REVIEW");
  assert.equal(bp.chapters[0].status, "NEEDS_REVIEW");
  assert.equal(bp.chapters[2].status, "DRAFT");
  assert.deepEqual(bp.chapters[0].content, oldChapterContent);
  assert.equal(bp.workflowState.stageConfirmations.chapters, false);
  assert.equal(bp.workflowState.stageConfirmations.story, true);
});

test("新增建议等待审批，批准只修改清单，确认清单之后才创建新草稿", () => {
  let bp = confirm(approve(base(), "story-bible"), "story");
  bp = approvePlan(bp, "outline-characters", planResult("character", ["Alice"]));
  const alice = bp.characters[0];
  const addition = { outlineId: "outline-characters", name: "Teacher", kind: "character", source: "AI", purpose: "连接过去与现在的事件", required: true, enabled: true, relatedIds: [bp.storyBible.id] };
  bp = generated(bp, alice.id, { content: contentFor(bp, alice), additionSuggestions: [addition] });
  assert.equal(bp.characters.length, 1);
  assert.equal(bp.workflowState.outlinePlans.find((row) => row.id === "outline-characters")?.items.length, 1);
  const suggestion = bp.workflowState.additionSuggestions[0];
  assert.equal(suggestion.status, "PENDING_REVIEW");
  assert.notEqual(suggestion.item.id, alice.id);
  assert.equal(previewImport("blueprint", bp).valid, true);
  bp = applyWorkflowCommand(bp, { type: "approveAddition", suggestionId: suggestion.id });
  assert.equal(bp.workflowState.additionSuggestions[0].status, "APPROVED");
  assert.equal(bp.characters.length, 1);
  assert.equal(bp.characters[0].status, "NEEDS_REVIEW");
  assert.equal(bp.workflowState.outlinePlans.find((row) => row.id === "outline-characters")?.status, "PENDING_REVIEW");
  assert.throws(() => assertCanGenerate(bp, alice.id), /之前的必需|清单/);
  bp = applyWorkflowCommand(bp, { type: "approveOutline", outlineId: "outline-characters" });
  assert.equal(bp.characters.length, 2);
  assert.equal(bp.characters.find((row) => row.id === suggestion.item.id)?.status, "DRAFT");
  assert.equal(bp.characters.find((row) => row.id === suggestion.item.id)?.name, "Teacher");
  assert.equal(previewImport("blueprint", bp).valid, true);
});

test("拒绝新增建议不扩张范围，越界、伪造 ID 和未来引用均被拒绝", () => {
  let bp = confirm(approve(base(), "story-bible"), "story");
  bp = approvePlan(bp, "outline-characters", planResult("character", ["Alice"]));
  const alice = bp.characters[0];
  const addition = { outlineId: "outline-characters", name: "Doctor", kind: "character", source: "AI", purpose: "解释调查证据", required: true, enabled: true, relatedIds: [bp.storyBible.id] };
  const result = { content: contentFor(bp, alice), additionSuggestions: [addition] };
  assert.throws(() => generated(bp, alice.id, { ...result, additionSuggestions: [{ ...addition, outlineId: "missing-outline" }] }), /清单不存在/);
  assert.throws(() => generated(bp, alice.id, { ...result, additionSuggestions: [{ ...addition, kind: "ending" }] }), /类型/);
  assert.throws(() => generated(bp, alice.id, { ...result, additionSuggestions: [{ ...addition, id: "forged-id" }] }));
  assert.throws(() => generated(bp, alice.id, { ...result, additionSuggestions: [{ ...addition, relatedIds: [bp.chapters[0].id] }] }), /已审批/);
  bp = generated(bp, alice.id, result);
  bp = applyWorkflowCommand(bp, { type: "rejectAddition", suggestionId: bp.workflowState.additionSuggestions[0].id });
  assert.equal(bp.workflowState.additionSuggestions[0].status, "REJECTED");
  assert.equal(bp.workflowState.outlinePlans.find((row) => row.id === "outline-characters")?.items.length, 1);
  assert.equal(bp.characters.length, 1);
  assert.throws(() => applyWorkflowCommand(bp, { type: "approveAddition", suggestionId: bp.workflowState.additionSuggestions[0].id }), /已处理/);
});

test("旧 Schema v1 草稿缺少新增建议字段时默认恢复为空，故事名称长度与标题一致", () => {
  const original = createBlueprint();
  const legacy = { ...original, workflowState: { ...original.workflowState } } as Omit<Blueprint, "workflowState"> & { workflowState: Omit<Blueprint["workflowState"], "additionSuggestions"> & { additionSuggestions?: Blueprint["workflowState"]["additionSuggestions"] } };
  delete legacy.workflowState.additionSuggestions;
  const preview = previewImport("blueprint", legacy);
  assert.equal(preview.valid, true);
  assert.deepEqual((preview.data as Blueprint).workflowState.additionSuggestions, []);
  assert.equal(storyInputSchema.safeParse({ name: "x".repeat(301), genre: "悬疑", outline: "调查" }).success, false);
  assert.equal(storyInputSchema.safeParse({ name: "x".repeat(300), genre: "悬疑", outline: "调查" }).success, true);
});

test("导入不能删除已批准清单的必需实体绕过审批或提前进入下一阶段", () => {
  const bp = completedCharacters();
  const removed = bp.characters[1].id;
  const invalid = structuredClone(bp);
  invalid.characters = invalid.characters.filter((row) => row.id !== removed);
  invalid.relationships!.content.relationships = [];
  for (const entity of allEntities(invalid)) entity.dependencies = entity.dependencies.filter((id) => id !== removed);
  for (const plan of invalid.workflowState.outlinePlans) plan.dependencies = plan.dependencies.filter((id) => id !== removed);
  const preview = previewImport("blueprint", invalid);
  assert.equal(preview.valid, false);
  assert.equal(preview.errors.some((error) => error.includes("已确认清单缺少对应实体")), true);
  assert.notEqual(getStageStatus(invalid, "characters"), "CONFIRMED");
  assert.throws(() => assertCanGenerate(invalid, "outline-endings"), /前置阶段/);
});

test("未采用的可选人物草稿不阻塞初始世界及 Finalize，禁用人物不强制初始映射", () => {
  let bp = confirm(approve(base([1]), "story-bible"), "story");
  bp = approvePlan(bp, "outline-characters", { items: [
    { name: "Alice", kind: "character", source: "AI", purpose: "主线调查", required: true, enabled: true, relatedIds: [] },
    { name: "Observer", kind: "character", source: "AI", purpose: "可选的调查视角", required: false, enabled: true, relatedIds: [] },
  ] });
  bp = approve(bp, bp.characters[0].id);
  const optionalId = bp.characters[1].id;
  bp = confirm(approve(bp, "relationships"), "characters");
  assert.equal(bp.characters[1].status, "DRAFT");
  bp = approvePlan(bp, "outline-endings", planResult("ending")); bp = approve(bp, bp.endings[0].id); bp = confirm(bp, "endings");
  bp = approve(bp, bp.volumes[0].id); bp = approve(bp, bp.chapters[0].id); bp = confirm(bp, "chapters");
  bp = approve(bp, bp.chapterCharacterPlans[0].id); bp = approvePlan(bp, `outline-branches-${bp.chapters[0].id}`, { items: [] }); bp = confirm(bp, "branches");
  bp = approvePlan(bp, "outline-systems", planResult("gameSystem")); bp = approve(bp, bp.gameSystems[0].id);
  bp = confirm(approve(bp, "initial-world-state"), "systems");
  assert.equal(Object.hasOwn(bp.initialWorldState!.content.characterLocations as object, optionalId), false);
  bp = generated(bp, "blueprint-review", { issues: [] }); bp = applyWorkflowCommand(bp, { type: "approveReview" }); bp = confirm(bp, "review");
  assert.equal(canFinalize(bp), true);
  const disabled = structuredClone(bp);
  disabled.characters[1].content = contentFor(disabled, disabled.characters[1]) as WorkflowEntity["content"];
  disabled.characters[1].status = "APPROVED";
  disabled.workflowState.outlinePlans.find((plan) => plan.stageId === "characters")!.items[1].enabled = false;
  assert.deepEqual(activeApprovedCharacters(disabled).map((character) => character.id), [bp.characters[0].id]);
  assert.deepEqual(entityApprovalErrors(disabled, disabled.initialWorldState!), []);
});

test("正式引用仅指向前置阶段及明确同阶段上游，清单不能绑定自己的详情", () => {
  const bp = completedContent();
  const alice = bp.characters[0]; const bob = bp.characters[1];
  assert.equal(canReferenceEntity(bp, alice, bp.storyBible), true);
  for (const row of [alice, bob, bp.relationships!, bp.endings[0], bp.chapters[0], bp.gameSystems[0]]) assert.equal(canReferenceEntity(bp, alice, row), false);
  const characterOutline = bp.workflowState.outlinePlans.find((plan) => plan.stageId === "characters")!;
  assert.deepEqual(allowedReferenceEntities(bp, characterOutline).map((row) => row.id), [bp.storyBible.id]);
  assert.equal(canReferenceEntity(bp, bp.relationships!, alice), true);
  assert.equal(canReferenceEntity(bp, bp.chapters[0], bp.volumes[0]), true);
  assert.equal(canReferenceEntity(bp, bp.chapters[0], bp.chapters[1]), false);
  assert.equal(canReferenceEntity(bp, bp.chapters[1], bp.chapters[0]), true);
  const branchOwner = { ...bp.chapterCharacterPlans[0], id: "branch-direction", kind: "criticalBranch" as const, content: emptyContent("criticalBranch") };
  assert.equal(canReferenceEntity(bp, branchOwner, bp.chapterCharacterPlans[0]), true);
  assert.equal(canReferenceEntity(bp, branchOwner, bp.chapterCharacterPlans[1]), false);
  assert.equal(canReferenceEntity(bp, bp.initialWorldState!, bp.gameSystems[0]), true);
  assert.equal(canReferenceEntity(bp, bp.gameSystems[0], bp.initialWorldState!), false);
  const wrong = structuredClone(bp);
  wrong.workflowState.outlinePlans.find((plan) => plan.id === characterOutline.id)!.items[0].relatedIds = [bob.id];
  assert.equal(previewImport("blueprint", wrong).valid, false);
  assert.throws(() => applyWorkflowCommand(bp, { type: "updateOutline", outlineId: characterOutline.id, items: characterOutline.items.map((item, index) => index === 0 ? { ...item, relatedIds: [bp.endings[0].id] } : item) }), /前置方向/);
});

test("前置 AI 上下文隔离后置实体、卷章结构和清单，后置 Addition 被拒绝", () => {
  const bp = completedContent();
  bp.storyInput.presetEndings = ["True End 创作意向"];
  const storyContext = getGenerationTarget(bp, bp.storyBible.id).context as { storyInput: Record<string, unknown>; approvedEntities: WorkflowEntity[]; outlineScopes: unknown[] };
  assert.deepEqual(storyContext.approvedEntities, []);
  assert.deepEqual(storyContext.outlineScopes, []);
  assert.equal(Object.hasOwn(storyContext.storyInput, "volumeChapterCounts"), false);
  assert.deepEqual(storyContext.storyInput.presetEndings, ["True End 创作意向"]);
  const characterContext = getGenerationTarget(bp, bp.characters[0].id).context as { approvedEntities: WorkflowEntity[]; outlineScopes: Array<{ stageId: StageId }> };
  assert.deepEqual(characterContext.approvedEntities.map((row) => row.id), [bp.storyBible.id]);
  assert.deepEqual(characterContext.outlineScopes.map((scope) => scope.stageId), ["characters"]);
  const chapterContext = getGenerationTarget(bp, bp.chapters[0].id).context as { approvedEntities: WorkflowEntity[] };
  assert.equal(chapterContext.approvedEntities.some((row) => row.id === bp.chapters[1].id), false);
  const addition = { outlineId: "outline-systems", name: "未来系统", kind: "gameSystem", source: "AI", purpose: "不允许从人物阶段新增后置系统", required: true, enabled: true, relatedIds: [] };
  assert.throws(() => generated(bp, bp.characters[0].id, { content: contentFor(bp, bp.characters[0]), additionSuggestions: [addition] }), /后置阶段/);
  const systemContext = getGenerationTarget(bp, bp.gameSystems[0].id).context as { approvedEntities: WorkflowEntity[] };
  assert.equal(systemContext.approvedEntities.some((row) => row.kind === "initialWorldState"), false);
});

test("Schema v1 迁移保留旧出场意向与正文，修正关联方向并使受影响内容复审", () => {
  const bp = completedContent();
  const legacy = { ...structuredClone(bp), schemaVersion: 1, workflowState: { ...structuredClone(bp.workflowState), outlinePlans: bp.workflowState.outlinePlans.map((plan) => ({ ...structuredClone(plan), items: plan.items.map((item) => ({ ...structuredClone(item), volumeNumbers: plan.stageId === "characters" ? [1] : [] })) })) } };
  const characterOutline = legacy.workflowState.outlinePlans.find((plan) => plan.stageId === "characters")!;
  characterOutline.items[0].relatedIds = [bp.endings[0].id];
  legacy.characters[0].dependencies.push(bp.gameSystems[0].id);
  const originalBytes = JSON.stringify(legacy);
  const migrated = migrateBlueprint(legacy) as Blueprint;
  assert.equal(JSON.stringify(legacy), originalBytes);
  assert.equal(migrated.schemaVersion, 2);
  const nextOutline = migrated.workflowState.outlinePlans.find((plan) => plan.stageId === "characters")!;
  assert.equal(Object.hasOwn(nextOutline.items[0], "volumeNumbers"), false);
  assert.ok(nextOutline.items[0].purpose.includes("旧版出场意向"));
  assert.deepEqual(nextOutline.items[0].relatedIds, []);
  assert.equal(nextOutline.status, "NEEDS_REVIEW");
  assert.ok(nextOutline.reviewReasons.some((reason) => reason.includes("前置方向")));
  assert.equal(migrated.characters[0].status, "NEEDS_REVIEW");
  assert.equal(migrated.characters[0].dependencies.includes(bp.gameSystems[0].id), false);
  assert.equal(migrated.storyBible.status, "APPROVED");
  assert.equal(migrated.workflowState.stageConfirmations.characters, false);
  assert.equal(migrated.workflowState.review.basedOnContentRevision, null);
  assert.deepEqual(migrated.chapters[0].content, bp.chapters[0].content);
  assert.deepEqual(validateBlueprintStructure(migrated), []);
  const preview = previewImport("blueprint", legacy);
  assert.equal(preview.valid, true);
  assert.ok(preview.warnings.some((warning) => warning.includes("Schema v1")));
});

test("Schema v2 拒绝前向依赖及已经退役的出场卷号，不执行静默转换", () => {
  const bp = base();
  const invalid = structuredClone(bp); invalid.storyBible.dependencies = [invalid.chapters[0].id];
  assert.equal(previewImport("blueprint", invalid).valid, false);
  assert.equal((migrateBlueprint(invalid) as Blueprint).storyBible.dependencies[0], invalid.chapters[0].id);
  let prepared = confirm(approve(bp, "story-bible"), "story");
  const legacyAI = { items: [{ name: "Alice", kind: "character", source: "AI", purpose: "用户将稍后确定卷章", required: true, enabled: true, relatedIds: [], volumeNumbers: [1] }] };
  assert.throws(() => generated(prepared, "outline-characters", legacyAI));
  prepared = approvePlan(prepared, "outline-characters", planResult("character"));
  const plan = prepared.workflowState.outlinePlans.find((row) => row.id === "outline-characters")!;
  assert.throws(() => applyWorkflowCommand(prepared, { type: "updateOutline", outlineId: plan.id, items: plan.items.map((item) => ({ ...item, volumeNumbers: [] })) }));
});

test("基础输入虚拟目标可保存选择与填充任务，取消保留 Story Bible 审批状态", () => {
  const bp = completedCharacters();
  const selected = applyWorkflowCommand(bp, { type: "select", stageId: "story", objectId: "story-input" });
  assert.equal(selected.workflowState.selectedObjectId, "story-input");
  assert.throws(() => applyWorkflowCommand(bp, { type: "select", stageId: "characters", objectId: "story-input" }), /阶段/);
  selected.workflowState.activeGeneration = { targetId: "story-input", token: "fill-story-token", startedAt: new Date().toISOString(), previousStatus: selected.storyBible.status };
  assert.deepEqual(validateBlueprintStructure(selected), []);
  const cancelled = failGeneration(selected, "基础输入填充已取消");
  assert.equal(cancelled.workflowState.activeGeneration, null);
  assert.equal(cancelled.storyBible.status, bp.storyBible.status);
  assert.deepEqual(cancelled.storyBible.content, bp.storyBible.content);
  assert.equal(previewImport("blueprint", cancelled).valid, true);
});

test("实体名称同步到规范清单，后续只改定位并确认不会回滚已采用名称", () => {
  let bp = completedCharacters();
  const alice = bp.characters[0];
  const initialPlan = bp.workflowState.outlinePlans.find((plan) => plan.stageId === "characters")!;
  const originalItem = structuredClone(initialPlan.items.find((item) => item.id === alice.id)!);
  bp = applyWorkflowCommand(bp, { type: "updateEntity", entityId: alice.id, name: "Eve", content: alice.content });
  const plan = bp.workflowState.outlinePlans.find((row) => row.stageId === "characters")!;
  const item = plan.items.find((row) => row.id === alice.id)!;
  assert.equal(bp.characters[0].name, "Eve");
  assert.equal(item.name, "Eve");
  assert.equal(plan.status, "APPROVED");
  assert.equal(item.source, originalItem.source);
  assert.equal(item.userModified, originalItem.userModified);
  bp = applyWorkflowCommand(bp, { type: "updateOutline", outlineId: plan.id, items: plan.items.map((row) => row.id === alice.id ? { ...row, purpose: "调整调查定位" } : row) });
  bp = applyWorkflowCommand(bp, { type: "approveOutline", outlineId: plan.id });
  assert.equal(bp.characters[0].name, "Eve");
  assert.equal(bp.workflowState.outlinePlans.find((row) => row.id === plan.id)!.items.find((row) => row.id === alice.id)!.name, "Eve");
});
