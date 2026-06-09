# ChemAgent 代码审查报告（修复后）

> 审查时间: 2026-06-02  
> 修复时间: 2026-06-02  
> 审查范围: `M:\agents-for madao\ChemAgent\` 全部 54 个文件  

---

## 🔴 关键问题 — 全部已修复 ✅

### BUG-1: Real 模式流式事件不处理 ✅ 已修复

**根因**: `state.ts` 的 `sendMessage()` real 分支只调用 `stream.send()`，没有处理返回的事件流。

**修复**: 提取共享 `handleStreamEvent()` 函数，real 分支订阅 stream 事件并调用同一处理逻辑。`state.ts` 现在是唯一的 stream 事件处理器。

**改动**: `src/state.ts` — 新增 `handleStreamEvent()` 函数 + real 分支订阅逻辑

---

### BUG-2: WebSocket 事件 topic 不匹配 ✅ 已修复

**根因**: 服务器发送 thinking/text_delta/tool_call_*/done 时不带 `topic` 字段（默认 `'*'`），前端订阅 `topic: 'chat'`，stream hub 匹配 `'chat' !== '*'` → 事件被丢弃。

**修复**: 
- `server/src/types.ts` — 所有 StreamEvent 变体添加 `topic?: string`
- `server/src/mock-agent.ts` — 所有事件标记 `topic: 'chat'`

**验证**: WebSocket 测试收到 44 个事件，全部 `topic=chat` ✓

---

### BUG-3: Mock/Real 模型 ID 不一致 ✅ 已修复

**根因**: mock.ts 使用 `m-1`/`m-2`，server store 使用 `m-default`/`m-gpt4o`。

**修复**: `src/api/mock.ts` 模型 ID 改为 `m-default`、`m-gpt4o`。

---

### BUG-4: chat-view 重复订阅 stream ✅ 已修复

**根因**: chat-view 直接订阅 stream + state.ts 也处理事件 → 双重处理或冲突。

**修复**: 
- `src/views/chat-view.ts` — 移除 `stream.subscribe()` 和 `handleStreamEvent` 方法
- state.ts 为唯一事件处理器，chat-view 通过 `subscribe()` 从 state 读取更新

---

### BUG-5: WebSocket 消息被静默丢弃 ✅ 已修复（额外发现）

**根因**: ws 库以 Buffer 传递消息，`typeof data !== 'string'` 检查导致所有命令消息被丢弃。

**修复**: `server/src/ws.ts` — 使用 `Buffer.from(data).toString('utf-8')` 标准化消息。

---

## ✅ 验证结果

| 检查项 | 结果 |
|--------|------|
| TypeScript 类型检查 | ✅ 0 错误 |
| 单元测试 (16/16) | ✅ 全部通过 |
| 生产构建 | ✅ 260KB / 75KB gzip |
| REST API (13 端点) | ✅ 全部通过 |
| WebSocket 流式 (44 事件) | ✅ 全部 topic=chat |
| 模型 ID 一致性 | ✅ mock 与 server 统一 |

### 端到端烟雾测试 (13/13 通过)

1. ✅ 登录 → JWT Token (192 chars)
2. ✅ 用户信息 → Justinian
3. ✅ 任务列表 → 5 tasks
4. ✅ Skills → 4 skills, 2 installed
5. ✅ 知识库 → 3 entries
6. ✅ 知识搜索 → 1 hit (gromacs)
7. ✅ 模型列表 → m-default, m-gpt4o
8. ✅ 模型测试 → success, 683ms
9. ✅ 创建会话 → S-xxx
10. ✅ 系统状态 → v1.0.0
11. ✅ 错误密码 → AUTH_INVALID
12. ✅ 未鉴权 → 401
13. ✅ WebSocket 流式 → 44 events (thinking→tool_call→text_delta→file→confirm→done)

---

## 📊 最终结论

**Mock 模式**: ✅ 完全可用  
**Real 模式**: ✅ 完全可用（REST + WebSocket 流式对话）

所有 5 个 bug 已修复，前后端协议完全对齐。
