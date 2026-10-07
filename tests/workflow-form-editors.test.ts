import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FormField, StructuredField } from "../src/client/components/WorkflowFieldEditors.tsx";
import { fieldPresentation } from "../src/client/components/workflowFields.ts";
import { emptyContent, entityFields, entityKinds, storyInputFields } from "../src/shared/workflow.js";
import type { EntityKind, FieldDefinition, WorkflowEntity } from "../src/shared/workflow.js";
import { createBlueprint } from "../src/shared/workflowEngine.js";

class LocalDraftStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function withLocalStorage<T>(run: (storage: LocalDraftStorage) => T): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = new LocalDraftStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try { return run(storage); }
  finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

function fixture() {
  const blueprint = createBlueprint();
  const entity = (kind: EntityKind, id = `fixture-${kind}`): WorkflowEntity => ({
    ...blueprint.storyBible, id, kind, name: `测试 ${kind}`, content: emptyContent(kind),
  });
  blueprint.storyBible.content.locations = ["邮局"];
  blueprint.characters = [entity("character", "char-a"), entity("character", "char-b")];
  blueprint.characters[0].content.dynamicAttributes = [{ key: "trust", label: "信任", min: 0, max: 100, initial: 10 }];
  blueprint.endings = [entity("ending", "ending-a")];
  blueprint.chapters = [entity("chapter", "chapter-a")];
  return { blueprint, entity, candidates: [...blueprint.characters, ...blueprint.endings, ...blueprint.chapters] };
}

function structuredField(kind: EntityKind, key: string): FieldDefinition {
  const field = entityFields[kind].find((item) => item.key === key);
  assert.ok(field && field.type === "json", `${kind}.${key} should be a structured field`);
  return field;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" }[char]!));
}

// SSR executes the real initial recovery/render path without effects, a browser or a database.
function renderRecovery(kind: EntityKind, key: string, raw: string): string {
  return withLocalStorage((storage) => {
    const { blueprint, entity, candidates } = fixture();
    const row = entity(kind);
    const field = structuredField(kind, key);
    const journal = `chronicle.workflow.field.${row.id}.${key}`;
    storage.setItem(journal, raw);
    const savedContent = JSON.stringify(row.content);
    const html = renderToString(createElement(StructuredField, {
      field, entity: row, blueprint, candidates, value: row.content[key], disabled: false,
      onChange() { assert.fail("rendering recovered text must not write Blueprint content"); },
      onError() { assert.fail("SSR must not run recovery effects"); },
    }));
    const textareas = [...html.matchAll(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/g)].map((match) => match[1]);
    assert.ok(textareas.includes(escapeHtml(raw)), `${kind}.${key} must preserve the exact advanced JSON draft`);
    assert.equal(storage.getItem(journal), raw, "rendering must preserve the local journal");
    assert.equal(JSON.stringify(row.content), savedContent, "recovery must not mutate saved content");
    return html;
  });
}

test("all structured fields preserve malformed or incompatible recovered JSON without crashing", () => {
  for (const kind of entityKinds) {
    for (const field of entityFields[kind].filter((item) => item.type === "json")) {
      for (const raw of ["[null]", "null", '{"incomplete":']) renderRecovery(kind, field.key, raw);
    }
  }
});

test("nested character changes and choice lists reject unsafe recovery rows while retaining their raw text", () => {
  const character = {
    characterId: "char-a", startState: "", goal: "", mentalChange: "", relationshipChange: "",
    knownInformation: [], forbiddenInformation: [], attributeChanges: [], endState: "",
  };
  // char-a has a trust definition: the old renderer dereferenced null.key in changes.find().
  for (const patch of [
    { attributeChanges: [null] },
    { attributeChanges: [{ key: "trust", delta: "invalid" }] },
    { knownInformation: { fact: "not a list" } },
    { knownInformation: [null] },
    { forbiddenInformation: [{ fact: "not text" }] },
  ]) renderRecovery("chapterCharacterPlan", "characters", JSON.stringify([{ ...character, ...patch }]));

  const choice = {
    id: "choice-a", label: "公开照片", hidden: false, unlockConditions: [], effects: [],
    relationshipEffects: [], futureChapterEffects: [], opensRoutes: [], closesRoutes: [], endingIds: [],
  };
  for (const key of ["unlockConditions", "effects", "relationshipEffects", "futureChapterEffects", "opensRoutes", "closesRoutes", "endingIds"]) {
    for (const invalid of [[null], { broken: "not a list" }]) {
      renderRecovery("criticalBranch", "choices", JSON.stringify([{ ...choice, [key]: invalid }]));
    }
  }
});

test("valid structured journals recover typed rows and defined character attribute changes", () => {
  const recovered = JSON.stringify([{
    characterId: "char-a", startState: "已恢复的起始状态", goal: "调查", mentalChange: "", relationshipChange: "",
    knownInformation: ["照片来自事故当天"], forbiddenInformation: [], attributeChanges: [{ key: "trust", delta: 7 }], endState: "",
  }]);
  const html = renderRecovery("chapterCharacterPlan", "characters", recovered);
  assert.ok(html.includes("信任变化量"), "the character's own attribute definition must render");
  assert.ok(html.includes('value="7"'), "a valid recovered delta must populate the numeric control");
  const textareaBodies = [...html.matchAll(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/g)].map((match) => match[1]);
  assert.ok(textareaBodies.includes("已恢复的起始状态"), "valid journals must recover editable row values");
});

test("every story and entity field has help/example metadata and renders through its real editor", () => {
  withLocalStorage(() => {
    const { blueprint, entity, candidates } = fixture();
    const nameField: FieldDefinition = { key: "name", label: "名称", type: "text", required: true };
    const checkMetadata = (kind: EntityKind | "storyInput", field: FieldDefinition) => {
      const presentation = fieldPresentation(kind, field);
      assert.ok(presentation.help.trim(), `${kind}.${field.key} needs help text`);
      assert.ok(presentation.example.trim(), `${kind}.${field.key} needs an example`);
    };
    for (const field of storyInputFields) {
      checkMetadata("storyInput", field);
      assert.ok(renderToString(createElement(FormField, {
        field, kind: "storyInput", value: blueprint.storyInput[field.key], disabled: false,
        candidates, scope: "story-input", onChange() {},
      })));
    }
    for (const kind of entityKinds) {
      const row = entity(kind);
      for (const field of [nameField, ...entityFields[kind]]) {
        checkMetadata(kind, field);
        const html = field.type === "json"
          ? renderToString(createElement(StructuredField, {
            field, entity: row, blueprint, candidates, value: row.content[field.key], disabled: false,
            onChange() {}, onError() {},
          }))
          : renderToString(createElement(FormField, {
            field, kind, value: field.key === "name" ? row.name : row.content[field.key], disabled: false,
            candidates, scope: row.id, onChange() {},
          }));
        assert.ok(html, `${kind}.${field.key} should render`);
      }
    }
  });
});
