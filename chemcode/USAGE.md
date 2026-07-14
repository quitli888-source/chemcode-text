# ChemAgent 使用指南

## 什么是 ChemAgent

ChemAgent 是一个面向计算化学的 AI 智能体平台。前端是基于 Lit Web Components 的单页应用，后端是一个轻量 Node.js Gateway，通过 WebSocket 实现实时对话和工具调用。

**核心能力：**
- 多轮对话 + 工具调用（文件读写、Shell 执行、子 Agent 派生）
- 流式响应（逐字输出、工具进度实时展示）
- 危险工具确认机制（Shell 执行等需要用户批准）
- 上下文自动压缩（超长对话自动摘要）
- 工具权限控制（allowlist / denylist）
- 子 Agent 隔离运行，可选事件透传
- 对话历史完整持久化（含工具调用记录）
- 组件自动清理，无内存泄漏

---

## 环境要求

- **操作系统**：Windows 10/11（已适配 Windows，Shell 默认使用 `cmd`）
- **Node.js**：v18+（推荐 v20+）
- **包管理**：npm 或 pnpm

---

## 快速启动

### 1. 安装依赖

```powershell
cd "M:\agents-for madao\ChemAgent"
npm install
```

### 2. 启动后端 Gateway

```powershell
npm run server
```

启动后会看到：
```
[chemagent-gateway] listening on http://0.0.0.0:8787
[chemagent-gateway] WebSocket: ws://0.0.0.0:8787/ws
```

### 3. 启动前端（另一个终端）

```powershell
cd "M:\agents-for madao\ChemAgent"
npm run dev
```

前端默认运行在 `http://localhost:5174`。

### 4. 登录

默认测试账号：
- 用户名：`Justinian`
- 密码：`demo`

或：
- 用户名：`demo`
- 密码：`demo`

---

## 配置 LLM 模型

**重要：模型和 API Key 完全由你在前端配置，代码中不硬编码任何默认值。**

### 通过前端配置（推荐）

1. 登录后，点击左侧导航栏的 **设置**（齿轮图标）
2. 选择 **模型管理** 标签
3. 点击 **添加模型**
4. 填写：
   - **模型名称**：如 `deepseek-chat`、`gpt-4o`、`claude-3-5-sonnet` 等
   - **API 地址**：如 `https://api.deepseek.com`、`https://api.openai.com`
   - **API Key**：你的 API Key
   - **提供商**：选择对应的 provider
   - **设为默认**：勾选后该模型为默认对话模型
5. 点击 **测试连接** 验证配置是否正确
6. 保存

### 支持的 Provider

任何兼容 OpenAI `/v1/chat/completions` 接口的服务均可使用：

| Provider | API 地址示例 |
|----------|-------------|
| DeepSeek | `https://api.deepseek.com` |
| OpenAI | `https://api.openai.com` |
| Anthropic（通过兼容代理） | 取决于代理地址 |
| 本地模型（Ollama 等） | `http://localhost:11434` |

---

## 使用对话

### 基本对话

1. 点击左侧 **对话** 图标
2. 点击 **新建对话** 或选择已有对话
3. 在底部输入框输入问题，按 Enter 发送
4. Agent 会实时流式回复，包括：
   - 文本逐字显示
   - 工具调用进度（如"正在读取文件..."）
   - 危险操作确认弹窗

### 工具调用

Agent 可以使用以下内置工具：

| 工具 | 说明 | 危险？ |
|------|------|--------|
| `file_read` | 读取文件内容 | 否 |
| `file_write` | 写入文件 | 是（需确认） |
| `bash_exec` | 执行 Shell 命令 | 是（需确认） |
| `update_plan` | 更新工作计划 | 否 |
| `sessions_spawn` | 派生子 Agent | 否 |

当 Agent 调用危险工具时，会弹出确认框，你可以：
- **允许执行**：工具正常执行
- **拒绝**：Agent 会收到拒绝通知并调整方案

### 子 Agent（sessions_spawn）

Agent 可以将复杂子任务派给子 Agent 独立执行：
- 子 Agent 在隔离会话中运行
- 默认不向父会话转发事件（隔离设计）
- 超时后通过 AbortController 真正取消，无资源泄漏
- 子 Agent 完成后结果返回给父 Agent

---

## 工具权限控制

你可以通过配置限制 Agent 可用的工具：

### 配置方式

在 `server/src/ws.ts` 的 `handleCommand` 中，构造 `AgentRunConfig` 时传入 `toolPermissions`：

```typescript
const finalContent = await runAgentLoop({
  llm: llmConfig,
  userMessage: cmd.content,
  sessionId: cmd.sessionId,
  messageId,
  workdir,
  userId: client.userId,
  confirmManager,
  signal: abortCtrl.signal,
  // 工具权限配置
  toolPermissions: {
    deny: ['bash_exec'],           // 禁止执行 Shell 命令
    // 或者用 allow 白名单模式：
    // allow: ['file_read', 'update_plan'],
  },
}, (ev) => sendToClient(client, ev));
```

### 规则

- `deny`（黑名单）优先级高于 `allow`（白名单）
- 只设 `deny`：除了被禁止的工具，其他都可用
- 只设 `allow`：只有列表中的工具可用
- 都不设：所有工具可用（默认）
- 被拒绝的工具调用返回 `{ success: false, details: { denied: true } }`

---

## 上下文压缩（Compaction）

当对话消息数超过 40 条时，系统自动触发上下文压缩：
- 保留系统提示 + 最近 10 条消息
- 将旧消息用 LLM 摘要替代
- 压缩过程对用户透明（thinking 事件显示进度）
- 压缩失败不影响对话继续

---

## 文件上传

- 点击输入框旁的 📎 按钮
- 支持拖拽文件到输入区域
- 文件通过 REST API 上传到 `data/uploads/` 目录
- Agent 可通过 `file_read` 工具读取上传的文件

---

## API 端点一览

### REST API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | POST | 登录，返回 Token |
| `/api/auth/logout` | POST | 登出 |
| `/api/auth/me` | GET | 当前用户信息 |
| `/api/sessions` | GET/POST | 会话列表/创建 |
| `/api/sessions/:id` | GET/DELETE | 会话详情/删除 |
| `/api/sessions/:id/history` | GET | 会话消息历史 |
| `/api/models` | GET/POST | 模型列表/添加 |
| `/api/models/:id` | PATCH/DELETE | 修改/删除模型 |
| `/api/models/:id/test` | POST | 测试模型连接 |
| `/api/tasks` | GET | 任务列表 |
| `/api/skills` | GET | Skills 列表 |
| `/api/knowledge` | GET | 知识库列表 |
| `/api/uploads` | POST | 文件上传 |
| `/api/system/health` | GET | 健康检查（无需认证） |

### WebSocket

连接地址：`ws://localhost:8787/ws?token=<your-token>`

**客户端 → 服务端命令：**

```json
{ "type": "user_message", "sessionId": "S-xxx", "content": "你好" }
{ "type": "cancel", "sessionId": "S-xxx" }
{ "type": "confirm_response", "confirmId": "msg-xxx", "optionId": "accept" }
```

**服务端 → 客户端事件：**

```json
{ "type": "text_delta", "messageId": "...", "delta": "你", "index": 0 }
{ "type": "tool_call_start", "toolCallId": "...", "toolName": "file_read", "args": {...} }
{ "type": "tool_call_update", "toolCallId": "...", "status": "running" }
{ "type": "tool_call_end", "toolCallId": "...", "result": "..." }
{ "type": "thinking", "messageId": "...", "content": "正在分析..." }
{ "type": "confirm_request", "messageId": "...", "prompt": "...", "options": [...] }
{ "type": "done", "messageId": "...", "finishReason": "stop" }
{ "type": "error", "code": "LLM_ERROR", "message": "...", "retryable": false }
```

---

## 数据存储

所有数据存储在项目目录下的 `data/` 文件夹中：

```
data/
├── users/
│   ├── usr_chemcode_001.json   # 用户数据（对话、模型配置等）
│   └── usr_demo.json
└── uploads/                    # 上传的文件
```

可通过环境变量 `CHEMAGENT_DATA_DIR` 自定义数据目录。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8787` | 后端端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `CHEMAGENT_DATA_DIR` | `./data` | 数据目录 |
| `AUTH_TOKEN_SECRET` | `chemagent-dev-secret` | Token 签名密钥 |
| `AUTH_TOKEN_TTL` | `86400` | Token 有效期（秒） |

---

## Windows 注意事项

1. **Shell 命令**：默认使用 `cmd /c` 执行。如需使用 PowerShell，可在调用时指定 `"shell": "powershell"`
2. **路径分隔符**：代码使用 `path.resolve` / `path.join`，自动处理 Windows 路径
3. **进程终止**：超时和取消使用 `child.kill()`，Windows 下正常工作
4. **文件监听**：`vite` 开发服务器的 HMR 在 Windows 下正常工作

---

## 常见问题

### Q: 启动后对话无响应？
A: 检查是否在设置中配置了 LLM 模型。未配置时会显示 Mock 提示信息。

### Q: 模型测试连接失败？
A: 检查 API 地址和 Key 是否正确。确保网络能访问对应的 API 服务。

### Q: 工具调用被拒绝？
A: 检查是否有 `toolPermissions` 配置限制了该工具。或者该工具标记为 `dangerous` 需要用户确认。

### Q: 长对话变慢？
A: 系统会在消息超过 40 条时自动压缩上下文。压缩过程可能需要几秒钟。

---

## 项目结构

```
ChemAgent/
├── server/src/                 # 后端源码
│   ├── index.ts               # Gateway 入口
│   ├── ws.ts                  # WebSocket 网关
│   ├── auth.ts                # Token 认证
│   ├── store.ts               # 数据存储
│   ├── storage.ts             # 文件系统工具
│   ├── middleware.ts           # Express 中间件
│   ├── mock-agent.ts          # Mock Agent（未配置模型时的回退）
│   ├── agent/
│   │   ├── loop.ts            # Agent 核心循环
│   │   ├── confirm.ts         # 危险工具确认管理
│   │   ├── types.ts           # Agent 类型定义
│   │   └── index.ts           # Agent 模块导出
│   ├── llm/
│   │   ├── client.ts          # LLM API 客户端（OpenAI 兼容）
│   │   └── types.ts           # LLM 类型定义
│   ├── tools/
│   │   ├── registry.ts        # 工具注册中心（含权限控制）
│   │   ├── types.ts           # 工具类型定义
│   │   ├── file-read.ts       # file_read 工具
│   │   ├── file-write.ts      # file_write 工具
│   │   ├── bash-exec.ts       # bash_exec 工具
│   │   ├── update-plan.ts     # update_plan 工具
│   │   ├── sessions-spawn.ts  # sessions_spawn 工具
│   │   └── index.ts           # 工具注册入口
│   └── routes/                # REST API 路由
│       ├── auth.ts
│       ├── sessions.ts
│       ├── tasks.ts
│       ├── skills.ts
│       ├── knowledge.ts
│       ├── models.ts
│       ├── uploads.ts
│       └── system.ts
├── src/                        # 前端源码
│   ├── main.ts               # 前端入口
│   ├── app.ts                # App 组件
│   ├── state.ts              # 全局状态管理
│   ├── api/                   # API 层
│   │   ├── client.ts         # HTTP 客户端
│   │   ├── stream.ts         # WebSocket 流式通信
│   │   ├── types.ts          # 前端类型定义
│   │   ├── mock.ts           # Mock API
│   │   └── index.ts          # API 导出
│   ├── views/                 # 页面组件
│   │   ├── chat-view.ts      # 对话页面
│   │   ├── settings-view.ts  # 设置页面
│   │   ├── knowledge-view.ts # 知识库页面
│   │   ├── skills-view.ts    # Skills 页面
│   │   ├── task-detail-view.ts
│   │   ├── login-view.ts     # 登录页面
│   │   └── index.ts
│   ├── components/            # 通用组件
│   │   ├── navbar.ts
│   │   ├── sidebar.ts
│   │   ├── toast.ts
│   │   ├── code-block.ts
│   │   ├── markdown-renderer.ts
│   │   ├── tool-call-card.ts
│   │   ├── thinking-block.ts
│   │   ├── confirm-dialog.ts
│   │   ├── connection-status.ts
│   │   ├── status-card.ts
│   │   └── index.ts
│   └── types.ts              # 全局类型
├── data/                       # 运行时数据
├── package.json
├── tsconfig.json
├── vite.config.ts
└── USAGE.md                   # 本文件
```
