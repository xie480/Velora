import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createBlueprint } from "../src/shared/workflowEngine.js";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "velora-workflow-migration-"));
process.env.DATABASE_FILE = join(temporaryDirectory, "blueprint.sqlite");
const runtime = await import("../src/server/db/index.js");
const store = await import("../src/server/services/workflowStore.js");
after(() => {
  runtime.closeDatabase();
  assert.equal(dirname(resolve(temporaryDirectory)), resolve(tmpdir()));
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("旧版 Working 与历史快照读取为 v2，保留意向文本且不修改历史原始 JSON", () => {
  const current = createBlueprint();
  const legacy = { ...current, schemaVersion: 1, workflowState: { ...current.workflowState, outlinePlans: current.workflowState.outlinePlans.map((plan, index) => index === 0 ? { ...plan, status: "PENDING_REVIEW", items: [{ id: "legacy-alice", name: "Alice", kind: "character", source: "USER", purpose: "照片调查角色", required: true, enabled: true, relatedIds: [], volumeNumbers: [1, 2], userModified: false }] } : plan) } };
  const raw = JSON.stringify(legacy);
  runtime.sqlite.prepare("INSERT INTO workflow_working (id, revision, blueprint_json, updated_at) VALUES (?, ?, ?, ?)").run("working", 5, raw, 1);
  runtime.sqlite.prepare("INSERT INTO workflow_versions (version, parent_version, created_at, description, user_note, finalized, workflow_state_json, blueprint_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(1, null, 1, "旧快照", "", 0, JSON.stringify(legacy.workflowState), raw);
  const working = store.getWorkingBlueprint();
  assert.equal(working.revision, 5);
  assert.equal(working.blueprint.schemaVersion, 2);
  const item = working.blueprint.workflowState.outlinePlans[0].items[0];
  assert.equal("volumeNumbers" in item, false);
  assert.match(item.purpose, /1/);
  assert.match(item.purpose, /2/);
  assert.match(item.purpose, /意向/);
  assert.equal(store.getBlueprintVersion(1).blueprint.schemaVersion, 2);
  const originalSnapshot = runtime.sqlite.prepare("SELECT blueprint_json AS data FROM workflow_versions WHERE version = 1").get() as { data: string };
  assert.equal(originalSnapshot.data, raw);
  const originalWorking = runtime.sqlite.prepare("SELECT blueprint_json AS data FROM workflow_working WHERE id = 'working'").get() as { data: string };
  assert.equal(originalWorking.data, raw, "只读加载不隐式写入 Working");
  store.saveWorkingBlueprint(working.revision, working.blueprint);
  assert.equal(store.getWorkingBlueprint().revision, 6);
  assert.equal(JSON.parse((runtime.sqlite.prepare("SELECT blueprint_json AS data FROM workflow_working WHERE id = 'working'").get() as { data: string }).data).schemaVersion, 2);
  assert.equal((runtime.sqlite.prepare("SELECT blueprint_json AS data FROM workflow_versions WHERE version = 1").get() as { data: string }).data, raw);
});
