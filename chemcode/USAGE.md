# Chemcode 使用指南

## 启动

```powershell
Copy-Item .env.example .env
npm install
npm run server
```

另开终端：

```powershell
npm run dev
```

打开 `http://localhost:5174`，使用 `demo / demo` 登录。

## 配置模型

进入“设置 → 模型管理”，填写模型名、OpenAI-compatible API 地址和 API Key，测试连接后设为默认模型。Key 存储在本地数据目录中，不应提交到 Git。

## 对话与取消

在新会话中描述任务。文本、思考状态和工具调用会实时显示，并通过消息 ID 关联到正确的会话消息。点击“取消任务”会中止当前会话对应的 LLM 请求、工具执行或 Mock 生成；WebSocket 重连后仍会重新关联尚未结束的运行。

子 Agent 通过独立会话执行，输入、工具消息、回复和最终状态都会保存，并可从会话历史恢复。

## 人工确认

普通危险工具会显示确认对话框。PyGAMD Skill 还包含 H1–H7 科学工作流确认节点；这些节点必须按顺序接受，不能通过 Full Access 跳过。拒绝或超时后 Agent 会收到明确结果，不会继续执行下一阶段。

## 文件与数据

- 上传文件保存在 `data/uploads/`。
- 用户和会话数据默认保存在 `data/`，可通过 `CHEMCODE_DATA_DIR` 修改。
- Agent 的工作记录保存在当前工作目录的 `.chemcode-memory/`。
- 支持普通文本、PDF、DOCX、PPTX 和 XLSX 提取。

## Mock 模式

在 `.env` 中设置：

```dotenv
VITE_USE_MOCK=true
```

Mock 生成同样支持取消，用于不配置 LLM 时测试界面和事件流。

## 测试与构建

```powershell
npm test
npm run build
```

## 常见问题

- 对话无响应：检查 Gateway 是否运行、模型是否设为默认、API 地址是否包含正确的兼容端点。
- PyGAMD H1 不能通过：运行 `check_environment.py --install-missing --json`，根据报告补齐 GPU、Python 或 OVITO 依赖。
- 长会话压缩失败：系统会保留可用上下文并退避，不会在同一轮反复压缩；可稍后重试或新建会话。
- v1 本地状态不可见：v2 使用新的 Chemcode 浏览器存储命名空间，需要重新登录和配置。
