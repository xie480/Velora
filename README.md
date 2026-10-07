# Project Chronicle

本地单人叙事创作工作台。当前包括七阶段前置创作 Workflow、版本化 Game Blueprint、React/Vite 创作首页、React Flow 示例图、Hono 本机 API、SQLite/Drizzle 本地保存、USearch HNSW 探测，以及模型服务配置和连接检查。

## 环境要求

- Node.js 22.12 或更新版本
- npm 10 或更新版本

## 启动

```powershell
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

打开 `http://127.0.0.1:5173`，点击“检查技术栈与环境”。API 仅绑定 `127.0.0.1:4310`，生产构建通过同一个本机服务托管前端和 API：

```powershell
npm run build
npm start
```

SQLite 文件默认创建在 `.data/project-chronicle.sqlite`。向量正文与 Float32 向量由 SQLite 保存；USearch 当前仅执行真实内存索引探测，产品检索索引的写入、持久化和重建会在后续向量功能中实现。

## Embedding 与 AI 服务

`EMBEDDING_LOCAL_ENABLED=true` 时，本机 API 会在启动时加载 `EMBEDDING_LOCAL_MODEL_PATH` 指向的 BGE 模型，并在当前 Node 进程中复用单个 ONNX q8 CPU 推理实例。诊断弹窗会实际执行一次本地向量化；此模式不会请求远程 Embedding 服务。默认模型路径为 `D:/AI_Models/bge-base-zh-v1.5-model`。模型权重不复制进仓库，`.env` 也已加入忽略规则。

将 `EMBEDDING_LOCAL_ENABLED` 设为 `false` 后，可配置 OpenAI 兼容 Embedding 服务。OpenAI 兼容聊天服务仍使用 `/models` 做连通检查；远程 Embedding 检查会发送固定短文本，可能计入所选服务商的少量请求用量。服务端仅返回状态和维度信息，不会把密钥发送给浏览器。

模型与 API 页面支持多个兼容中转预设和独立的 ChatGPT SIWC 授权；保存并激活预设后，Workflow 使用其中的中档模型。兼容中转调用 Chat Completions，ChatGPT 计划授权调用 Responses（`store:false`、流式响应，等待完成事件）。密钥与令牌只在服务端本地加密保存。真实账号资格、额度、令牌刷新和模型创作质量仍需使用所选服务实际验证，模型目录连通不代表生成可用。

## 前置创作 Workflow

点击侧栏“前置创作”，或打开 `http://127.0.0.1:5173/?view=workflow`。按基础设定 → 人物 → 结局 → 卷与章节 → 人物变化 / 分支 → SLG 系统与初始世界 → 最终检查进行创作。

- 基础设定分为“基础创作表单”和“Story Bible”：可从空表单在右侧输入创作要求，多选需要 AI 填写或修改的字段；只覆盖选中字段，结果仍需人工审核。后续详情及已有清单同样支持按字段填写，清单条目数量保持不变。Story Bible 整体审批；卷章数量由用户指定，固定大纲直接展开。
- 每个字段提供填写说明和示例；名称、类型、时间使用短输入，背景与概要使用不同高度的段落。列表逐条增删，属性、人物关系、分支选项和初始映射使用结构化编辑，批量 JSON 放在高级入口。
- 人物、结局、每章关键分支和系统先生成或编辑 Outline Plan，确认清单后才建立详情草稿；每次只生成一个审批对象，审批通过再继续。
- 已审批内容可修改。下游内容保留，并显示 NEEDS_REVIEW；可保持内容重新审批、手动编辑、按意见修订或重新生成。AI 新增项目必须先作为 Addition Suggestion 审批，再确认清单。
- 自动保存与手动保存都写入本机 SQLite；阶段、选中对象、清单、审批、复审及历史版本可恢复。浏览器只备份未提交草稿，冲突时停止自动覆盖。
- 正式引用只允许指向前置阶段和明确的同阶段上游；前置 AI 上下文不读取后置实体与卷章结构。基础表单里的预设人物、事件、分支、结局仍可作为文字创作意向。
- JSON 导入先校验与预览，明确确认后替换 Working Blueprint；未知字段和不支持的 Schema Version 会被拒绝。当前 Schema v2 兼容读取 v1：旧出场卷号保留为文字意向，反向关联解除并提示复审；历史快照原始 JSON 不修改。导出包括所有创作实体与 Workflow 状态。
- Create Version 保存不可变快照；Finalize 还要求全部阶段确认、最新检查通过且没有 ERROR。历史只能查看、比较或复制为新的 Working Blueprint。

当前提供一个本地 Working Blueprint。生成时先取消才能修改内容；服务重启保留原内容并恢复中断状态，不自动重发 AI 请求。单项生成超时 120 秒，Blueprint 保存 / 导入上限 5 MiB，总章节上限 500。缩减已有创作的卷章会被保护性拒绝；直接重新规划已有详情的清单也会被拒绝，可用手动清单编辑或新增建议继续调整。

本阶段仅产出游戏开始前的静态 Blueprint；尚未实现正式 Runtime、Character Agent、时间 Tick、动态 Scene、玩家存档或实际游戏流程。实现、验证与取舍见 [前置创作技术文档](doc/技术方案/前置创作/2026-10-08-前置创作Workflow实现.md)。

## 开发验证

```powershell
npm run typecheck
npm test
npm run build
```

测试使用 Node 内置测试运行器、隔离 SQLite 与本机模型响应夹具，不修改真实 Provider 配置；模拟通过不代表真实服务商、账号或叙事质量已验证。数据库结构沿用 `src/server/db/migrations.ts` 的启动迁移，新增表会在服务启动时创建，无需为 Workflow 单独运行 Drizzle Kit 迁移。

## 项目结构

```text
src/
  client/       React 页面与设计系统
  server/       Hono API、SQLite/Drizzle 与服务检查
  shared/       前后端共享类型
drizzle/        Drizzle Kit 生成的迁移目录
doc/            产品、架构与 UI 设计文档
```
