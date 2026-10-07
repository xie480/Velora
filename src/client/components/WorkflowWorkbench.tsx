import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowRight, BookOpen, Check, CheckCircle2, Circle, CircleAlert, Clock3, Download, FileJson, GitBranch, History, ListTree, Plus, RefreshCw, Save, Settings2, ShieldCheck, Sparkles, Square, Trash2, Upload, X } from "lucide-react";
import { allEntities, allowedReferenceEntities, diffBlueprints, entityApprovalErrors, entityFields, entityStage, MAX_IMPORT_BYTES, stages, storyInputFields } from "../../shared/workflow";
import type { Blueprint, EntityKind, ImportPreview, OutlineItem, OutlinePlan, StageId, VersionSnapshot, VersionSummary, WorkflowEntity } from "../../shared/workflow";
import { assertCanGenerate, getStageEntities, getStageStatus } from "../../shared/workflowEngine";
import { assertCanFormFill, getFormFillFields } from "../../shared/workflowFormAI";
import { useWorkflowController, WorkflowController, workflowRequest } from "./workflowApi";
import { FormField, ReferenceChoices, StructuredField } from "./WorkflowFieldEditors";
import { friendlyFieldLabel } from "./workflowFields";
import "./workflow.css";

const controller = new WorkflowController<Blueprint, VersionSummary>();
const stageLabels: Record<string, string> = { NOT_STARTED: "未开始", PLANNING: "正在规划", OUTLINE_REVIEW: "清单待审核", IN_PROGRESS: "进行中", READY_TO_CONFIRM: "可确认阶段", CONFIRMED: "已确认", NEEDS_REVIEW: "需要重新审核", DRAFT: "未生成 / 草稿", GENERATING: "正在生成", PENDING_REVIEW: "待审核", APPROVED: "已通过", REJECTED: "已拒绝" };
const kindLabels: Record<EntityKind, string> = { storyBible: "Story Bible", character: "人物", relationships: "人物关系总览", ending: "结局", volume: "卷级规划", chapter: "章节走向", chapterCharacterPlan: "章节人物变化", criticalBranch: "关键分支", gameSystem: "SLG 系统", initialWorldState: "初始世界状态" };
const saveLabels = { loading: "正在读取", saved: "已保存", dirty: "存在未保存修改", saving: "保存中", failed: "保存失败", conflict: "版本冲突 · 草稿已保留" };
const CHAPTER_COUNTS_BUFFER = "chronicle.workflow.chapterCountsRaw.v1";
function readCountsBuffer(): string | null { try { return localStorage.getItem(CHAPTER_COUNTS_BUFFER); } catch { return null; } }
function parseChapterCounts(raw: string): number[] | null {
  const counts = raw.split(/[,，\s]+/).filter(Boolean).map(Number);
  return counts.length > 0 && counts.length <= 30 && counts.every((count) => Number.isInteger(count) && count >= 1 && count <= 100) && counts.reduce((sum, count) => sum + count, 0) <= 500 ? counts : null;
}

function Status({ status }: { status: string }) {
  const Icon = status === "APPROVED" || status === "CONFIRMED" ? CheckCircle2 : status === "NEEDS_REVIEW" || status === "REJECTED" ? CircleAlert : status === "DRAFT" || status === "NOT_STARTED" ? Circle : Clock3;
  return <span className={`workflow-status workflow-status--${status}`}><Icon size={13} aria-hidden="true" />{stageLabels[status] ?? status}</span>;
}

function Modal({ title, children, footer, onClose }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab" || !ref.current) return;
      const targets = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]')];
      if (!targets.length) return;
      if (event.shiftKey && (document.activeElement === targets[0] || document.activeElement === ref.current)) { event.preventDefault(); targets[targets.length - 1].focus(); }
      else if (!event.shiftKey && (document.activeElement === targets[targets.length - 1] || document.activeElement === ref.current)) { event.preventDefault(); targets[0].focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", onKey); previousFocus?.focus(); };
  }, []);
  return <div className="workflow-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="workflow-modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="workflow-modal-title" tabIndex={-1}><header className="workflow-modal__header"><div><span className="eyebrow">BLUEPRINT WORKSPACE</span><h2 id="workflow-modal-title">{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭弹窗"><X size={17} aria-hidden="true" /></button></header><div className="workflow-modal__body">{children}</div>{footer && <footer className="workflow-modal__footer">{footer}</footer>}</section></div>;
}

function overlayDrafts(blueprint: Blueprint, pending: ReturnType<typeof controller.getSnapshot>["pending"]): Blueprint {
  if (!pending.length) return blueprint;
  const copy = structuredClone(blueprint);
  for (const { command } of pending) {
    if (command.type === "updateStoryInput") copy.storyInput = command.input as Blueprint["storyInput"];
    if (command.type === "updateEntity") {
      const entity = allEntities(copy).find((row) => row.id === command.entityId);
      if (entity) { entity.name = command.name as string; entity.content = command.content as WorkflowEntity["content"]; entity.userModified = true; }
    }
    if (command.type === "updateOutline") {
      const plan = copy.workflowState.outlinePlans.find((row) => row.id === command.outlineId);
      if (plan) { plan.items = command.items as OutlineItem[]; plan.userModified = true; }
    }
  }
  return copy;
}

interface OutlineRow { id: string; name: string; entity?: WorkflowEntity; plan?: OutlinePlan; group?: string; virtual?: boolean }
function stageOutline(blueprint: Blueprint, stageId: StageId): OutlineRow[] {
  const entities = getStageEntities(blueprint, stageId);
  const plans = blueprint.workflowState.outlinePlans.filter((plan) => plan.stageId === stageId);
  if (stageId === "story") return [{ id: "story-input", name: "基础创作表单" }, ...entities.map((entity) => ({ id: entity.id, name: entity.name, entity }))];
  if (stageId === "review") return [{ id: "blueprint-review", name: "Blueprint 总体检查" }];
  if (stageId === "branches") return blueprint.chapters.flatMap((chapter) => {
    const plan = plans.find((row) => row.parentId === chapter.id);
    const changes = entities.filter((row) => row.kind === "chapterCharacterPlan" && row.parentId === chapter.id);
    const branches = entities.filter((row) => row.kind === "criticalBranch" && row.parentId === chapter.id);
    return [...changes.map((entity) => ({ id: entity.id, name: entity.name, entity, group: chapter.name })), { id: plan?.id ?? `outline-branches-${chapter.id}`, name: plan?.name ?? "本章关键分支清单", plan, group: chapter.name, virtual: !plan }, ...branches.map((entity) => ({ id: entity.id, name: entity.name, entity, group: chapter.name }))];
  });
  if (stageId === "characters" || stageId === "endings" || stageId === "systems") {
    const plan = plans[0];
    return [{ id: plan?.id ?? `outline-${stageId}`, name: plan?.name ?? `${stages.find((stage) => stage.id === stageId)?.name} Outline Plan`, plan, virtual: !plan }, ...entities.map((entity) => ({ id: entity.id, name: entity.name, entity }))];
  }
  return entities.map((entity) => ({ id: entity.id, name: entity.name, entity, ...(entity.kind === "chapter" ? { group: blueprint.volumes.find((volume) => volume.id === entity.parentId)?.name } : {}) }));
}

function generationProblem(blueprint: Blueprint, targetId: string): string | null {
  try { assertCanGenerate(blueprint, targetId); return null; }
  catch (error) { return error instanceof Error ? error.message : "请先完成前置审批"; }
}

export function WorkflowWorkbench({ onOpenProviders }: { onOpenProviders: () => void }) {
  const state = useWorkflowController(controller, (value) => Boolean(value.workflowState.activeGeneration));
  const blueprint = useMemo(() => state.response ? overlayDrafts(state.response.blueprint, state.pending) : null, [state.response, state.pending]);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [instructions, setInstructions] = useState("");
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [modal, setModal] = useState<"import" | "versions" | "createVersion" | "resolveConflict" | null>(null);
  const [importKind, setImportKind] = useState<"story" | "blueprint">("story");
  const [importText, setImportText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [version, setVersion] = useState<VersionSnapshot | null>(null);
  const [compareVersion, setCompareVersion] = useState<VersionSnapshot | null>(null);
  const [versionDescription, setVersionDescription] = useState("");
  const [versionNote, setVersionNote] = useState("");
  const [finalize, setFinalize] = useState(false);
  const [countsRaw, setCountsRaw] = useState(() => readCountsBuffer() ?? "");
  const countsEdited = useRef(readCountsBuffer() !== null);
  const fileInput = useRef<HTMLInputElement>(null);
  const versionRequest = useRef(0);
  const importRequest = useRef(0);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const countsDirty = countsEdited.current && JSON.stringify(parseChapterCounts(countsRaw)) !== JSON.stringify(blueprint?.storyInput.volumeChapterCounts ?? []);
  const currentStage = blueprint?.workflowState.currentStage ?? "story";
  const outlines = useMemo(() => blueprint ? stageOutline(blueprint, currentStage) : [], [blueprint, currentStage]);
  const selected = outlines.find((row) => row.id === blueprint?.workflowState.selectedObjectId) ?? outlines[0] ?? null;
  const storyForm = currentStage === "story" && selected?.id === "story-input";
  const entity = selected?.entity ?? null;
  const approvalErrors = blueprint && entity ? entityApprovalErrors(blueprint, entity) : [];
  const plan = selected?.plan ?? null;
  const referenceCandidates = blueprint && (entity || plan) ? allowedReferenceEntities(blueprint, entity ?? plan!) : [];
  const fillFields = useMemo(() => { try { return blueprint && selected ? getFormFillFields(blueprint, selected.id) : []; } catch { return []; } }, [blueprint, selected?.id]);
  const activeGeneration = blueprint?.workflowState.activeGeneration;
  const readOnly = state.busy || Boolean(activeGeneration) || state.saveState === "conflict";
  const stageStatus = blueprint ? getStageStatus(blueprint, currentStage) : "NOT_STARTED";
  const targetProblem = blueprint && selected ? generationProblem(blueprint, selected.id) : "请选择对象";
  const fillProblem = useMemo(() => { if (!blueprint || !selected || !fillFields.length) return null; try { assertCanFormFill(blueprint, selected.id); return null; } catch (error) { return error instanceof Error ? error.message : "请先完成前置审批"; } }, [blueprint, selected?.id, fillFields.length]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (!hasFieldErrors && !countsDirty) return; event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [hasFieldErrors, countsDirty]);
  useEffect(() => { setInstructions(""); }, [selected?.id]);
  useEffect(() => { setSelectedFields(fillFields.map((field) => field.key)); }, [selected?.id, fillFields.map((field) => field.key).join(",")]);
  useEffect(() => {
    if (!blueprint) return;
    const counts = blueprint.storyInput.volumeChapterCounts;
    if (countsEdited.current && JSON.stringify(parseChapterCounts(countsRaw)) !== JSON.stringify(counts)) return;
    countsEdited.current = false;
    try { localStorage.removeItem(CHAPTER_COUNTS_BUFFER); } catch { /* The server contains the confirmed structure. */ }
    setCountsRaw(counts.join(", "));
  }, [blueprint?.storyInput.volumeChapterCounts.join(",")]);
  function editCountsRaw(raw: string) {
    countsEdited.current = true;
    setCountsRaw(raw);
    try { localStorage.setItem(CHAPTER_COUNTS_BUFFER, raw); }
    catch { setNotice({ kind: "error", text: "卷章结构草稿无法备份到浏览器，请应用结构后再离开。" }); }
  }
  async function applyChapterCounts() {
    const counts = parseChapterCounts(countsRaw);
    if (!counts) throw new Error("请填写有效的每卷章节数，且总章节数不超过 500。");
    await controller.command({ type: "configureChapters", counts });
    countsEdited.current = false;
    try { localStorage.removeItem(CHAPTER_COUNTS_BUFFER); } catch { /* The server now owns this confirmed structure. */ }
    setCountsRaw(counts.join(", "));
  }
  async function saveWorkingFields() {
    await controller.flush();
    if (countsDirty) await applyChapterCounts();
  }

  function setFieldError(key: string, message: string | null) {
    setFieldErrors((current) => { const next = { ...current }; if (message) next[key] = message; else delete next[key]; return next; });
  }
  async function act(operation: () => Promise<unknown>, success?: string) {
    if (hasFieldErrors) { setNotice({ kind: "error", text: "请先修正编辑器中的 JSON 或名称错误。未提交内容已保留。" }); return; }
    try { setNotice(null); await operation(); if (success) setNotice({ kind: "success", text: success }); }
    catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "操作失败" }); }
  }
  function select(stageId: StageId, objectId: string | null) { void act(() => controller.command({ type: "select", stageId, objectId })); }
  function editEntity(update: Partial<Pick<WorkflowEntity, "name" | "content">>) {
    if (!entity || readOnly) return;
    const name = update.name ?? entity.name;
    if (!name.trim()) { setFieldError(`${entity.id}.name`, "名称不能为空"); return; }
    setFieldError(`${entity.id}.name`, null);
    controller.setDraft(`entity:${entity.id}`, { type: "updateEntity", entityId: entity.id, name, content: update.content ?? entity.content });
  }
  function editPlan(items: OutlineItem[]) {
    if (!plan || readOnly) return;
    controller.setDraft(`outline:${plan.id}`, { type: "updateOutline", outlineId: plan.id, items });
  }
  function updatePlanItem(id: string, update: Partial<OutlineItem>) { if (plan) editPlan(plan.items.map((item) => item.id === id ? { ...item, ...update, userModified: true } : item)); }
  function addPlanItem() {
    if (!plan) return;
    const kind = plan.stageId === "characters" ? "character" : plan.stageId === "endings" ? "ending" : plan.stageId === "systems" ? "gameSystem" : "criticalBranch";
    editPlan([...plan.items, { id: `user_${crypto.randomUUID().replaceAll("-", "")}`, name: "新增项目", kind, source: "USER", purpose: "", required: true, enabled: true, relatedIds: [], userModified: true }]);
  }
  async function generate(mode: "generate" | "revise" = "generate") {
    if (!selected) return;
    await act(() => controller.mutate("/generate", { targetId: selected.id, instructions, mode }), mode === "revise" ? "修订任务已开始，完成后需重新审批。" : "生成任务已开始，完成后请审核结果。" );
  }
  async function fillSelectedFields() {
    if (!selected) return;
    await act(() => controller.mutate("/fill", { targetId: selected.id, prompt: instructions, fields: selectedFields }), "AI 填充任务已提交；完成后请检查所选字段，未选内容保持原值。");
  }
  async function previewImport() {
    const requestId = ++importRequest.current;
    const kind = importKind;
    const data = importText;
    setPreviewBusy(true); setPreview(null);
    try {
      const result = await workflowRequest<ImportPreview>("/import/preview", { method: "POST", body: JSON.stringify({ kind, data }) });
      if (requestId === importRequest.current) setPreview(result);
    } catch (error) { if (requestId === importRequest.current) setPreview({ valid: false, errors: [error instanceof Error ? error.message : "导入预览失败"], warnings: [], summary: [] }); }
    finally { if (requestId === importRequest.current) setPreviewBusy(false); }
  }
  function invalidateImport() { importRequest.current += 1; setPreview(null); setPreviewBusy(false); }
  function closeModal() { invalidateImport(); versionRequest.current += 1; setModal(null); }
  async function readFile(file?: File) {
    if (!file) return;
    invalidateImport();
    const requestId = importRequest.current;
    if (file.size > MAX_IMPORT_BYTES) { setPreview({ valid: false, errors: ["JSON 文件超过 5 MiB"], warnings: [], summary: [] }); return; }
    try { const data = await file.text(); if (requestId === importRequest.current) setImportText(data); }
    catch { if (requestId === importRequest.current) setPreview({ valid: false, errors: ["无法读取此文件"], warnings: [], summary: [] }); }
  }
  async function openVersion(value: number, compare = false) {
    const requestId = ++versionRequest.current;
    try {
      const response = await workflowRequest<VersionSnapshot>(`/versions/${value}`);
      if (requestId !== versionRequest.current) return;
      if (compare) setCompareVersion(response); else { setVersion(response); setCompareVersion(null); }
    } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "版本读取失败" }); }
  }
  async function exportJson() {
    await act(async () => {
      await controller.flush();
      const anchor = document.createElement("a");
      anchor.href = "/api/workflow/export";
      anchor.download = "game-blueprint.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }, "已发起 Blueprint JSON 下载。");
  }

  if (!blueprint) return <div className="page-content workflow-page"><div className="workflow-empty"><ListTree size={38} aria-hidden="true" /><strong>{state.saveState === "loading" ? "正在恢复本地创作进度" : "无法读取本地 Blueprint"}</strong><p>{state.error ?? "正在读取工作副本、清单、审批状态与历史版本。"}</p>{state.error && <button type="button" className="primary-button" onClick={() => void controller.initialize()}><RefreshCw size={15} aria-hidden="true" />重新读取</button>}</div></div>;

  return <div className="page-content workflow-page">
    <header className="workflow-header"><div><span className="eyebrow">PRE-GAME CREATION / BLUEPRINT</span><h1>{blueprint.metadata.title || "新的故事 Blueprint"}</h1><p>先确定准备生成什么，再逐项生成、审批和修订。工作副本保存在本机。</p></div><div className="workflow-header__actions"><span className={`workflow-save workflow-save--${state.saveState}`} role="status" aria-live="polite"><Save size={13} aria-hidden="true" />{saveLabels[state.saveState === "saved" && (countsDirty || hasFieldErrors) ? "dirty" : state.saveState]}</span><button className="quiet-button" type="button" disabled={state.busy || Boolean(activeGeneration)} onClick={() => void act(saveWorkingFields, "工作副本已保存。")}><Save size={14} aria-hidden="true" />保存</button><button className="quiet-button" type="button" onClick={() => { invalidateImport(); setModal("import"); }} disabled={readOnly}><Upload size={14} aria-hidden="true" />导入</button><button className="quiet-button" type="button" onClick={() => void exportJson()} disabled={readOnly}><Download size={14} aria-hidden="true" />导出</button><button className="quiet-button" type="button" onClick={() => setModal("versions")}><History size={14} aria-hidden="true" />历史版本 · {state.response?.versions.length ?? 0}</button></div></header>
    {(notice || state.error) && <div className={`workflow-notice workflow-notice--${notice?.kind ?? "error"}`} role={notice?.kind === "success" ? "status" : "alert"}>{notice?.kind === "success" ? <CheckCircle2 size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}<span>{notice?.text ?? state.error}</span>{state.saveState === "conflict" && <button className="quiet-button" type="button" onClick={() => setModal("resolveConflict")}>查看冲突</button>}{notice && <button className="icon-button" type="button" onClick={() => setNotice(null)} aria-label="关闭提示"><X size={13} aria-hidden="true" /></button>}</div>}
    {blueprint.workflowState.generationError && <div className="workflow-notice workflow-notice--error" role="alert"><CircleAlert size={16} aria-hidden="true" /><span>{blueprint.workflowState.generationError}</span></div>}
    {activeGeneration && <div className="workflow-task" role="status" aria-live="polite"><div className="workflow-task__row"><svg viewBox="0 0 110 45" fill="none" aria-hidden="true"><path className="workflow-task__path" d="M8 23C32 23 27 8 52 8S77 36 103 23" /><circle cx="8" cy="23" r="4" /><circle cx="52" cy="8" r="4" /><circle cx="103" cy="23" r="4" /></svg><div><strong>{activeGeneration.targetId.startsWith("outline-") ? "正在规划本阶段内容" : activeGeneration.targetId === "blueprint-review" ? "正在执行 Blueprint 总体检查" : activeGeneration.targetId === "story-input" ? "正在填写基础创作表单" : "正在填写当前表单"}</strong><p>{activeGeneration.targetId === "story-input" ? "基础创作表单" : allEntities(blueprint).find((row) => row.id === activeGeneration.targetId)?.name ?? blueprint.workflowState.outlinePlans.find((row) => row.id === activeGeneration.targetId)?.name ?? activeGeneration.targetId} · 完成后等待用户审批</p></div><button type="button" className="quiet-button" onClick={() => void act(() => controller.mutate("/cancel", {}), "生成已取消，保留已有内容。")} disabled={state.busy}><Square size={13} aria-hidden="true" />取消生成</button></div></div>}
    <nav className="workflow-stages" aria-label="创作阶段">{stages.map((stage, index) => { const status = getStageStatus(blueprint, stage.id); const locked = index > 0 && !blueprint.workflowState.stageConfirmations[stages[index - 1].id] && status === "NOT_STARTED"; return <button key={stage.id} type="button" className={`workflow-stage ${currentStage === stage.id ? "workflow-stage--active" : ""} ${status === "CONFIRMED" ? "workflow-stage--confirmed" : ""}`} disabled={readOnly || locked} onClick={() => select(stage.id, null)} aria-current={currentStage === stage.id ? "step" : undefined} title={locked ? "请先确认上一阶段" : stage.description}><span className="workflow-stage__number">{status === "CONFIRMED" ? <Check size={14} aria-hidden="true" /> : index + 1}</span><span className="workflow-stage__copy"><strong>{stage.name}</strong><small>{stageLabels[status]}</small></span></button>; })}</nav>
    {countsDirty && <div className="workflow-notice" role="status"><Save size={16} aria-hidden="true" /><span>卷章结构草稿已暂存在本机，尚未应用。应用结构或点击“保存”后，才会更新 Blueprint 的固定大纲。</span><button className="quiet-button" type="button" disabled={readOnly} onClick={() => select("chapters", null)}>查看卷章结构</button></div>}
    {blueprint.workflowState.additionSuggestions.some((suggestion) => suggestion.status === "PENDING_REVIEW") && <section className="workflow-suggestions" aria-label="AI 新增项目建议"><div className="workflow-panel-heading"><div><span className="eyebrow">ADDITION SUGGESTIONS / EXPLICIT APPROVAL</span><h2>AI 建议新增项目</h2></div><Sparkles size={18} aria-hidden="true" /></div><p className="workflow-outline__hint">建议尚未加入任何大纲。批准后只追加清单项，仍须回到对应清单确认，才创建待生成草稿。</p><div className="workflow-suggestion-list">{blueprint.workflowState.additionSuggestions.filter((suggestion) => suggestion.status === "PENDING_REVIEW").map((suggestion) => { const scope = blueprint.workflowState.outlinePlans.find((outline) => outline.id === suggestion.outlineId); const chapter = scope?.parentId ? blueprint.chapters.find((row) => row.id === scope.parentId) : null; return <article className="workflow-suggestion" key={suggestion.id}><div className="workflow-suggestion__heading"><strong>{suggestion.item.name}</strong><Status status={suggestion.status} /></div><small>{kindLabels[suggestion.item.kind]} · {chapter ? `${chapter.name} / ` : ""}{scope?.name ?? suggestion.outlineId}</small><p>{suggestion.item.purpose}</p><div className="workflow-actions"><button className="quiet-button" type="button" disabled={readOnly || !scope} onClick={() => { if (scope) select(scope.stageId, scope.id); }}>查看作用清单</button><button className="primary-button" type="button" disabled={readOnly || hasFieldErrors || !scope} onClick={() => void act(async () => { await controller.command({ type: "approveAddition", suggestionId: suggestion.id }); if (scope) await controller.command({ type: "select", stageId: scope.stageId, objectId: scope.id }); }, "新增建议已加入清单，请检查并重新确认清单；尚未生成详情。") }><Check size={13} aria-hidden="true" />批准加入清单</button><button className="quiet-button" type="button" disabled={readOnly} onClick={() => void act(() => controller.command({ type: "rejectAddition", suggestionId: suggestion.id }), "新增建议已拒绝，没有扩展项目范围。") }><X size={13} aria-hidden="true" />拒绝建议</button></div></article>; })}</div></section>}
    <div className="workflow-layout">
      <aside className="workflow-outline" aria-label="阶段大纲"><div className="workflow-panel-heading"><div><span className="eyebrow">STAGE OUTLINE</span><h2>{stages.find((stage) => stage.id === currentStage)?.name}</h2></div><ListTree size={18} aria-hidden="true" /></div><div className="workflow-panel-body"><p className="workflow-outline__hint">{stages.find((stage) => stage.id === currentStage)?.description}</p><Status status={stageStatus} /></div><div className="workflow-outline-list">{outlines.length ? outlines.map((row, index) => <div key={row.id}>{row.group && row.group !== outlines[index - 1]?.group && <div className="workflow-group">{row.group}</div>}<button className={`workflow-outline-item ${selected?.id === row.id ? "workflow-outline-item--selected" : ""}`} type="button" disabled={readOnly} onClick={() => select(currentStage, row.id)} aria-pressed={selected?.id === row.id}>{row.entity ? <BookOpen size={14} aria-hidden="true" /> : <ListTree size={14} aria-hidden="true" />}<span className="workflow-outline-item__copy"><strong>{row.name}</strong><small>{row.entity ? `${kindLabels[row.entity.kind]} · ${row.entity.source === "USER" ? "用户" : "AI"}${row.entity.userModified ? " / 用户已修改" : ""}` : row.plan ? `AI 规划清单 · ${row.plan.items.length} 项${row.plan.userModified ? " / 用户已修改" : ""}` : row.virtual ? "尚未规划" : row.id === "story-input" ? "用户创作意图 / 可手动或 AI 辅助填写" : "一致性审核"}</small><Status status={row.entity?.status ?? row.plan?.status ?? (currentStage === "review" ? blueprint.workflowState.review.status : "DRAFT")} /></span></button></div>) : <p className="workflow-note">{currentStage === "chapters" ? "输入总卷数与每卷章节数后，即可直接展开固定大纲。" : "完成前置阶段后将在此显示审核对象。"}</p>}</div></aside>
      <section className="workflow-editor" aria-labelledby="workflow-object-title"><div className="workflow-editor__heading"><span className="eyebrow">{plan || selected?.virtual ? "OUTLINE PLAN / CONFIRM SCOPE FIRST" : currentStage === "review" ? "BLUEPRINT REVIEW" : "CURRENT REVIEW OBJECT"}</span><h2 id="workflow-object-title">{selected?.name ?? "配置卷与章节"}</h2><div className="workflow-actions"><Status status={entity?.status ?? plan?.status ?? (currentStage === "review" ? blueprint.workflowState.review.status : "DRAFT")} />{entity && <span className="eyebrow">{kindLabels[entity.kind]} · REV {entity.revision}</span>}</div>{(entity?.reviewReasons.length || plan?.reviewReasons.length) ? <p className="workflow-note workflow-note--warning">需要重新审核：{(entity?.reviewReasons ?? plan?.reviewReasons ?? []).join("；")}</p> : null}</div>
        <div className="workflow-editor__body">
          {entity && approvalErrors.length > 0 && <details className="workflow-note workflow-note--warning" style={{ marginBottom: 18 }}><summary>当前仍有 {approvalErrors.length} 项字段 / 引用需要补全，审批以服务端校验为准</summary><ul>{approvalErrors.map((message, index) => <li key={index}>{message}</li>)}</ul></details>}
          {currentStage === "story" && <><div className="workflow-form-tabs" role="tablist" aria-label="基础设定表单切换"><button type="button" role="tab" aria-selected={storyForm} className={storyForm ? "workflow-form-tab workflow-form-tab--active" : "workflow-form-tab"} disabled={readOnly} onClick={() => select("story", "story-input")}>基础创作表单<span>你的创作意图</span></button><button type="button" role="tab" aria-selected={!storyForm} className={!storyForm ? "workflow-form-tab workflow-form-tab--active" : "workflow-form-tab"} disabled={readOnly} onClick={() => select("story", "story-bible")}>Story Bible<span>整体故事设定 · 需要审批</span></button></div>{storyForm ? <><p className="workflow-note">来源：用户创作意图。可以从空表单开始，在右侧输入想法并勾选希望 AI 填写的字段；也可以手动输入或导入 JSON。AI 只改所选字段，不会自动确认故事设定。</p><div className="workflow-fields" style={{ marginTop: 20 }}>{storyInputFields.map((field) => <FormField key={field.key} field={field} kind="storyInput" scope="story-input" value={blueprint.storyInput[field.key]} disabled={readOnly} candidates={[]} onChange={(value) => controller.setDraft("story-input", { type: "updateStoryInput", input: { ...blueprint.storyInput, [field.key]: value } })} />)}</div></> : <p className="workflow-outline__hint">Story Bible 将基础创作意图整理成后续共用的世界事实与规则。可按字段补全，内容完整后作为一个整体审批。</p>}</>}
          {currentStage === "chapters" && <fieldset className="workflow-fieldset"><legend>固定卷章结构</legend><label className="workflow-field"><span>每卷章节数（例如 10, 12, 8，共 3 卷）</span><input className="workflow-input" value={countsRaw} disabled={readOnly} onChange={(event) => editCountsRaw(event.target.value)} placeholder="10, 12, 8" /><small>总卷数 = 数字数量；每卷 1–100 章，最多 30 卷，总计最多 500 章。</small></label><div className="workflow-actions" style={{ marginTop: 12 }}><button className="quiet-button" type="button" disabled={readOnly} onClick={() => { void act(applyChapterCounts, "固定卷章大纲已更新；已有内容保留，受影响对象需重新审核。"); }}><ListTree size={14} aria-hidden="true" />应用卷章结构</button><span className="workflow-status">当前 {blueprint.volumes.length} 卷 / {blueprint.chapters.length} 章</span></div></fieldset>}
          {plan && <><p className="workflow-note">先确认准备生成什么，才创建详情。右侧可按要求填写现有条目的选中列，不会增删条目。调整数量请手动增删或先审核新增建议。</p>{plan.items.map((item, index) => <div className="workflow-plan-row" key={item.id}><div className="workflow-plan-row__top"><strong>{index + 1}. {item.name}</strong><span>{item.source === "USER" ? "用户预设" : "AI 建议"}</span><button className="danger-icon-button" type="button" disabled={readOnly} onClick={() => editPlan(plan.items.filter((row) => row.id !== item.id))} aria-label={`删除清单项 ${item.name}`}><Trash2 size={13} aria-hidden="true" /></button></div><div className="workflow-fields"><label className="workflow-field"><span>名称</span><small>简短、易辨认的项目名称，用于后续大纲导航。</small><input className="workflow-input" value={item.name} disabled={readOnly} maxLength={300} placeholder="例如：林遥" onChange={(event) => { if (event.target.value.trim()) updatePlanItem(item.id, { name: event.target.value }); }} /></label><label className="workflow-field workflow-field--wide"><span>定位与存在理由</span><small>说明这个项目承担什么剧情功能或玩法价值，避免仅写一个名称。</small><textarea className="workflow-textarea" rows={3} value={item.purpose} disabled={readOnly} placeholder="例如：提供事故亲历者视角，让主角的调查与信任选择发生冲突" onChange={(event) => updatePlanItem(item.id, { purpose: event.target.value })} /></label></div><div className="workflow-checkboxes" style={{ marginTop: 10 }}><label className="workflow-checkbox"><input type="checkbox" checked={item.enabled} disabled={readOnly} onChange={(event) => updatePlanItem(item.id, { enabled: event.target.checked })} />启用此项目</label><label className="workflow-checkbox"><input type="checkbox" checked={item.required} disabled={readOnly} onChange={(event) => updatePlanItem(item.id, { required: event.target.checked })} />阶段必需项</label>{item.userModified && <span className="workflow-status">用户已修改</span>}</div><div className="workflow-field" style={{ marginTop: 15 }}><span>关联的前置对象</span><small>只选择当前阶段允许引用的已存在对象。没有候选时可留空，不需要预填未来章节或结局。</small><ReferenceChoices label="关联的前置对象" value={item.relatedIds} candidates={referenceCandidates} disabled={readOnly} onChange={(value) => updatePlanItem(item.id, { relatedIds: value })} /></div></div>)}<button type="button" className="quiet-button" disabled={readOnly} onClick={addPlanItem} style={{ marginTop: 14 }}><Plus size={14} aria-hidden="true" />新增清单项</button></>}
          {selected?.virtual && <div className="workflow-empty"><ListTree size={36} aria-hidden="true" /><strong>先规划清单，再生成内容</strong><p>AI 先提出准备创建的项目、理由和定位。你可编辑并确认清单，然后逐项生成和审批。</p><button className="primary-button" type="button" disabled={readOnly || Boolean(targetProblem)} onClick={() => void generate()}><Sparkles size={15} aria-hidden="true" />AI 生成 Outline Plan</button>{targetProblem && <p>{targetProblem}</p>}</div>}
          {entity && <><FormField field={{ key: "name", label: "审核对象名称", type: "text", required: true }} kind={entity.kind} value={entity.name} scope={entity.id} candidates={referenceCandidates} disabled={readOnly} onChange={(value) => editEntity({ name: String(value) })} /><div className="workflow-fields" style={{ marginTop: 20 }}>{entityFields[entity.kind].map((field) => field.type === "json" ? <StructuredField key={`${entity.id}:${field.key}`} field={field} entity={entity} value={entity.content[field.key]} disabled={readOnly} blueprint={blueprint} candidates={referenceCandidates} onChange={(value) => editEntity({ content: { ...entity.content, [field.key]: value } })} onError={setFieldError} /> : <FormField key={`${entity.id}:${field.key}`} field={field} kind={entity.kind} scope={entity.id} value={entity.content[field.key]} locations={(blueprint.storyBible.content.locations ?? []) as string[]} disabled={readOnly} candidates={referenceCandidates} onChange={(value) => editEntity({ content: { ...entity.content, [field.key]: value } as WorkflowEntity["content"] })} />)}</div><div className="workflow-columns-note">{entity.source === "USER" ? "用户来源" : "AI 来源"}{entity.userModified ? " · 用户已修改" : ""} · 修改后需审批。<details><summary>查看引用标识</summary><code>{entity.id}</code>{entity.parentId ? ` · 父级 ${entity.parentId}` : ""}</details></div></>}
          {currentStage === "review" && <><p className="workflow-note">总体检查只发现问题和修复建议，不增加主要内容。所有 ERROR 解决，并审批最新检查结果后，才能 Finalize。</p><div className="workflow-actions" style={{ margin: "16px 0" }}><span className="workflow-status">ERROR {blueprint.workflowState.review.issues.filter((issue) => issue.severity === "ERROR").length}</span><span className="workflow-status">WARNING {blueprint.workflowState.review.issues.filter((issue) => issue.severity === "WARNING").length}</span><span className="workflow-status">SUGGESTION {blueprint.workflowState.review.issues.filter((issue) => issue.severity === "SUGGESTION").length}</span></div>{blueprint.workflowState.review.issues.map((issue) => <article key={issue.id} className={`workflow-review-issue workflow-review-issue--${issue.severity}`}><div className="workflow-review-issue__category">{issue.severity} / {issue.category}</div><h3>{issue.message}</h3><p>{issue.suggestion}</p><div className="workflow-links">{issue.entityIds.map((id) => { const target = allEntities(blueprint).find((row) => row.id === id); const stageId = target ? entityStage(target.kind) : "review"; return <button key={id} type="button" className="workflow-link" disabled={readOnly} onClick={() => select(stageId, id)}>{target?.name ?? id}</button>; })}</div></article>)}{!blueprint.workflowState.review.issues.length && <div className="workflow-empty"><ShieldCheck size={36} aria-hidden="true" /><strong>{blueprint.workflowState.review.reviewedAt ? "当前检查未发现问题" : "等待执行总体检查"}</strong><p>覆盖 Story、Characters、Ending、Branch、Foreshadowing、Chapter 与系统定义。</p></div>}</>}
        </div></section>
      <aside className="workflow-inspector" aria-label="AI 生成与审批"><div className="workflow-panel-heading"><div><span className="eyebrow">AI / APPROVAL</span><h2>AI 生成</h2></div><Sparkles size={18} aria-hidden="true" /></div><div className="workflow-panel-body"><label className="workflow-field"><span>AI 生成</span><small>{storyForm ? "描述你的故事想法，即使还没有名称、类型或大纲，也能开始填写。" : currentStage === "review" ? "说明希望检查的重点；检查会发现问题，不会改写主要内容。" : "写清希望新增或调整的内容；已有内容也可以按你的要求修改。"}</small><textarea className="workflow-textarea" rows={5} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder={storyForm ? "例如：创作一个温暖的校园悬疑故事，请补全名称、类型和大纲。" : plan ? "例如：让现有角色的剧情定位更鲜明，保留已有条目数量。" : "例如：保留已有设定，完善主角目标和世界规则，让冲突更清晰。"} disabled={readOnly} /></label>{fillFields.length > 0 && <fieldset className="workflow-fill-selection"><legend>选择希望 AI 填写的字段</legend><div className="workflow-actions"><button type="button" className="quiet-button" disabled={readOnly} onClick={() => setSelectedFields(fillFields.map((field) => field.key))}>全选</button><button type="button" className="quiet-button" disabled={readOnly} onClick={() => setSelectedFields([])}>取消全选</button><span className="workflow-status">已选 {selectedFields.length} / {fillFields.length}</span></div><div className="workflow-fill-selection__fields">{fillFields.map((field) => <label key={field.key} className="workflow-checkbox"><input type="checkbox" checked={selectedFields.includes(field.key)} disabled={readOnly} onChange={(event) => setSelectedFields((current) => event.target.checked ? [...current, field.key] : current.filter((key) => key !== field.key))} />{friendlyFieldLabel(field)}</label>)}</div><small>开始前先保存当前表单；只覆盖勾选的字段，未选内容保持原值。{plan ? "填写现有条目不会增删清单，完成后需重新确认。" : "生成结果仍需你检查，不会自动审批。"}</small></fieldset>}<div className="workflow-actions">{fillFields.length > 0 && <button className="primary-button" type="button" disabled={readOnly || hasFieldErrors || !instructions.trim() || !selectedFields.length || Boolean(fillProblem)} onClick={() => void fillSelectedFields()}><Sparkles size={14} aria-hidden="true" />生成所选字段</button>}{fillProblem && <p className="workflow-note">{fillProblem}</p>}{(plan || selected?.virtual || currentStage === "review") && <><button className={fillFields.length ? "quiet-button" : "primary-button"} type="button" disabled={readOnly || hasFieldErrors || Boolean(targetProblem)} onClick={() => void generate()}><ListTree size={14} aria-hidden="true" />{currentStage === "review" ? "执行总体检查" : plan?.items.length ? "重新规划整个清单" : "AI 规划生成清单"}</button>{targetProblem && <p className="workflow-note">{targetProblem}</p>}</>}</div></div>
        <div className="workflow-inspector__section"><h3>{plan ? "清单审批" : currentStage === "review" ? "检查结果审批" : "当前对象审批"}</h3>{storyForm && <p>基础创作表单记录你的创作意图，无需单独审批。完成后切换到 Story Bible，审核整体故事设定。</p>}{plan && <><p>{plan.status === "APPROVED" ? "清单已确认。点击左侧详情逐项生成，追加项目需先重新审批清单。" : "先确认准备生成什么，确认不会触发批量生成。"}</p><div className="workflow-actions"><button className="primary-button" type="button" disabled={readOnly || hasFieldErrors || plan.status === "APPROVED"} onClick={() => void act(() => controller.command({ type: "approveOutline", outlineId: plan.id }), "清单已确认。请选择一个对象开始生成。") }><Check size={14} aria-hidden="true" />确认清单</button></div></>}{entity && <><p>{entity.status === "NEEDS_REVIEW" ? "前置数据改变。可检查后保持内容并重新通过、手动修改、AI 修订或重新生成。" : "审批通过后再处理下一个必需项。手动修改也可以直接送审。"}</p><div className="workflow-actions"><button className="primary-button" type="button" disabled={readOnly || hasFieldErrors || entity.status === "APPROVED"} onClick={() => void act(() => controller.command({ type: "approveEntity", entityId: entity.id }), "当前对象已通过审批。") }><CheckCircle2 size={14} aria-hidden="true" />{entity.status === "NEEDS_REVIEW" ? "保持内容并重新通过" : "审批通过"}</button><button className="quiet-button" type="button" disabled={readOnly || !instructions.trim()} onClick={() => void act(() => controller.command({ type: "rejectEntity", entityId: entity.id, reason: instructions }), "对象已拒绝，内容已保留。") }><X size={14} aria-hidden="true" />拒绝并保留内容</button><p className="workflow-outline__hint">拒绝前请填写具体原因。</p></div></>}{currentStage === "review" && <div className="workflow-actions"><button className="primary-button" type="button" disabled={readOnly || blueprint.workflowState.review.status === "APPROVED" || blueprint.workflowState.review.issues.some((issue) => issue.severity === "ERROR") || !blueprint.workflowState.review.reviewedAt} onClick={() => void act(() => controller.command({ type: "approveReview" }), "总体检查已审批通过。") }><CheckCircle2 size={14} aria-hidden="true" />审批检查结果</button></div>}</div>
        <div className="workflow-inspector__section"><h3>阶段确认</h3><p>所有必需项通过后，由你明确确认再进入下一阶段。</p><div className="workflow-actions"><button className="primary-button" type="button" disabled={readOnly || hasFieldErrors || stageStatus !== "READY_TO_CONFIRM"} onClick={() => void act(() => controller.command({ type: "confirmStage", stageId: currentStage }), "当前阶段已确认。") }>{currentStage === "review" ? "确认最终检查" : "确认并进入下一阶段"}<ArrowRight size={14} aria-hidden="true" /></button><button className="quiet-button" type="button" disabled={readOnly} onClick={() => { setFinalize(false); setModal("createVersion"); }}><History size={14} aria-hidden="true" />Create Version</button><button className="primary-button" type="button" disabled={readOnly || !blueprint.workflowState.stageConfirmations.review || blueprint.workflowState.review.issues.some((issue) => issue.severity === "ERROR")} onClick={() => { setFinalize(true); setModal("createVersion"); }}><ShieldCheck size={14} aria-hidden="true" />Finalize Blueprint</button></div></div><div className="workflow-inspector__section"><button className="quiet-button" type="button" onClick={() => void act(async () => { await controller.flush(); onOpenProviders(); })}><Settings2 size={14} aria-hidden="true" />模型与 API 设置</button><p>生成使用当前激活的本机模型预设，完成后不自动审批或扩展范围。</p></div></aside>
    </div>
    {modal === "import" && <Modal title={importKind === "story" ? "导入基础设定 JSON" : "导入 Blueprint JSON"} onClose={closeModal} footer={<><button className="quiet-button" type="button" onClick={closeModal}>取消</button><button className="quiet-button" type="button" disabled={previewBusy || !importText.trim()} onClick={() => void previewImport()}><FileJson size={14} aria-hidden="true" />{previewBusy ? "正在校验" : "校验并预览"}</button><button className="primary-button" type="button" disabled={readOnly || !preview?.valid || !preview.data} onClick={() => void act(async () => { await controller.mutate("/import", { kind: importKind, data: preview!.data, confirmed: true }); setModal(null); }, "已导入并保存。当前工作副本已替换，历史版本保留。") }><Check size={14} aria-hidden="true" />确认覆盖当前{importKind === "story" ? "基础输入" : "工作副本"}</button></>}><div className="workflow-import-options"><button type="button" className="quiet-button" aria-pressed={importKind === "story"} onClick={() => { setImportKind("story"); invalidateImport(); }}>基础设定</button><button type="button" className="quiet-button" aria-pressed={importKind === "blueprint"} onClick={() => { setImportKind("blueprint"); invalidateImport(); }}>完整 Blueprint</button><button type="button" className="quiet-button" onClick={() => fileInput.current?.click()}><Upload size={14} aria-hidden="true" />选择 JSON 文件</button><input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ""; }} /></div><label className="workflow-field"><span>粘贴 JSON（最大 5 MiB）</span><textarea className="workflow-textarea workflow-textarea--json" value={importText} onChange={(event) => { invalidateImport(); setImportText(event.target.value); }} spellCheck={false} /></label>{preview && <div className="workflow-summary"><strong>{preview.valid ? "校验通过 · 导入摘要" : "校验未通过"}</strong><ul>{preview.summary.map((message, index) => <li key={`summary-${index}`}>{message}</li>)}{preview.errors.map((message, index) => <li key={`error-${index}`} style={{ color: "var(--danger)" }}>{message}</li>)}{preview.warnings.map((message, index) => <li key={`warning-${index}`} style={{ color: "var(--warning)" }}>{message}</li>)}</ul></div>}<p className="workflow-note workflow-note--warning">只有点击“确认覆盖”才会导入。请先核对内容；导入前可创建版本保存当前工作副本。</p></Modal>}
    {modal === "createVersion" && <Modal title={finalize ? "Finalize Blueprint" : "创建不可变 Blueprint 版本"} onClose={closeModal} footer={<><button className="quiet-button" type="button" onClick={closeModal}>取消</button><button className="primary-button" type="button" disabled={readOnly} onClick={() => void act(async () => { await controller.mutate("/versions", { description: versionDescription, userNote: versionNote, finalize }); setModal(null); setVersionDescription(""); setVersionNote(""); }, finalize ? "Blueprint 已 Finalize 并保存不可变版本。" : "已创建不可变版本。") }><ShieldCheck size={14} aria-hidden="true" />{finalize ? "确认 Finalize" : "创建版本"}</button></>}><p className="workflow-note">Snapshot 将保存当前 Blueprint、Workflow 状态、父版本、时间和说明。历史版本只能查看、比较或复制为新的工作副本。</p><label className="workflow-field" style={{ marginTop: 18 }}><span>版本说明</span><input className="workflow-input" value={versionDescription} onChange={(event) => setVersionDescription(event.target.value)} /></label><label className="workflow-field" style={{ marginTop: 18 }}><span>用户备注</span><textarea className="workflow-textarea" value={versionNote} onChange={(event) => setVersionNote(event.target.value)} /></label></Modal>}
    {modal === "versions" && <Modal title="Blueprint 历史版本" onClose={() => { versionRequest.current += 1; setModal(null); }} footer={<><button className="quiet-button" type="button" onClick={closeModal}>关闭</button>{version && <button className="primary-button" type="button" disabled={readOnly} onClick={() => void act(async () => { await controller.mutate(`/versions/${version.version}/restore`, { confirmed: true }); setModal(null); }, `已将 v${version.version} 复制为新的 Working Blueprint。`) }><GitBranch size={14} aria-hidden="true" />复制为工作副本</button>}</>}><div className="workflow-version-layout"><div className="workflow-version-list">{state.response?.versions.length ? state.response.versions.map((row) => <button className="workflow-version-item" type="button" key={row.version} aria-pressed={version?.version === row.version} onClick={() => void openVersion(row.version)}><strong>v{row.version}{row.finalized ? " · Finalized" : ""}</strong><small>{row.description || "未填写版本说明"}<br />{new Date(row.createdAt).toLocaleString("zh-CN")}<br />父版本：{row.parentVersion ? `v${row.parentVersion}` : "无"}</small></button>) : <p className="workflow-note">尚无历史版本。使用 Create Version 或 Finalize 创建第一个快照。</p>}</div><div>{version ? <><h3 className="workflow-section-title">v{version.version} · 只读 Snapshot</h3><p className="workflow-outline__hint">{version.userNote || "无用户备注"}</p><label className="workflow-field"><span>比较基准</span><select className="workflow-select" value={compareVersion?.version ?? "working"} onChange={(event) => { if (event.target.value === "working") setCompareVersion(null); else void openVersion(Number(event.target.value), true); }}><option value="working">当前 Working Blueprint</option>{state.response?.versions.filter((row) => row.version !== version.version).map((row) => <option key={row.version} value={row.version}>v{row.version}</option>)}</select></label><div className="workflow-summary"><strong>v{version.version} → {compareVersion ? `v${compareVersion.version}` : "当前工作副本"}</strong>{diffBlueprints(version.blueprint, compareVersion?.blueprint ?? blueprint).length ? <ul>{diffBlueprints(version.blueprint, compareVersion?.blueprint ?? blueprint).map((change) => <li key={change.id}>{change.change === "ADDED" ? "新增" : change.change === "REMOVED" ? "删除" : "修改"}：{change.name}</li>)}</ul> : <p>未发现差异</p>}</div><details><summary>查看完整 Blueprint JSON</summary><pre className="workflow-code">{JSON.stringify(version.blueprint, null, 2)}</pre></details></> : <div className="workflow-empty"><History size={36} aria-hidden="true" /><strong>选择一个版本查看</strong><p>历史内容不可直接修改。复制后可继续编辑工作副本。</p></div>}</div></div>{version && <p className="workflow-note workflow-note--warning" style={{ marginTop: 18 }}>“复制为工作副本”会替换当前 Working Blueprint，请先保存或创建版本；现有历史版本不会删除。</p>}</Modal>}
    {modal === "resolveConflict" && <Modal title="处理版本冲突" onClose={closeModal} footer={<><button className="quiet-button" type="button" onClick={() => void act(() => controller.reloadKeepingDrafts(), "已读取最新服务器版本，草稿仍保留。")}>读取最新版本</button><button className="quiet-button" type="button" onClick={() => { controller.discardDrafts(); setModal(null); }}>放弃本机未提交草稿</button><button className="primary-button" type="button" onClick={() => void act(async () => { await controller.reloadKeepingDrafts(); await controller.applyRecoveredDrafts(); setModal(null); }, "已显式应用本机草稿。")}>确认将草稿应用到最新版本</button></>}><p className="workflow-note workflow-note--warning">其他窗口或恢复状态改变了服务器 revision，自动保存已停止。本机未提交草稿不会静默覆盖服务器。检查以下命令后，再选择放弃或显式应用。</p><pre className="workflow-code" style={{ marginTop: 18 }}>{JSON.stringify(state.pending.map((entry) => entry.command), null, 2)}</pre></Modal>}
  </div>;
}
