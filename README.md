# Project Chronicle

本地单人叙事创作工作台的初始脚手架。当前包括 React/Vite 创作首页、React Flow 示例图、Hono 本机 API、SQLite/Drizzle 基础表、USearch HNSW 探测，以及模型服务连接检查弹窗。

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

ChatGPT Plus plan usage 的 SIWC 登录流程暂未实现。当前官方客户端资格、客户端注册和许可适用性仍需产品侧确认；检查面板会将其标为待接入，而非连接失败或登录成功。

## 项目结构

```text
src/
  client/       React 页面与设计系统
  server/       Hono API、SQLite/Drizzle 与服务检查
  shared/       前后端共享类型
drizzle/        Drizzle Kit 生成的迁移目录
doc/            产品、架构与 UI 设计文档
```
