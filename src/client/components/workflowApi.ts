import { useEffect, useSyncExternalStore } from "react";

const API_ROOT = "/api/workflow";
const JOURNAL_KEY = "chronicle.workflow.unsaved.v1";
const AUTO_SAVE_DELAY_MS = 700;
const POLL_INTERVAL_MS = 1000;

export type SaveState = "loading" | "saved" | "dirty" | "saving" | "failed" | "conflict";
export interface WorkflowResponse<TBlueprint, TVersion> {
  blueprint: TBlueprint;
  revision: number;
  versions: TVersion[];
}
export interface PendingCommand {
  key: string;
  command: Record<string, unknown>;
  sequence: number;
}
interface ControllerState<TBlueprint, TVersion> {
  response: WorkflowResponse<TBlueprint, TVersion> | null;
  pending: PendingCommand[];
  saveState: SaveState;
  error: string | null;
  busy: boolean;
}

export class WorkflowRequestError extends Error {
  constructor(message: string, readonly status: number, readonly errorCode?: string) {
    super(message);
  }
}

export async function workflowRequest<T>(path = "", init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string; message?: string; errorCode?: string };
  if (!response.ok) throw new WorkflowRequestError(payload.error ?? payload.message ?? `请求失败（HTTP ${response.status}）`, response.status, payload.errorCode);
  return payload;
}

/** The queue survives view changes. Each response advances the revision used by the next write. */
export class WorkflowController<TBlueprint, TVersion> {
  private state: ControllerState<TBlueprint, TVersion> = { response: null, pending: [], saveState: "loading", error: null, busy: false };
  private listeners = new Set<() => void>();
  private tail: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;
  private initialized = false;
  private loading: Promise<void> | null = null;
  private journalRevision: number | null = null;
  private journalConflict = false;

  constructor() {
    try {
      const journal = JSON.parse(localStorage.getItem(JOURNAL_KEY) ?? "null") as { revision?: number; pending?: PendingCommand[]; conflict?: boolean } | null;
      if (journal && Number.isInteger(journal.revision) && Array.isArray(journal.pending)) {
        const pending = journal.pending.filter((entry) => typeof entry.key === "string" && entry.command && typeof entry.command === "object" && Number.isInteger(entry.sequence));
        this.state = { ...this.state, pending };
        this.sequence = pending.reduce((max, entry) => Math.max(max, entry.sequence), 0);
        this.journalRevision = journal.revision ?? null;
        this.journalConflict = journal.conflict === true;
      }
    } catch { /* A malformed local recovery journal must never replace the server document. */ }
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(update: Partial<ControllerState<TBlueprint, TVersion>>) {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }

  private journal() {
    try {
      if (!this.state.pending.length) localStorage.removeItem(JOURNAL_KEY);
      else localStorage.setItem(JOURNAL_KEY, JSON.stringify({ revision: this.state.response?.revision ?? this.journalRevision, pending: this.state.pending, conflict: this.state.saveState === "conflict" }));
    } catch {
      this.publish({ error: "浏览器无法保存未提交草稿备份；请先手动保存，再关闭页面。" });
    }
  }

  async initialize() {
    if (this.initialized) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const response = await workflowRequest<WorkflowResponse<TBlueprint, TVersion>>();
        const conflict = this.state.pending.length > 0 && (this.journalConflict || this.journalRevision !== response.revision);
        this.publish({ response, saveState: conflict ? "conflict" : this.state.pending.length ? "dirty" : "saved", error: conflict ? "恢复的本地草稿与服务器版本不同。草稿已保留，请先检查差异并决定如何应用。" : null });
        this.initialized = true;
        if (this.state.pending.length && !conflict) this.scheduleSave();
      } catch (error) {
        this.publish({ saveState: "failed", error: error instanceof Error ? error.message : "无法读取本地 Blueprint。" });
      } finally { this.loading = null; }
    })();
    return this.loading;
  }

  setDraft(key: string, command: Record<string, unknown>) {
    const entry = { key, command, sequence: ++this.sequence };
    this.publish({ pending: [...this.state.pending.filter((item) => item.key !== key), entry], saveState: this.state.saveState === "conflict" ? "conflict" : "dirty" });
    this.journal();
    if (this.state.saveState !== "conflict") this.scheduleSave();
  }

  private scheduleSave() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush().catch(() => undefined); }, AUTO_SAVE_DELAY_MS);
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => undefined);
    return next;
  }

  private fail(error: unknown) {
    const conflict = this.state.saveState === "conflict" || (error instanceof WorkflowRequestError && error.status === 409 && (error.errorCode === "REVISION_CONFLICT" || error.message === "工作副本已有新修改，请刷新后重新操作。"));
    this.publish({ saveState: conflict ? "conflict" : this.state.pending.length || !this.state.response ? "failed" : "saved", error: error instanceof Error ? error.message : "保存失败，草稿仍然保留。", busy: false });
    this.journal();
  }

  private async savePending() {
    if (this.state.saveState === "conflict") throw new Error("当前存在版本冲突，请先处理保留的草稿。");
    if (!this.state.response) throw new Error("Blueprint 尚未加载。");
    while (this.state.pending.length) {
      const entry = this.state.pending[0];
      this.publish({ saveState: "saving" });
      const response = await workflowRequest<WorkflowResponse<TBlueprint, TVersion>>("/commands", {
        method: "POST", body: JSON.stringify({ revision: this.state.response.revision, command: entry.command }),
      });
      this.publish({ response, pending: this.state.pending.filter((item) => item.sequence !== entry.sequence), error: null });
      this.journal();
    }
    this.publish({ saveState: "saved" });
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    return this.serial(async () => {
      try { await this.savePending(); }
      catch (error) { this.fail(error); throw error; }
    });
  }

  mutate(path: string, body: Record<string, unknown>) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    return this.serial(async () => {
      try {
        await this.savePending();
        this.publish({ busy: true, error: null });
        const response = await workflowRequest<WorkflowResponse<TBlueprint, TVersion>>(path, {
          method: "POST", body: JSON.stringify({ ...body, revision: this.state.response!.revision }),
        });
        this.publish({ response, busy: false, saveState: this.state.pending.length ? "dirty" : "saved" });
        this.journal();
        return response;
      } catch (error) { this.fail(error); throw error; }
    });
  }

  command(command: Record<string, unknown>) { return this.mutate("/commands", { command }); }

  /** Polling never races queued writes or rebases a local draft silently. */
  poll() {
    return this.serial(async () => {
      if (this.state.pending.length || this.state.saveState === "conflict" || this.state.busy) return;
      try {
        const response = await workflowRequest<WorkflowResponse<TBlueprint, TVersion>>();
        if (!this.state.response || response.revision >= this.state.response.revision) this.publish({ response });
      } catch (error) {
        this.publish({ error: error instanceof Error ? error.message : "生成状态读取失败。" });
      }
    });
  }

  async reloadKeepingDrafts() {
    await this.serial(async () => {
      const response = await workflowRequest<WorkflowResponse<TBlueprint, TVersion>>();
      this.publish({ response, saveState: this.state.pending.length ? "conflict" : "saved", error: this.state.pending.length ? "已读取最新版本。本地草稿仍保留，应用前请确认不会覆盖其他窗口的修改。" : null });
      this.journal();
    });
  }

  applyRecoveredDrafts() {
    this.publish({ saveState: this.state.pending.length ? "dirty" : "saved", error: null });
    this.journal();
    return this.flush();
  }

  discardDrafts() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.publish({ pending: [], saveState: "saved", error: null });
    this.journal();
  }
}

export function useWorkflowController<TBlueprint, TVersion>(controller: WorkflowController<TBlueprint, TVersion>, shouldPoll: (value: TBlueprint) => boolean) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    void controller.initialize().then(() => controller.poll());
    const poll = setInterval(() => { const document = controller.getSnapshot().response?.blueprint; if (document && shouldPoll(document)) void controller.poll(); }, POLL_INTERVAL_MS);
    const refreshOnFocus = () => void controller.poll();
    const guard = (event: BeforeUnloadEvent) => {
      const current = controller.getSnapshot();
      if (!current.pending.length && !current.busy) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    window.addEventListener("focus", refreshOnFocus);
    return () => { clearInterval(poll); window.removeEventListener("beforeunload", guard); window.removeEventListener("focus", refreshOnFocus); void controller.flush().catch(() => undefined); };
  }, [controller]);
  return state;
}
