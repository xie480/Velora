import { z } from "zod";
import {
  BLUEPRINT_SCHEMA_VERSION, allEntities, blueprintSchema, contentReferenceIds, contentSchemas,
  emptyContent, entityApprovalErrors, entityFields, outlineItemSchema, reviewIssueSchema, stageIds, storyInputFields,
  storyInputSchema, validateBlueprintStructure, workflowCommandSchema,
} from "./workflow.js";
import type {
  Blueprint, Content, EntityKind, OutlineItem, OutlinePlan, ReviewIssue,
  StageId, StageStatus, WorkflowCommand, WorkflowEntity,
} from "./workflow.js";

export class WorkflowError extends Error { constructor(message: string) { super(message); this.name = "WorkflowError"; } }

const entityStages: Record<EntityKind, StageId> = {
  storyBible: "story", character: "characters", relationships: "characters", ending: "endings",
  volume: "chapters", chapter: "chapters", chapterCharacterPlan: "branches", criticalBranch: "branches",
  gameSystem: "systems", initialWorldState: "systems",
};
const plannedKinds: Partial<Record<StageId, EntityKind>> = {
  characters: "character", endings: "ending", branches: "criticalBranch", systems: "gameSystem",
};
const now = (): string => new Date().toISOString();
const newId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;
const stageIndex = (stage: StageId): number => stageIds.indexOf(stage);
const copy = (blueprint: Blueprint): Blueprint => structuredClone(blueprint);

function entity(kind: EntityKind, id: string, name: string, parentId: string | null = null): WorkflowEntity {
  return { id, kind, name, parentId, content: emptyContent(kind) as WorkflowEntity["content"], status: "DRAFT", source: "AI", userModified: false, revision: 0, dependencies: [], reviewReasons: [] };
}
function outline(stageId: StageId, parentId: string | null = null): OutlinePlan {
  const names: Partial<Record<StageId, string>> = { characters: "人物规划", endings: "结局规划", branches: "关键分支规划", systems: "SLG 系统规划" };
  return { id: parentId ? `outline-branches-${parentId}` : `outline-${stageId}`, stageId, parentId, type: "AI_PLANNED", name: names[stageId] ?? stageId, status: "DRAFT", revision: 0, userModified: false, reviewReasons: [], items: [], dependencies: [] };
}
export function createBlueprint(title = "未命名 Blueprint"): Blueprint {
  const timestamp = now();
  return blueprintSchema.parse({
    schemaVersion: BLUEPRINT_SCHEMA_VERSION, blueprintVersion: 0,
    metadata: { id: newId("blueprint"), title, createdAt: timestamp, updatedAt: timestamp, parentVersion: null, description: "", userNote: "" },
    storyInput: storyInputSchema.parse({}),
    workflowState: { currentStage: "story", selectedObjectId: "story-bible", contentRevision: 0, stageConfirmations: Object.fromEntries(stageIds.map((id) => [id, false])), outlinePlans: [outline("characters"), outline("endings"), outline("systems")], review: { status: "DRAFT", basedOnContentRevision: null, issues: [], reviewedAt: null }, activeGeneration: null },
    storyBible: entity("storyBible", "story-bible", "Story Bible"), characters: [], relationships: null, endings: [], volumes: [], chapters: [], chapterCharacterPlans: [], criticalBranches: [], gameSystems: [], initialWorldState: null,
  });
}
export const getAllEntities = allEntities;
export function getStageEntities(blueprint: Blueprint, stage: StageId): WorkflowEntity[] {
  return allEntities(blueprint).filter((row) => entityStages[row.kind] === stage);
}
function findEntity(blueprint: Blueprint, id: string): WorkflowEntity {
  const row = allEntities(blueprint).find((item) => item.id === id);
  if (!row) throw new WorkflowError("审核对象不存在");
  return row;
}
function findOutline(blueprint: Blueprint, id: string): OutlinePlan {
  const plan = blueprint.workflowState.outlinePlans.find((item) => item.id === id);
  if (!plan) throw new WorkflowError("规划清单不存在");
  return plan;
}
function outlineForEntity(blueprint: Blueprint, row: WorkflowEntity): OutlinePlan | undefined {
  return blueprint.workflowState.outlinePlans.find((plan) => plan.items.some((item) => item.id === row.id));
}
function requiredEntity(blueprint: Blueprint, row: WorkflowEntity): boolean {
  const plan = outlineForEntity(blueprint, row);
  return !plan || plan.items.some((item) => item.id === row.id && item.enabled && item.required);
}
function enabledEntity(blueprint: Blueprint, row: WorkflowEntity): boolean {
  const plan = outlineForEntity(blueprint, row);
  return !plan || plan.items.some((item) => item.id === row.id && item.enabled);
}
function requirePrecedingStages(blueprint: Blueprint, stage: StageId): void {
  if (stageIds.slice(0, stageIndex(stage)).some((id) => !blueprint.workflowState.stageConfirmations[id] || !stageComplete(blueprint, id))) throw new WorkflowError("请先确认所有前置阶段");
}
function requireEditable(blueprint: Blueprint): void {
  if (blueprint.workflowState.activeGeneration) throw new WorkflowError("当前存在正在生成的对象，请等待或取消后编辑");
}
function invalidateReview(blueprint: Blueprint): void {
  const review = blueprint.workflowState.review;
  if (review.status !== "DRAFT") review.status = "NEEDS_REVIEW";
  review.basedOnContentRevision = null;
  blueprint.workflowState.stageConfirmations.review = false;
}
function touch(blueprint: Blueprint, stage: StageId): void {
  blueprint.metadata.updatedAt = now();
  blueprint.workflowState.contentRevision += 1;
  for (const id of stageIds.slice(stageIndex(stage))) blueprint.workflowState.stageConfirmations[id] = false;
  invalidateReview(blueprint);
}
function refreshDependencies(blueprint: Blueprint): void {
  const rows = allEntities(blueprint);
  for (const row of rows) {
    const index = stageIndex(entityStages[row.kind]);
    const prior = rows.filter((candidate) => stageIndex(entityStages[candidate.kind]) < index).map((candidate) => candidate.id);
    const local: string[] = [];
    if (row.kind === "relationships") local.push(...blueprint.characters.map((item) => item.id));
    if (row.kind === "chapter") {
      local.push(...blueprint.volumes.map((item) => item.id));
      local.push(...blueprint.chapters.slice(0, blueprint.chapters.indexOf(row)).map((item) => item.id));
    }
    if (row.kind === "criticalBranch") local.push(...blueprint.chapterCharacterPlans.filter((item) => item.parentId === row.parentId).map((item) => item.id));
    if (row.kind === "initialWorldState") local.push(...blueprint.gameSystems.map((item) => item.id));
    row.dependencies = [...new Set([...prior, ...local, ...(row.parentId ? [row.parentId] : []), ...contentReferenceIds(row)])].filter((id) => id !== row.id);
  }
  for (const plan of blueprint.workflowState.outlinePlans) {
    const prior = rows.filter((row) => stageIndex(entityStages[row.kind]) < stageIndex(plan.stageId)).map((row) => row.id);
    const chapterPlan = plan.parentId ? blueprint.chapterCharacterPlans.find((row) => row.parentId === plan.parentId)?.id : null;
    plan.dependencies = [...new Set([...prior, ...(plan.parentId ? [plan.parentId] : []), ...(chapterPlan ? [chapterPlan] : []), ...plan.items.flatMap((item) => item.relatedIds)])];
  }
}
/** Keep authored content intact; mark the transitive dependency closure for explicit reapproval. */
function propagateReview(blueprint: Blueprint, changedIds: string[], reason: string): void {
  refreshDependencies(blueprint);
  const affected = new Set(changedIds);
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const row of allEntities(blueprint)) {
      if (affected.has(row.id) || !row.dependencies.some((id) => affected.has(id))) continue;
      affected.add(row.id); progressed = true;
    }
  }
  for (const row of allEntities(blueprint)) {
    if (!affected.has(row.id) || changedIds.includes(row.id) || row.status === "DRAFT") continue;
    row.status = "NEEDS_REVIEW";
    row.reviewReasons = [...new Set([...row.reviewReasons, reason])];
  }
  for (const plan of blueprint.workflowState.outlinePlans) {
    if (plan.status === "DRAFT" || !plan.dependencies.some((id) => affected.has(id))) continue;
    plan.status = "NEEDS_REVIEW";
    plan.reviewReasons = [...new Set([...plan.reviewReasons, reason])];
  }
}
function requiredContentErrors(blueprint: Blueprint, row: WorkflowEntity): string[] {
  const errors = entityApprovalErrors(blueprint, row);
  const all = new Map(allEntities(blueprint).map((item) => [item.id, item]));
  for (const id of contentReferenceIds(row)) {
    const referenced = all.get(id);
    if (referenced && referenced.status !== "APPROVED") errors.push(`引用尚未审批：${referenced.name}`);
  }
  if (row.kind === "initialWorldState") {
    const locations = blueprint.storyBible.content.locations as string[];
    if (!locations.includes(String(row.content.initialLocation))) errors.push("初始地点不在已审批世界地点中");
    if ((row.content.accessibleLocations as string[]).some((location) => !locations.includes(location))) errors.push("初始可访问地点不在已审批世界地点中");
    if (Object.values(row.content.characterLocations as Record<string, string>).some((location) => !locations.includes(location))) errors.push("人物初始所在地不在已审批世界地点中");
  }
  return [...new Set(errors)];
}
function configureStructure(blueprint: Blueprint, counts: number[]): void {
  storyInputSchema.parse({ ...blueprint.storyInput, volumeChapterCounts: counts });
  const previousCounts = blueprint.storyInput.volumeChapterCounts;
  const desired = new Map<string, number>();
  counts.forEach((count, index) => desired.set(blueprint.volumes[index]?.id ?? `volume-${index + 1}`, count));
  const removedVolumes = blueprint.volumes.slice(counts.length);
  const removedChapters = blueprint.chapters.filter((chapter) => !desired.has(chapter.parentId ?? "") || Number(chapter.content.chapterNumber) > (desired.get(chapter.parentId ?? "") ?? 0));
  const removedIds = new Set([...removedVolumes, ...removedChapters].map((row) => row.id));
  const related = allEntities(blueprint).filter((row) => removedIds.has(row.id) || (row.parentId && removedIds.has(row.parentId)));
  if (related.some((row) => row.status !== "DRAFT" || row.revision > 0)) throw new WorkflowError("缩减卷章会移除已有创作内容，请先保留版本；当前仅允许移除未生成的空白结构");
  blueprint.volumes = counts.map((_, index) => {
    const row = blueprint.volumes[index] ?? entity("volume", `volume-${index + 1}`, `第 ${index + 1} 卷`);
    if (previousCounts[index] !== counts[index] && row.status !== "DRAFT") { row.status = "NEEDS_REVIEW"; row.reviewReasons = [...new Set([...row.reviewReasons, "本卷章节数量已修改"])]; }
    row.content.volumeNumber = index + 1; return row;
  });
  const oldChapters = blueprint.chapters;
  blueprint.chapters = blueprint.volumes.flatMap((volume, volumeIndex) => Array.from({ length: counts[volumeIndex] }, (_, chapterIndex) => {
    const row = oldChapters.find((chapter) => chapter.parentId === volume.id && Number(chapter.content.chapterNumber) === chapterIndex + 1) ?? entity("chapter", `chapter-${volumeIndex + 1}-${chapterIndex + 1}`, `第 ${volumeIndex + 1} 卷 · Chapter ${chapterIndex + 1}`, volume.id);
    row.content.chapterNumber = chapterIndex + 1; return row;
  }));
  const chapterIds = new Set(blueprint.chapters.map((row) => row.id));
  const oldPlans = blueprint.chapterCharacterPlans;
  blueprint.chapterCharacterPlans = blueprint.chapters.map((chapter) => oldPlans.find((row) => row.parentId === chapter.id) ?? entity("chapterCharacterPlan", `plan-${chapter.id}`, `${chapter.name} · 人物变化`, chapter.id));
  blueprint.criticalBranches = blueprint.criticalBranches.filter((row) => chapterIds.has(row.parentId ?? ""));
  blueprint.workflowState.outlinePlans = blueprint.workflowState.outlinePlans.filter((plan) => plan.stageId !== "branches" || chapterIds.has(plan.parentId ?? ""));
  for (const chapter of blueprint.chapters) if (!blueprint.workflowState.outlinePlans.some((plan) => plan.stageId === "branches" && plan.parentId === chapter.id)) blueprint.workflowState.outlinePlans.push(outline("branches", chapter.id));
  blueprint.storyInput.volumeChapterCounts = counts;
  for (const plan of blueprint.workflowState.outlinePlans) if (plan.status !== "DRAFT" && plan.items.some((item) => item.volumeNumbers.some((number) => number > counts.length))) {
    plan.status = "NEEDS_REVIEW"; plan.reviewReasons = [...new Set([...plan.reviewReasons, "规划中的预计卷号超出新的卷数，请核对清单"])];
    for (const stage of stageIds.slice(stageIndex(plan.stageId))) blueprint.workflowState.stageConfirmations[stage] = false;
  }
  if (blueprint.workflowState.selectedObjectId && !allEntities(blueprint).some((row) => row.id === blueprint.workflowState.selectedObjectId) && !blueprint.workflowState.outlinePlans.some((row) => row.id === blueprint.workflowState.selectedObjectId)) blueprint.workflowState.selectedObjectId = null;
  refreshDependencies(blueprint);
}

function stageSequence(blueprint: Blueprint, stage: StageId): Array<WorkflowEntity | OutlinePlan> {
  const plans = blueprint.workflowState.outlinePlans.filter((plan) => plan.stageId === stage);
  const enabled = (rows: WorkflowEntity[]): WorkflowEntity[] => plans.flatMap((plan) => plan.items.filter((item) => item.enabled).flatMap((item) => rows.filter((row) => row.id === item.id)));
  if (stage === "characters") return [...plans, ...enabled(blueprint.characters), ...(blueprint.relationships ? [blueprint.relationships] : [])];
  if (stage === "endings") return [...plans, ...enabled(blueprint.endings)];
  if (stage === "chapters") return [...blueprint.volumes, ...blueprint.chapters];
  if (stage === "branches") return blueprint.chapters.flatMap((chapter) => [
    ...blueprint.chapterCharacterPlans.filter((row) => row.parentId === chapter.id),
    ...plans.filter((plan) => plan.parentId === chapter.id),
    ...enabled(blueprint.criticalBranches.filter((row) => row.parentId === chapter.id)),
  ]);
  if (stage === "systems") return [...plans, ...enabled(blueprint.gameSystems), ...(blueprint.initialWorldState ? [blueprint.initialWorldState] : [])];
  return getStageEntities(blueprint, stage);
}
function isOutline(row: WorkflowEntity | OutlinePlan): row is OutlinePlan { return "items" in row; }
function sequenceRequired(blueprint: Blueprint, row: WorkflowEntity | OutlinePlan): boolean { return isOutline(row) || requiredEntity(blueprint, row); }
function stageComplete(blueprint: Blueprint, stage: StageId): boolean {
  if (stage === "review") return blueprint.workflowState.review.status === "APPROVED" && blueprint.workflowState.review.basedOnContentRevision === blueprint.workflowState.contentRevision && !blueprint.workflowState.review.issues.some((issue) => issue.severity === "ERROR");
  if (stage === "chapters" && (!blueprint.volumes.length || !blueprint.chapters.length)) return false;
  if (stage === "characters" && !blueprint.relationships) return false;
  if (stage === "systems" && !blueprint.initialWorldState) return false;
  const requiredItems = blueprint.workflowState.outlinePlans.filter((plan) => plan.stageId === stage).flatMap((plan) => plan.items.filter((item) => item.enabled && item.required).map((item) => ({ item, plan })));
  if (requiredItems.some(({ item, plan }) => !allEntities(blueprint).some((row) => row.id === item.id && row.kind === item.kind && row.parentId === plan.parentId && row.status === "APPROVED"))) return false;
  const sequence = stageSequence(blueprint, stage);
  return sequence.length > 0 && sequence.filter((row) => sequenceRequired(blueprint, row)).every((row) => row.status === "APPROVED");
}
export function getStageStatus(blueprint: Blueprint, stage: StageId): StageStatus {
  if (blueprint.workflowState.stageConfirmations[stage] && stageComplete(blueprint, stage)) return "CONFIRMED";
  const sequence = stageSequence(blueprint, stage);
  if (sequence.some((row) => row.status === "NEEDS_REVIEW") || (stage === "review" && blueprint.workflowState.review.status === "NEEDS_REVIEW")) return "NEEDS_REVIEW";
  if (stageComplete(blueprint, stage)) return "READY_TO_CONFIRM";
  if (stage === "review") return blueprint.workflowState.review.status === "DRAFT" ? "NOT_STARTED" : "IN_PROGRESS";
  if (sequence.some((row) => isOutline(row) && row.status === "GENERATING")) return "PLANNING";
  if (sequence.some((row) => isOutline(row) && row.status === "PENDING_REVIEW")) return "OUTLINE_REVIEW";
  return sequence.some((row) => row.status !== "DRAFT") ? "IN_PROGRESS" : "NOT_STARTED";
}
function validateOutline(blueprint: Blueprint, plan: OutlinePlan): void {
  if (plan.items.some((item) => item.kind !== plannedKinds[plan.stageId])) throw new WorkflowError("清单只能包含本阶段对应类型");
  if (plan.stageId !== "branches" && !plan.items.some((item) => item.enabled && item.required)) throw new WorkflowError("本阶段至少需要一个启用的必需项目");
  if (plan.items.some((item) => !item.purpose.trim())) throw new WorkflowError("每个规划项目必须说明存在目的");
  const ids = new Set(allEntities(blueprint).map((row) => row.id));
  if (plan.items.some((item) => item.relatedIds.some((id) => !ids.has(id)))) throw new WorkflowError("规划项目包含不存在的引用");
  if (blueprint.storyInput.volumeChapterCounts.length && plan.items.some((item) => item.volumeNumbers.some((number) => number > blueprint.storyInput.volumeChapterCounts.length))) throw new WorkflowError("规划项目引用了未配置的卷");
}
function validateAdditionItem(blueprint: Blueprint, outlineId: string, item: OutlineItem): OutlinePlan {
  const plan = findOutline(blueprint, outlineId);
  if (item.kind !== plannedKinds[plan.stageId] || item.source !== "AI") throw new WorkflowError("新增建议必须符合指定清单类型及 AI 来源");
  if (!item.purpose.trim()) throw new WorkflowError("新增建议必须说明目的");
  if (item.relatedIds.some((id) => !allEntities(blueprint).some((row) => row.id === id && row.status === "APPROVED"))) throw new WorkflowError("新增建议只能引用已审批的现有内容");
  if (blueprint.storyInput.volumeChapterCounts.length && item.volumeNumbers.some((number) => number > blueprint.storyInput.volumeChapterCounts.length)) throw new WorkflowError("新增建议引用了不存在的卷");
  return plan;
}
function markOutlineContentsForReview(blueprint: Blueprint, plan: OutlinePlan, reason: string): void {
  const ids = plan.items.map((item) => item.id);
  for (const row of allEntities(blueprint).filter((row) => ids.includes(row.id) && row.status !== "DRAFT")) { row.status = "NEEDS_REVIEW"; row.reviewReasons = [...new Set([...row.reviewReasons, reason])]; }
  propagateReview(blueprint, ids, reason);
}
function addOutlineEntities(blueprint: Blueprint, plan: OutlinePlan): void {
  const containers: Partial<Record<EntityKind, WorkflowEntity[]>> = { character: blueprint.characters, ending: blueprint.endings, criticalBranch: blueprint.criticalBranches, gameSystem: blueprint.gameSystems };
  for (const item of plan.items.filter((row) => row.enabled)) {
    const container = containers[item.kind];
    if (!container) throw new WorkflowError("清单实体类型无效");
    let row = container.find((candidate) => candidate.id === item.id);
    if (!row) { row = entity(item.kind, item.id, item.name, plan.parentId); row.source = item.source; row.userModified = item.userModified; container.push(row); }
    else if (row.name !== item.name) { row.name = item.name; if (row.status !== "DRAFT") row.status = "NEEDS_REVIEW"; }
  }
  if (plan.stageId === "characters" && !blueprint.relationships) blueprint.relationships = entity("relationships", "relationships", "Character Relationship Overview");
  if (plan.stageId === "systems" && !blueprint.initialWorldState) blueprint.initialWorldState = entity("initialWorldState", "initial-world-state", "Initial World State");
  refreshDependencies(blueprint);
}
function assertApprovalOrder(blueprint: Blueprint, targetId: string, stage: StageId): void {
  requirePrecedingStages(blueprint, stage);
  const targetPlan = blueprint.workflowState.outlinePlans.find((plan) => plan.items.some((item) => item.id === targetId));
  if (targetPlan) {
    const targetIndex = targetPlan.items.findIndex((item) => item.id === targetId);
    if (targetPlan.items.slice(0, targetIndex).some((item) => item.enabled && item.required && !allEntities(blueprint).some((row) => row.id === item.id && row.status === "APPROVED"))) throw new WorkflowError("请先审批之前的必需项目");
  }
  const sequence = stageSequence(blueprint, stage);
  const index = sequence.findIndex((row) => row.id === targetId);
  if (index < 0) throw new WorkflowError("对象不在已启用的生成清单中");
  if (sequence.slice(0, index).some((row) => sequenceRequired(blueprint, row) && row.status !== "APPROVED")) throw new WorkflowError("请先审批之前的必需项目");
}
export function applyWorkflowCommand(input: Blueprint, commandInput: WorkflowCommand): Blueprint {
  const command = workflowCommandSchema.parse(commandInput);
  const blueprint = copy(input);
  if (command.type === "select") {
    if (command.objectId && command.objectId !== "blueprint-review" && !allEntities(blueprint).some((row) => row.id === command.objectId && entityStages[row.kind] === command.stageId) && !blueprint.workflowState.outlinePlans.some((row) => row.id === command.objectId && row.stageId === command.stageId)) throw new WorkflowError("所选对象与阶段不匹配");
    blueprint.workflowState.currentStage = command.stageId; blueprint.workflowState.selectedObjectId = command.objectId; return blueprint;
  }
  requireEditable(blueprint);
  if (command.type === "updateStoryInput") {
    const changedCounts = JSON.stringify(blueprint.storyInput.volumeChapterCounts) !== JSON.stringify(command.input.volumeChapterCounts);
    if (changedCounts && command.input.volumeChapterCounts.length) configureStructure(blueprint, command.input.volumeChapterCounts);
    if (changedCounts && !command.input.volumeChapterCounts.length && blueprint.volumes.length) throw new WorkflowError("已有卷章结构，不能清空卷数；请使用卷章配置调整");
    blueprint.storyInput = command.input; blueprint.metadata.title = String(command.input.name || "未命名 Blueprint");
    if (blueprint.storyBible.status !== "DRAFT") blueprint.storyBible.status = "NEEDS_REVIEW";
    propagateReview(blueprint, [blueprint.storyBible.id], "基础故事输入已修改"); touch(blueprint, "story");
  } else if (command.type === "configureChapters") {
    configureStructure(blueprint, command.counts); propagateReview(blueprint, blueprint.volumes.map((row) => row.id), "卷章结构已修改"); touch(blueprint, "chapters");
  } else if (command.type === "updateOutline") {
    const plan = findOutline(blueprint, command.outlineId);
    const oldIds = new Set(plan.items.map((item) => item.id));
    const reserved = new Set([...allEntities(blueprint).map((row) => row.id), ...blueprint.workflowState.outlinePlans.map((row) => row.id), "blueprint-review"]);
    const newIds = new Set<string>();
    for (const item of command.items) {
      if ((reserved.has(item.id) && !oldIds.has(item.id)) || newIds.has(item.id)) throw new WorkflowError("项目 ID 重复或已由其他对象占用");
      if (item.kind !== plannedKinds[plan.stageId]) throw new WorkflowError("不能向清单添加其他阶段的实体类型");
      newIds.add(item.id);
    }
    // Previously authored entities stay in the document even when disabled by the user.
    const retained = plan.items.filter((item) => !newIds.has(item.id) && allEntities(blueprint).some((row) => row.id === item.id && (row.revision > 0 || row.status !== "DRAFT"))).map((item) => ({ ...item, enabled: false, required: false, userModified: true }));
    const removableIds = new Set(plan.items.filter((item) => !newIds.has(item.id) && !retained.some((row) => row.id === item.id)).map((item) => item.id));
    if (allEntities(blueprint).some((row) => !removableIds.has(row.id) && contentReferenceIds(row).some((id) => removableIds.has(id)))) throw new WorkflowError("清单项目仍被其他内容引用，不能移除；请先处理引用");
    blueprint.characters = blueprint.characters.filter((row) => !removableIds.has(row.id)); blueprint.endings = blueprint.endings.filter((row) => !removableIds.has(row.id)); blueprint.criticalBranches = blueprint.criticalBranches.filter((row) => !removableIds.has(row.id)); blueprint.gameSystems = blueprint.gameSystems.filter((row) => !removableIds.has(row.id));
    plan.items = [...command.items.map((item) => ({ ...item, userModified: true })), ...retained]; plan.status = "PENDING_REVIEW"; plan.userModified = true; plan.revision += 1;
    for (const row of allEntities(blueprint).filter((row) => oldIds.has(row.id) && row.status !== "DRAFT")) { row.status = "NEEDS_REVIEW"; row.reviewReasons = [...new Set([...row.reviewReasons, "生成清单已修改"])]; }
    propagateReview(blueprint, plan.items.map((item) => item.id), "生成清单已修改"); touch(blueprint, plan.stageId);
    if (removableIds.has(blueprint.workflowState.selectedObjectId ?? "")) blueprint.workflowState.selectedObjectId = plan.id;
  } else if (command.type === "approveOutline") {
    const plan = findOutline(blueprint, command.outlineId); assertApprovalOrder(blueprint, plan.id, plan.stageId);
    if (!["PENDING_REVIEW", "NEEDS_REVIEW"].includes(plan.status)) throw new WorkflowError("请先生成或编辑清单");
    validateOutline(blueprint, plan); plan.status = "APPROVED"; plan.reviewReasons = []; addOutlineEntities(blueprint, plan); touch(blueprint, plan.stageId);
  } else if (command.type === "approveAddition" || command.type === "rejectAddition") {
    const suggestion = blueprint.workflowState.additionSuggestions.find((row) => row.id === command.suggestionId);
    if (!suggestion || suggestion.status !== "PENDING_REVIEW") throw new WorkflowError("新增建议不存在或已处理");
    if (command.type === "rejectAddition") { suggestion.status = "REJECTED"; blueprint.metadata.updatedAt = now(); }
    else {
      const plan = validateAdditionItem(blueprint, suggestion.outlineId, suggestion.item);
      if (plan.items.length >= 100) throw new WorkflowError("本清单已达到 100 项上限");
      plan.items.push(suggestion.item); plan.status = "PENDING_REVIEW"; plan.userModified = true; plan.revision += 1;
      suggestion.status = "APPROVED";
      markOutlineContentsForReview(blueprint, plan, "用户批准了新增建议，生成清单已修改");
      plan.status = "PENDING_REVIEW";
      touch(blueprint, plan.stageId);
    }
  } else if (command.type === "updateEntity") {
    const row = findEntity(blueprint, command.entityId);
    const content = contentSchemas[row.kind].parse(command.content) as Content;
    if (row.kind === "volume" && content.volumeNumber !== row.content.volumeNumber) throw new WorkflowError("卷序号由固定结构决定");
    if (row.kind === "chapter" && content.chapterNumber !== row.content.chapterNumber) throw new WorkflowError("章序号由固定结构决定");
    row.content = content as WorkflowEntity["content"]; row.name = command.name; row.userModified = true; row.revision += 1; row.status = "PENDING_REVIEW";
    propagateReview(blueprint, [row.id], `${row.name} 已修改`); touch(blueprint, entityStages[row.kind]);
  } else if (command.type === "approveEntity") {
    const row = findEntity(blueprint, command.entityId); assertApprovalOrder(blueprint, row.id, entityStages[row.kind]);
    if (!["PENDING_REVIEW", "NEEDS_REVIEW"].includes(row.status)) throw new WorkflowError("此对象尚未进入待审核状态");
    if (outlineForEntity(blueprint, row)?.status !== undefined && outlineForEntity(blueprint, row)?.status !== "APPROVED") throw new WorkflowError("请先确认生成清单");
    const errors = requiredContentErrors(blueprint, row); if (errors.length) throw new WorkflowError(errors.join("；"));
    row.status = "APPROVED"; row.reviewReasons = []; touch(blueprint, entityStages[row.kind]);
  } else if (command.type === "rejectEntity") {
    const row = findEntity(blueprint, command.entityId); row.status = "REJECTED"; row.reviewReasons = [command.reason]; propagateReview(blueprint, [row.id], `${row.name} 已拒绝`); touch(blueprint, entityStages[row.kind]);
  } else if (command.type === "confirmStage") {
    requirePrecedingStages(blueprint, command.stageId);
    if (!stageComplete(blueprint, command.stageId)) throw new WorkflowError("所有必需内容与清单审批完成后才能确认阶段");
    blueprint.workflowState.stageConfirmations[command.stageId] = true;
    const next = stageIds[stageIndex(command.stageId) + 1]; if (next) { blueprint.workflowState.currentStage = next; blueprint.workflowState.selectedObjectId = stageSequence(blueprint, next)[0]?.id ?? (next === "review" ? "blueprint-review" : null); }
    blueprint.metadata.updatedAt = now();
  } else if (command.type === "approveReview") {
    requirePrecedingStages(blueprint, "review");
    const review = blueprint.workflowState.review;
    if (review.status !== "PENDING_REVIEW" || review.basedOnContentRevision !== blueprint.workflowState.contentRevision) throw new WorkflowError("检查报告尚未生成或已经过期，请重新检查");
    const errors = [...runBlueprintChecks(blueprint), ...review.issues].filter((issue) => issue.severity === "ERROR");
    if (errors.length) throw new WorkflowError("总体检查仍存在 ERROR，修复并重新检查后才能审批");
    review.status = "APPROVED"; blueprint.metadata.updatedAt = now();
  }
  const structuralErrors = validateBlueprintStructure(blueprint); if (structuralErrors.length) throw new WorkflowError(structuralErrors.join("；"));
  return blueprint;
}

export function assertCanGenerate(blueprint: Blueprint, targetId: string): void {
  requireEditable(blueprint);
  if (targetId === "blueprint-review") { requirePrecedingStages(blueprint, "review"); return; }
  const plan = blueprint.workflowState.outlinePlans.find((row) => row.id === targetId);
  if (plan) {
    assertApprovalOrder(blueprint, plan.id, plan.stageId);
    const generated = allEntities(blueprint).filter((row) => plan.items.some((item) => item.id === row.id));
    if (generated.some((row) => row.revision > 0 || row.status !== "DRAFT")) throw new WorkflowError("已开始详情创作，重新规划可能扩张范围；请手动修改清单或复制版本");
    return;
  }
  const row = findEntity(blueprint, targetId);
  assertApprovalOrder(blueprint, row.id, entityStages[row.kind]);
  const approvedPlan = outlineForEntity(blueprint, row);
  if (approvedPlan && approvedPlan.status !== "APPROVED") throw new WorkflowError("请先审批本阶段生成清单");
  if (row.kind === "storyBible") {
    const missing = storyInputFields.filter((field) => field.required && !String(blueprint.storyInput[field.key] ?? "").trim());
    if (missing.length) throw new WorkflowError(`请填写基础输入：${missing.map((field) => field.label).join("、")}`);
  }
}
export function beginGeneration(input: Blueprint, targetId: string, token: string): Blueprint {
  assertCanGenerate(input, targetId);
  const blueprint = copy(input);
  const plan = blueprint.workflowState.outlinePlans.find((row) => row.id === targetId);
  const row = targetId === "blueprint-review" ? blueprint.workflowState.review : plan ?? findEntity(blueprint, targetId);
  blueprint.workflowState.activeGeneration = { token, targetId, startedAt: now(), previousStatus: row.status };
  blueprint.workflowState.generationError = null;
  row.status = "GENERATING"; blueprint.workflowState.selectedObjectId = targetId; blueprint.metadata.updatedAt = now();
  return blueprint;
}

const generatedOutlineItemSchema = outlineItemSchema.omit({ id: true, userModified: true });
const outlineResultSchema = z.object({ items: z.array(generatedOutlineItemSchema).max(100) }).strict();
const generatedAdditionSchema = z.object({ outlineId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/), ...generatedOutlineItemSchema.extend({ source: z.literal("AI") }).shape }).strict();
const reviewResultSchema = z.object({ issues: z.array(reviewIssueSchema.omit({ id: true })).max(1000) }).strict();
function entityResultSchema(kind: EntityKind): z.ZodType {
  return z.object({ content: contentSchemas[kind], additionSuggestions: z.array(generatedAdditionSchema).max(30).optional() }).strict();
}
export function getGenerationTarget(blueprint: Blueprint, targetId: string): { kind: "outline" | "entity" | "review"; schema: z.ZodType; context: unknown; prompt: string } {
  const sharedContext = { storyInput: blueprint.storyInput, approvedEntities: allEntities(blueprint).filter((row) => row.status === "APPROVED" && enabledEntity(blueprint, row)), outlineScopes: blueprint.workflowState.outlinePlans.map((plan) => ({ id: plan.id, stageId: plan.stageId, parentId: plan.parentId, kind: plannedKinds[plan.stageId], items: plan.items })), constraints: "仅进行游戏开始前的静态创作规划，不生成正文、对白、Runtime、Scene、Agent 或时间 Tick。引用必须使用已批准且启用的实体 ID。未采用的可选草稿和已禁用人物不参与初始世界状态。" };
  if (targetId === "blueprint-review") return { kind: "review", schema: reviewResultSchema, context: { ...sharedContext, checks: runBlueprintChecks(blueprint) }, prompt: "检查故事、人物、结局、关键分支、伏笔和章节一致性。仅返回 issues；ERROR 是阻塞问题，WARNING 是风险，SUGGESTION 是优化建议。不要生成新的主要内容。" };
  const plan = blueprint.workflowState.outlinePlans.find((row) => row.id === targetId);
  if (plan) return { kind: "outline", schema: outlineResultSchema, context: { ...sharedContext, stageId: plan.stageId, parentId: plan.parentId, existingItems: plan.items }, prompt: `只规划 ${plan.name}，项目类型固定为 ${plannedKinds[plan.stageId]}，作用范围固定为当前阶段/章节。每个项目说明目的与引用，用户预设用 USER 来源，建议新增用 AI 来源。不生成详情，不返回 ID 或审批状态。分支可为空以表示本章无必要关键分支。系统可列 enabled=false 的不建议项目。` };
  const row = findEntity(blueprint, targetId);
  return { kind: "entity", schema: entityResultSchema(row.kind), context: { ...sharedContext, target: row, outline: outlineForEntity(blueprint, row), fields: entityFields[row.kind] }, prompt: `只生成 ${row.name} (${row.kind}) 这一个审批单元。返回 content，不改变名称、ID、父级、类型、清单或审批状态。填写所有必需字段，保持用户不可变事实。卷序号/章序号必须保持。关键分支每个选项包含实际效果；人物属性必须遵循其独立定义。如果确实发现需要新增清单项目，只能在可选 additionSuggestions 提出独立建议，outlineId 必须取已有清单作用范围，kind 必须匹配，source 必须 AI。不得返回项目 ID、详情或审批状态，不得直接扩张清单；用户先批准建议、再确认清单后才会创建草稿。` };
}
export function completeGeneration(input: Blueprint, targetId: string, result: unknown, token?: string): Blueprint {
  const active = input.workflowState.activeGeneration;
  if (!active || active.targetId !== targetId || (token !== undefined && active.token !== token)) throw new WorkflowError("生成任务已取消或已过期");
  const blueprint = copy(input);
  const plan = blueprint.workflowState.outlinePlans.find((row) => row.id === targetId);
  if (targetId === "blueprint-review") {
    const generated = reviewResultSchema.parse(result);
    const issues = generated.issues.map((issue) => ({ ...issue, id: newId("issue") }));
    const ids = new Set(allEntities(blueprint).map((row) => row.id));
    if (issues.some((issue) => issue.entityIds.some((id) => !ids.has(id)))) throw new WorkflowError("检查报告引用不存在的实体");
    blueprint.workflowState.review = { status: "PENDING_REVIEW", basedOnContentRevision: blueprint.workflowState.contentRevision, issues: [...runBlueprintChecks(blueprint), ...issues], reviewedAt: now() };
  } else if (plan) {
    const generated = outlineResultSchema.parse(result);
    if (generated.items.some((item) => item.kind !== plannedKinds[plan.stageId])) throw new WorkflowError("AI 规划输出越过了本阶段类型范围");
    const previousIds = new Set(plan.items.map((item) => item.id));
    if (allEntities(blueprint).some((row) => previousIds.has(row.id) && (row.status !== "DRAFT" || row.revision > 0))) throw new WorkflowError("清单详情已有内容，不能用重新规划替换已创作范围");
    if (allEntities(blueprint).some((row) => !previousIds.has(row.id) && contentReferenceIds(row).some((id) => previousIds.has(id)))) throw new WorkflowError("旧清单项目仍被其他内容引用，请先处理引用再重新规划");
    // Regeneration is allowed only before any detail is authored; remove its obsolete blank slots.
    blueprint.characters = blueprint.characters.filter((row) => !previousIds.has(row.id)); blueprint.endings = blueprint.endings.filter((row) => !previousIds.has(row.id)); blueprint.criticalBranches = blueprint.criticalBranches.filter((row) => !previousIds.has(row.id)); blueprint.gameSystems = blueprint.gameSystems.filter((row) => !previousIds.has(row.id));
    plan.items = generated.items.map((item) => ({ ...item, id: newId(item.kind), userModified: false })); plan.revision += 1; plan.status = "PENDING_REVIEW"; plan.userModified = false; plan.reviewReasons = [];
    if (plan.stageId === "characters") {
      for (const name of blueprint.storyInput.presetCharacters as string[]) {
        const preset = plan.items.find((item) => item.name === name);
        if (preset) { preset.source = "USER"; preset.enabled = true; preset.required = true; }
        else plan.items.unshift({ id: newId("character"), name, kind: "character", source: "USER", purpose: "用户预设人物，需保留并完善设定", required: true, enabled: true, relatedIds: [], volumeNumbers: [], userModified: false });
      }
    }
    validateOutline(blueprint, plan); touch(blueprint, plan.stageId);
  } else {
    const row = findEntity(blueprint, targetId);
    const parsed = entityResultSchema(row.kind).parse(result) as { content: Content; additionSuggestions?: z.infer<typeof generatedAdditionSchema>[] };
    if ((row.kind === "volume" && parsed.content.volumeNumber !== row.content.volumeNumber) || (row.kind === "chapter" && parsed.content.chapterNumber !== row.content.chapterNumber)) throw new WorkflowError("AI 输出不得改变固定卷章结构");
    row.content = parsed.content as WorkflowEntity["content"]; row.revision += 1; row.status = "PENDING_REVIEW"; row.reviewReasons = [];
    const contentErrors = requiredContentErrors(blueprint, row); if (contentErrors.length) throw new WorkflowError(`AI 生成内容不完整：${contentErrors.join("；")}`);
    if (blueprint.workflowState.additionSuggestions.length + (parsed.additionSuggestions?.length ?? 0) > 1000) throw new WorkflowError("新增建议已达到 1000 项上限，请先整理项目");
    for (const addition of parsed.additionSuggestions ?? []) {
      const { outlineId, ...itemData } = addition;
      const item: OutlineItem = { ...itemData, id: newId(itemData.kind), userModified: false };
      validateAdditionItem(blueprint, outlineId, item);
      blueprint.workflowState.additionSuggestions.push({ id: newId("suggestion"), outlineId, item, status: "PENDING_REVIEW" });
    }
    propagateReview(blueprint, [row.id], `${row.name} 已重新生成`); touch(blueprint, entityStages[row.kind]);
  }
  blueprint.workflowState.activeGeneration = null; refreshDependencies(blueprint); blueprint.metadata.updatedAt = now();
  blueprint.workflowState.generationError = null;
  const errors = validateBlueprintStructure(blueprint); if (errors.length) throw new WorkflowError(errors.join("；"));
  return blueprint;
}
export function failGeneration(input: Blueprint, reason = "生成失败，请重试"): Blueprint {
  const blueprint = copy(input);
  const active = blueprint.workflowState.activeGeneration; if (!active) return blueprint;
  const plan = blueprint.workflowState.outlinePlans.find((row) => row.id === active.targetId);
  const target = active.targetId === "blueprint-review" ? blueprint.workflowState.review : plan ?? findEntity(blueprint, active.targetId);
  target.status = active.previousStatus;
  if ("reviewReasons" in target) target.reviewReasons = [...new Set([...target.reviewReasons, reason])];
  blueprint.workflowState.generationError = reason;
  blueprint.workflowState.activeGeneration = null; blueprint.metadata.updatedAt = now(); return blueprint;
}
export function cancelGeneration(input: Blueprint): Blueprint {
  return failGeneration(input, "生成已取消，原有内容已保留。");
}

export function runBlueprintChecks(blueprint: Blueprint): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const add = (severity: ReviewIssue["severity"], category: ReviewIssue["category"], message: string, entityIds: string[] = [], suggestion = ""): void => { issues.push({ id: `check-${issues.length + 1}`, severity, category, message, entityIds, suggestion }); };
  for (const error of validateBlueprintStructure(blueprint)) add("ERROR", "Workflow", error);
  for (const stage of stageIds.filter((id) => id !== "review")) if (!blueprint.workflowState.stageConfirmations[stage] || !stageComplete(blueprint, stage)) add("ERROR", "Workflow", `${stage} 阶段尚未完成确认`);
  for (const row of allEntities(blueprint).filter((item) => requiredEntity(blueprint, item))) {
    if (row.status !== "APPROVED") add("ERROR", "Workflow", `${row.name} 尚未审批`, [row.id]);
    for (const error of requiredContentErrors(blueprint, row)) add("ERROR", "Workflow", `${row.name}: ${error}`, [row.id]);
  }
  if (!blueprint.characters.filter((row) => enabledEntity(blueprint, row)).length) add("ERROR", "Characters", "人物清单为空");
  if (!blueprint.endings.filter((row) => enabledEntity(blueprint, row)).length) add("ERROR", "Ending", "结局清单为空");
  if (blueprint.volumes.length !== blueprint.storyInput.volumeChapterCounts.length || blueprint.volumes.some((volume, index) => blueprint.chapters.filter((row) => row.parentId === volume.id).length !== blueprint.storyInput.volumeChapterCounts[index])) add("ERROR", "Chapter", "实际卷章数量与用户指定结构不一致");
  for (const ending of blueprint.endings.filter((row) => requiredEntity(blueprint, row))) {
    const chapters = blueprint.chapters.filter((row) => ((row.content.endingIds ?? []) as string[]).includes(ending.id));
    if (!chapters.length) add("ERROR", "Ending", `${ending.name} 没有关联章节`, [ending.id], "将该结局对应的路线、事件和铺垫落实到章节");
    else if (!chapters.some((chapter) => ((chapter.content.routes ?? []) as string[]).some((route) => ((ending.content.routes ?? []) as string[]).includes(route)))) add("ERROR", "Ending", `${ending.name} 的路线没有被章节推进`, [ending.id, ...chapters.map((row) => row.id)]);
  }
  for (const branch of blueprint.criticalBranches.filter((row) => requiredEntity(blueprint, row))) {
    const choices = (branch.content.choices ?? []) as Array<{ futureChapterEffects: string[]; opensRoutes: string[]; closesRoutes: string[]; endingIds: string[] }>;
    if (!choices.some((choice) => choice.futureChapterEffects.length || choice.opensRoutes.length || choice.closesRoutes.length || choice.endingIds.length)) add("ERROR", "Branch", `${branch.name} 未描述后续章节、路线或结局影响`, [branch.id]);
  }
  const paidOff = new Set(blueprint.chapters.flatMap((row) => (row.content.resolvedForeshadowing ?? []) as string[]));
  for (const chapter of blueprint.chapters) for (const clue of (chapter.content.introducedForeshadowing ?? []) as string[]) if (!paidOff.has(clue)) add("WARNING", "Foreshadowing", `伏笔尚未找到章节回收：${clue}`, [chapter.id], "核对伏笔名称及回收章节，必要时补充回收计划");
  if (!issues.some((issue) => issue.severity === "ERROR")) add("SUGGESTION", "Story", "结构检查通过；请结合 AI 总体检查核对主线冲突、人物 OOC 与揭示依据");
  return issues;
}
export function canFinalize(blueprint: Blueprint): boolean {
  return !blueprint.workflowState.activeGeneration && stageIds.every((stage) => blueprint.workflowState.stageConfirmations[stage] && stageComplete(blueprint, stage)) && blueprint.workflowState.review.basedOnContentRevision === blueprint.workflowState.contentRevision && !blueprint.workflowState.review.issues.some((issue) => issue.severity === "ERROR") && !runBlueprintChecks(blueprint).some((issue) => issue.severity === "ERROR");
}
