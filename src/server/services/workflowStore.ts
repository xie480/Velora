/**
 * SQLite source of truth for the single editable Workflow and its permanent version snapshots.
 * Every mutation uses compare-and-swap; a stale browser or model response cannot overwrite newer work.
 */
import { sqlite } from "../db/index.js";
import { blueprintSchema, MAX_IMPORT_BYTES, migrateBlueprint } from "../../shared/workflow.js";
import type { Blueprint, VersionSnapshot, VersionSummary, WorkflowResponse } from "../../shared/workflow.js";
import { createBlueprint } from "../../shared/workflowEngine.js";

const workingId = "working";

export class WorkflowStoreError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 413 | 500 = 500,
    readonly errorCode: "REVISION_CONFLICT" | "WORKFLOW_CONSTRAINT" | "NOT_FOUND" | "PAYLOAD_TOO_LARGE" | "STORAGE_ERROR" = "STORAGE_ERROR",
  ) {
    super(message);
    this.name = "WorkflowStoreError";
  }
}

interface WorkingRow { revision: number; blueprintJson: string }
interface VersionRow {
  version: number;
  parentVersion: number | null;
  createdAt: number;
  description: string;
  userNote: string;
  finalized: number;
  blueprintJson?: string;
}
const versionColumns = "version, parent_version AS parentVersion, created_at AS createdAt, description, user_note AS userNote, finalized";

function parseStoredBlueprint(value: string): Blueprint {
  try {
    return blueprintSchema.parse(migrateBlueprint(JSON.parse(value)));
  } catch {
    throw new WorkflowStoreError("本地 Blueprint 数据无法读取，请保留数据库文件并检查日志。");
  }
}

function serializeBlueprint(blueprint: Blueprint): string {
  const validated = blueprintSchema.safeParse(blueprint);
  if (!validated.success) throw new WorkflowStoreError("Blueprint 数据未通过 Schema 校验，未覆盖本地数据。");
  const json = JSON.stringify(validated.data);
  if (Buffer.byteLength(json, "utf8") > MAX_IMPORT_BYTES) {
    throw new WorkflowStoreError("Blueprint 超过 5 MiB 保存限制，请缩减内容后重试。", 413, "PAYLOAD_TOO_LARGE");
  }
  return json;
}

function publicVersion(row: VersionRow): VersionSummary {
  return {
    version: row.version,
    parentVersion: row.parentVersion,
    createdAt: new Date(row.createdAt).toISOString(),
    description: row.description,
    userNote: row.userNote,
    finalized: row.finalized === 1,
  };
}

/** Lazily create a new empty project; loading an existing project never replaces its contents. */
export function getWorkingBlueprint(): { blueprint: Blueprint; revision: number } {
  let row = sqlite.prepare("SELECT revision, blueprint_json AS blueprintJson FROM workflow_working WHERE id = ?").get(workingId) as WorkingRow | undefined;
  if (!row) {
    const initial = createBlueprint();
    sqlite.prepare("INSERT OR IGNORE INTO workflow_working (id, revision, blueprint_json, updated_at) VALUES (?, ?, ?, ?)")
      .run(workingId, 0, serializeBlueprint(initial), Date.now());
    row = sqlite.prepare("SELECT revision, blueprint_json AS blueprintJson FROM workflow_working WHERE id = ?").get(workingId) as WorkingRow;
  }
  return { blueprint: parseStoredBlueprint(row.blueprintJson), revision: row.revision };
}

export function listBlueprintVersions(): VersionSummary[] {
  const rows = sqlite.prepare(`SELECT ${versionColumns} FROM workflow_versions ORDER BY version DESC`).all() as VersionRow[];
  return rows.map(publicVersion);
}

export function getWorkflowResponse(): WorkflowResponse {
  return { ...getWorkingBlueprint(), versions: listBlueprintVersions() };
}

export function assertWorkingRevision(expectedRevision: number): { blueprint: Blueprint; revision: number } {
  const current = getWorkingBlueprint();
  if (current.revision !== expectedRevision) {
    throw new WorkflowStoreError("工作副本已有新修改，请刷新后重新操作。", 409, "REVISION_CONFLICT");
  }
  return current;
}

/** Save is atomic and does not keep a transaction open during model requests. */
export function saveWorkingBlueprint(expectedRevision: number, blueprint: Blueprint): WorkflowResponse {
  const next = structuredClone(blueprint);
  next.metadata.updatedAt = new Date().toISOString();
  const json = serializeBlueprint(next);
  const updated = sqlite.prepare("UPDATE workflow_working SET blueprint_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?")
    .run(json, Date.now(), workingId, expectedRevision);
  if (updated.changes !== 1) throw new WorkflowStoreError("工作副本已有新修改，请刷新后重新操作。", 409, "REVISION_CONFLICT");
  return { blueprint: next, revision: expectedRevision + 1, versions: listBlueprintVersions() };
}

/** Snapshot INSERT and working-copy update share a short transaction; history cannot be rewritten. */
export function createBlueprintVersion(
  expectedRevision: number,
  description: string,
  userNote: string,
  finalized: boolean,
): WorkflowResponse {
  return sqlite.transaction(() => {
    const current = assertWorkingRevision(expectedRevision);
    if (current.blueprint.workflowState.activeGeneration) {
      throw new WorkflowStoreError("请先完成或取消当前生成，再创建版本。", 409, "WORKFLOW_CONSTRAINT");
    }
    const latest = sqlite.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM workflow_versions").get() as { version: number };
    const version = latest.version + 1;
    const proposedParent = current.blueprint.metadata.parentVersion;
    const parentVersion = proposedParent && sqlite.prepare("SELECT 1 FROM workflow_versions WHERE version = ?").get(proposedParent)
      ? proposedParent : null;
    const now = Date.now();
    const snapshot = structuredClone(current.blueprint);
    snapshot.blueprintVersion = version;
    snapshot.metadata.parentVersion = parentVersion;
    snapshot.metadata.description = description;
    snapshot.metadata.userNote = userNote;
    snapshot.metadata.updatedAt = new Date(now).toISOString();
    const json = serializeBlueprint(snapshot);
    sqlite.prepare(`INSERT INTO workflow_versions (version, parent_version, created_at, description, user_note, finalized, workflow_state_json, blueprint_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(version, parentVersion, now, description, userNote, finalized ? 1 : 0, JSON.stringify(snapshot.workflowState), json);
    // The next working snapshot derives from this newly created version; restoring changes this parent explicitly.
    const working = structuredClone(snapshot);
    working.metadata.parentVersion = version;
    return saveWorkingBlueprint(expectedRevision, working);
  })();
}

export function getBlueprintVersion(version: number): VersionSnapshot {
  const row = sqlite.prepare(`SELECT ${versionColumns}, blueprint_json AS blueprintJson FROM workflow_versions WHERE version = ?`).get(version) as VersionRow | undefined;
  if (!row?.blueprintJson) throw new WorkflowStoreError("历史版本不存在。", 404, "NOT_FOUND");
  return { ...publicVersion(row), blueprint: parseStoredBlueprint(row.blueprintJson) };
}

/** Copy a historical snapshot into the working row while retaining every existing history record. */
export function restoreBlueprintVersion(expectedRevision: number, version: number): WorkflowResponse {
  return sqlite.transaction(() => {
    assertWorkingRevision(expectedRevision);
    const snapshot = getBlueprintVersion(version);
    const working = structuredClone(snapshot.blueprint);
    working.metadata.parentVersion = version;
    working.workflowState.activeGeneration = null;
    return saveWorkingBlueprint(expectedRevision, working);
  })();
}
