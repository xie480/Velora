import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkflowController } from "../src/client/components/workflowApi.js";

class LocalDraftStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

interface TestDocument { value: string }
interface FakeServer { revision: number; blueprint: TestDocument; versions: never[] }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }

function environment() {
  const storage = new LocalDraftStorage();
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  const server: FakeServer = { revision: 0, blueprint: { value: "saved" }, versions: [] };
  const controllers: Array<WorkflowController<TestDocument, never>> = [];
  return {
    storage, server,
    createController() { const controller = new WorkflowController<TestDocument, never>(); controllers.push(controller); return controller; },
    cleanup() {
      for (const controller of controllers) controller.discardDrafts();
      globalThis.fetch = previousFetch;
      if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
      else Reflect.deleteProperty(globalThis, "localStorage");
    },
  };
}

test("revision conflict remains explicit after reloading latest data and reopening the page", async (context) => {
  const env = environment(); context.after(env.cleanup);
  let writes = 0;
  globalThis.fetch = async (_url, init) => {
    if (!init?.method) return response(env.server);
    writes += 1;
    return response({ error: "服务器已有新版本", errorCode: "REVISION_CONFLICT" }, 409);
  };
  const original = env.createController();
  await original.initialize();
  original.setDraft("value", { type: "edit", value: "retained draft" });
  env.server.revision = 1;
  await assert.rejects(original.flush());
  assert.equal(original.getSnapshot().saveState, "conflict");
  await original.reloadKeepingDrafts();
  assert.equal(original.getSnapshot().response?.revision, 1);
  const reopened = env.createController();
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().saveState, "conflict", "refresh must not authorize replaying a previously conflicted draft");
  await assert.rejects(reopened.flush());
  assert.equal(writes, 1, "no recovery write is allowed without an explicit user decision");
  assert.equal(reopened.getSnapshot().pending[0].command.value, "retained draft");
});

test("workflow validation errors do not masquerade as storage revision conflicts", async (context) => {
  const env = environment(); context.after(env.cleanup);
  globalThis.fetch = async (_url, init) => init?.method
    ? response({ error: "请先审批之前的必需项目", errorCode: "WORKFLOW_CONSTRAINT" }, 409)
    : response(env.server);
  const controller = env.createController(); await controller.initialize();
  await assert.rejects(controller.command({ type: "approveEntity", entityId: "later" }));
  assert.equal(controller.getSnapshot().saveState, "saved");
  assert.equal(controller.getSnapshot().pending.length, 0);
  assert.match(controller.getSnapshot().error ?? "", /审批/);
});

test("typing during an in-flight autosave retains the newer edit and advances revisions serially", async (context) => {
  const env = environment(); context.after(env.cleanup);
  let releaseFirst: (() => void) | undefined;
  let reportStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { reportStarted = resolve; });
  const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const writtenRevisions: number[] = [];
  globalThis.fetch = async (_url, init) => {
    if (!init?.method) return response(env.server);
    const body = JSON.parse(String(init.body)) as { revision: number; command: { value: string } };
    writtenRevisions.push(body.revision);
    if (writtenRevisions.length === 1) { reportStarted!(); await firstRelease; }
    assert.equal(body.revision, env.server.revision);
    env.server.blueprint = { value: body.command.value }; env.server.revision += 1;
    return response(env.server);
  };
  const controller = env.createController(); await controller.initialize();
  controller.setDraft("value", { type: "edit", value: "first" });
  const saving = controller.flush(); await started;
  controller.setDraft("value", { type: "edit", value: "second" }); releaseFirst!();
  await saving;
  assert.equal(controller.getSnapshot().response?.blueprint.value, "second");
  assert.equal(controller.getSnapshot().pending.length, 0);
  assert.equal(controller.getSnapshot().saveState, "saved");
  assert.deepEqual(writtenRevisions, [0, 1]);
});

test("actions flush dirty fields before using the next authoritative revision", async (context) => {
  const env = environment(); context.after(env.cleanup);
  const commands: string[] = [];
  globalThis.fetch = async (_url, init) => {
    if (!init?.method) return response(env.server);
    const body = JSON.parse(String(init.body)) as { revision: number; command: { type: string; value?: string } };
    assert.equal(body.revision, env.server.revision);
    commands.push(body.command.type);
    if (body.command.type === "edit") env.server.blueprint = { value: body.command.value! };
    env.server.revision += 1;
    return response(env.server);
  };
  const controller = env.createController(); await controller.initialize();
  controller.setDraft("value", { type: "edit", value: "draft before selection" });
  await controller.command({ type: "select", stageId: "characters", objectId: null });
  assert.deepEqual(commands, ["edit", "select"]);
  assert.equal(controller.getSnapshot().response?.blueprint.value, "draft before selection");
  assert.equal(controller.getSnapshot().response?.revision, 2);
});
