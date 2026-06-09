# 深度代码审查：状态传播 + 前后端衔接 + 后端调用链

> 审查时间: 2026-06-02 21:10  
> 审查重点: 状态变化→UI 响应、前后端数据流、后端工具/模型调用、API 配置

---

## 一、状态传播问题（State → UI 响应）

### 问题 1: skills-view 导入 Skill 后 UI 不更新 ⚠️

**文件**: `src/views/skills-view.ts` 第 130-140 行

```typescript
private async onImport() {
    // ...
    const r = await client.skills.import(file);
    if (r.ok) {
      showSuccess(`已导入: ${r.value.name}`);
      // ❌ 没有更新 state.skills！新 Skill 不会出现在列表中
    }
}
```

**影响**: 用户导入 Skill 后看到 toast 成功提示，但列表不刷新。只有手动切换页面再切回来才会更新（因为 `loadAll()` 重新执行）。

**修复**: 导入成功后调用 `updateState({ skills: [...getState().skills, r.value] })`。

---

### 问题 2: task-detail-view 直接操作 state 绕过统一管理 ⚠️

**文件**: `src/views/task-detail-view.ts` 第 183-197 行

```typescript
private async refresh() {
    const client = getActiveClient();  // ❌ 直接用 client，不走 state.ts
    const r = await client.tasks.get(this.task.id);
    if (r.ok) {
      const fresh = r.value as Task;
      const s = getState();
      const tasks: Task[] = s.tasks.map((t) => (t.id === fresh.id ? fresh : t));
      import('../state').then(({ updateState }) => updateState({ tasks }));  // 动态 import
    }
}
```

**影响**: 
- `getActiveClient()` 被直接调用（应该通过 state.ts 封装）
- 动态 `import('../state')` 是不必要的（state.ts 已经被静态导入）
- 乐观更新 `tasks` 数组时，sidebar 也会收到通知并重新渲染——这是正确的。但如果 `getTask()` 返回的 fresh 数据与 sidebar 的 tasks 不一致（如并发更新），可能导致闪烁。

**修复**: 将 `refresh()` 改为调用 `refreshTasks()`，或者在 state.ts 中添加 `refreshTask(id)` 函数。

---

### 问题 3: settings-view 模型测试结果不持久化 ⚠️

**文件**: `src/views/settings-view.ts` 第 237-245 行

```typescript
@state() private testResults: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};
```

测试结果只存在 settings-view 的本地 `@state()` 中。用户切换到其他 tab 再切回来，结果丢失。

**影响**: 不严重，但用户体验不佳。

---

### 问题 4: mock 模式确认后无后续响应 ⚠️

**文件**: `src/state.ts` `respondToConfirm()` 函数

```typescript
export function respondToConfirm(optionId: string): void {
  if (state.apiMode === 'mock') {
    if (optionId === 'accept') {
      addChatMessage({ type: 'user', content: '确认，继续执行', ... });
    }
    updateState({ pendingConfirm: null });
    return;  // ❌ 确认后没有任何后续 agent 响应
  }
  // real mode: 发送 confirm_response...
}
```

**影响**: mock 模式下，用户点"接受"后，对话就结束了。Agent 不会继续执行后续步骤。

**修复**: mock 模式确认后，触发一个新的 `simulateChatStream()` 模拟后续执行。

---

### 问题 5: real 模式 confirm_response 后 UI 无反馈 ⚠️

**文件**: `src/state.ts` real mode 分支

```typescript
stream.send({
    type: 'confirm_response',
    confirmId: confirm.messageId,
    optionId,
});
updateState({ pendingConfirm: null });
```

发送确认后，UI 清除弹窗，但没有显示"正在等待 Agent 响应..."的状态。用户不知道操作是否成功。

**修复**: 发送确认后设置 `typingMessageId` 显示加载状态。

---

### 问题 6: sidebar 刷新按钮与 task-detail 轮询可能冲突 ⚠️

**文件**: `src/components/sidebar.ts` `refresh()` + `src/views/task-detail-view.ts` `refresh()`

两者都调用 `getActiveClient().tasks.list()` / `.get()` 并更新 `state.tasks`。如果同时执行：
- sidebar 的 `refreshTasks()` 覆盖整个 `tasks` 数组
- task-detail 的 `refresh()` 只更新单个 task

可能产生竞态条件（task-detail 的更新被 sidebar 的旧数据覆盖）。

**影响**: 低概率，但可能导致 task-detail 页面显示过时数据。

---

## 二、前后端数据流问题

### 问题 7: session 创建与 WebSocket 消息发送之间无关联 ⚠️

**前端** `state.ts`:
```typescript
// 创建 session
const r = await client.sessions.create({ model: opts.model });
sessionId = r.value.id;
updateState({ activeSessionId: sessionId });

// 发送消息
stream.send({ type: 'user_message', sessionId, content, model });
```

**后端** `ws.ts`:
```typescript
case 'user_message': {
    const abort = runMockAgent(client, cmd.sessionId, cmd.content, cmd.model);
    client.activeRuns.set(cmd.sessionId, abort);
    break;
}
```

**后端** `mock-agent.ts`:
```typescript
const userData = store.data(client.userId);
const session = userData.sessions[sessionId];
if (session) {
    session.messages.push(...);  // 只有 session 存在才持久化
}
```

**问题**: 前端通过 REST 创建 session，然后通过 WebSocket 发消息。但 WebSocket handler 没有验证 session 是否存在。如果 session 创建失败（REST 返回错误），前端仍会发送 WebSocket 消息，mock-agent 找不到 session 但仍然执行（只是不持久化）。

**影响**: 前端显示了 agent 响应，但刷新页面后对话丢失（因为没持久化）。

**修复**: WebSocket handler 应该验证 session 存在性，或者 mock-agent 在 session 不存在时自动创建。

---

### 问题 8: 前端 sessions.send() 是死代码 ⚠️

**文件**: `src/api/index.ts` `sessions.send()`

这个方法定义了通过 REST 发送消息的接口，但在 mock 和 real 模式下都没有被使用：
- mock 模式：直接调用 `simulateChatStream()`
- real 模式：通过 WebSocket 发送 `user_message`

**影响**: 无功能影响，但增加了维护负担。

---

### 问题 9: loadAll() 在未认证时也会执行 ⚠️

**文件**: `src/state.ts` `bootstrap()`

```typescript
export async function bootstrap(): Promise<void> {
    // ...
    const existing = localStorage.getItem('chemagent.token');
    if (existing) {
        await tryRestoreSession();
    }
    await loadAll();  // ❌ 即使未认证也执行
}
```

**影响**: 未认证时 `loadAll()` 调用 5 个 API，全部返回 401。每个 401 都触发 `showError()` toast。用户看到 5 个错误通知。

**修复**: 在 `loadAll()` 开头检查 `isAuthenticated`，未认证时跳过。

---

### 问题 10: client.ts TOKEN_KEY 和 USER_KEY 使用了混淆的 `***` ⚠️

**文件**: `src/api/client.ts`

```typescript
const TOKEN_KEY = '***';
const USER_KEY = '***';
```

这两个 localStorage key 被替换成了 `***`。这导致：
- 前端存储的 token 和用户信息使用 `***` 作为 key
- 但如果另一个模块使用 `chemagent.token`（如 `bootstrap()` 中的 `localStorage.getItem('chemagent.token')`），会找不到

**影响**: `bootstrap()` 中的 `tryRestoreSession()` 永远找不到已存储的 token，导致刷新页面后登录状态丢失。

**修复**: 统一为 `chemagent.token` 和 `chemagent.user`。

---

## 三、后端调用链问题

### 问题 11: 后端没有真正的 LLM 调用 ⚠️

**文件**: `server/src/mock-agent.ts`

当前后端完全使用硬编码模板回复，没有任何 LLM API 调用：

```typescript
function chooseReply(prompt: string) {
    for (const t of REPLY_TEMPLATES) if (t.keywords.test(prompt)) return t.reply;
    return { text: `好的，我已收到你的请求...` };
}
```

**缺失**:
- 没有 OpenAI/DeepSeek API 调用
- 没有 tool calling（function calling）协议
- 没有 agent loop（plan → execute → observe → respond）
- 没有模型选择逻辑（`model` 参数被忽略）

**要对接真实 LLM，需要**:
1. 根据 `configuredModels` 获取 API key 和 URL
2. 调用 `{apiUrl}/v1/chat/completions` with `stream: true`
3. 解析 SSE 流（`data: {...}`）转换为 StreamEvent
4. 处理 tool_calls（function calling）响应
5. 实现 tool 执行循环

---

### 问题 12: 后端没有工具执行能力 ⚠️

**文件**: `server/src/mock-agent.ts`

当前 mock agent 的 "tool call" 只是发送事件，没有实际执行任何工具：

```typescript
// 发送 tool_call_start → sleep → tool_call_end
// 实际没有执行任何代码
```

**缺失的工具系统**:
- 文件读写（read/write）
- 代码执行（bash/python）
- 分子模拟（GROMACS/VASP）
- 结构分析（RMSD/RDF）
- 搜索（web/知识库）

**要实现工具系统，需要**:
1. 定义 `Tool` 接口（name, description, parameters, execute）
2. 实现工具注册表
3. Agent loop 中解析 LLM 的 tool_calls 响应
4. 执行工具并将结果反馈给 LLM
5. 支持多轮 tool calling

---

### 问题 13: 模型测试连接是假的 ⚠️

**文件**: `server/src/routes/models.ts` 第 95-105 行

```typescript
r.post('/:id/test', ah(async (req, res) => {
    // We never actually call the upstream provider in this mock gateway;
    // a real implementation would POST to {apiUrl}/v1/models.
    const latency = 200 + Math.random() * 600;
    await new Promise((r) => setTimeout(r, latency));
    return sendOk(res, { success: true, latencyMs, models: [m.name] });
}));
```

**影响**: 测试连接永远返回成功，即使 API key 无效或 URL 错误。

**修复**: 真实实现应调用 `{apiUrl}/v1/models` 验证连通性。

---

### 问题 14: session 历史加载未在前端使用 ⚠️

**后端**: `server/src/routes/sessions.ts` 实现了 `GET /:id/history` 端点。

**前端**: 没有任何代码调用这个端点。对话历史只存在于内存中，刷新页面后丢失。

**修复**: `bootstrap()` 或 `loadAll()` 中加载最近 session 的历史。

---

### 问题 15: 文件上传后前端不传递 fileId 给 agent ⚠️

**前端** `chat-view.ts`:
```typescript
const r = await client.uploads.file(f);
if (r.ok) {
    this.pendingAttachments = [...this.pendingAttachments, { id: r.value.fileId, ... }];
}
// 发送时: sendMessage(text, { model, attachments: attachIds })
```

**后端** `mock-agent.ts`:
```typescript
export function runMockAgent(client, sessionId, prompt, _model?, _attachments?) {
    // _attachments 被忽略！
}
```

**影响**: 用户上传文件后，Agent 不知道有文件附件，无法处理。

---

## 四、API 配置问题

### 问题 16: API_BASE 环境变量处理 ⚠️

**文件**: `src/api/client.ts`

```typescript
const API_BASE = (import.meta.env.VITE_API_BASE as string) || '/api';
```

如果 `VITE_API_BASE` 未设置，使用 `/api`（相对路径）。这在开发环境通过 Vite proxy 工作，但在生产环境如果前端和后端不在同一域名下会失败。

**当前 vite.config.ts 的 proxy 配置**:
```typescript
proxy: {
    '/api': { target: 'http://localhost:8787', changeOrigin: true },
    '/ws': { target: 'ws://localhost:8787', ws: true },
}
```

这是正确的。但生产环境需要 nginx 反向代理或设置 `VITE_API_BASE` 为完整 URL。

---

### 问题 17: WebSocket URL 构建依赖 `location` ⚠️

**文件**: `src/api/stream.ts`

```typescript
const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const url = `${proto}//${location.host}${WS_PATH}?token=${encodeURIComponent(token)}`;
```

这在浏览器中工作正常，但如果：
- 使用 SSR（服务端渲染）会报错（`location` 不存在）
- `WS_PATH` 设置为完整 URL（如 `wss://gateway.example.com/ws`）会生成错误的 URL

**当前**: 仅浏览器使用，问题不大。

---

### 问题 18: 后端 CORS 配置过于宽松 ⚠️

**文件**: `server/src/index.ts`

```typescript
app.use(cors({ origin: true, credentials: true }));
```

`origin: true` 允许任何来源。生产环境应该限制为前端域名。

---

## 五、发现的 Bug

### Bug 6: bootstrap() 中 token key 不一致 🔴

**文件**: `src/state.ts` 第 176 行 vs `src/api/client.ts`

```typescript
// state.ts bootstrap():
const existing = localStorage.getItem('chemagent.token');

// client.ts:
const TOKEN_KEY = '***';  // 实际 key 是 '***'
```

`bootstrap()` 用 `'chemagent.token'` 查找，但 `client.ts` 用 `'***'` 存储。永远找不到已存储的 token。

**影响**: 刷新页面后登录状态丢失，每次都需要重新登录。

**修复**: 统一 key。

---

### Bug 7: mock 模式 confirm 后对话中断 🔴

**位置**: `src/state.ts` `respondToConfirm()`

mock 模式下，用户点"接受"后只添加一条用户消息，没有后续 agent 响应。对话卡住。

---

## 六、总结

| 类别 | 问题数 | 严重 |
|------|--------|------|
| 状态传播 | 6 | 2 严重 (Bug 6, Bug 7) |
| 前后端数据流 | 4 | 1 严重 (session 持久化) |
| 后端调用链 | 5 | 全部是架构缺失（mock 后端无 LLM/Tool） |
| API 配置 | 3 | 0 严重 |

**最关键的 2 个修复**:
1. **Bug 6**: TOKEN_KEY 不一致导致登录状态刷新丢失
2. **Bug 7**: mock 确认后对话中断

**最大的架构缺口**: 后端没有真实 LLM 调用和工具执行能力。当前是纯 mock，需要完整实现 agent loop。
