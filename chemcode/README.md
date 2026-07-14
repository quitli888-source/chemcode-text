# Chemcode

> 计算化学 AI Agent 平台 — 前端 + Gateway 后端 + Skill 体系
> 基于 Vite + Lit (Web Components) + Express + WebSocket + TypeScript

## 概览

Chemcode 是一个面向**计算化学 / 分子动力学 / 量子化学**的 LLM 驱动 Agent 平台。用户在前端输入自然语言任务，Agent 自动调用工具完成工作。

**架构模式**：与 OpenClaw (`pi-embedded-runner` 模式) 对齐的 LLM ↔ Tool 多轮循环。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Lit 3.3 (Web Components) + Vite 5.4 |
| 后端 | Node.js 22 + Express 4 + TypeScript 5.6 |
| WebSocket | ws 8.18 (原生，无 socket.io) |
| 鉴权 | JWT-lite（SHA256 密码哈希） |
| 持久化 | 内存 + JSON 文件（data/users/, data/skills/） |
| LLM 客户端 | OpenAI-compatible streaming（流式 + 工具调用） |
| 向量数据库 | Qdrant 1.x（通过 SSH 连接远程服务器） |
| Skill 系统 | 文件系统扫描 + manifest.json + SKILL.md 注入 |

## 快速开始

### 安装

```bash
npm install
```

### 仅前端（Mock 模式）

```bash
# .env
VITE_USE_MOCK=true

npm run dev  # → http://localhost:5174
```

### 完整模式

```bash
# 终端 1：后端 Gateway
npm run server   # → http://localhost:8787

# 终端 2：前端
npm run dev      # → http://localhost:5174
```

登录：`demo / demo`

## 已注册工具（11个）

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

## 已安装 Skills

### pygamd-skill-v4

**PyGAMD DPD 介观模拟技能** — 吉林大学朱有亮团队开发的 Python GPU 加速分子动力学软件

- **DPD 模拟**（耗散粒子动力学，AB 两嵌段共聚物相分离）
- **轨迹分析**（RDF、序参数、回转半径）
- **物理一致性检验**（温度守恒、动量守恒、能量漂移、压力张量 virial）

## 目录结构

```
chemcode/
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

## 配置

```bash
# .env.example 已包含所有配置项
cp .env.example .env
# 编辑 .env 填入你的配置
```

## License

MIT
