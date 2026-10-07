import { z } from "zod";

export const BLUEPRINT_SCHEMA_VERSION = 2;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const approvalStatuses = ["DRAFT", "GENERATING", "PENDING_REVIEW", "APPROVED", "NEEDS_REVIEW", "REJECTED"] as const;
export const stageStatuses = ["NOT_STARTED", "PLANNING", "OUTLINE_REVIEW", "IN_PROGRESS", "READY_TO_CONFIRM", "CONFIRMED", "NEEDS_REVIEW"] as const;
export const stageIds = ["story", "characters", "endings", "chapters", "branches", "systems", "review"] as const;
export type ApprovalStatus = typeof approvalStatuses[number];
export type StageStatus = typeof stageStatuses[number];
export type StageId = typeof stageIds[number];
export type StageType = "FIXED" | "AI_PLANNED";
export const stages: ReadonlyArray<{ id: StageId; name: string; type: StageType; description: string }> = [
  { id: "story", name: "基础设定", type: "FIXED", description: "完善并审批整体 Story Bible" },
  { id: "characters", name: "人物", type: "AI_PLANNED", description: "先确认角色清单，再逐项审批人物与关系" },
  { id: "endings", name: "结局", type: "AI_PLANNED", description: "从结局反向设计条件、事件和铺垫" },
  { id: "chapters", name: "卷与章节", type: "FIXED", description: "按指定卷章数量展开，先卷后章" },
  { id: "branches", name: "人物变化 / 分支", type: "FIXED", description: "章节人物计划固定；每章关键分支先规划清单" },
  { id: "systems", name: "SLG 系统", type: "AI_PLANNED", description: "审核系统建议，再配置系统与初始世界" },
  { id: "review", name: "最终检查", type: "FIXED", description: "审核一致性问题，解决 ERROR 后冻结 Blueprint" },
];
export const entityKinds = ["storyBible", "character", "relationships", "ending", "volume", "chapter", "chapterCharacterPlan", "criticalBranch", "gameSystem", "initialWorldState"] as const;
export type EntityKind = typeof entityKinds[number];
const entityStageMap: Record<EntityKind, StageId> = { storyBible: "story", character: "characters", relationships: "characters", ending: "endings", volume: "chapters", chapter: "chapters", chapterCharacterPlan: "branches", criticalBranch: "branches", gameSystem: "systems", initialWorldState: "systems" };
export function entityStage(kind: EntityKind): StageId { return entityStageMap[kind]; }
export type Content = Record<string, z.infer<ReturnType<typeof z.json>>>;
export interface FieldDefinition {
  key: string;
  label: string;
  type: "text" | "textList" | "referenceList" | "number" | "json";
  required: boolean;
  referenceKind?: EntityKind;
}
const text = (key: string, label: string, required = true): FieldDefinition => ({ key, label, type: "text", required });
const list = (key: string, label: string, required = false): FieldDefinition => ({ key, label, type: "textList", required });
const refs = (key: string, label: string, referenceKind: EntityKind, required = false): FieldDefinition => ({ key, label, type: "referenceList", referenceKind, required });
const json = (key: string, label: string, required = false): FieldDefinition => ({ key, label, type: "json", required });
const number = (key: string, label: string): FieldDefinition => ({ key, label, type: "number", required: true });

export const entityFields: Record<EntityKind, FieldDefinition[]> = {
  storyBible: [text("premise", "Premise"), text("worldBackground", "世界背景"), list("worldRules", "世界规则", true), text("setting", "社会 / 科技 / 时代环境"), text("startingState", "故事起始状态"), text("mainConflict", "主要矛盾"), text("coreSecret", "核心秘密"), list("factions", "重要势力"), list("locations", "重要地点", true), list("themes", "核心主题", true), list("immutableFacts", "不可变事实", true), list("unrevealedInformation", "当前不可提前揭露的信息")],
  character: [text("basicProfile", "基础资料"), text("identity", "身份"), text("appearance", "外貌"), text("background", "背景"), text("family", "家庭", false), text("importantPast", "重要过去", false), text("personality", "性格"), list("values", "价值观", true), list("likes", "喜好"), list("dislikes", "厌恶"), text("desire", "欲望"), text("fear", "恐惧"), list("weaknesses", "弱点"), text("secret", "秘密", false), text("shortTermGoal", "短期目标"), text("longTermGoal", "长期目标"), text("behaviorStyle", "行为风格"), text("speechStyle", "谈吐风格"), list("commonExpressions", "常用表达"), list("forbiddenExpressions", "禁止表达"), text("emotions", "情绪表现"), text("initialAttitude", "对主角初始态度"), json("dynamicAttributes", "动态属性定义")],
  relationships: [text("summary", "关系总览"), json("relationships", "关系明细")],
  ending: [text("endingType", "类型：NORMAL / HAPPY / BAD / FAKE / TRUE / SECRET / SPECIAL"), text("outcome", "最终结果"), refs("characterIds", "涉及人物", "character", true), text("themeMeaning", "主题意义"), list("prerequisites", "必要剧情前提", true), list("relationshipRequirements", "人物关系要求"), list("requiredEvents", "必须发生事件"), list("forbiddenEvents", "必须避免事件"), list("flagRequirements", "Flag 要求"), list("informationRequirements", "信息要求"), list("itemRequirements", "道具要求"), list("setup", "前期铺垫", true), list("foreshadowing", "前期伏笔"), list("payoffs", "需要回收的内容"), list("routes", "对应路线", true)],
  volume: [number("volumeNumber", "卷序号"), text("theme", "本卷主题"), text("storyPhase", "剧情阶段"), text("conflict", "核心冲突"), refs("characterIds", "主要人物", "character", true), refs("endingIds", "推进结局", "ending", true), list("foreshadowing", "主要伏笔"), text("endingState", "本卷结束故事状态")],
  chapter: [number("chapterNumber", "章序号"), text("storyPhase", "故事阶段"), text("theme", "主题"), text("conflict", "主要矛盾"), text("summary", "剧情概要"), text("startTime", "起始时间"), text("duration", "预计时间跨度"), text("endCondition", "Chapter End Condition"), list("requiredBeats", "Required Events / Beats", true), list("optionalEvents", "Optional Events"), list("forbiddenEvents", "Forbidden Events"), list("routes", "推进路线", true), refs("endingIds", "关联结局", "ending", true), list("introducedForeshadowing", "新增伏笔"), list("resolvedForeshadowing", "回收伏笔"), list("retainedConditions", "后续保留条件")],
  chapterCharacterPlan: [json("characters", "角色本章状态与变化", true)],
  criticalBranch: [text("background", "出现背景"), list("preconditions", "出现前提"), json("choices", "选项 / 隐藏选项 / 条件 / 效果", true), refs("endingIds", "关联结局", "ending", true), list("foreshadowing", "前期伏笔要求")],
  gameSystem: [text("systemType", "系统类型"), text("reason", "为什么需要"), text("gameplayValue", "玩法价值"), refs("chapterIds", "作用章节", "chapter"), refs("characterIds", "作用人物", "character"), refs("endingIds", "作用结局", "ending"), text("worldPresentation", "世界观表现形式"), json("configuration", "系统配置（静态定义）")],
  initialWorldState: [text("initialTime", "初始时间"), text("initialLocation", "初始地点"), list("accessibleLocations", "初始可访问地点", true), json("characterLocations", "人物初始所在地"), json("characterRelationships", "人物初始关系"), json("characterAttributes", "人物初始属性"), json("playerAttributes", "玩家初始属性"), list("inventory", "初始道具"), list("publicInformation", "初始公开信息"), list("hiddenInformation", "初始隐藏信息"), json("flags", "初始 Flag"), list("historicalEvents", "已经发生的历史事件")],
};

const shortText = z.string().max(300);
const prose = z.string().max(30_000);
const idSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const idList = z.array(idSchema).max(500);
const textList = z.array(z.string().min(1).max(5000)).max(500);
const attributeSchema = z.object({ key: idSchema, label: shortText, min: z.number(), max: z.number(), initial: z.number() }).strict().refine((value) => value.min <= value.initial && value.initial <= value.max, "属性初始值必须位于 min / max 之间");
const relationshipSchema = z.object({ fromCharacterId: idSchema, toCharacterId: idSchema, relationship: prose, initialValue: z.number().optional() }).strict();
const characterChangeSchema = z.object({ characterId: idSchema, startState: prose, goal: prose, mentalChange: prose, relationshipChange: prose, knownInformation: textList, forbiddenInformation: textList, attributeChanges: z.array(z.object({ key: idSchema, delta: z.number() }).strict()).max(100), endState: prose }).strict();
const choiceSchema = z.object({ id: idSchema, label: shortText, hidden: z.boolean(), unlockConditions: textList, effects: textList, relationshipEffects: textList, futureChapterEffects: textList, opensRoutes: textList, closesRoutes: textList, endingIds: idList }).strict();
const nestedNumbers = z.record(idSchema, z.record(idSchema, z.number()));
const overrides: Partial<Record<EntityKind, Record<string, z.ZodType>>> = {
  character: { dynamicAttributes: z.array(attributeSchema).max(100).default([]) },
  relationships: { relationships: z.array(relationshipSchema).max(1000).default([]) },
  ending: { endingType: z.enum(["NORMAL", "HAPPY", "BAD", "FAKE", "TRUE", "SECRET", "SPECIAL"]).default("NORMAL") },
  chapterCharacterPlan: { characters: z.array(characterChangeSchema).max(100).default([]) },
  criticalBranch: { choices: z.array(choiceSchema).max(100).default([]) },
  initialWorldState: {
    characterLocations: z.record(idSchema, shortText).default({}),
    characterRelationships: z.array(relationshipSchema).max(1000).default([]),
    characterAttributes: nestedNumbers.default({}),
    playerAttributes: z.record(idSchema, z.number()).default({}),
    flags: z.record(idSchema, z.union([z.string(), z.number(), z.boolean()])).default({}),
  },
};
export const contentSchemas = Object.fromEntries(entityKinds.map((kind) => [kind, z.object(Object.fromEntries(entityFields[kind].map((field) => {
  const schema = overrides[kind]?.[field.key] ?? (field.type === "text" ? prose.default("") : field.type === "textList" ? textList.default([]) : field.type === "referenceList" ? idList.default([]) : field.type === "number" ? z.number().int().min(1).max(500).default(1) : z.record(z.string(), z.json()).default({}));
  return [field.key, schema];
}))).strict()])) as Record<EntityKind, z.ZodObject>;
export function emptyContent(kind: EntityKind): Content { return contentSchemas[kind].parse({}) as Content; }

export const storyInputFields: FieldDefinition[] = [text("name", "名称"), text("genre", "类型"), list("tags", "标签"), text("outline", "大纲"), text("background", "背景", false), text("worldView", "世界观", false), text("era", "时代", false), list("locations", "地点"), list("themes", "核心主题"), text("coreConflict", "核心冲突", false), text("tone", "故事基调", false), list("presetCharacters", "预设人物"), list("presetEvents", "预设事件"), list("presetBranches", "预设分支"), list("presetEndings", "预设结局"), list("requiredContent", "必须发生内容"), list("forbiddenChanges", "禁止 AI 违背的设定"), text("expectedLength", "预计长度", false), text("notes", "其他说明", false)];
export interface StoryInput {
  [key: string]: string | string[] | number[];
  name: string; genre: string; tags: string[]; outline: string; background: string;
  worldView: string; era: string; locations: string[]; themes: string[];
  coreConflict: string; tone: string; presetCharacters: string[]; presetEvents: string[];
  presetBranches: string[]; presetEndings: string[]; requiredContent: string[];
  forbiddenChanges: string[]; expectedLength: string; notes: string; volumeChapterCounts: number[];
}
export const storyInputSchema: z.ZodType<StoryInput> = z.object({
  ...Object.fromEntries(storyInputFields.map((field) => [field.key, field.key === "name" ? shortText.default("") : field.type === "textList" ? textList.default([]) : prose.default("")])),
  volumeChapterCounts: z.array(z.number().int().min(1).max(100)).max(30).default([]),
}).strict().refine((value) => value.volumeChapterCounts.reduce((sum, n) => sum + n, 0) <= 500, "总章节数不能超过 500") as unknown as z.ZodType<StoryInput>;

export const entitySchema = z.object({ id: idSchema, kind: z.enum(entityKinds), parentId: idSchema.nullable(), name: shortText.min(1), status: z.enum(approvalStatuses), source: z.enum(["USER", "AI"]), userModified: z.boolean(), revision: z.number().int().min(0), dependencies: idList, reviewReasons: textList, content: z.record(z.string(), z.json()) }).strict().superRefine((value, context) => {
  const result = contentSchemas[value.kind].safeParse(value.content);
  if (!result.success) for (const issue of result.error.issues) context.addIssue({ code: "custom", path: ["content", ...issue.path], message: issue.message });
});
export type WorkflowEntity = z.infer<typeof entitySchema>;
export const outlineItemSchema = z.object({ id: idSchema, name: shortText.min(1), kind: z.enum(["character", "ending", "criticalBranch", "gameSystem"]), source: z.enum(["USER", "AI"]), purpose: z.string().max(31_000), required: z.boolean(), enabled: z.boolean(), relatedIds: idList, userModified: z.boolean() }).strict();
export type OutlineItem = z.infer<typeof outlineItemSchema>;
export const outlinePlanSchema = z.object({ id: idSchema, stageId: z.enum(stageIds), type: z.literal("AI_PLANNED"), parentId: idSchema.nullable(), name: shortText, status: z.enum(approvalStatuses), revision: z.number().int().min(0), userModified: z.boolean(), reviewReasons: textList, items: z.array(outlineItemSchema).max(100), dependencies: idList }).strict();
export type OutlinePlan = z.infer<typeof outlinePlanSchema>;
export const additionSuggestionSchema = z.object({ id: idSchema, outlineId: idSchema, item: outlineItemSchema, status: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED"]) }).strict();
export type AdditionSuggestion = z.infer<typeof additionSuggestionSchema>;
export const reviewIssueSchema = z.object({ id: idSchema, severity: z.enum(["ERROR", "WARNING", "SUGGESTION"]), category: z.enum(["Story", "Characters", "Ending", "Branch", "Foreshadowing", "Chapter", "System", "Workflow"]), message: prose.min(1), entityIds: idList, suggestion: prose }).strict();
export type ReviewIssue = z.infer<typeof reviewIssueSchema>;
const reviewSchema = z.object({ status: z.enum(approvalStatuses), basedOnContentRevision: z.number().int().min(0).nullable(), issues: z.array(reviewIssueSchema).max(1000), reviewedAt: z.string().nullable() }).strict();
const generationSchema = z.object({ token: idSchema, targetId: idSchema, startedAt: z.string(), previousStatus: z.enum(approvalStatuses) }).strict();
export const blueprintSchema = z.object({
  schemaVersion: z.literal(BLUEPRINT_SCHEMA_VERSION), blueprintVersion: z.number().int().min(0),
  metadata: z.object({ id: idSchema, title: shortText, createdAt: z.string(), updatedAt: z.string(), parentVersion: z.number().int().min(1).nullable(), description: prose, userNote: prose }).strict(),
  storyInput: storyInputSchema,
  workflowState: z.object({ currentStage: z.enum(stageIds), selectedObjectId: idSchema.nullable(), contentRevision: z.number().int().min(0), stageConfirmations: z.object(Object.fromEntries(stageIds.map((id) => [id, z.boolean()])) as Record<StageId, z.ZodBoolean>).strict(), outlinePlans: z.array(outlinePlanSchema).max(503), additionSuggestions: z.array(additionSuggestionSchema).max(1000).default([]), review: reviewSchema, activeGeneration: generationSchema.nullable(), generationError: prose.nullable().default(null) }).strict(),
  storyBible: entitySchema, characters: z.array(entitySchema).max(100), relationships: entitySchema.nullable(), endings: z.array(entitySchema).max(100), volumes: z.array(entitySchema).max(30), chapters: z.array(entitySchema).max(500), chapterCharacterPlans: z.array(entitySchema).max(500), criticalBranches: z.array(entitySchema).max(5000), gameSystems: z.array(entitySchema).max(100), initialWorldState: entitySchema.nullable(),
}).strict();
export type Blueprint = z.infer<typeof blueprintSchema>;
export const workflowCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("updateStoryInput"), input: storyInputSchema }).strict(),
  z.object({ type: z.literal("configureChapters"), counts: z.array(z.number().int().min(1).max(100)).min(1).max(30) }).strict(),
  z.object({ type: z.literal("select"), stageId: z.enum(stageIds), objectId: idSchema.nullable() }).strict(),
  z.object({ type: z.literal("updateOutline"), outlineId: idSchema, items: z.array(outlineItemSchema).max(100) }).strict(),
  z.object({ type: z.literal("approveOutline"), outlineId: idSchema }).strict(),
  z.object({ type: z.literal("approveAddition"), suggestionId: idSchema }).strict(),
  z.object({ type: z.literal("rejectAddition"), suggestionId: idSchema }).strict(),
  z.object({ type: z.literal("updateEntity"), entityId: idSchema, name: shortText.min(1), content: z.record(z.string(), z.json()) }).strict(),
  z.object({ type: z.literal("approveEntity"), entityId: idSchema }).strict(),
  z.object({ type: z.literal("rejectEntity"), entityId: idSchema, reason: prose.min(1) }).strict(),
  z.object({ type: z.literal("confirmStage"), stageId: z.enum(stageIds) }).strict(),
  z.object({ type: z.literal("approveReview") }).strict(),
]);
export type WorkflowCommand = z.infer<typeof workflowCommandSchema>;
export interface VersionSummary { version: number; parentVersion: number | null; createdAt: string; description: string; userNote: string; finalized: boolean }
export interface WorkflowResponse { blueprint: Blueprint; revision: number; versions: VersionSummary[] }
export interface VersionSnapshot extends VersionSummary { blueprint: Blueprint }
export interface ImportPreview { valid: boolean; errors: string[]; warnings: string[]; summary: string[]; data?: Blueprint | StoryInput }

const legacyOutlineItemSchema = outlineItemSchema.extend({ purpose: prose, volumeNumbers: z.array(z.number().int().min(1).max(30)).max(30).default([]) });
const legacyOutlinePlanSchema = outlinePlanSchema.extend({ items: z.array(legacyOutlineItemSchema).max(100) });
const legacyBlueprintSchema = blueprintSchema.extend({ schemaVersion: z.literal(1), workflowState: blueprintSchema.shape.workflowState.extend({ outlinePlans: z.array(legacyOutlinePlanSchema).max(503), additionSuggestions: z.array(additionSuggestionSchema.extend({ item: legacyOutlineItemSchema })).max(1000).default([]) }) });
/** Read old documents as a migrated projection. Callers retain immutable original snapshot bytes. */
export function migrateBlueprint(data: unknown): unknown {
  const version = data && typeof data === "object" ? (data as { schemaVersion?: unknown }).schemaVersion : null;
  if (version === BLUEPRINT_SCHEMA_VERSION) return data;
  if (version !== 1) throw new Error(`不支持此 Schema Version，当前支持 ${BLUEPRINT_SCHEMA_VERSION}，并可迁移旧版 1`);
  const legacy = legacyBlueprintSchema.parse(data);
  const changedItemIds = new Set<string>();
  const changedPlanIds = new Set<string>();
  const convertItem = (item: z.infer<typeof legacyOutlineItemSchema>, outlineId: string): OutlineItem => {
    const { volumeNumbers, ...next } = item;
    if (volumeNumbers.length) {
      next.purpose = `${next.purpose}\n旧版出场意向：预计第 ${volumeNumbers.join("、")} 卷；此说明仅保留创作意向，不绑定卷章结构。`;
      changedItemIds.add(item.id); changedPlanIds.add(outlineId);
    }
    return next;
  };
  const blueprint = blueprintSchema.parse({ ...legacy, schemaVersion: BLUEPRINT_SCHEMA_VERSION, workflowState: { ...legacy.workflowState, outlinePlans: legacy.workflowState.outlinePlans.map((plan) => ({ ...plan, items: plan.items.map((item) => convertItem(item, plan.id)) })), additionSuggestions: legacy.workflowState.additionSuggestions.map((suggestion) => ({ ...suggestion, item: convertItem(suggestion.item, suggestion.outlineId) })) } });
  const active = blueprint.workflowState.activeGeneration;
  if (active) {
    const target = active.targetId === "blueprint-review" ? blueprint.workflowState.review : blueprint.workflowState.outlinePlans.find((plan) => plan.id === active.targetId) ?? allEntities(blueprint).find((entity) => entity.id === active.targetId);
    if (target?.status === "GENERATING") target.status = active.previousStatus;
    blueprint.workflowState.activeGeneration = null;
    blueprint.workflowState.generationError = "旧版 Blueprint 已迁移，未完成生成已中断；原有内容已保留。";
  }
  const rows = allEntities(blueprint);
  const byId = new Map(rows.map((entity) => [entity.id, entity]));
  if ([...rows, ...blueprint.workflowState.outlinePlans].some((row) => row.dependencies.some((id) => !byId.has(id)))) throw new Error("旧版 Blueprint 存在悬空依赖，无法安全迁移");
  const changedEntities = new Set<string>();
  const markEntity = (entity: WorkflowEntity, reason: string): void => { entity.status = entity.status === "DRAFT" ? "DRAFT" : "NEEDS_REVIEW"; entity.reviewReasons = [...new Set([...entity.reviewReasons, reason])]; changedEntities.add(entity.id); };
  for (const entity of rows) {
    const rejected = entity.dependencies.filter((id) => { const target = byId.get(id); return target ? !canReferenceEntity(blueprint, entity, target) : false; });
    if (rejected.length) markEntity(entity, `Schema v1 迁移：移除违反前置方向的依赖 ${rejected.join("、")}`);
    if (changedItemIds.has(entity.id)) markEntity(entity, "Schema v1 迁移：旧版出场卷号已保留为文字意向，请重新审核");
  }
  for (const plan of blueprint.workflowState.outlinePlans) {
    const rejected = plan.dependencies.filter((id) => { const target = byId.get(id); return target ? !canReferenceEntity(blueprint, plan, target) : false; });
    for (const item of plan.items) {
      const removed = item.relatedIds.filter((id) => { const target = byId.get(id); return target ? !canReferenceEntity(blueprint, plan, target) : false; });
      if (!removed.length) continue;
      item.relatedIds = item.relatedIds.filter((id) => !removed.includes(id));
      changedPlanIds.add(plan.id);
      plan.reviewReasons.push(`Schema v1 迁移：${item.name} 移除违反前置方向的关联 ${removed.join("、")}`);
      const detail = byId.get(item.id); if (detail) markEntity(detail, "Schema v1 迁移：生成清单的前置关联已改变，请重新审核");
    }
    if (rejected.length) { changedPlanIds.add(plan.id); plan.reviewReasons.push(`Schema v1 迁移：移除违反前置方向的清单依赖 ${rejected.join("、")}`); }
    if (changedPlanIds.has(plan.id)) {
      plan.status = "NEEDS_REVIEW";
      plan.reviewReasons = [...new Set([...plan.reviewReasons, "Schema v1 迁移：规划字段或关联方向已调整，请重新审核清单"])];
    }
  }
  for (const suggestion of blueprint.workflowState.additionSuggestions) {
    const plan = blueprint.workflowState.outlinePlans.find((row) => row.id === suggestion.outlineId);
    if (!plan) continue;
    const removed = suggestion.item.relatedIds.filter((id) => { const target = byId.get(id); return target ? !canReferenceEntity(blueprint, plan, target) : false; });
    if (removed.length) {
      suggestion.item.relatedIds = suggestion.item.relatedIds.filter((id) => !removed.includes(id));
      suggestion.item.purpose += `\nSchema v1 迁移：移除违反前置方向的关联 ${removed.join("、")}，需按当前清单重新确认。`;
      if (suggestion.status === "PENDING_REVIEW") { changedPlanIds.add(plan.id); plan.status = "NEEDS_REVIEW"; plan.reviewReasons = [...new Set([...plan.reviewReasons, "Schema v1 迁移：新增建议的前置关联已调整，请重新审核"])]; }
    }
  }
  rebuildBlueprintDependencies(blueprint);
  let earliest: number = stageIds.length;
  for (const id of changedEntities) earliest = Math.min(earliest, stageIds.indexOf(entityStage(byId.get(id)!.kind)));
  for (const plan of blueprint.workflowState.outlinePlans) if (changedPlanIds.has(plan.id)) earliest = Math.min(earliest, stageIds.indexOf(plan.stageId));
  if (earliest < stageIds.length) {
    for (const entity of rows) if (stageIds.indexOf(entityStage(entity.kind)) > earliest && entity.status !== "DRAFT") { entity.status = "NEEDS_REVIEW"; entity.reviewReasons = [...new Set([...entity.reviewReasons, "Schema v1 迁移：前置数据的关联规则已调整"])]; }
    for (const plan of blueprint.workflowState.outlinePlans) if (stageIds.indexOf(plan.stageId) > earliest && plan.status !== "DRAFT") { plan.status = "NEEDS_REVIEW"; plan.reviewReasons = [...new Set([...plan.reviewReasons, "Schema v1 迁移：前置数据的关联规则已调整"])]; }
    for (const stage of stageIds.slice(earliest)) blueprint.workflowState.stageConfirmations[stage] = false;
    blueprint.workflowState.review.status = blueprint.workflowState.review.status === "DRAFT" ? "DRAFT" : "NEEDS_REVIEW";
    blueprint.workflowState.review.basedOnContentRevision = null;
    blueprint.workflowState.contentRevision += 1;
  }
  return blueprintSchema.parse(blueprint);
}
function unknownFields(schema: z.ZodType, value: unknown, path = ""): string[] {
  const parsed = schema.safeParse(value);
  if (parsed.success) return [];
  return parsed.error.issues.filter((issue) => issue.code === "unrecognized_keys").flatMap((issue) => (issue as z.core.$ZodIssueUnrecognizedKeys).keys.map((key) => `${path}${issue.path.join(".")}${issue.path.length ? "." : ""}${key}`));
}
export function previewImport(kind: "story" | "blueprint", raw: unknown): ImportPreview {
  let data: unknown = raw;
  try {
    if (typeof raw === "string") {
      if (new TextEncoder().encode(raw).byteLength > MAX_IMPORT_BYTES) throw new Error("JSON 文件超过 5 MiB");
      data = JSON.parse(raw);
    }
    const migrated = kind === "blueprint" && data && typeof data === "object" && (data as { schemaVersion?: unknown }).schemaVersion === 1;
    if (kind === "blueprint") data = migrateBlueprint(data);
    const schema = kind === "story" ? storyInputSchema : blueprintSchema;
    const unknown = unknownFields(schema, data);
    const result = schema.safeParse(data);
    if (!result.success) return { valid: false, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "JSON"}: ${issue.message}`), warnings: unknown.map((key) => `未知字段：${key}；请移除后重试`), summary: [] };
    if (kind === "story") {
      const input = result.data as StoryInput;
      const missing = storyInputFields.filter((field) => field.required && !String(input[field.key] ?? "").trim()).map((field) => field.label);
      if (missing.length) return { valid: false, errors: [`缺少必填字段：${missing.join("、")}`], warnings: [], summary: [] };
      return { valid: true, errors: [], warnings: [], summary: [`名称：${input.name}`, `类型：${input.genre}`, `预设人物：${(input.presetCharacters as string[]).length}`, `卷数：${input.volumeChapterCounts.length}`], data: input };
    }
    const blueprint = result.data as Blueprint;
    const errors = validateBlueprintStructure(blueprint);
    return { valid: errors.length === 0, errors, warnings: [...(migrated ? ["Schema v1 已迁移到 v2；旧出场卷号保留为文字意向，违反前置方向的关联被移除，受影响内容需重新审核"] : []), ...(blueprint.workflowState.activeGeneration ? ["导入后将恢复未完成生成状态，不重放 AI 请求"] : [])], summary: [`项目：${blueprint.metadata.title}`, `Schema v${blueprint.schemaVersion} / Blueprint v${blueprint.blueprintVersion}`, `人物 ${blueprint.characters.length} · 结局 ${blueprint.endings.length} · 章节 ${blueprint.chapters.length} · 分支 ${blueprint.criticalBranches.length}`, `阶段：${stages.find((stage) => stage.id === blueprint.workflowState.currentStage)?.name}`], ...(errors.length ? {} : { data: blueprint }) };
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : "JSON 无效"], warnings: [], summary: [] };
  }
}

export function allEntities(blueprint: Blueprint): WorkflowEntity[] {
  return [blueprint.storyBible, ...blueprint.characters, ...(blueprint.relationships ? [blueprint.relationships] : []), ...blueprint.endings, ...blueprint.volumes, ...blueprint.chapters, ...blueprint.chapterCharacterPlans, ...blueprint.criticalBranches, ...blueprint.gameSystems, ...(blueprint.initialWorldState ? [blueprint.initialWorldState] : [])];
}
export type ReferenceOwner = WorkflowEntity | OutlinePlan;
/** Formal references flow from an authoring unit to its established prerequisites. */
export function canReferenceEntity(blueprint: Blueprint, owner: ReferenceOwner, target: WorkflowEntity): boolean {
  if (owner.id === target.id) return false;
  const ownerStage = "stageId" in owner ? owner.stageId : entityStage(owner.kind);
  const targetStage = entityStage(target.kind);
  if (stageIds.indexOf(targetStage) < stageIds.indexOf(ownerStage)) return true;
  if (targetStage !== ownerStage) return false;
  if ("stageId" in owner) return owner.stageId === "branches" && target.kind === "chapterCharacterPlan" && target.parentId === owner.parentId;
  if (owner.kind === "relationships") return target.kind === "character";
  if (owner.kind === "chapter") return target.kind === "volume" || (target.kind === "chapter" && blueprint.chapters.findIndex((row) => row.id === target.id) >= 0 && blueprint.chapters.findIndex((row) => row.id === target.id) < blueprint.chapters.findIndex((row) => row.id === owner.id));
  if (owner.kind === "criticalBranch") return target.kind === "chapterCharacterPlan" && target.parentId === owner.parentId;
  return owner.kind === "initialWorldState" && target.kind === "gameSystem";
}
export function allowedReferenceEntities(blueprint: Blueprint, owner: ReferenceOwner): WorkflowEntity[] {
  return allEntities(blueprint).filter((target) => canReferenceEntity(blueprint, owner, target));
}
/** Canonical dependency caches contain prerequisite stages and the explicit supported local order. */
export function rebuildBlueprintDependencies(blueprint: Blueprint): void {
  for (const entity of allEntities(blueprint)) entity.dependencies = allowedReferenceEntities(blueprint, entity).map((row) => row.id);
  for (const plan of blueprint.workflowState.outlinePlans) plan.dependencies = allowedReferenceEntities(blueprint, plan).map((row) => row.id);
}
export function contentReferenceIds(entity: WorkflowEntity): string[] {
  const ids = entityFields[entity.kind].filter((field) => field.type === "referenceList").flatMap((field) => (entity.content[field.key] ?? []) as string[]);
  if (entity.kind === "relationships" || entity.kind === "initialWorldState") {
    const rows = (entity.content[entity.kind === "relationships" ? "relationships" : "characterRelationships"] ?? []) as Array<{ fromCharacterId: string; toCharacterId: string }>;
    ids.push(...rows.flatMap((row) => [row.fromCharacterId, row.toCharacterId]));
  }
  if (entity.kind === "chapterCharacterPlan") ids.push(...((entity.content.characters ?? []) as Array<{ characterId: string }>).map((row) => row.characterId));
  if (entity.kind === "criticalBranch") ids.push(...((entity.content.choices ?? []) as Array<{ endingIds: string[] }>).flatMap((row) => row.endingIds));
  if (entity.kind === "initialWorldState") ids.push(...Object.keys((entity.content.characterLocations ?? {}) as object), ...Object.keys((entity.content.characterAttributes ?? {}) as object));
  return [...new Set(ids)];
}
/** Unadopted optional drafts and disabled retained characters do not participate in the initial world. */
export function activeApprovedCharacters(blueprint: Blueprint): WorkflowEntity[] {
  const enabledIds = new Set(blueprint.workflowState.outlinePlans.filter((plan) => plan.stageId === "characters").flatMap((plan) => plan.items.filter((item) => item.enabled).map((item) => item.id)));
  return blueprint.characters.filter((character) => character.status === "APPROVED" && enabledIds.has(character.id));
}
export function entityApprovalErrors(blueprint: Blueprint, entity: WorkflowEntity): string[] {
  const parsed = contentSchemas[entity.kind].safeParse(entity.content);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const errors: string[] = [];
  for (const field of entityFields[entity.kind].filter((field) => field.required)) {
    const value = entity.content[field.key];
    if (value === undefined || value === null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0) || (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length)) errors.push(`请填写 ${field.label}`);
  }
  const byId = new Map(allEntities(blueprint).map((row) => [row.id, row]));
  for (const id of contentReferenceIds(entity)) {
    const target = byId.get(id);
    if (!target || id === entity.id) errors.push(`引用不存在：${id}`);
    else if (!canReferenceEntity(blueprint, entity, target)) errors.push(`引用违反前置方向：${target.name}`);
  }
  for (const field of entityFields[entity.kind].filter((field) => field.referenceKind)) for (const id of (entity.content[field.key] ?? []) as string[]) if (byId.get(id)?.kind !== field.referenceKind) errors.push(`${field.label} 的引用类型错误：${id}`);
  if (entity.kind === "character") {
    const attributes = entity.content.dynamicAttributes as Array<{ key: string }>;
    if (new Set(attributes.map((attribute) => attribute.key)).size !== attributes.length) errors.push("动态属性 key 不得重复");
  }
  if (entity.kind === "relationships" || entity.kind === "initialWorldState") {
    const relationships = (entity.content[entity.kind === "relationships" ? "relationships" : "characterRelationships"] ?? []) as Array<{ fromCharacterId: string; toCharacterId: string; relationship: string }>;
    for (const row of relationships) if (byId.get(row.fromCharacterId)?.kind !== "character" || byId.get(row.toCharacterId)?.kind !== "character" || row.fromCharacterId === row.toCharacterId || !row.relationship.trim()) errors.push("人物关系须关联两名不同人物并说明关系");
  }
  if (entity.kind === "chapterCharacterPlan") {
    const changes = entity.content.characters as Array<z.infer<typeof characterChangeSchema>>;
    if (new Set(changes.map((change) => change.characterId)).size !== changes.length) errors.push("同一章节的人物计划不得重复人物");
    for (const change of changes) {
      const character = byId.get(change.characterId);
      if (character?.kind !== "character") { errors.push(`人物不存在：${change.characterId}`); continue; }
      if ([change.startState, change.goal, change.mentalChange, change.relationshipChange, change.endState].some((value) => !value.trim())) errors.push(`${character.name} 的章节状态与变化不完整`);
      if (change.knownInformation.some((value) => change.forbiddenInformation.includes(value))) errors.push(`${character.name} 的已知信息与禁止知道的信息冲突`);
      const attributes = (character.content.dynamicAttributes ?? []) as Array<{ key: string }>;
      for (const attribute of change.attributeChanges) if (!attributes.some((definition) => definition.key === attribute.key)) errors.push(`${character.name} 未定义动态属性 ${attribute.key}`);
    }
  }
  if (entity.kind === "criticalBranch") {
    const choices = entity.content.choices as Array<z.infer<typeof choiceSchema>>;
    if (choices.length < 2) errors.push("关键分支至少需要两个选项");
    if (new Set(choices.map((choice) => choice.id)).size !== choices.length) errors.push("选项 ID 不得重复");
    for (const choice of choices) {
      if (!choice.label.trim()) errors.push("选项名称不能为空");
      if (choice.hidden && !choice.unlockConditions.length) errors.push("隐藏选项须声明解锁条件");
      if (![choice.effects, choice.relationshipEffects, choice.futureChapterEffects, choice.opensRoutes, choice.closesRoutes].some((effects) => effects.length)) errors.push(`${choice.label || "选项"} 缺少后续影响`);
      if (choice.endingIds.some((id) => byId.get(id)?.kind !== "ending")) errors.push(`${choice.label} 关联结局无效`);
    }
  }
  if (entity.kind === "initialWorldState") {
    const locations = entity.content.accessibleLocations as string[];
    if (!locations.includes(entity.content.initialLocation as string)) errors.push("初始地点必须在可访问地点清单中");
    const characterLocations = entity.content.characterLocations as Record<string, string>;
    const characterAttributes = entity.content.characterAttributes as Record<string, Record<string, number>>;
    for (const character of activeApprovedCharacters(blueprint)) {
      if (!characterLocations[character.id]?.trim()) errors.push(`缺少 ${character.name} 的初始所在地`);
      const definitions = character.content.dynamicAttributes as Array<{ key: string; min: number; max: number }>;
      for (const definition of definitions) {
        const value = characterAttributes[character.id]?.[definition.key];
        if (value === undefined || value < definition.min || value > definition.max) errors.push(`${character.name}.${definition.key} 的初始值缺失或越界`);
      }
      for (const key of Object.keys(characterAttributes[character.id] ?? {})) if (!definitions.some((definition) => definition.key === key)) errors.push(`${character.name} 未定义动态属性 ${key}`);
    }
  }
  return [...new Set(errors)];
}
/** Referential validation also runs for imports, where approval metadata is untrusted. */
export function validateBlueprintStructure(blueprint: Blueprint): string[] {
  const errors: string[] = [];
  const groups: Array<[EntityKind, WorkflowEntity[]]> = [["storyBible", [blueprint.storyBible]], ["character", blueprint.characters], ["relationships", blueprint.relationships ? [blueprint.relationships] : []], ["ending", blueprint.endings], ["volume", blueprint.volumes], ["chapter", blueprint.chapters], ["chapterCharacterPlan", blueprint.chapterCharacterPlans], ["criticalBranch", blueprint.criticalBranches], ["gameSystem", blueprint.gameSystems], ["initialWorldState", blueprint.initialWorldState ? [blueprint.initialWorldState] : []]];
  const entities = allEntities(blueprint);
  const ids = new Set(entities.map((entity) => entity.id));
  const plans = blueprint.workflowState.outlinePlans;
  if (ids.size !== entities.length || new Set([...ids, ...plans.map((plan) => plan.id), "blueprint-review", "story-input"]).size !== entities.length + plans.length + 2) errors.push("实体 / 清单 ID 重复或占用保留 ID");
  for (const [kind, rows] of groups) for (const entity of rows) {
    if (entity.kind !== kind) errors.push(`${entity.name}: 实体类型与容器不匹配`);
    for (const id of [...entity.dependencies, ...contentReferenceIds(entity), ...(entity.parentId ? [entity.parentId] : [])]) if (!ids.has(id) || id === entity.id) errors.push(`${entity.name}: 无效引用 ${id}`);
    for (const id of [...entity.dependencies, ...contentReferenceIds(entity), ...(entity.parentId ? [entity.parentId] : [])]) { const target = entities.find((row) => row.id === id); if (target && !canReferenceEntity(blueprint, entity, target)) errors.push(`${entity.name}: 引用违反前置方向 ${id}`); }
    for (const field of entityFields[kind].filter((field) => field.referenceKind)) for (const id of (entity.content[field.key] ?? []) as string[]) if (entities.find((row) => row.id === id)?.kind !== field.referenceKind) errors.push(`${entity.name}: ${field.key} 引用类型错误`);
    if (["chapter", "chapterCharacterPlan", "criticalBranch"].includes(kind)) {
      const parentKind = kind === "chapter" ? "volume" : "chapter";
      if (entities.find((row) => row.id === entity.parentId)?.kind !== parentKind) errors.push(`${entity.name}: 缺少有效的 ${parentKind} 父级`);
    }
    if (entity.status === "APPROVED") errors.push(...entityApprovalErrors(blueprint, entity).map((error) => `${entity.name}: ${error}`));
  }
  const expectedPlan: Partial<Record<StageId, EntityKind>> = { characters: "character", endings: "ending", branches: "criticalBranch", systems: "gameSystem" };
  for (const stage of ["characters", "endings", "systems"] as const) if (plans.filter((plan) => plan.stageId === stage).length !== 1) errors.push(`${stage}: 必须保留唯一的阶段规划清单`);
  const plannedItems = plans.flatMap((plan) => plan.items.map((item) => ({ item, plan })));
  if (new Set(plannedItems.map(({ item }) => item.id)).size !== plannedItems.length) errors.push("不同清单的项目 ID 不能重复");
  const suggestions = blueprint.workflowState.additionSuggestions;
  const reservedIds = new Set([...ids, ...plans.map((plan) => plan.id), ...plannedItems.map(({ item }) => item.id), "blueprint-review", "story-input"]);
  if (new Set(suggestions.map((suggestion) => suggestion.id)).size !== suggestions.length || suggestions.some((suggestion) => reservedIds.has(suggestion.id))) errors.push("新增建议 ID 重复或占用现有对象 ID");
  if (new Set(suggestions.flatMap((suggestion) => [suggestion.id, suggestion.item.id])).size !== suggestions.length * 2) errors.push("新增建议与建议项目 ID 重复");
  for (const suggestion of suggestions) {
    const plan = plans.find((row) => row.id === suggestion.outlineId);
    if (!plan || suggestion.item.kind !== expectedPlan[plan.stageId] || suggestion.item.source !== "AI") errors.push("新增建议的清单范围、实体类型或来源无效");
    const membership = plannedItems.find(({ item }) => item.id === suggestion.item.id);
    if (reservedIds.has(suggestion.item.id) && !(suggestion.status === "APPROVED" && membership?.plan.id === suggestion.outlineId)) errors.push("新增建议项目 ID 与现有对象冲突");
    for (const id of suggestion.item.relatedIds) { const target = entities.find((row) => row.id === id); if (!target) errors.push(`${suggestion.item.name}: 新增建议引用不存在`); else if (plan && !canReferenceEntity(blueprint, plan, target)) errors.push(`${suggestion.item.name}: 新增建议引用违反前置方向`); }
  }
  for (const plan of plans) {
    if (!expectedPlan[plan.stageId] || plan.items.some((item) => item.kind !== expectedPlan[plan.stageId])) errors.push(`${plan.name}: 清单与阶段类型不匹配`);
    if ((plan.stageId === "branches") !== Boolean(plan.parentId) || (plan.parentId && !blueprint.chapters.some((chapter) => chapter.id === plan.parentId))) errors.push(`${plan.name}: 章节范围无效`);
    if (new Set(plan.items.map((item) => item.id)).size !== plan.items.length) errors.push(`${plan.name}: 项目 ID 重复`);
    for (const id of plan.dependencies) { const target = entities.find((row) => row.id === id); if (!target) errors.push(`${plan.name}: 无效依赖 ${id}`); else if (!canReferenceEntity(blueprint, plan, target)) errors.push(`${plan.name}: 依赖违反前置方向 ${id}`); }
    for (const item of plan.items) {
      if (item.id === plan.id || item.id === "blueprint-review" || item.id === "story-input") errors.push(`${plan.name}: 非法项目 ID`);
      for (const id of item.relatedIds) { const target = entities.find((row) => row.id === id); if (!target) errors.push(`${item.name}: 无效清单引用 ${id}`); else if (!canReferenceEntity(blueprint, plan, target)) errors.push(`${item.name}: 清单引用违反前置方向 ${id}`); }
      if (plan.status === "APPROVED" && item.enabled && !entities.some((entity) => entity.id === item.id && entity.kind === item.kind && entity.parentId === plan.parentId)) errors.push(`${item.name}: 已确认清单缺少对应实体`);
    }
  }
  for (const entity of entities.filter((row) => ["character", "ending", "criticalBranch", "gameSystem"].includes(row.kind))) {
    const membership = plannedItems.find(({ item }) => item.id === entity.id);
    if (!membership || membership.item.kind !== entity.kind || membership.plan.parentId !== entity.parentId) errors.push(`${entity.name}: 实体没有对应的规划项目或范围不一致`);
  }
  if (blueprint.volumes.length !== blueprint.storyInput.volumeChapterCounts.length) errors.push("卷数与固定结构不一致");
  for (const [index, volume] of blueprint.volumes.entries()) {
    const chapters = blueprint.chapters.filter((chapter) => chapter.parentId === volume.id);
    if (volume.content.volumeNumber !== index + 1 || chapters.length !== blueprint.storyInput.volumeChapterCounts[index] || chapters.some((chapter, chapterIndex) => chapter.content.chapterNumber !== chapterIndex + 1)) errors.push(`${volume.name}: 卷章序号或数量与固定结构不一致`);
  }
  for (const chapter of blueprint.chapters) {
    if (blueprint.chapterCharacterPlans.filter((plan) => plan.parentId === chapter.id).length !== 1) errors.push(`${chapter.name}: 必须保留唯一的章节人物计划`);
    if (plans.filter((plan) => plan.stageId === "branches" && plan.parentId === chapter.id).length !== 1) errors.push(`${chapter.name}: 必须保留唯一的关键分支规划`);
  }
  // Detect dependency cycles without relying on order in an imported JSON array.
  const visiting = new Set<string>(); const visited = new Set<string>();
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  function visit(id: string): void {
    if (visiting.has(id)) { errors.push(`依赖关系存在循环：${id}`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) if (byId.has(dependency)) visit(dependency);
    visiting.delete(id); visited.add(id);
  }
  for (const id of ids) visit(id);
  const selected = blueprint.workflowState.selectedObjectId;
  if (selected === "story-input" ? blueprint.workflowState.currentStage !== "story" : selected && selected !== "blueprint-review" && !ids.has(selected) && !plans.some((plan) => plan.id === selected)) errors.push("当前审核对象不存在或阶段不匹配");
  const generating = [...entities, ...plans, { id: "blueprint-review", status: blueprint.workflowState.review.status }].filter((row) => row.status === "GENERATING");
  const active = blueprint.workflowState.activeGeneration;
  if (active ? (active.targetId === "story-input" ? generating.length !== 0 : generating.length !== 1 || generating[0].id !== active.targetId) || active.previousStatus === "GENERATING" : generating.length > 0) errors.push("生成状态与持久化任务不一致");
  return [...new Set(errors)];
}

export function diffBlueprints(before: Blueprint, after: Blueprint): Array<{ id: string; name: string; change: "ADDED" | "REMOVED" | "CHANGED" }> {
  const oldEntities = new Map(allEntities(before).map((entity) => [entity.id, entity]));
  const nextEntities = new Map(allEntities(after).map((entity) => [entity.id, entity]));
  const changes: Array<{ id: string; name: string; change: "ADDED" | "REMOVED" | "CHANGED" }> = [];
  for (const [id, entity] of nextEntities) {
    const old = oldEntities.get(id);
    if (!old) changes.push({ id, name: entity.name, change: "ADDED" });
    else if (JSON.stringify(old) !== JSON.stringify(entity)) changes.push({ id, name: entity.name, change: "CHANGED" });
  }
  for (const [id, entity] of oldEntities) if (!nextEntities.has(id)) changes.push({ id, name: entity.name, change: "REMOVED" });
  if (JSON.stringify(before.storyInput) !== JSON.stringify(after.storyInput)) changes.unshift({ id: "story-input", name: "基础输入 / 卷章结构", change: "CHANGED" });
  if (JSON.stringify(before.workflowState) !== JSON.stringify(after.workflowState)) changes.push({ id: "workflow-state", name: "Workflow 状态 / 清单 / 检查", change: "CHANGED" });
  return changes;
}
