import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { contentSchemas, emptyContent } from "../../shared/workflow";
import type { Blueprint, Content, EntityKind, FieldDefinition, WorkflowEntity } from "../../shared/workflow";
import { endingOptions, fieldPresentation, friendlyFieldLabel } from "./workflowFields";

type Json = Content[string];
type JsonRow = Record<string, Json>;
const newKey = () => crypto.randomUUID().replaceAll("-", "");
const NumberDraftContext = createContext<{ scope: string; onError: (key: string, message: string | null) => void } | null>(null);
function localRead(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function localWrite(key: string, raw: string | null) { try { if (raw === null) localStorage.removeItem(key); else localStorage.setItem(key, raw); } catch { /* Before-unload guards remain active for invalid structured drafts. */ } }
function recordValue(value: unknown): value is JsonRow { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function canRenderStructured(field: FieldDefinition, value: unknown): boolean {
  if (["dynamicAttributes", "relationships", "characterRelationships", "characters", "choices"].includes(field.key)) {
    if (!Array.isArray(value) || !value.every(recordValue)) return false;
    const listKeys = field.key === "characters" ? ["knownInformation", "forbiddenInformation", "attributeChanges"] : field.key === "choices" ? ["unlockConditions", "effects", "relationshipEffects", "futureChapterEffects", "opensRoutes", "closesRoutes", "endingIds"] : [];
    return value.every((row) => listKeys.every((key) => row[key] === undefined || (Array.isArray(row[key]) && (key === "attributeChanges" ? row[key].every((change) => recordValue(change) && typeof change.key === "string" && typeof change.delta === "number") : row[key].every((item) => typeof item === "string")))));
  }
  return recordValue(value);
}

interface Entry { key: string; text: string }
export function TextEntries({ label, value, onChange, disabled, scope, example, multiline = false }: { label: string; value: string[]; onChange: (value: string[]) => void; disabled: boolean; scope: string; example: string; multiline?: boolean }) {
  const journal = `chronicle.workflow.list.${scope}`;
  const [rows, setRows] = useState<Entry[]>(() => {
    try { const saved = JSON.parse(localRead(journal) ?? "null") as Entry[] | null; if (Array.isArray(saved) && saved.every((row) => typeof row.key === "string" && typeof row.text === "string")) return saved; } catch { /* Fall back to the saved document. */ }
    return value.map((text) => ({ key: newKey(), text }));
  });
  const root = useRef<HTMLDivElement>(null);
  const serialized = JSON.stringify(value);
  useEffect(() => {
    if (root.current?.contains(document.activeElement)) return;
    setRows((current) => {
      const used = new Set<string>();
      const next = value.map((text) => { const previous = current.find((row) => row.text === text && !used.has(row.key)); if (previous) used.add(previous.key); return previous ?? { key: newKey(), text }; });
      const emptyDrafts = current.filter((row) => !row.text.trim());
      return [...next, ...emptyDrafts];
    });
  }, [serialized]);
  function commit(next: Entry[]) {
    setRows(next);
    localWrite(journal, next.some((row) => !row.text.trim()) ? JSON.stringify(next) : null);
    onChange(next.filter((row) => row.text.trim().length > 0).map((row) => row.text));
  }
  function add(after?: number) {
    const row = { key: newKey(), text: "" };
    const next = [...rows]; next.splice(after === undefined ? next.length : after + 1, 0, row); commit(next);
    requestAnimationFrame(() => document.getElementById(`entry-${row.key}`)?.focus());
  }
  function remove(key: string, index: number) {
    const next = rows.filter((row) => row.key !== key); commit(next);
    const focus = next[Math.min(index, next.length - 1)];
    if (focus) requestAnimationFrame(() => document.getElementById(`entry-${focus.key}`)?.focus());
  }
  return <div className="workflow-entries" ref={root}>{rows.map((row, index) => <div className="workflow-entry" key={row.key}><span className="workflow-entry__index">{index + 1}</span>{multiline ? <textarea id={`entry-${row.key}`} className="workflow-textarea workflow-textarea--entry" rows={2} value={row.text} disabled={disabled} placeholder={`例如：${example}`} aria-label={`${label}第 ${index + 1} 项`} onChange={(event) => commit(rows.map((item) => item.key === row.key ? { ...item, text: event.target.value } : item))} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); add(index); } }} /> : <input id={`entry-${row.key}`} className="workflow-input" value={row.text} disabled={disabled} placeholder={`例如：${example}`} aria-label={`${label}第 ${index + 1} 项`} onChange={(event) => commit(rows.map((item) => item.key === row.key ? { ...item, text: event.target.value } : item))} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); add(index); } }} />}<button className="danger-icon-button" type="button" disabled={disabled} aria-label={`删除${label}第 ${index + 1} 项`} onClick={() => remove(row.key, index)}><Trash2 size={13} aria-hidden="true" /></button></div>)}<button className="quiet-button" type="button" disabled={disabled} onClick={() => add()}><Plus size={13} aria-hidden="true" />添加{label}</button><small className="workflow-entry-hint">Enter 添加下一项{multiline ? "，Shift + Enter 在本项换行" : ""}；空白草稿不会写入内容列表。</small></div>;
}

export function ReferenceChoices({ label, value, candidates, onChange, disabled }: { label: string; value: string[]; candidates: WorkflowEntity[]; onChange: (value: string[]) => void; disabled: boolean }) {
  const available = new Set(candidates.map((row) => row.id));
  const unavailable = value.filter((id) => !available.has(id));
  return <div className="workflow-checkboxes">{candidates.map((row) => <label className="workflow-checkbox" key={row.id}><input type="checkbox" checked={value.includes(row.id)} disabled={disabled} onChange={(event) => onChange(event.target.checked ? [...value, row.id] : value.filter((id) => id !== row.id))} />{row.name}</label>)}{!candidates.length && <small className="workflow-note">尚无可关联的前置对象，当前阶段不需要填写后续阶段引用。</small>}{unavailable.map((id) => <button className="workflow-link" type="button" disabled={disabled} key={id} onClick={() => onChange(value.filter((row) => row !== id))}>移除不可用引用：{id}</button>)}<span className="visually-hidden">{label}</span></div>;
}

export function FormField({ field, kind, value, disabled, candidates, scope, onChange, locations = [] }: { field: FieldDefinition; kind: EntityKind | "storyInput"; value: unknown; disabled: boolean; candidates: WorkflowEntity[]; scope: string; onChange: (value: unknown) => void; locations?: string[] }) {
  const presentation = fieldPresentation(kind, field);
  const raw = String(value ?? "");
  const nameJournal = `chronicle.workflow.name.${scope}`;
  const isEntityName = field.key === "name" && kind !== "storyInput";
  const recoveredName = isEntityName ? localRead(nameJournal) : null;
  const [scalar, setScalar] = useState(recoveredName ?? raw);
  const focused = useRef(false);
  const invalidName = useRef(recoveredName !== null && !recoveredName.trim());
  useEffect(() => { if (!focused.current && !invalidName.current) setScalar(raw); }, [raw]);
  useEffect(() => { if (recoveredName !== null) onChange(recoveredName); }, []);
  function editScalar(next: string) {
    setScalar(next);
    if (isEntityName) { invalidName.current = !next.trim(); localWrite(nameJournal, invalidName.current ? next : null); }
    onChange(next);
  }
  const label = friendlyFieldLabel(field);
  const fixed = field.key === "volumeNumber" || field.key === "chapterNumber";
  return <div className={`workflow-field ${presentation.wide ? "workflow-field--wide" : ""}`}><label htmlFor={field.type === "textList" || field.type === "referenceList" ? undefined : `field-${scope}-${field.key}`}><span>{label}{field.required ? " *" : ""}</span></label><small>{presentation.help}</small>{field.key === "initialLocation" && kind === "initialWorldState" ? <select id={`field-${scope}-${field.key}`} className="workflow-select" value={raw} disabled={disabled} onChange={(event) => editScalar(event.target.value)}><option value="">请选择已审批的故事地点</option>{raw && !locations.includes(raw) && <option value={raw} disabled>旧地点：{raw}（需要重新选择）</option>}{locations.map((location) => <option value={location} key={location}>{location}</option>)}</select> : field.key === "accessibleLocations" && kind === "initialWorldState" ? <div className="workflow-checkboxes">{locations.map((location) => <label className="workflow-checkbox" key={location}><input type="checkbox" checked={Array.isArray(value) && value.includes(location)} disabled={disabled} onChange={(event) => { const selected = Array.isArray(value) ? value as string[] : []; onChange(event.target.checked ? [...selected, location] : selected.filter((item) => item !== location)); }} />{location}</label>)}{Array.isArray(value) && (value as string[]).filter((location) => !locations.includes(location)).map((location) => <button key={location} type="button" className="workflow-link" disabled={disabled} onClick={() => onChange((value as string[]).filter((item) => item !== location))}>移除旧地点：{location}</button>)}{!locations.length && <small>请先在 Story Bible 中确定地点并审批。</small>}</div> : field.type === "textList" ? <TextEntries label={label} value={Array.isArray(value) ? value as string[] : []} onChange={onChange} disabled={disabled} scope={`${scope}.${field.key}`} example={presentation.example} multiline={!new Set(["tags", "locations", "themes", "likes", "dislikes", "factions", "accessibleLocations", "inventory", "routes"]).has(field.key)} /> : field.type === "referenceList" ? <ReferenceChoices label={label} value={Array.isArray(value) ? value as string[] : []} candidates={candidates.filter((row) => !field.referenceKind || row.kind === field.referenceKind)} disabled={disabled} onChange={onChange} /> : field.key === "endingType" ? <select id={`field-${scope}-${field.key}`} className="workflow-select" value={raw} disabled={disabled} onChange={(event) => editScalar(event.target.value)}>{endingOptions.map(([key, title]) => <option value={key} key={key}>{title}</option>)}</select> : field.type === "number" ? <input id={`field-${scope}-${field.key}`} className="workflow-input" type="number" value={Number(value ?? 1)} readOnly={fixed} disabled={disabled || fixed} onChange={(event) => onChange(Number(event.target.value))} /> : presentation.short ? <input id={`field-${scope}-${field.key}`} className="workflow-input" value={scalar} disabled={disabled} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }} aria-invalid={isEntityName && !scalar.trim()} maxLength={field.key === "name" ? 300 : 30000} placeholder={`例如：${presentation.example}`} onChange={(event) => editScalar(event.target.value)} /> : <textarea id={`field-${scope}-${field.key}`} className="workflow-textarea" rows={presentation.rows} value={scalar} disabled={disabled} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }} aria-invalid={isEntityName && !scalar.trim()} maxLength={30000} placeholder={`例如：${presentation.example}`} onChange={(event) => editScalar(event.target.value)} />}</div>;
}

function Picker({ label, value, candidates, disabled, onChange }: { label: string; value: string; candidates: Array<{ id: string; name: string }>; disabled: boolean; onChange: (value: string) => void }) { return <label className="workflow-field"><span>{label}</span><select className="workflow-select" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">请选择{label}</option>{candidates.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>; }
function SmallText({ label, value, disabled, onChange, long = false, example }: { label: string; value: unknown; disabled: boolean; onChange: (value: string) => void; long?: boolean; example?: string }) { return <label className={`workflow-field ${long ? "workflow-field--wide" : ""}`}><span>{label}</span>{long ? <textarea className="workflow-textarea" rows={3} value={String(value ?? "")} disabled={disabled} placeholder={example} onChange={(event) => onChange(event.target.value)} /> : <input className="workflow-input" value={String(value ?? "")} disabled={disabled} placeholder={example} onChange={(event) => onChange(event.target.value)} />}</label>; }
function NumberValue({ label, value, disabled, onChange, scope }: { label: string; value: unknown; disabled: boolean; onChange: (value: number) => void; scope: string }) {
  const context = useContext(NumberDraftContext);
  const journal = `chronicle.workflow.number.${context?.scope ?? "form"}.${scope}`;
  const savedText = typeof value === "number" ? String(value) : "0";
  const [raw, setRaw] = useState(() => localRead(journal) ?? savedText);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const invalid = useRef(localRead(journal) !== null);
  const errorCallback = useRef(context?.onError); errorCallback.current = context?.onError;
  function parse(rawValue: string): number | null { if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(rawValue)) return null; const number = Number(rawValue); return Number.isFinite(number) ? number : null; }
  function edit(next: string, submit = true) {
    setRaw(next);
    const number = parse(next);
    if (number === null) {
      const message = "请补全数值，例如 -5 或 0.5；原有数值保持不变。";
      invalid.current = true; setError(message); localWrite(journal, next); errorCallback.current?.(journal, message);
    } else {
      invalid.current = false; setError(null); localWrite(journal, null); errorCallback.current?.(journal, null);
      if (submit) onChange(number);
    }
  }
  useEffect(() => { if (!focused.current && !invalid.current) setRaw(savedText); }, [savedText]);
  useEffect(() => { const recovery = localRead(journal); if (recovery !== null) edit(recovery, false); return () => errorCallback.current?.(journal, null); }, [journal]);
  return <label className="workflow-field"><span>{label}</span><input className="workflow-input" type="text" inputMode="decimal" aria-label={label} value={raw} disabled={disabled} aria-invalid={Boolean(error)} placeholder="例如 -5 或 0.5" onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }} onChange={(event) => edit(event.target.value)} />{error && <small className="workflow-note workflow-note--warning" role="alert">{error}</small>}</label>;
}

interface StructuredProps { field: FieldDefinition; entity: WorkflowEntity; blueprint: Blueprint; candidates: WorkflowEntity[]; value: unknown; disabled: boolean; onChange: (value: Json) => void; onError: (key: string, message: string | null) => void }
export function StructuredField(props: StructuredProps) {
  const { field, entity, blueprint, candidates, value, disabled, onChange, onError } = props;
  const journal = `chronicle.workflow.field.${entity.id}.${field.key}`;
  const savedValue = value ?? emptyContent(entity.kind)[field.key];
  const initial = () => { try { const recovery = localRead(journal); if (recovery !== null) { const parsed = JSON.parse(recovery) as Json; if (canRenderStructured(field, parsed)) return parsed; } } catch { /* Preserve malformed raw text in the advanced editor. */ } return savedValue as Json; };
  const [draft, setDraft] = useState<Json>(initial);
  const [raw, setRaw] = useState(() => localRead(journal) ?? JSON.stringify(savedValue, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [advancedRevision, setAdvancedRevision] = useState(0);
  const localInvalid = useRef(false);
  const rowKeys = useRef<string[]>(Array.isArray(draft) ? draft.map(() => newKey()) : []);
  const root = useRef<HTMLDivElement>(null);
  const serialized = JSON.stringify(savedValue);
  useEffect(() => { if (!localInvalid.current && !root.current?.contains(document.activeElement)) { setDraft(savedValue as Json); setRaw(JSON.stringify(savedValue, null, 2)); } }, [serialized]);
  useEffect(() => { const recovery = localRead(journal); if (recovery !== null) validateRaw(recovery); return () => onError(journal, null); }, []);
  const presentation = fieldPresentation(entity.kind, field);
  function validate(next: Json, rawValue = JSON.stringify(next, null, 2)) {
    if (canRenderStructured(field, next)) setDraft(next);
    setRaw(rawValue);
    const result = contentSchemas[entity.kind].safeParse({ ...entity.content, [field.key]: next });
    if (result.success) { localInvalid.current = false; setError(null); onError(journal, null); localWrite(journal, null); onChange(next); }
    else { const message = result.error.issues.filter((issue) => issue.path[0] === field.key).map((issue) => `${issue.path.slice(1).join(".") || field.label}：${issue.message}`).join("；") || "请完成当前条目的必需信息"; localInvalid.current = true; setError(message); onError(journal, message); localWrite(journal, rawValue); }
    return result.success;
  }
  function validateRaw(next: string) {
    setRaw(next);
    try { if (validate(JSON.parse(next) as Json, next)) { localWrite(`chronicle.workflow.keyvalues.${entity.id}.${field.key}`, null); setAdvancedRevision((revision) => revision + 1); } }
    catch (problem) { const message = problem instanceof Error ? problem.message : "JSON 无法读取"; localInvalid.current = true; setError(message); onError(journal, message); localWrite(journal, next); }
  }
  const rows = Array.isArray(draft) ? draft as JsonRow[] : [];
  function changeRow(index: number, update: JsonRow) { validate(rows.map((row, ordinal) => ordinal === index ? { ...row, ...update } : row)); }
  function addRow(row: JsonRow) { rowKeys.current.push(newKey()); validate([...rows, row]); }
  function removeRow(index: number) { rowKeys.current.splice(index, 1); validate(rows.filter((_, ordinal) => ordinal !== index)); }
  const characterRows = candidates.filter((row) => row.kind === "character");
  const endingRows = candidates.filter((row) => row.kind === "ending");
  const chapterRows = candidates.filter((row) => row.kind === "chapter");
  function entries(index: number, key: string, label: string, example: string) { return <div className="workflow-field workflow-field--wide" key={key}><span>{label}</span><TextEntries label={label} value={(rows[index][key] ?? []) as string[]} disabled={disabled} scope={`${entity.id}.${field.key}.${rows[index].id ?? rows[index].characterId ?? rowKeys.current[index]}.${key}`} example={example} multiline onChange={(next) => changeRow(index, { [key]: next })} /></div>; }
  const attributesOf = (id: string) => (blueprint.characters.find((row) => row.id === id)?.content.dynamicAttributes ?? []) as Array<{ key: string; label: string; initial: number }>;
  return <NumberDraftContext.Provider value={{ scope: `${entity.id}.${field.key}`, onError }}><div className="workflow-field workflow-field--wide workflow-structured" ref={root}><span>{field.label}{field.required ? " *" : ""}</span><small>{presentation.help} 例如：{presentation.example}</small>
    {field.key === "dynamicAttributes" && <>{rows.map((row, index) => <div className="workflow-structured-row" key={rowKeys.current[index] ?? (rowKeys.current[index] = newKey())}><div className="workflow-structured-row__heading"><strong>属性 {index + 1}</strong><button className="danger-icon-button" type="button" disabled={disabled} onClick={() => removeRow(index)} aria-label={`删除属性 ${index + 1}`}><Trash2 size={13} /></button></div><div className="workflow-fields"><SmallText label="属性标识（英文字母 / 数字 / 下划线）" value={row.key} disabled={disabled} example="trust" onChange={(next) => changeRow(index, { key: next })} /><SmallText label="显示名称" value={row.label} disabled={disabled} example="信任" onChange={(next) => changeRow(index, { label: next })} /><NumberValue scope={`attribute-${index}-min`} label="最小值" value={row.min} disabled={disabled} onChange={(next) => changeRow(index, { min: next })} /><NumberValue scope={`attribute-${index}-max`} label="最大值" value={row.max} disabled={disabled} onChange={(next) => changeRow(index, { max: next })} /><NumberValue scope={`attribute-${index}-initial`} label="初始值" value={row.initial} disabled={disabled} onChange={(next) => changeRow(index, { initial: next })} /></div></div>)}<button className="quiet-button" type="button" disabled={disabled} onClick={() => addRow({ key: `attribute_${rows.length + 1}`, label: "新属性", min: 0, max: 100, initial: 0 })}><Plus size={13} />添加属性定义</button></>}
    {(field.key === "relationships" || field.key === "characterRelationships") && <>{rows.map((row, index) => <div className="workflow-structured-row" key={rowKeys.current[index] ?? (rowKeys.current[index] = newKey())}><div className="workflow-structured-row__heading"><strong>关系 {index + 1}</strong><button type="button" className="danger-icon-button" disabled={disabled} onClick={() => removeRow(index)} aria-label={`删除关系 ${index + 1}`}><Trash2 size={13} /></button></div><div className="workflow-fields"><Picker label="关系发起人物" value={String(row.fromCharacterId ?? "")} candidates={characterRows} disabled={disabled} onChange={(next) => changeRow(index, { fromCharacterId: next })} /><Picker label="关系对象人物" value={String(row.toCharacterId ?? "")} candidates={characterRows.filter((person) => person.id !== row.fromCharacterId)} disabled={disabled} onChange={(next) => changeRow(index, { toCharacterId: next })} /><SmallText label="关系说明" value={row.relationship} disabled={disabled} long example="仍然信任对方，但不愿谈起过去" onChange={(next) => changeRow(index, { relationship: next })} /><NumberValue scope={`relationship-${index}-initial`} label="初始关系数值（可选）" value={row.initialValue} disabled={disabled} onChange={(next) => changeRow(index, { initialValue: next })} /></div></div>)}<button type="button" className="quiet-button" disabled={disabled || characterRows.length < 2} onClick={() => addRow({ fromCharacterId: characterRows[0].id, toCharacterId: characterRows[1].id, relationship: "", initialValue: 0 })}><Plus size={13} />添加人物关系</button>{characterRows.length < 2 && <small>至少有两名已确定人物时，才需要建立人物间关系。</small>}</>}
    {entity.kind === "chapterCharacterPlan" && <>{rows.map((row, index) => <div className="workflow-structured-row" key={rowKeys.current[index] ?? (rowKeys.current[index] = newKey())}><div className="workflow-structured-row__heading"><strong>人物变化 {index + 1}</strong><button type="button" className="danger-icon-button" disabled={disabled} onClick={() => removeRow(index)} aria-label={`删除人物变化 ${index + 1}`}><Trash2 size={13} /></button></div><div className="workflow-fields"><Picker label="人物" value={String(row.characterId ?? "")} candidates={characterRows} disabled={disabled} onChange={(next) => changeRow(index, { characterId: next })} />{[["startState", "本章起始状态"], ["goal", "本章目标"], ["mentalChange", "心态变化"], ["relationshipChange", "人际关系变化"], ["endState", "本章结束预期状态"]].map(([key, label]) => <SmallText key={key} label={label} value={row[key]} disabled={disabled} long example="描述可观察的状态、行动或变化" onChange={(next) => changeRow(index, { [key]: next })} />)}{entries(index, "knownInformation", "应知道的信息", "已知道照片来自事故当天")}{entries(index, "forbiddenInformation", "不能知道的信息", "尚不知道寄信人的身份")}<div className="workflow-field workflow-field--wide"><span>可能变化的属性</span>{attributesOf(String(row.characterId)).map((attribute) => { const changes = (row.attributeChanges ?? []) as Array<{ key: string; delta: number }>; return <NumberValue key={attribute.key} scope={`${row.characterId}-${attribute.key}-delta`} label={`${attribute.label}变化量（可为负数，0 表示不变）`} value={changes.find((change) => change.key === attribute.key)?.delta ?? 0} disabled={disabled} onChange={(delta) => changeRow(index, { attributeChanges: [...changes.filter((change) => change.key !== attribute.key), ...(delta ? [{ key: attribute.key, delta }] : [])] })} />; })}</div></div></div>)}<button type="button" className="quiet-button" disabled={disabled || !characterRows.some((person) => !rows.some((row) => row.characterId === person.id))} onClick={() => { const person = characterRows.find((candidate) => !rows.some((row) => row.characterId === candidate.id)); if (person) addRow({ characterId: person.id, startState: "", goal: "", mentalChange: "", relationshipChange: "", knownInformation: [], forbiddenInformation: [], attributeChanges: [], endState: "" }); }}><Plus size={13} />添加本章人物计划</button></>}
    {field.key === "choices" && <>{rows.map((row, index) => <div className="workflow-structured-row" key={rowKeys.current[index] ?? (rowKeys.current[index] = newKey())}><div className="workflow-structured-row__heading"><strong>选择 {index + 1}</strong><button type="button" className="danger-icon-button" disabled={disabled} onClick={() => removeRow(index)} aria-label={`删除选择 ${index + 1}`}><Trash2 size={13} /></button></div><div className="workflow-fields"><SmallText label="玩家看到的选项文字" value={row.label} disabled={disabled} example="向林遥公开照片" onChange={(next) => changeRow(index, { label: next })} /><label className="workflow-checkbox"><input type="checkbox" checked={Boolean(row.hidden)} disabled={disabled} onChange={(event) => changeRow(index, { hidden: event.target.checked })} />隐藏选项（条件满足后显示）</label>{[["unlockConditions", "解锁条件", "信任达到 30"], ["effects", "实际效果", "公开照片，调查证据已共享"], ["relationshipEffects", "人物关系影响", "林遥对主角的信任增加"], ["futureChapterEffects", "后续章节影响", "下一章可共同进入档案室"], ["opensRoutes", "开启路线", "共同调查线"], ["closesRoutes", "关闭路线", "独自调查线"]].map(([key, label, example]) => entries(index, key, label, example))}<div className="workflow-field workflow-field--wide"><span>关联结局</span><ReferenceChoices label="关联结局" value={(row.endingIds ?? []) as string[]} candidates={endingRows} disabled={disabled} onChange={(next) => changeRow(index, { endingIds: next })} /></div></div></div>)}<button type="button" className="quiet-button" disabled={disabled} onClick={() => addRow({ id: `choice_${newKey()}`, label: "", hidden: false, unlockConditions: [], effects: [], relationshipEffects: [], futureChapterEffects: [], opensRoutes: [], closesRoutes: [], endingIds: [] })}><Plus size={13} />添加选项</button></>}
    {field.key === "characterLocations" && <div className="workflow-fields">{characterRows.map((person) => <Picker key={person.id} label={`${person.name}初始所在地`} value={String((draft as JsonRow)?.[person.id] ?? "")} candidates={(blueprint.storyBible.content.locations as string[]).map((location) => ({ id: location, name: location }))} disabled={disabled} onChange={(next) => validate({ ...(draft as JsonRow), [person.id]: next })} />)}</div>}
    {field.key === "characterAttributes" && <div className="workflow-fields">{characterRows.flatMap((person) => attributesOf(person.id).map((attribute) => <NumberValue key={`${person.id}.${attribute.key}`} scope={`${person.id}-${attribute.key}-initial`} label={`${person.name} / ${attribute.label}`} value={((draft as JsonRow)?.[person.id] as JsonRow | undefined)?.[attribute.key] ?? attribute.initial} disabled={disabled} onChange={(next) => validate({ ...(draft as JsonRow), [person.id]: { ...((draft as JsonRow)?.[person.id] as JsonRow ?? {}), [attribute.key]: next } })} />))}</div>}
    {(field.key === "playerAttributes" || field.key === "flags" || field.key === "configuration") && <KeyValueEditor key={advancedRevision} onDraftError={(message) => { localInvalid.current = Boolean(message); setError(message); onError(journal, message); }} value={!Array.isArray(draft) && draft && typeof draft === "object" ? draft as JsonRow : {}} disabled={disabled} scope={`${entity.id}.${field.key}`} mode={field.key === "playerAttributes" ? "number" : field.key === "flags" ? "flag" : "json"} onChange={validate} />}
    {error && <p className="workflow-note workflow-note--warning" role="alert">{error}。草稿已保留，请补全后继续。</p>}
    <details className="workflow-advanced"><summary>高级：直接编辑 JSON</summary><p className="workflow-outline__hint">结构化表单与这里编辑同一字段。适合批量粘贴；不符合字段结构的内容会保留为草稿，不覆盖 Blueprint。</p><textarea className="workflow-textarea workflow-textarea--json" value={raw} disabled={disabled} spellCheck={false} aria-label={`${field.label}高级 JSON`} onChange={(event) => validateRaw(event.target.value)} /></details>
    {field.key === "configuration" && chapterRows.length > 0 && <small>系统配置只定义静态参数。作用章节、人物和结局请使用上方关联字段选择。</small>}
  </div></NumberDraftContext.Provider>;
}

function KeyValueEditor({ value, disabled, scope, mode, onChange, onDraftError }: { value: JsonRow; disabled: boolean; scope: string; mode: "number" | "flag" | "json"; onChange: (value: JsonRow) => void; onDraftError: (message: string | null) => void }) {
  type Parameter = { id: string; key: string; value: Json; complex: boolean };
  const journal = `chronicle.workflow.keyvalues.${scope}`;
  const recovery = useRef<Parameter[] | null>(null);
  const [rows, setRows] = useState<Parameter[]>(() => {
    try { const saved = JSON.parse(localRead(journal) ?? "null") as Parameter[] | null; if (Array.isArray(saved) && saved.every((row) => row && typeof row.id === "string" && typeof row.key === "string")) { recovery.current = saved; return saved; } } catch { /* Preserve the saved document if the client journal is unreadable. */ }
    return Object.entries(value).map(([key, item]) => ({ id: newKey(), key, value: item, complex: item !== null && typeof item === "object" }));
  });
  const [issue, setIssue] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const initialSync = useRef(true);
  useEffect(() => {
    if (initialSync.current) { initialSync.current = false; return; }
    if (root.current?.contains(document.activeElement)) return;
    setRows((current) => Object.entries(value).map(([key, item]) => ({ id: current.find((row) => row.key === key)?.id ?? newKey(), key, value: item, complex: item !== null && typeof item === "object" })));
    setIssue(null); localWrite(journal, null);
  }, [JSON.stringify(value)]);
  useEffect(() => { if (recovery.current) commit(recovery.current); }, []);
  function commit(next: Parameter[]) {
    setRows(next);
    const keys = next.map((row) => row.key);
    const problem = keys.some((key) => !key.trim()) ? "请填写参数名称，空名称草稿已保留" : new Set(keys).size !== keys.length ? "参数名称不能重复，重复名称草稿已保留" : null;
    setIssue(problem); onDraftError(problem);
    if (problem) { localWrite(journal, JSON.stringify(next)); return; }
    localWrite(journal, null);
    onChange(Object.fromEntries(next.map((row) => [row.key, row.value])));
  }
  function change(id: string, patch: Partial<Parameter>) { commit(rows.map((row) => row.id === id ? { ...row, ...patch } : row)); }
  function remove(id: string, index: number) {
    const next = rows.filter((row) => row.id !== id); commit(next);
    const target = next[Math.min(index, next.length - 1)];
    if (target) requestAnimationFrame(() => document.getElementById(`kv-${target.id}`)?.focus());
  }
  return <div ref={root} className="workflow-keyvalues">{rows.map((row, index) => <div key={row.id} className="workflow-structured-row"><div className="workflow-structured-row__heading"><strong>参数 {index + 1}</strong><button type="button" className="danger-icon-button" disabled={disabled} aria-label={`删除参数 ${index + 1}`} onClick={() => remove(row.id, index)}><Trash2 size={13} /></button></div><div className="workflow-fields"><label className="workflow-field"><span>参数名称（英文字母 / 数字 / 下划线）</span><input id={`kv-${row.id}`} className="workflow-input" value={row.key} disabled={disabled} placeholder={mode === "flag" ? "photo_verified" : "daily_actions"} onChange={(event) => change(row.id, { key: event.target.value })} /></label>{row.complex ? <p className="workflow-note">这是已有嵌套配置。其完整内容保持原值，可在下面的高级编辑中修改。</p> : <><label className="workflow-field"><span>值类型</span><select className="workflow-select" value={typeof row.value} disabled={disabled || mode === "number"} onChange={(event) => change(row.id, { value: event.target.value === "number" ? 0 : event.target.value === "boolean" ? false : "" })}><option value="string">文字</option><option value="number">数值</option><option value="boolean">是 / 否</option></select></label>{typeof row.value === "number" ? <NumberValue scope={`parameter-${row.key}`} label="参数值" value={row.value} disabled={disabled} onChange={(value) => change(row.id, { value })} /> : typeof row.value === "boolean" ? <label className="workflow-checkbox"><input type="checkbox" checked={row.value} disabled={disabled} onChange={(event) => change(row.id, { value: event.target.checked })} />是（不勾选为否）</label> : <SmallText label="参数值" value={row.value} disabled={disabled} onChange={(value) => change(row.id, { value })} />}</>}</div></div>)}<button type="button" className="quiet-button" disabled={disabled} onClick={() => commit([...rows, { id: newKey(), key: `parameter_${newKey().slice(0, 6)}`, value: mode === "number" ? 0 : mode === "flag" ? false : "", complex: false }])}><Plus size={13} />添加参数</button>{issue && <p className="workflow-note workflow-note--warning" role="alert">{issue}</p>}<small className="workflow-entry-hint">{scope.split(".").at(-1) === "configuration" ? "已有复杂配置不会因编辑其他参数而丢失。" : "名称用于后续内容引用，请保持一致。"}</small></div>;
}
