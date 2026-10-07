import assert from "node:assert/strict";
import test from "node:test";
import { contentSchemas, emptyContent, entityApprovalErrors, previewImport, storyInputSchema, validateBlueprintStructure } from "../src/shared/workflow.js";
import { createBlueprint } from "../src/shared/workflowEngine.js";

test("基础 JSON 导入检查必填、未知字段和无效 JSON，不接受静默覆盖", () => {
  assert.equal(previewImport("story", "{bad json").valid, false);
  assert.equal(previewImport("story", {}).valid, false);
  const input = { name: "晨雾", genre: "悬疑", outline: "寻找失踪的同学", presetCharacters: ["Alice"] };
  const valid = previewImport("story", input);
  assert.equal(valid.valid, true);
  assert.ok(valid.summary.some((entry) => entry.includes("晨雾")));
  const unknown = previewImport("story", { ...input, unrecognized: "内容" });
  assert.equal(unknown.valid, false);
  assert.ok(unknown.warnings.some((warning) => warning.includes("unrecognized")));
  assert.equal(previewImport("story", { ...input, presetCharacters: "Alice" }).valid, false);
});

test("用户卷章结构限制零、负数和总章节溢出", () => {
  assert.equal(storyInputSchema.safeParse({ volumeChapterCounts: [0] }).success, false);
  assert.equal(storyInputSchema.safeParse({ volumeChapterCounts: [-1] }).success, false);
  assert.equal(storyInputSchema.safeParse({ volumeChapterCounts: [100, 100, 100, 100, 100, 1] }).success, false);
  assert.equal(storyInputSchema.safeParse({ volumeChapterCounts: [10, 12, 8] }).success, true);
});

test("动态属性具有角色自己的范围，禁止初始越界或未知数据字段", () => {
  const content = emptyContent("character");
  assert.equal(contentSchemas.character.safeParse({ ...content, dynamicAttributes: [{ key: "trust", label: "信任", min: 0, max: 100, initial: 101 }] }).success, false);
  assert.equal(contentSchemas.character.safeParse({ ...content, dynamicAttributes: [{ key: "stress", label: "压力", min: 0, max: 10, initial: 3 }] }).success, true);
  assert.equal(contentSchemas.character.safeParse({ ...content, runtimeAgent: {} }).success, false);
});

test("Blueprint Schema Version、实体类型、ID 唯一性、悬空引用在导入边界校验", () => {
  const blueprint = createBlueprint();
  assert.equal(previewImport("blueprint", blueprint).valid, true);
  assert.equal(previewImport("blueprint", { ...blueprint, schemaVersion: 999 }).valid, false);
  const wrong = structuredClone(blueprint);
  wrong.characters.push({ ...wrong.storyBible, kind: "ending" });
  assert.ok(validateBlueprintStructure(wrong).some((error) => error.includes("不匹配")));
  assert.equal(previewImport("blueprint", wrong).valid, false);
  const dangling = structuredClone(blueprint);
  dangling.storyBible.dependencies = ["missing"];
  assert.equal(previewImport("blueprint", dangling).valid, false);
  const cycle = structuredClone(blueprint);
  cycle.storyBible.dependencies = [cycle.storyBible.id];
  assert.equal(previewImport("blueprint", cycle).valid, false);
});

test("导入不能用 APPROVED 元数据掩盖空白实体", () => {
  const blueprint = createBlueprint();
  blueprint.storyBible.status = "APPROVED";
  assert.equal(previewImport("blueprint", blueprint).valid, false);
  assert.ok(entityApprovalErrors(blueprint, blueprint.storyBible).length > 0);
});

test("隐藏分支必须有解锁条件与实际影响，章节人物计划不得使用未定义属性", () => {
  const blueprint = createBlueprint();
  const branch = { ...blueprint.storyBible, id: "branch-test", kind: "criticalBranch" as const, parentId: "chapter-test", content: { ...emptyContent("criticalBranch"), background: "选择是否公开照片", endingIds: [], choices: [{ id: "secret", label: "秘密联络", hidden: true, unlockConditions: [], effects: [], relationshipEffects: [], futureChapterEffects: [], opensRoutes: [], closesRoutes: [], endingIds: [] }] } };
  const errors = entityApprovalErrors(blueprint, branch);
  assert.ok(errors.some((error) => error.includes("两个选项")));
  assert.ok(errors.some((error) => error.includes("解锁")));
  assert.ok(errors.some((error) => error.includes("影响")));
});
