# Chemcode

> 面向计算化学、分子动力学和量子化学任务的 LLM Agent 平台

[![Version](https://img.shields.io/badge/release-v2.0.0-blue)](https://github.com/quitli888-source/chemcode-text/tree/v2.0.0)
[![Tests](https://img.shields.io/badge/tests-11%20passed-brightgreen)](https://github.com/quitli888-source/chemcode-text/tree/v2.0.0/chemcode/tests)
[![Node](https://img.shields.io/badge/Node.js-18%2B-339933)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](https://github.com/quitli888-source/chemcode-text/blob/v2.0.0/chemcode/README.md#license)

最新稳定版本为 **[v2.0.0](https://github.com/quitli888-source/chemcode-text/tree/v2.0.0)**，发布源码分支为 **[`codex/v2.0.0`](https://github.com/quitli888-source/chemcode-text/tree/codex/v2.0.0)**。

## 项目简介

Chemcode 允许用户用自然语言描述科学任务，由 Agent 自动规划、调用工具、执行模拟、分析轨迹并生成可视化产物。前端基于 Lit Web Components，Gateway 使用 Express、WebSocket 和 TypeScript。

主要能力：

- 并发会话流式响应与运行状态恢复
- 可中止 LLM、工具、子 Agent 和 Mock 生成的真实取消机制
- 对话、子 Agent 会话、用量和分页历史持久化
- 文件处理、Shell、任务、知识库、Skill 脚本和人工确认工具
- PDF、DOCX、PPTX、XLSX 和普通文本提取
- 有界自动续写、上下文压缩失败退避和 CJK token 估算
- PyGAMD AB 两嵌段共聚物 DPD 工作流、物理一致性分析和 OVITO 渲染

## 快速开始

推荐检出稳定标签：

```bash
git clone https://github.com/quitli888-source/chemcode-text.git
cd chemcode-text
git switch --detach v2.0.0
cd chemcode
npm install
```

复制环境配置：

```bash
cp .env.example .env
```

启动 Gateway：

```bash
npm run server
```

另开终端启动前端：

```bash
npm run dev
```

默认地址：

- 前端：`http://localhost:5174`
- Gateway：`http://localhost:8787`
- WebSocket：`ws://localhost:8787/ws`
- 演示账号：`demo / demo`

## PyGAMD 人工确认工作流

内置 `pygamd-skill-v4` v0.4.1，Agent 必须按顺序完成七个科学工作流确认节点：

1. H1：环境与依赖确认
2. H2：科学问题和模拟方案确认
3. H3：参数与输入文件确认
4. H4：最小可行模拟结果确认
5. H5：平衡阶段结果确认
6. H6：生产模拟启动确认
7. H7：分析、物理一致性和 OVITO 产物确认

确认节点由 `human_checkpoint` 强制执行，Full Access 和工具白名单不能绕过。H1 可安装并重新导入验证 PyGAMD、Numba/CUDA、NumPy、Matplotlib 和 OVITO。

## 内置工具

| 工具 | 用途 |
|---|---|
| `file_read` | 读取文件 |
| `file_write` | 写入文件 |
| `bash_exec` | 执行 Shell 命令 |
| `update_plan` | 维护 Agent 计划 |
| `sessions_spawn` | 派生并保存子 Agent 会话 |
| `database_search` | 检索 Qdrant 化学知识库 |
| `database_status` | 查看数据库状态 |
| `run_skill_script` | 执行 Skill 脚本 |
| `human_checkpoint` | 执行强制人工确认节点 |
| `save_note` | 写入工作区记忆 |
| `create_task` | 创建任务 |
| `update_task` | 更新任务状态 |

## v2.0.0 命名变更

v2.0.0 将产品名、应用目录、npm 包、Web Components、浏览器存储键、环境变量和运行时记忆目录统一为 Chemcode 命名：

- 应用目录：`chemcode/`
- npm 包：`chemcode-ui`
- 数据目录变量：`CHEMCODE_DATA_DIR`
- Agent 记忆目录：`.chemcode-memory/`
- Web Components：`<chemcode-*>`

这是破坏性命名空间更新，v1 浏览器本地状态不会自动迁移。

## 测试与环境检查

```bash
cd chemcode
npm test
npm run build
python data/skills/pygamd-skill-v4/scripts/check_environment.py --json
```

v2.0.0 已验证 11 项自动化测试、TypeScript/Vite 生产构建，以及 PyGAMD 1.4.8、CUDA 和 OVITO 3.15.5 环境。

## 文档

- [完整使用与架构说明](https://github.com/quitli888-source/chemcode-text/blob/v2.0.0/chemcode/README.md)
- [使用指南](https://github.com/quitli888-source/chemcode-text/blob/v2.0.0/chemcode/USAGE.md)
- [开发状态](https://github.com/quitli888-source/chemcode-text/blob/v2.0.0/chemcode/TASK.md)
- [版本记录](https://github.com/quitli888-source/chemcode-text/blob/v2.0.0/chemcode/CHANGELOG.md)

## License

MIT
