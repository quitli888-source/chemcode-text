# Chemcode

> **计算化学 AI Agent 平台** — 自然语言驱动的分子动力学 / 量子化学 / 化学信息学任务执行系统

[![Version](https://img.shields.io/badge/version-2.0-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()
[![Node](https://img.shields.io/badge/node-22+-339933)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6)]()

## 项目简介

Chemcode 是一个面向**计算化学**的 LLM 驱动 Agent 平台。用户在前端输入自然语言任务，Agent 自动调用工具链完成模拟、分析、可视化等全流程工作。

**核心能力：**
- 🔬 **分子动力学模拟** — DPD 耗散粒子动力学、NVT/NVE 系综
- 🧪 **化学信息学** — RDKit 分子操作、SMILES 解析
- 📊 **轨迹分析** — RDF、序参数、回转半径、MSD
- 🤖 **多轮 Agent 循环** — LLM ↔ Tool 自动编排（OpenClaw pi-embedded-runner 模式）
- 📚 **知识库检索** — Qdrant 向量数据库，化学论文语义搜索
- 🛠 **Skill 系统** — 可扩展的技能包机制（manifest + SKILL.md 注入）

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Lit 3.3 (Web Components) + Vite 5.4 |
| 后端 | Node.js 22 + Express 4 + TypeScript 5.6 |
| WebSocket | ws 8.18（原生，无 socket.io） |
| 鉴权 | JWT-lite（SHA256 密码哈希） |
| 持久化 | 内存 + JSON 文件 |
| LLM | OpenAI-compatible streaming（流式 + 工具调用） |
| 向量数据库 | Qdrant 1.x（SSH 隧道连接远程服务器） |
| Skill 系统 | 文件系统扫描 + manifest.json |

## 快速开始

### 安装

```bash
cd chemcode
npm install
```

### Mock 模式（仅前端）

```bash
# chemcode/.env
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

## Agent 工具链（11个）

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

**PyGAMD DPD 介观模拟技能** — 吉林大学朱有亮团队开发的 GPU 加速分子动力学软件

- DPD 模拟（AB 两嵌段共聚物相分离、自组装）
- 轨迹分析（RDF、序参数、回转半径）
- 物理一致性检验（温度守恒、动量守恒、能量漂移）

## 目录结构

```
chemcode-text/
├── chemcode/
│   ├── src/                # 前端 (Lit Web Components)
│   │   ├── components/      # UI 组件
│   │   ├── views/           # 页面视图
│   │   ├── api/             # API 客户端
│   │   └── styles.css       # 全局样式
│   ├── server/              # 后端 Gateway
│   │   └── src/
│   │       ├── agent/       # Agent 核心循环
│   │       ├── tools/       # 工具实现
│   │       ├── skills/      # Skill 加载器
│   │       ├── llm/         # LLM 客户端
│   │       ├── db/          # Qdrant 连接
│   │       └── routes/      # REST 路由
│   ├── data/                # 持久化数据
│   │   └── skills/          # 已安装的 Skills
│   ├── demos/               # 功能演示
│   └── scripts/             # 辅助脚本
├── README.md
└── .gitignore
```

## 配置

```bash
cd chemcode
cp .env.example .env
# 编辑 .env 填入你的配置（API Key、Qdrant 连接等）
```

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v2.0 | 2026-07-14 | 统一命名 chemcode，完善知识库后端，新增文件提取与错误日志 |
| v1.0 | 2026-06 | 初始版本，前端 UI + Agent 循环 + Skill 系统 |

## License

MIT
