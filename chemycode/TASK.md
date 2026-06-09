# Chemycode 开发任务文档

## 项目概述

Chemycode（原 ChemAgent）是一个面向计算化学/分子动力学/量子化学的 LLM 驱动 Agent 平台。

## 已完成任务（2026-06-09）

### 1. Skill 集成系统 ✅

**目标**：让 Agent 能够使用导入的 Skill（如 PyGAMD DPD 模拟技能）

**实现**：
- `server/src/tools/run-skill-script.ts` — 执行 Skill 目录中的 Python 脚本
- `server/src/tools/save-note.ts` — 写入 `.chemycode-memory/` 笔记
- `server/src/skills/loader.ts` — 扫描 `data/skills/` 加载 Skill
- `server/src/agent/loop.ts` — SKILL.md 全文注入系统提示

**工作流**：
```
用户点击 ⚡ Skill → 选择 Skill → 后续消息的 SKILL.md 注入系统提示
→ LLM 读取完整技能文档 → 使用 bash_exec/file_write 执行工作流
```

### 2. 工具系统 ✅

**已注册工具（11个）**：

| 工具 | 用途 |
|------|------|
| `file_read` | 读取文件 |
| `file_write` | 写入文件 |
| `bash_exec` | 执行 shell 命令 |
| `update_plan` | 维护任务计划 |
| `sessions_spawn` | 派生子 Agent |
| `database_search` | 检索 Qdrant 化学论文 |
| `database_status` | 查看数据库状态 |
| `run_skill_script` | 执行 Skill 脚本 |
| `save_note` | 写入记忆文件夹 |
| `create_task` | 创建任务 |
| `update_task` | 更新任务状态 |

### 3. 工作空间管理 ✅

- **锁定机制**：每个 session 锁定 workdir，后续消息不改变
- **记忆文件夹**：自动创建 `.chemycode-memory/`（含 `notes.md`、`history.log`）
- **驱动器检测**：原生 Windows 遍历 A-Z 检测所有可用驱动器

### 4. 上下文管理 ✅

- **压缩策略**：工具结果原样保留，对话消息分块摘要化
- **自动续写**：无上限（Infinity），直到任务完成
- **空内容重试**：10 次，明确提示要求总结

### 5. UI 改进 ✅

- **工具卡片默认折叠**（OpenClaw 模式）
- **Skill 按钮**：点击激活，后续消息自动携带 Skill 上下文
- **工作空间浏览器**：动态检测驱动器，支持 Windows 路径

### 6. 重命名 ✅

- ChemAgent → Chemycode
- 所有代码、配置、文档已更新

## 待完成任务

- [ ] 集成更多 Skill（量子化学、分子对接等）
- [ ] 优化 Agent 循环性能
- [ ] 添加单元测试
- [ ] 生产环境部署文档

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Lit 3.3 + Vite 5.4 |
| 后端 | Node.js 22 + Express 4 + TypeScript 5.6 |
| 通信 | WebSocket (ws 8.18) |
| 数据库 | Qdrant (SSH 远程连接) |
| LLM | OpenAI-compatible streaming |

## 目录结构

```
chemycode/
├── src/                    # 前端 (Lit Web Components)
├── server/                 # 后端 Gateway
│   └── src/
│       ├── agent/          # Agent 核心循环
│       ├── tools/          # 工具实现
│       ├── skills/         # Skill 加载器
│       ├── llm/            # LLM 客户端
│       ├── db/             # Qdrant 连接
│       └── routes/         # REST 路由
├── data/                   # 持久化数据
│   └── skills/             # 已安装的 Skills
├── demos/                  # 功能演示
└── docs/                   # 文档
```
