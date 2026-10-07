import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, InputHTMLAttributes } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  CloudCog,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import type {
  ProviderProfile,
  ProviderProfileDraft,
  ProviderModelCatalogEntry,
  ProviderModels,
  ProviderType,
} from "../../shared/providers";

type ModelTier = keyof ProviderModels;

const modelTiers: Array<{ key: ModelTier; label: string }> = [
  { key: "small", label: "轻量模型" },
  { key: "medium", label: "标准模型" },
  { key: "large", label: "旗舰模型" },
];

type ApiResult<T> = T & { error?: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as ApiResult<T>;
  if (!response.ok) throw new Error(payload.error || `请求失败（HTTP ${response.status}）`);
  return payload;
}

function emptyDraft(providerType: ProviderType, ordinal: number): ProviderProfileDraft {
  return {
    name: providerType === "chatgpt_plan" ? `ChatGPT 账号 ${ordinal}` : `中转站预设 ${ordinal}`,
    providerType,
    baseUrl: "",
    apiKey: "",
    clearApiKey: false,
    models: { small: "gpt-4.1-mini", medium: "gpt-4.1", large: "gpt-4.1" },
    temperature: 0.7,
  };
}

function profileToDraft(profile: ProviderProfile): ProviderProfileDraft {
  return {
    name: profile.name,
    providerType: profile.providerType,
    baseUrl: profile.baseUrl ?? "",
    apiKey: "",
    clearApiKey: false,
    models: { ...profile.models },
    temperature: profile.temperature,
  };
}

function typeLabel(type: ProviderType): string {
  return type === "chatgpt_plan" ? "ChatGPT 订阅授权" : "OpenAI 兼容中转";
}

function authMessage(code: string | null): { kind: "success" | "error"; text: string } | null {
  if (code === "connected") {
    return { kind: "success", text: "ChatGPT 账号已完成授权。请确认卡片状态显示“计划额度已授权”。" };
  }
  const errors: Record<string, string> = {
    access_denied: "你取消了 ChatGPT 授权。可稍后重新登录，或改用 OpenAI 兼容中转。",
    authorization_failed: "ChatGPT 授权没有完成，请重新尝试，并确认当前账号同意了计划额度权限。",
    invalid_state: "授权回调校验失败。请从本机设置页重新发起登录。",
    scope_missing: "账号已登录，但没有授予 ChatGPT 计划额度权限；当前配置不能用于计划额度请求。",
    account_mismatch: "本次登录的账号与此预设绑定的账号不同。请新建 ChatGPT 配置后再登录。",
  };
  return code && errors[code]
    ? { kind: "error", text: errors[code] }
    : null;
}

function ProfileStatus({ profile }: { profile: ProviderProfile }) {
  if (profile.providerType === "openai_compatible") {
    return (
      <span className={`profile-state ${profile.hasApiKey ? "profile-state--ready" : ""}`}>
        <span />{profile.hasApiKey ? "密钥已保存" : "等待配置"}
      </span>
    );
  }
  const label = profile.chatgpt.planUsageAuthorized
    ? "计划额度已授权"
    : profile.chatgpt.signedIn
      ? "账号已登录"
      : "等待登录";
  return (
    <span className={`profile-state ${profile.chatgpt.planUsageAuthorized ? "profile-state--ready" : ""}`}>
      <span />{label}
    </span>
  );
}

function TextField({
  label,
  hint,
  ...props
}: {
  label: string;
  hint?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="settings-field">
      <span className="settings-field__label">{label}</span>
      <input {...props} />
      {hint && <span className="settings-field__hint">{hint}</span>}
    </label>
  );
}

export function ProviderSettings() {
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderProfileDraft>(emptyDraft("openai_compatible", 1));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelCatalog, setModelCatalog] = useState<ProviderModelCatalogEntry[]>([]);
  const [modelPickerTier, setModelPickerTier] = useState<ModelTier | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const confirmationRef = useRef<HTMLElement>(null);
  const modelPickerRef = useRef<HTMLElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const callbackProfileId = useRef<string | null>(null);
  const callbackMessage = useRef<ReturnType<typeof authMessage>>(null);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedId) ?? null,
    [profiles, selectedId],
  );
  const hasUnsavedProfile = selectedId === null;
  const canFetchModels = draft.providerType !== "chatgpt_plan"
    || Boolean(selectedId && selectedProfile?.chatgpt.planUsageAuthorized);
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLocaleLowerCase();
    if (!query) return modelCatalog;
    return modelCatalog.filter((model) =>
      model.id.toLocaleLowerCase().includes(query) || model.name.toLocaleLowerCase().includes(query),
    );
  }, [modelCatalog, modelSearch]);

  async function loadProfiles() {
    setLoading(true);
    try {
      const result = await request<{ profiles: ProviderProfile[] }>("/api/providers/profiles");
      setProfiles(result.profiles);
      const preferredId = callbackProfileId.current ?? selectedId;
      const selected = result.profiles.find((profile) => profile.id === preferredId)
        ?? result.profiles[0]
        ?? null;
      setSelectedId(selected?.id ?? null);
      if (selected) setDraft(profileToDraft(selected));
      else setDraft(emptyDraft("openai_compatible", 1));
      setModelCatalog([]);
      setModelPickerTier(null);
      if (callbackMessage.current) {
        setNotice(callbackMessage.current);
        callbackMessage.current = null;
      }
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "无法读取本机配置。" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    callbackProfileId.current = params.get("profile");
    callbackMessage.current = authMessage(params.get("chatgpt_auth"));
    if (params.has("view") || params.has("profile") || params.has("chatgpt_auth")) {
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
    }
    void loadProfiles();
  }, []);

  useEffect(() => {
    if (!confirmDelete && !confirmDisconnect) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    confirmationRef.current?.querySelector<HTMLElement>("button")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirmDelete(false);
        setConfirmDisconnect(false);
        return;
      }
      if (event.key !== "Tab" || !confirmationRef.current) return;
      const focusable = [...confirmationRef.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [confirmDelete, confirmDisconnect]);

  useEffect(() => {
    if (!modelPickerTier) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modelSearchRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setModelPickerTier(null);
        return;
      }
      if (event.key !== "Tab" || !modelPickerRef.current) return;
      const focusable = [...modelPickerRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [modelPickerTier]);

  function startNew(providerType: ProviderType) {
    setSelectedId(null);
    setDraft(emptyDraft(providerType, profiles.length + 1));
    setModelCatalog([]);
    setModelPickerTier(null);
    setConfirmDelete(false);
    setNotice(null);
  }

  function selectProfile(profile: ProviderProfile) {
    setSelectedId(profile.id);
    setDraft(profileToDraft(profile));
    setModelCatalog([]);
    setModelPickerTier(null);
    setNotice(null);
    setConfirmDelete(false);
  }

  function updateDraft(update: Partial<ProviderProfileDraft>) {
    setDraft((current) => ({ ...current, ...update }));
    if ("providerType" in update || "baseUrl" in update || "apiKey" in update || "clearApiKey" in update) {
      setModelCatalog([]);
      setModelPickerTier(null);
    }
  }

  async function persistProfile(): Promise<ProviderProfile | null> {
    setSaving(true);
    setNotice(null);
    try {
      const result = await request<{ profile: ProviderProfile }>(
        selectedId ? `/api/providers/profiles/${selectedId}` : "/api/providers/profiles",
        {
          method: selectedId ? "PUT" : "POST",
          body: JSON.stringify(draft),
        },
      );
      const saved = result.profile;
      setProfiles((current) => {
        const next = current.some((profile) => profile.id === saved.id)
          ? current.map((profile) => profile.id === saved.id ? saved : profile)
          : [...current, saved];
        return next;
      });
      setSelectedId(saved.id);
      setDraft(profileToDraft(saved));
      return saved;
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "配置保存失败。" });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile() {
    const saved = await persistProfile();
    if (saved) setNotice({ kind: "success", text: "配置已保存到本机 SQLite。" });
  }

  async function activateProfile() {
    if (!selectedId) return;
    try {
      const result = await request<{ profile: ProviderProfile }>(
        `/api/providers/profiles/${selectedId}/activate`,
        { method: "POST" },
      );
      setProfiles((current) => current.map((profile) => ({
        ...profile,
        isActive: profile.id === result.profile.id,
      })));
      setNotice({ kind: "success", text: `“${result.profile.name}”已设为当前配置。` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "切换配置失败。" });
    }
  }

  async function checkRelay() {
    if (!selectedId) return;
    setChecking(true);
    setNotice(null);
    try {
      const result = await request<{
        ok: boolean;
        detail?: string;
        error?: string;
      }>(`/api/providers/profiles/${selectedId}/check`, { method: "POST" });
      setNotice({ kind: result.ok ? "success" : "error", text: result.detail ?? result.error ?? "连接检查完成。" });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "连接检查失败。" });
    } finally {
      setChecking(false);
    }
  }

  async function beginChatGPTLogin() {
    if (draft.providerType !== "chatgpt_plan" || authBusy || saving) return;
    setAuthBusy(true);
    setNotice(null);
    try {
      let profileId = selectedId;
      if (!profileId) {
        const savedProfile = await persistProfile();
        if (!savedProfile) return;
        profileId = savedProfile.id;
      }
      const result = await request<{ authorizeUrl: string }>("/api/providers/chatgpt/start", {
        method: "POST",
        body: JSON.stringify({ profileId }),
      });
      window.location.assign(result.authorizeUrl);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "无法启动 ChatGPT 登录。" });
    } finally {
      setAuthBusy(false);
    }
  }

  async function fetchModelCatalog(targetTier: ModelTier = "small") {
    if (modelsLoading || saving || loading) return;
    setModelsLoading(true);
    setNotice(null);
    try {
      let result: { models: ProviderModelCatalogEntry[] };
      if (draft.providerType === "openai_compatible") {
        result = await request<{ models: ProviderModelCatalogEntry[] }>("/api/providers/models", {
            method: "POST",
            body: JSON.stringify({
              providerType: "openai_compatible",
              profileId: selectedId ?? undefined,
              baseUrl: draft.baseUrl,
              apiKey: draft.apiKey,
              clearApiKey: draft.clearApiKey,
            }),
          });
      } else {
        if (!selectedId || !selectedProfile?.chatgpt.planUsageAuthorized) {
          throw new Error("请先登录并授予 ChatGPT 计划额度权限，再拉取模型。");
        }
        result = await request<{ models: ProviderModelCatalogEntry[] }>("/api/providers/models", {
          method: "POST",
          body: JSON.stringify({ providerType: "chatgpt_plan", profileId: selectedId }),
        });
      }

      if (!result.models.length) throw new Error("服务已响应，但模型目录中没有可用模型。");
      setModelCatalog(result.models);
      setModelPickerTier(targetTier);
      setModelSearch("");
      setNotice({
        kind: "success",
        text: `已从${draft.providerType === "chatgpt_plan" ? "ChatGPT 账户" : "中转站 /models"}读取 ${result.models.length} 个模型。`,
      });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "读取模型目录失败。" });
    } finally {
      setModelsLoading(false);
    }
  }

  function chooseModel(model: ProviderModelCatalogEntry) {
    if (!modelPickerTier) return;
    const tier = modelTiers.find((item) => item.key === modelPickerTier)?.label ?? "模型";
    updateDraft({ models: { ...draft.models, [modelPickerTier]: model.id } });
    setModelPickerTier(null);
    setNotice({ kind: "success", text: `已将 ${model.name} 设为${tier}。` });
  }

  async function disconnectChatGPT() {
    if (!selectedId) return;
    try {
      await request(`/api/providers/profiles/${selectedId}/chatgpt/disconnect`, { method: "POST" });
      setConfirmDisconnect(false);
      setNotice({ kind: "success", text: "本机已清除该配置保存的 ChatGPT 凭据。若要撤销 OpenAI 侧授权，请到 ChatGPT 设置中管理已连接应用。" });
      await loadProfiles();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "清除账号凭据失败。" });
    }
  }

  async function deleteProfile() {
    if (!selectedId) return;
    try {
      await request(`/api/providers/profiles/${selectedId}`, { method: "DELETE" });
      setConfirmDelete(false);
      setNotice({ kind: "success", text: "配置及其本机凭据已删除。" });
      callbackProfileId.current = null;
      await loadProfiles();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "删除配置失败。" });
    }
  }

  const hasPlanUsage = Boolean(selectedProfile?.chatgpt.planUsageAuthorized);

  return (
    <div className="page-content provider-page">
      <section className="provider-hero">
        <div className="provider-hero__content">
          <span className="provider-hero__eyebrow"><span /> MODEL ROUTING / LOCAL VAULT</span>
          <h1>模型与 API 设置</h1>
          <p>为不同创作场景保存独立模型预设。配置仅存放在本机 SQLite，服务凭据由本机 API 管理。</p>
          <div className="provider-hero__metrics">
            <span><strong>{profiles.length.toString().padStart(2, "0")}</strong> 个配置预设</span>
            <i />
            <span>{profiles.some((profile) => profile.isActive) ? "已选择当前服务" : "尚未激活服务"}</span>
          </div>
        </div>
        <div className="provider-hero__graphic" aria-hidden="true">
          <div className="provider-hero__ring provider-hero__ring--outer" />
          <div className="provider-hero__ring provider-hero__ring--inner" />
          <div className="provider-hero__core"><Sparkles size={24} /></div>
          <span className="provider-hero__orbit-dot provider-hero__orbit-dot--one" />
          <span className="provider-hero__orbit-dot provider-hero__orbit-dot--two" />
          <svg viewBox="0 0 290 190" fill="none">
            <path d="M18 95H89C116 95 116 43 145 43S174 147 202 147h70" />
            <path d="M18 95H89C116 95 116 147 145 147S174 43 202 43h70" />
            {[18, 89, 145, 202, 272].map((x, index) => (
              <g key={`${x}-${index}`} className={`provider-hero__node provider-hero__node--${index}`}>
                <circle cx={x} cy={index === 1 || index === 3 ? 43 : index === 2 ? 95 : 147} r="7" />
                <circle cx={x} cy={index === 1 || index === 3 ? 43 : index === 2 ? 95 : 147} r="16" />
              </g>
            ))}
          </svg>
          <span className="provider-hero__graphic-label">ROUTING / PROFILE 01</span>
        </div>
        <div className="provider-hero__index">02 <span>/</span> 07</div>
      </section>

      <div className="provider-settings-layout">
        <aside className="profile-rail" aria-label="API 配置预设">
          <div className="profile-rail__heading">
            <div><span className="eyebrow">YOUR CONNECTIONS</span><h2>配置预设</h2></div>
            <span className="profile-rail__count">{profiles.length.toString().padStart(2, "0")}</span>
          </div>
          <div className="profile-rail__actions">
            <button type="button" className="profile-add" onClick={() => startNew("openai_compatible")}>
              <Plus size={15} aria-hidden="true" />添加中转站
            </button>
            <button type="button" className="profile-add profile-add--quiet" onClick={() => startNew("chatgpt_plan")}>
              <Plus size={15} aria-hidden="true" />添加 ChatGPT
            </button>
          </div>
          <div className="profile-list" aria-live="polite">
            {loading ? (
              <div className="profile-list__loading"><span className="loading-sweep" />正在读取本机配置</div>
            ) : profiles.length ? profiles.map((profile) => (
              <button
                className={`profile-item ${selectedId === profile.id ? "profile-item--selected" : ""}`}
                key={profile.id}
                type="button"
                onClick={() => selectProfile(profile)}
                aria-pressed={selectedId === profile.id}
              >
                <span className={`profile-item__icon ${profile.providerType === "chatgpt_plan" ? "profile-item__icon--chatgpt" : ""}`}>
                  {profile.providerType === "chatgpt_plan" ? <KeyRound size={16} /> : <CloudCog size={16} />}
                </span>
                <span className="profile-item__copy">
                  <strong>{profile.name}</strong>
                  <small>{typeLabel(profile.providerType)}</small>
                  <ProfileStatus profile={profile} />
                </span>
                {profile.isActive && <span className="profile-item__active" aria-label="当前配置"><Check size={13} /></span>}
                <ArrowRight className="profile-item__arrow" size={14} aria-hidden="true" />
              </button>
            )) : (
              <div className="profile-empty">
                <span><SlidersHorizontal size={18} /></span>
                <strong>还没有连接配置</strong>
                <small>添加中转站或 ChatGPT 账号开始设置。</small>
              </div>
            )}
          </div>
          <div className="profile-rail__footnote"><ShieldCheck size={14} />仅此设备可访问</div>
        </aside>

        <section className="profile-editor" aria-labelledby="profile-editor-title">
          <div className="profile-editor__topline">
            <div>
              <span className="eyebrow">PROVIDER PROFILE</span>
              <h2 id="profile-editor-title">{hasUnsavedProfile ? "创建配置预设" : draft.name || "配置预设"}</h2>
            </div>
            {selectedProfile?.isActive ? (
              <span className="active-chip"><CheckCircle2 size={14} />当前使用</span>
            ) : selectedProfile ? (
              <button className="activate-button" type="button" onClick={() => void activateProfile()}>
                设为当前<ArrowRight size={14} />
              </button>
            ) : (
              <span className="draft-chip">未保存</span>
            )}
          </div>

          <div className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-section__step">01</span>
              <div><h3>服务类型</h3><p>选择这组模型使用的授权方式</p></div>
            </div>
            <TextField
              label="配置名称"
              value={draft.name}
              placeholder="例如：叙事创作主力模型"
              maxLength={80}
              onChange={(event) => updateDraft({ name: event.target.value })}
            />
            <div className="provider-choice" role="group" aria-label="服务类型">
              <button
                type="button"
                className={`provider-choice__card ${draft.providerType === "openai_compatible" ? "provider-choice__card--selected" : ""}`}
                disabled={!hasUnsavedProfile}
                onClick={() => updateDraft({ providerType: "openai_compatible", baseUrl: "", apiKey: "", clearApiKey: false })}
                aria-pressed={draft.providerType === "openai_compatible"}
              >
                <span className="provider-choice__icon"><CloudCog size={18} /></span>
                <span><strong>OpenAI 兼容中转</strong><small>填写端点与 API Key</small></span>
                {draft.providerType === "openai_compatible" && <CheckCircle2 size={16} className="provider-choice__check" />}
              </button>
              <button
                type="button"
                className={`provider-choice__card provider-choice__card--chatgpt ${draft.providerType === "chatgpt_plan" ? "provider-choice__card--selected" : ""}`}
                disabled={!hasUnsavedProfile}
                onClick={() => updateDraft({ providerType: "chatgpt_plan", baseUrl: "", apiKey: "", clearApiKey: false })}
                aria-pressed={draft.providerType === "chatgpt_plan"}
              >
                <span className="provider-choice__icon"><KeyRound size={18} /></span>
                <span><strong>ChatGPT 账号</strong><small>登录并授权计划额度</small></span>
                {draft.providerType === "chatgpt_plan" && <CheckCircle2 size={16} className="provider-choice__check" />}
              </button>
            </div>
            {selectedProfile && <p className="settings-lock-note"><ShieldCheck size={13} />已保存预设的服务类型固定；如需另一种服务，请新增独立预设。</p>}
          </div>

          {draft.providerType === "openai_compatible" ? (
            <div className="settings-section">
              <div className="settings-section__heading">
                <span className="settings-section__step">02</span>
                <div><h3>中转站连接</h3><p>请求由本机服务发送至此端点</p></div>
                <span className="settings-section__glyph"><CloudCog size={16} /></span>
              </div>
              <div className="settings-fields-grid">
                <TextField
                  label="API Base URL"
                  value={draft.baseUrl}
                  placeholder="https://api.example.com/v1"
                  autoComplete="url"
                  spellCheck={false}
                  onChange={(event) => updateDraft({ baseUrl: event.target.value })}
                  hint="远程端点需使用 HTTPS；本机回环服务可使用 HTTP。"
                />
                <div className="settings-field">
                  <label className="settings-field__label" htmlFor="provider-api-key">API Key</label>
                  <input
                    id="provider-api-key"
                    type="password"
                    value={draft.apiKey}
                    placeholder={selectedProfile?.hasApiKey ? "已保存，留空则保持不变" : "粘贴服务商提供的密钥"}
                    autoComplete="new-password"
                    spellCheck={false}
                    onChange={(event) => updateDraft({ apiKey: event.target.value, clearApiKey: false })}
                  />
                  <span className="settings-field__hint">
                    {selectedProfile?.hasApiKey ? "密钥仅由本机 API 使用，页面不会读取已保存的值。" : "密钥会加密后写入本机数据库，不会传回页面。"}
                    {selectedProfile?.hasApiKey && !draft.clearApiKey && (
                      <button className="field-action" type="button" onClick={() => updateDraft({ clearApiKey: true, apiKey: "" })}>
                        移除密钥
                      </button>
                    )}
                    {draft.clearApiKey && <button className="field-action" type="button" onClick={() => updateDraft({ clearApiKey: false })}>保留已保存密钥</button>}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="settings-section chatgpt-section">
              <div className="settings-section__heading">
                <span className="settings-section__step">02</span>
                <div><h3>ChatGPT 账号授权</h3><p>使用系统浏览器完成本机 OAuth 登录</p></div>
                <span className="settings-section__glyph settings-section__glyph--violet"><KeyRound size={16} /></span>
              </div>
              <div className={`chatgpt-connection ${hasPlanUsage ? "chatgpt-connection--ready" : ""}`}>
                <div className="chatgpt-connection__mark" aria-hidden="true"><Activity size={20} /></div>
                <div className="chatgpt-connection__copy">
                  <strong>{selectedProfile?.chatgpt.planUsageAuthorized
                    ? "ChatGPT 计划额度已授权"
                    : selectedProfile?.chatgpt.signedIn
                      ? "已登录，计划额度尚未授权"
                      : "连接你的 ChatGPT 账号"}</strong>
                  <span>{selectedProfile?.chatgpt.email ?? "登录后将在此显示本机已连接账号"}</span>
                  {selectedProfile?.chatgpt.expiresAt && <small>令牌到期时间：{new Date(selectedProfile.chatgpt.expiresAt).toLocaleString("zh-CN")}</small>}
                </div>
                {hasPlanUsage ? <span className="chatgpt-connection__badge"><CheckCircle2 size={14} />已授权</span> : null}
              </div>
              <div className="chatgpt-actions">
                <button
                  className="chatgpt-login-button"
                  type="button"
                  onClick={() => void beginChatGPTLogin()}
                  disabled={authBusy || saving || loading}
                  title={hasUnsavedProfile ? "点击后先保存预设，再打开 ChatGPT 授权" : undefined}
                >
                  {authBusy ? <LoaderCircle size={16} className="spin-icon" /> : <KeyRound size={16} />}
                  Continue with ChatGPT
                  <ArrowRight size={15} />
                </button>
                {selectedProfile?.chatgpt.signedIn && (
                  <button className="quiet-button" type="button" onClick={() => setConfirmDisconnect(true)}>
                    <Unplug size={14} />清除本机凭据
                  </button>
                )}
              </div>
              <p className="chatgpt-note"><ShieldCheck size={14} />ChatGPT 计划额度授权与账号登录分开确认，仅由本机进程发起 Responses API 请求。可用性取决于账户资格和是否授予计划额度权限。</p>
            </div>
          )}

          <div className="settings-section model-section">
            <div className="settings-section__heading">
              <span className="settings-section__step">03</span>
              <div><h3>模型档位</h3><p>按任务复杂度为轻、中、重型工作分配模型</p></div>
              <button
                className="model-catalog-button"
                type="button"
                onClick={() => void fetchModelCatalog("small")}
                disabled={modelsLoading || saving || !canFetchModels}
              >
                {modelsLoading ? <LoaderCircle size={13} className="spin-icon" /> : <RefreshCw size={13} />}
                {modelCatalog.length ? "刷新模型目录" : "拉取模型目录"}
              </button>
            </div>
            <div className="model-tier-grid">
              {([
                ["small", "轻量模型", "快速整理、标签和短文本", "S"],
                ["medium", "标准模型", "日常创作与结构化编辑", "M"],
                ["large", "旗舰模型", "复杂推演与长篇内容", "L"],
              ] as const).map(([key, title, description, letter]) => (
                <div className={`model-tier model-tier--${key}`} key={key}>
                  <span className="model-tier__top"><span className="model-tier__letter">{letter}</span><span>{title}</span></span>
                  <div className="model-tier__field">
                    <input
                      value={draft.models[key]}
                      placeholder={key === "small" ? "gpt-4.1-mini" : "gpt-4.1"}
                      maxLength={160}
                      spellCheck={false}
                      onChange={(event) => updateDraft({ models: { ...draft.models, [key]: event.target.value } })}
                      aria-label={`${title}模型 ID`}
                    />
                    <button
                      className="model-tier__picker-button"
                      type="button"
                      onClick={() => modelCatalog.length ? setModelPickerTier(key) : void fetchModelCatalog(key)}
                      disabled={modelsLoading || !canFetchModels}
                      aria-label={`从模型目录选择${title}`}
                      title={modelCatalog.length ? "从已拉取的目录选择" : "先拉取模型目录"}
                    >
                      <SlidersHorizontal size={13} />
                    </button>
                  </div>
                  <small>{description}</small>
                </div>
              ))}
            </div>
            <p className="model-section__hint"><ArrowDownRight size={13} />中转站从当前端点的 <code>/models</code> 拉取；ChatGPT 登录并获计划权限后读取账户目录。目录可用于选择，也可手动填写模型 ID。</p>
          </div>

          <div className="settings-section temperature-section">
            <div className="settings-section__heading">
              <span className="settings-section__step">04</span>
              <div><h3>输出温度</h3><p>控制生成内容的随机程度</p></div>
              <span className="temperature-value">{draft.temperature.toFixed(1)}</span>
            </div>
            <div className="temperature-control">
              <span>稳定</span>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={draft.temperature}
                aria-label="输出温度"
                style={{ "--range-progress": `${draft.temperature / 2 * 100}%` } as CSSProperties}
                onChange={(event) => updateDraft({ temperature: Number(event.target.value) })}
              />
              <span>发散</span>
            </div>
          </div>

          {notice && (
            <div className={`settings-notice settings-notice--${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
              {notice.kind === "success" ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}
              <span>{notice.text}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="关闭提示"><X size={14} /></button>
            </div>
          )}

          <div className="profile-editor__footer">
            <span className="profile-editor__saved-note"><ShieldCheck size={14} />配置保存于本机 SQLite</span>
            <div className="profile-editor__buttons">
              {selectedProfile?.providerType === "openai_compatible" && (
                <button className="quiet-button" type="button" onClick={() => void checkRelay()} disabled={checking || saving}>
                  {checking ? <LoaderCircle size={14} className="spin-icon" /> : <RefreshCw size={14} />}
                  检查连接
                </button>
              )}
              {selectedProfile && (
                <button className="danger-icon-button" type="button" onClick={() => setConfirmDelete(true)} aria-label="删除配置" title="删除配置">
                  <Trash2 size={15} />
                </button>
              )}
              <button className="primary-button settings-save-button" type="button" onClick={() => void saveProfile()} disabled={saving || loading}>
                {saving ? <LoaderCircle size={15} className="spin-icon" /> : <Check size={15} />}
                保存配置<ArrowRight size={15} />
              </button>
            </div>
          </div>
        </section>
      </div>

      <div className="provider-disclaimer"><ShieldCheck size={14} /><span>使用兼容中转时，发送的提示词和创作内容会由所配置的服务处理。ChatGPT 计划授权只用于本人在本机发起的请求。</span></div>

      {modelPickerTier && (
        <div className="model-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModelPickerTier(null); }}>
          <section className="model-picker" ref={modelPickerRef} role="dialog" aria-modal="true" aria-labelledby="model-picker-title" tabIndex={-1}>
            <div className="model-picker__header">
              <div><span className="eyebrow">MODEL CATALOG / {modelCatalog.length.toString().padStart(2, "0")} MODELS</span><h2 id="model-picker-title">选择模型</h2></div>
              <button className="model-picker__close" type="button" onClick={() => setModelPickerTier(null)} aria-label="关闭模型目录"><X size={16} /></button>
            </div>
            <div className="model-picker__tiers" role="tablist" aria-label="选择模型档位">
              {modelTiers.map((tier) => (
                <button
                  key={tier.key}
                  className={modelPickerTier === tier.key ? "model-picker__tier model-picker__tier--selected" : "model-picker__tier"}
                  type="button"
                  role="tab"
                  aria-selected={modelPickerTier === tier.key}
                  onClick={() => setModelPickerTier(tier.key)}
                >
                  {tier.label}
                </button>
              ))}
            </div>
            <label className="model-picker__search">
              <Search size={15} aria-hidden="true" />
              <input ref={modelSearchRef} value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="搜索模型名称或 ID" aria-label="搜索模型目录" />
              <span>{filteredModels.length}</span>
            </label>
            <div className="model-picker__list">
              {filteredModels.length ? filteredModels.map((model) => (
                <button className="model-picker__item" type="button" key={model.id} onClick={() => chooseModel(model)}>
                  <span className="model-picker__item-copy"><strong>{model.name}</strong><code>{model.id}</code></span>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              )) : <div className="model-picker__empty">没有匹配的模型，请调整搜索内容。</div>}
            </div>
            <p className="model-picker__footer">将所选模型设为{modelTiers.find((tier) => tier.key === modelPickerTier)?.label}，其他档位保持不变。</p>
          </section>
        </div>
      )}

      {(confirmDelete || confirmDisconnect) && (
        <div className="settings-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setConfirmDelete(false); setConfirmDisconnect(false); } }}>
          <section className="settings-confirm-card" ref={confirmationRef} role="dialog" aria-modal="true" aria-labelledby="confirm-title" tabIndex={-1}>
            <span className="settings-confirm-card__icon"><Trash2 size={18} /></span>
            <h2 id="confirm-title">{confirmDelete ? "删除这份配置？" : "清除 ChatGPT 本机凭据？"}</h2>
            <p>{confirmDelete
              ? "这会删除配置及其保存在本机的凭据。此操作无法从应用内撤销。"
              : "应用会清除本机保存的令牌。若需撤销 OpenAI 侧授权，请到 ChatGPT 设置中管理已连接应用。"}</p>
            <div className="settings-confirm-card__actions">
              <button className="quiet-button" type="button" onClick={() => { setConfirmDelete(false); setConfirmDisconnect(false); }}>取消</button>
              <button className="danger-button" type="button" onClick={() => void (confirmDelete ? deleteProfile() : disconnectChatGPT())}>
                {confirmDelete ? "删除配置" : "清除凭据"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
