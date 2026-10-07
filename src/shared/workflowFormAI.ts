/**
 * Scoped AI assistance for existing authoring forms. Only explicitly selected fields may change;
 * this module shares the ordinary command invalidation rules and never creates or approves an entity.
 */
import { z } from "zod";
import {
  allEntities,
  allowedReferenceEntities,
  canReferenceEntity,
  contentReferenceIds,
  contentSchemas,
  entityFields,
  entityStage,
  outlineItemSchema,
  stageIds,
  storyInputFields,
  storyInputSchema,
} from "./workflow.js";
import type { Blueprint, FieldDefinition, OutlinePlan, StoryInput, WorkflowEntity } from "./workflow.js";
import {
  applyWorkflowCommand,
  getStageStatus,
  WorkflowError,
} from "./workflowEngine.js";

export const STORY_INPUT_FILL_TARGET = "story-input";
const fixedStructureFields = new Set(["volumeNumber", "chapterNumber"]);

function existingEntity(blueprint: Blueprint, targetId: string): WorkflowEntity {
  const row = allEntities(blueprint).find((entity) => entity.id === targetId);
  if (!row) throw new WorkflowError("AI 填充只支持当前已存在的表单对象，请先确认生成清单。");
  return row;
}

function existingOutline(blueprint: Blueprint, targetId: string): OutlinePlan | undefined {
  return blueprint.workflowState.outlinePlans.find((plan) => plan.id === targetId);
}

function storyContext(blueprint: Blueprint, stage: string): Record<string, unknown> {
  const input: Record<string, unknown> = { ...blueprint.storyInput };
  if (stageIds.indexOf(stage as typeof stageIds[number]) < stageIds.indexOf("chapters")) delete input.volumeChapterCounts;
  return input;
}

function adoptedReferences(blueprint: Blueprint, owner: WorkflowEntity | OutlinePlan): WorkflowEntity[] {
  return allowedReferenceEntities(blueprint, owner).filter((row) => {
    if (row.status !== "APPROVED") return false;
    const plan = blueprint.workflowState.outlinePlans.find((candidate) => candidate.items.some((item) => item.id === row.id));
    return !plan || plan.items.some((item) => item.id === row.id && item.enabled);
  });
}

/** Labels and keys come from the established form contracts, including the entity's outer name field. */
export function getFormFillFields(blueprint: Blueprint, targetId: string): FieldDefinition[] {
  if (targetId === STORY_INPUT_FILL_TARGET) return storyInputFields;
  const plan = existingOutline(blueprint, targetId);
  if (plan) return plan.items.length ? [
    { key: "name", label: "条目名称", type: "text", required: false },
    { key: "purpose", label: "条目定位 / 存在目的", type: "text", required: false },
    { key: "relatedIds", label: "关联前置对象", type: "referenceList", required: false },
    { key: "required", label: "是否必需", type: "json", required: false },
    { key: "enabled", label: "是否启用", type: "json", required: false },
  ] : [];
  const row = existingEntity(blueprint, targetId);
  return [
    { key: "name", label: "名称", type: "text", required: false },
    ...entityFields[row.kind].filter((field) => !fixedStructureFields.has(field.key)),
  ];
}

function selectedFields(blueprint: Blueprint, targetId: string, fields: string[]): string[] {
  const allowed = new Set(getFormFillFields(blueprint, targetId).map((field) => field.key));
  if (!fields.length || new Set(fields).size !== fields.length || fields.some((field) => !allowed.has(field))) {
    throw new WorkflowError("请至少选择一个允许填充的字段；不能重复、修改固定卷章结构或提交未知字段。");
  }
  return fields;
}

function ownerOutline(blueprint: Blueprint, entity: WorkflowEntity): OutlinePlan | undefined {
  const membership = blueprint.workflowState.outlinePlans.find((plan) => plan.items.some((item) => item.id === entity.id));
  if (membership) return membership;
  if (entity.kind === "relationships") return blueprint.workflowState.outlinePlans.find((plan) => plan.stageId === "characters");
  if (entity.kind === "initialWorldState") return blueprint.workflowState.outlinePlans.find((plan) => plan.stageId === "systems");
  return undefined;
}

export function assertCanFormFill(blueprint: Blueprint, targetId: string): void {
  if (blueprint.workflowState.activeGeneration) throw new WorkflowError("当前已有生成任务，请完成或取消后再使用 AI 填充。");
  if (targetId === STORY_INPUT_FILL_TARGET) return;
  const plan = existingOutline(blueprint, targetId);
  const row = plan ? null : existingEntity(blueprint, targetId);
  const stage = plan ? plan.stageId : entityStage(row!.kind);
  for (const previous of stageIds.slice(0, stageIds.indexOf(stage))) {
    if (getStageStatus(blueprint, previous) !== "CONFIRMED") throw new WorkflowError("请先确认所有前置阶段，再填充当前对象。");
  }
  if (plan) {
    if (!plan.items.length) throw new WorkflowError("空清单请先使用 AI 规划或手动新增条目，再填充当前清单。");
    return;
  }
  const outline = ownerOutline(blueprint, row!);
  if (["character", "ending", "criticalBranch", "gameSystem", "relationships", "initialWorldState"].includes(row!.kind)) {
    if (!outline || outline.status !== "APPROVED") throw new WorkflowError("请先确认所属生成清单，再填充对象详情。");
    const item = outline.items.find((candidate) => candidate.id === row!.id);
    if (item && !item.enabled) throw new WorkflowError("当前项目未在生成清单中启用，不能填充详情。");
  }
}

function requiredFieldSchema(schema: z.ZodType): z.ZodType {
  // Ordinary forms use defaults for incomplete drafts; a selected AI patch must actually contain each key.
  return schema instanceof z.ZodDefault ? schema.unwrap() as z.ZodType : schema;
}

/** Build a strict selected-field patch schema and context that contains only current or prior authoring data. */
export function getFormFillTarget(
  blueprint: Blueprint,
  targetId: string,
  fields: string[],
): { schema: z.ZodType; context: unknown; prompt: string } {
  const selected = selectedFields(blueprint, targetId, fields);
  if (targetId === STORY_INPUT_FILL_TARGET) {
    // In Zod 4, object refinements retain the public .shape accessor.
    const object = storyInputSchema as unknown as z.ZodObject;
    const schema = z.object(Object.fromEntries(selected.map((field) => [field, requiredFieldSchema(object.shape[field])]))).strict();
    return {
      schema,
      context: { storyInput: storyContext(blueprint, "story"), selectedFields: selected },
      prompt: "只辅助填写基础故事输入中的选中字段。允许从空表单开始；只返回选中字段的扁平 JSON patch。不得生成或修改卷章数量，不得从人物、结局、章节等后续创作推导并倒写基础设定。",
    };
  }

  const plan = existingOutline(blueprint, targetId);
  if (plan) {
    const ids = plan.items.map((item) => item.id);
    const itemShape: Record<string, z.ZodType> = { id: z.enum(ids as [string, ...string[]]) };
    for (const field of selected) itemShape[field] = outlineItemSchema.shape[field as "name" | "purpose" | "relatedIds" | "required" | "enabled"];
    const schema = z.object({ items: z.array(z.object(itemShape).strict()).length(ids.length) }).strict().superRefine((value, context) => {
      if (new Set(value.items.map((item) => item.id)).size !== ids.length) context.addIssue({ code: "custom", message: "必须为每个已有清单条目返回且仅返回一次，不得增删条目" });
    });
    return {
      schema,
      context: { storyInput: storyContext(blueprint, plan.stageId), plan, selectedFields: selected, referenceEntities: adoptedReferences(blueprint, plan) },
      prompt: `只填写 ${plan.name} 中已有条目的选中列。返回 items，每项保留当前条目 id 且只返回所选列；每个已有条目恰好出现一次，不能增删、替换 ID、类型、来源或审批状态。名称指条目名称，不改变清单标题。不得使用后续阶段或未采用草稿的正式引用。用户审核后才会采用清单，不生成详情。`,
    };
  }

  const row = existingEntity(blueprint, targetId);
  const contentFields = selected.filter((field) => field !== "name");
  const shape: Record<string, z.ZodType> = {};
  if (selected.includes("name")) shape.name = z.string().trim().min(1).max(300);
  if (contentFields.length) shape.content = z.object(Object.fromEntries(contentFields.map((field) => [field, requiredFieldSchema(contentSchemas[row.kind].shape[field])]))).strict();
  const schema = z.object(shape).strict();
  const target = { id: row.id, kind: row.kind, parentId: row.parentId, name: row.name, content: row.content };
  const context = row.kind === "storyBible"
    ? { storyInput: storyContext(blueprint, "story"), storyBible: target, selectedFields: selected }
    : {
      storyInput: storyContext(blueprint, entityStage(row.kind)),
      target,
      selectedFields: selected,
      outline: ownerOutline(blueprint, row),
      referenceEntities: adoptedReferences(blueprint, row),
    };
  return {
    schema,
    context,
    prompt: `只辅助填写 ${row.name} (${row.kind}) 的选中字段。name 只有选中时才返回；其余字段放在 content 的局部 patch。所有选中字段必须返回，禁止返回未选字段、ID、状态、类型、父级、固定卷章序号或新增建议。保留既有事实，只使用上下文中允许的实体 ID，禁止后续阶段倒写前置设定。缺少必需字段可留待用户继续填写，不要自动审批。`,
  };
}

/** Begin a cancellable fill without treating an incomplete draft as an approved generation prerequisite. */
export function beginFormFill(blueprint: Blueprint, targetId: string, token: string, fields: string[]): Blueprint {
  selectedFields(blueprint, targetId, fields);
  assertCanFormFill(blueprint, targetId);
  const next = structuredClone(blueprint);
  const plan = existingOutline(next, targetId);
  const row = targetId === STORY_INPUT_FILL_TARGET ? next.storyBible : plan ?? existingEntity(next, targetId);
  next.workflowState.activeGeneration = {
    token, targetId, previousStatus: row.status, startedAt: new Date().toISOString(),
  };
  if (targetId !== STORY_INPUT_FILL_TARGET) row.status = "GENERATING";
  next.workflowState.currentStage = targetId === STORY_INPUT_FILL_TARGET ? "story" : plan ? plan.stageId : entityStage((row as WorkflowEntity).kind);
  next.workflowState.selectedObjectId = targetId;
  next.workflowState.generationError = null;
  next.metadata.updatedAt = new Date().toISOString();
  return next;
}

/** Apply only the selected patch through ordinary commands so every affected approval is invalidated. */
export function completeFormFill(
  blueprint: Blueprint,
  targetId: string,
  output: unknown,
  fields: string[],
  token: string,
): Blueprint {
  const active = blueprint.workflowState.activeGeneration;
  if (!active || active.token !== token || active.targetId !== targetId) throw new WorkflowError("填充任务已取消或已过期。");
  const target = getFormFillTarget(blueprint, targetId, fields);
  const patch = target.schema.parse(output) as Record<string, unknown>;
  const restored = structuredClone(blueprint);
  restored.workflowState.activeGeneration = null;
  restored.workflowState.generationError = null;
  if (targetId === STORY_INPUT_FILL_TARGET) {
    const input = storyInputSchema.parse({ ...restored.storyInput, ...patch }) as StoryInput;
    return applyWorkflowCommand(restored, { type: "updateStoryInput", input });
  }
  const plan = existingOutline(restored, targetId);
  if (plan) {
    plan.status = active.previousStatus;
    const itemPatches = new Map((patch.items as Array<Record<string, unknown>>).map((item) => [item.id as string, item]));
    const allowedIds = new Set(adoptedReferences(restored, plan).map((row) => row.id));
    const items = plan.items.map((item) => {
      const changes = itemPatches.get(item.id)!;
      if (fields.includes("relatedIds") && (changes.relatedIds as string[]).some((id) => !allowedIds.has(id))) throw new WorkflowError("AI 填充清单引用了未确认或超出当前创作方向的对象。");
      return { ...item, ...Object.fromEntries(fields.map((field) => [field, changes[field]])) };
    });
    const next = applyWorkflowCommand(restored, { type: "updateOutline", outlineId: plan.id, items });
    const updated = existingOutline(next, targetId)!;
    updated.userModified = plan.userModified;
    for (const item of updated.items) item.userModified = plan.items.find((old) => old.id === item.id)?.userModified ?? item.userModified;
    return next;
  }
  const row = existingEntity(restored, targetId);
  row.status = active.previousStatus;
  const content = contentSchemas[row.kind].parse({ ...row.content, ...(patch.content as Record<string, unknown> | undefined) }) as WorkflowEntity["content"];
  const allowedIds = new Set(adoptedReferences(restored, row).map((reference) => reference.id));
  const selectedReferences = contentReferenceIds({ ...row, content: (patch.content ?? {}) as WorkflowEntity["content"] });
  if (selectedReferences.some((id) => !allowedIds.has(id))) throw new WorkflowError("AI 填充引用了未确认、未采用或超出当前创作方向的对象，原有内容已保留。");
  const proposed = { ...row, content };
  const byId = new Map(allEntities(restored).map((entity) => [entity.id, entity]));
  for (const id of contentReferenceIds(proposed)) {
    const reference = byId.get(id);
    if (!reference || !canReferenceEntity(restored, proposed, reference)) throw new WorkflowError("AI 填充引用了不存在或超出当前创作方向的对象，原有内容已保留。");
  }
  const next = applyWorkflowCommand(restored, {
    type: "updateEntity", entityId: row.id, name: typeof patch.name === "string" ? patch.name : row.name, content,
  });
  existingEntity(next, targetId).userModified = row.userModified;
  const previousItem = ownerOutline(restored, row)?.items.find((item) => item.id === row.id);
  const nextItem = ownerOutline(next, existingEntity(next, targetId))?.items.find((item) => item.id === row.id);
  if (previousItem && nextItem) nextItem.userModified = previousItem.userModified;
  return next;
}
