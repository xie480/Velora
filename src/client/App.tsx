import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Clock3,
  Cpu,
  Database,
  GitBranch,
  KeyRound,
  Layers3,
  Network,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { DiagnosticGroup, DiagnosticItem, DiagnosticReport } from "../shared/diagnostics";
import { NarrativePreview } from "./components/NarrativePreview";

const frontendItems: DiagnosticItem[] = [
  {
    id: "react-vite",
    label: "React + Vite",
    group: "local",
    state: "connected",
    detail: `界面已运行 · React ${import.meta.env.DEV ? "开发模式" : "生产构建"}`,
  },
  {
    id: "react-flow",
    label: "React Flow",
    group: "local",
    state: "connected",
    detail: "叙事图画布已挂载，节点与连线由 React Flow 绘制。",
  },
  {
    id: "svg-icons",
    label: "Lucide SVG 图标",
    group: "local",
    state: "connected",
    detail: "界面图标由内联 SVG 渲染。",
  },
];

function checkIndexedDb(): Promise<DiagnosticItem> {
  const id = `pc-diagnostic-${crypto.randomUUID()}`;
  return new Promise((resolve) => {
    if (!("indexedDB" in window)) {
      resolve({
        id: "indexeddb",
        label: "浏览器 IndexedDB",
        group: "local",
        state: "failed",
        detail: "当前浏览器未提供 IndexedDB。",
      });
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(id, 1);
    } catch {
      resolve({
        id: "indexeddb",
        label: "浏览器 IndexedDB",
        group: "local",
        state: "failed",
        detail: "浏览器拒绝创建本地存档检查库。",
      });
      return;
    }

    request.onupgradeneeded = () => request.result.createObjectStore("probe");
    request.onerror = () =>
      resolve({
        id: "indexeddb",
        label: "浏览器 IndexedDB",
        group: "local",
        state: "failed",
        detail: "本地数据库无法打开；请检查浏览器存储权限。",
      });
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("probe", "readwrite");
      transaction.objectStore("probe").put("ok", "status");
      transaction.oncomplete = () => {
        database.close();
        const cleanup = indexedDB.deleteDatabase(id);
        cleanup.onsuccess = () =>
          resolve({
            id: "indexeddb",
            label: "浏览器 IndexedDB",
            group: "local",
            state: "connected",
            detail: "临时本地库已成功读写并清理；玩家存档可使用 IndexedDB。",
          });
        cleanup.onerror = cleanup.onblocked = () =>
          resolve({
            id: "indexeddb",
            label: "浏览器 IndexedDB",
            group: "local",
            state: "connected",
            detail: "本地数据库读写检查通过；浏览器未能立即清理临时检查库。",
          });
      };
      transaction.onerror = () => {
        database.close();
        resolve({
          id: "indexeddb",
          label: "浏览器 IndexedDB",
          group: "local",
          state: "failed",
          detail: "本地数据库打开成功，但写入检查失败。",
        });
      };
    };
  });
}

function makeUnavailableReport(): DiagnosticReport {
  return {
    checkedAt: new Date().toISOString(),
    items: [
      {
        id: "hono-api",
        label: "Hono 本机 API",
        group: "local",
        state: "failed",
        detail: "无法连接本机 API；请确认项目服务已启动。",
      },
      {
        id: "backend-checks",
        label: "服务端依赖检查",
        group: "local",
        state: "failed",
        detail: "API 不可用，SQLite、Drizzle、USearch 与 AI 服务检查未执行。",
      },
    ],
  };
}

function formatCheckedAt(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function StatusGlyph({ state }: { state: DiagnosticItem["state"] }) {
  if (state === "connected") return <CheckCircle2 size={16} aria-hidden="true" />;
  if (state === "failed") return <CircleAlert size={16} aria-hidden="true" />;
  if (state === "not_integrated") return <CircleDashed size={16} aria-hidden="true" />;
  return <Clock3 size={16} aria-hidden="true" />;
}

function StatusText({ state }: { state: DiagnosticItem["state"] }) {
  const labels = {
    connected: "连接成功",
    failed: "检查失败",
    not_configured: "待配置",
    not_integrated: "待接入",
  };
  return <span className={`status-pill status-pill--${state}`}><StatusGlyph state={state} />{labels[state]}</span>;
}

function WeaveLoader() {
  return (
    <div className="weave-loader" role="status" aria-live="polite" aria-label="正在检查本机环境">
      <svg className="weave-loader__art" viewBox="0 0 520 120" fill="none" aria-hidden="true">
        <path className="weave-loader__track" d="M22 60H498" />
        <path className="weave-loader__line weave-loader__line--one" d="M22 60C70 60 67 27 116 27S162 94 212 94 260 43 309 43 356 76 406 76 452 60 498 60" />
        <path className="weave-loader__line weave-loader__line--two" d="M22 60C70 60 67 94 116 94S162 27 212 27 260 76 309 76 356 43 406 43 452 60 498 60" />
        {[22, 116, 212, 309, 406, 498].map((x, index) => (
          <g className={`weave-loader__node weave-loader__node--${index}`} key={x}>
            <circle cx={x} cy={60} r={index === 0 || index === 5 ? 8 : 6} />
            <circle cx={x} cy={60} r="14" />
          </g>
        ))}
      </svg>
      <div className="weave-loader__copy">
        <span>正在编织本机技术脉络</span>
        <span>逐项验证运行时、数据库、索引与服务连接</span>
      </div>
    </div>
  );
}

function DiagnosticRow({ item }: { item: DiagnosticItem }) {
  return (
    <article className={`diagnostic-row diagnostic-row--${item.state}`}>
      <div className="diagnostic-row__icon" aria-hidden="true">
        {item.group === "ai" ? <KeyRound size={17} /> : <Cpu size={17} />}
      </div>
      <div className="diagnostic-row__body">
        <div className="diagnostic-row__heading">
          <strong>{item.label}</strong>
          {typeof item.latencyMs === "number" && <span className="diagnostic-row__latency">{item.latencyMs} ms</span>}
        </div>
        <p>{item.detail}</p>
      </div>
      <StatusText state={item.state} />
    </article>
  );
}

function DiagnosticsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [notice, setNotice] = useState("");

  async function runCheck() {
    setLoading(true);
    setNotice("");
    const [browserItem, apiResponse] = await Promise.all([
      checkIndexedDb(),
      fetch("/api/system/diagnostics", { headers: { Accept: "application/json" } }).catch(() => null),
    ]);

    if (!apiResponse?.ok) {
      setReport({
        ...makeUnavailableReport(),
        items: [...frontendItems, browserItem, ...makeUnavailableReport().items],
      });
      setLoading(false);
      return;
    }

    try {
      const backendReport = (await apiResponse.json()) as DiagnosticReport;
      setReport({
        checkedAt: backendReport.checkedAt,
        items: [...frontendItems, browserItem, ...backendReport.items],
      });
    } catch {
      setNotice("服务已响应，但返回的诊断数据无法读取。请查看本机 API 终端日志。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (open) void runCheck();
  }, [open]);

  const groupedItems = useMemo(() => {
    const items = report?.items ?? [];
    return {
      local: items.filter((item) => item.group === "local"),
      ai: items.filter((item) => item.group === "ai"),
    } satisfies Record<DiagnosticGroup, DiagnosticItem[]>;
  }, [report]);

  const connectedCount = report?.items.filter((item) => item.state === "connected").length ?? 0;
  const totalCount = report?.items.length ?? 0;

  return (
    <dialog
      className="diagnostics-dialog"
      ref={dialogRef}
      aria-labelledby="diagnostics-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="diagnostics-dialog__inner">
        <header className="dialog-header">
          <div className="dialog-header__title">
            <span className="dialog-header__mark"><Activity size={18} aria-hidden="true" /></span>
            <div>
              <span className="eyebrow">SYSTEM DIAGNOSTICS</span>
              <h2 id="diagnostics-title">技术栈与环境检查</h2>
            </div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭环境检查">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="dialog-summary">
          <div className="dialog-summary__icon"><ShieldCheck size={20} aria-hidden="true" /></div>
          <div>
            <strong>{report ? `${connectedCount} / ${totalCount} 项已连接` : "检查本机创作环境"}</strong>
            <span>
              {report
                ? `最近检查 ${formatCheckedAt(report.checkedAt)} · 凭据不会发送到浏览器`
                : "本机服务、数据库与 AI 提供方状态将在此显示。"}
            </span>
          </div>
          <button className="quiet-button dialog-summary__refresh" type="button" onClick={() => void runCheck()} disabled={loading}>
            <RefreshCw size={15} className={loading ? "refresh-icon--active" : ""} aria-hidden="true" />
            重新检查
          </button>
        </div>

        {loading ? (
          <WeaveLoader />
        ) : (
          <div className="diagnostic-sections">
            <section aria-labelledby="local-checks-title">
              <div className="diagnostic-section-heading">
                <span className="diagnostic-section-heading__icon"><Layers3 size={15} aria-hidden="true" /></span>
                <h3 id="local-checks-title">本机运行环境</h3>
                <span>{groupedItems.local.length} 项</span>
              </div>
              <div className="diagnostic-list">
                {groupedItems.local.map((item) => <DiagnosticRow item={item} key={item.id} />)}
              </div>
            </section>
            <section aria-labelledby="ai-checks-title">
              <div className="diagnostic-section-heading">
                <span className="diagnostic-section-heading__icon diagnostic-section-heading__icon--ai"><Sparkles size={15} aria-hidden="true" /></span>
                <h3 id="ai-checks-title">模型与授权服务</h3>
                <span>{groupedItems.ai.length} 项</span>
              </div>
              <div className="diagnostic-list">
                {groupedItems.ai.map((item) => <DiagnosticRow item={item} key={item.id} />)}
              </div>
              <p className="dialog-footnote">
                <KeyRound size={13} aria-hidden="true" />
                外部服务只在此处于本机发起连接；Embedding 检查会发送一条固定短文本。
              </p>
            </section>
          </div>
        )}
        {notice && <p className="dialog-notice" role="alert">{notice}</p>}
      </div>
    </dialog>
  );
}

export function App() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="Project Chronicle 总览">
          <span className="brand__symbol" aria-hidden="true">
            <svg viewBox="0 0 40 40" fill="none">
              <path d="M7 11.5h10.4c3 0 5.4 2.4 5.4 5.4v11.6H12.4A5.4 5.4 0 0 1 7 23.1V11.5Z" />
              <path d="M33 11.5H22.6c-3 0-5.4 2.4-5.4 5.4v11.6h10.4a5.4 5.4 0 0 0 5.4-5.4V11.5Z" />
              <path d="M12 17.5h5m6 0h5M12 22.5h5m6 0h5" />
            </svg>
          </span>
          <span className="brand__copy"><strong>CHRONICLE</strong><span>NARRATIVE ATELIER</span></span>
        </a>

        <div className="sidebar-label">工作空间</div>
        <nav className="sidebar-nav" aria-label="主导航">
          <a className="nav-item nav-item--active" href="#overview" aria-current="page">
            <Layers3 size={17} aria-hidden="true" /><span>创作总览</span><span className="nav-item__edge" />
          </a>
          <button className="nav-item" type="button" onClick={() => setDialogOpen(true)}>
            <Cpu size={17} aria-hidden="true" /><span>技术环境</span><ArrowRight size={14} className="nav-item__arrow" aria-hidden="true" />
          </button>
        </nav>

        <div className="sidebar-divider" />
        <div className="sidebar-note">
          <span className="sidebar-note__icon"><BookOpen size={16} aria-hidden="true" /></span>
          <span className="eyebrow">YOUR STORY, YOUR SPACE</span>
          <p>从一个世界观开始，把灵感编织成可游玩的故事。</p>
          <span className="sidebar-note__line" />
        </div>

        <div className="sidebar-bottom">
          <span className="local-indicator"><span />仅限本机</span>
          <button className="sidebar-settings" type="button" onClick={() => setDialogOpen(true)}>
            <Activity size={16} aria-hidden="true" />环境状态<ArrowRight size={14} aria-hidden="true" />
          </button>
          <span className="sidebar-version">PROJECT CHRONICLE <span>0.1.0</span></span>
        </div>
      </aside>

      <main className="main-area" id="top">
        <header className="topbar">
          <div className="breadcrumb"><span>工作空间</span><span className="breadcrumb__slash">/</span><strong>创作总览</strong></div>
          <div className="topbar__actions">
            <span className="privacy-tag"><ShieldCheck size={14} aria-hidden="true" />本地优先</span>
            <span className="topbar__divider" />
            <button className="avatar-button" type="button" onClick={() => setDialogOpen(true)} aria-label="查看本机环境">
              <Activity size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="page-content" id="overview">
          <section className="welcome-band">
            <div className="welcome-band__grid" aria-hidden="true" />
            <div className="welcome-band__glow" aria-hidden="true" />
            <div className="welcome-copy">
              <div className="welcome-overline"><span />LOCAL STORY STUDIO <span className="welcome-overline__rule" /></div>
              <h1>让故事，沿着自己的<br /><em>脉络生长。</em></h1>
              <p>结构化创作、智能生成与确定性叙事运行时，<br className="desktop-break" />为你的下一个故事准备好了空间。</p>
              <button className="primary-button" type="button" onClick={() => setDialogOpen(true)}>
                <Activity size={17} aria-hidden="true" />
                检查技术栈与环境
                <ArrowRight size={16} aria-hidden="true" />
              </button>
              <span className="welcome-hint">首次启动建议先检查本机依赖与 AI 服务连接</span>
            </div>
            <div className="welcome-art" aria-hidden="true">
              <div className="welcome-art__orbit welcome-art__orbit--outer" />
              <div className="welcome-art__orbit welcome-art__orbit--inner" />
              <div className="welcome-art__axis welcome-art__axis--one" />
              <div className="welcome-art__axis welcome-art__axis--two" />
              <svg viewBox="0 0 440 320" fill="none">
                <defs>
                  <linearGradient id="route-gradient" x1="48" y1="160" x2="394" y2="160" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#72DDC9" />
                    <stop offset=".54" stopColor="#A79BFF" />
                    <stop offset="1" stopColor="#E6B477" />
                  </linearGradient>
                  <filter id="route-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="5" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>
                <path className="welcome-art__route welcome-art__route--ghost" d="M43 163C102 163 97 83 157 83s50 80 109 80 53-65 112-65" />
                <path className="welcome-art__route welcome-art__route--main" d="M43 163C102 163 97 242 157 242s50-79 109-79 53 66 112 66" />
                <path className="welcome-art__route welcome-art__route--branch" d="M266 163c55 0 51-105 111-105" />
                {[
                  [43, 163, "teal"], [157, 83, "violet"], [157, 242, "violet"],
                  [266, 163, "teal"], [378, 58, "gold"], [378, 228, "gold"],
                ].map(([x, y, tone], index) => (
                  <g className={`welcome-art__node welcome-art__node--${tone} welcome-art__node--${index}`} key={`${x}-${y}`}>
                    <circle cx={Number(x)} cy={Number(y)} r="17" className="welcome-art__node-ring" />
                    <circle cx={Number(x)} cy={Number(y)} r="5" className="welcome-art__node-core" />
                  </g>
                ))}
              </svg>
              <span className="art-label art-label--top">CANON</span>
              <span className="art-label art-label--middle">CHOICE</span>
              <span className="art-label art-label--bottom">ENDING</span>
              <span className="welcome-art__coordinates">NARRATIVE SYSTEM / 001</span>
            </div>
            <div className="welcome-index" aria-hidden="true">01 <span>/</span> 07</div>
          </section>

          <section className="section-heading">
            <div>
              <span className="eyebrow">THE CREATION SPACE</span>
              <h2>故事工作台</h2>
            </div>
            <span className="section-heading__note"><span />准备开始</span>
          </section>

          <div className="workspace-grid">
            <NarrativePreview />
            <section className="panel readiness-panel" aria-labelledby="readiness-title">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">FOUNDATION</span>
                  <h2 id="readiness-title">创作基底</h2>
                </div>
                <span className="readiness-panel__seal"><ShieldCheck size={16} aria-hidden="true" /></span>
              </div>
              <div className="readiness-intro">
                <div className="readiness-ring"><span><Network size={18} aria-hidden="true" /></span></div>
                <div><strong>本机叙事引擎</strong><span>单用户 · 本地数据 · 可选 AI 服务</span></div>
              </div>
              <div className="capability-list">
                <div><span className="capability-icon capability-icon--teal"><Database size={15} aria-hidden="true" /></span><span><strong>SQLite 内容库</strong><small>项目数据与向量源数据</small></span><ArrowDownRight size={14} aria-hidden="true" /></div>
                <div><span className="capability-icon capability-icon--violet"><GitBranch size={15} aria-hidden="true" /></span><span><strong>USearch HNSW</strong><small>本地近似最近邻检索</small></span><ArrowDownRight size={14} aria-hidden="true" /></div>
                <div><span className="capability-icon capability-icon--gold"><Sparkles size={15} aria-hidden="true" /></span><span><strong>模型接入层</strong><small>兼容中转与独立 Embedding</small></span><ArrowDownRight size={14} aria-hidden="true" /></div>
              </div>
              <button className="text-button" type="button" onClick={() => setDialogOpen(true)}>
                查看连接状态<ArrowRight size={15} aria-hidden="true" />
              </button>
            </section>
          </div>

          <section className="launch-strip">
            <span className="launch-strip__icon"><BookOpen size={18} aria-hidden="true" /></span>
            <div><strong>一个故事，从一个清晰的世界开始。</strong><span>环境检查完成后，即可初始化你的第一个创作项目。</span></div>
            <span className="launch-strip__meta"><span />PRIVATE WORKSPACE</span>
          </section>

          <footer className="page-footer"><span>PROJECT CHRONICLE</span><span>项目数据本地保存 · AI 请求发送至你配置的服务</span><span>V 0.1.0</span></footer>
        </div>
      </main>
      <DiagnosticsDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
