# Chemcode v2.0.0

Chemcode 是一个面向计算化学、分子动力学和量子化学的 LLM Agent 平台。前端使用 Lit Web Components，Gateway 使用 Express、WebSocket 和 TypeScript；Agent 可进行流式对话、调用工具、派生子 Agent、管理任务并执行 Skill 工作流。

## 主要能力

- 并发会话流式响应与运行状态恢复
- 可真正中止 LLM、工具、子 Agent 和 Mock 运行的取消机制
- 对话、子 Agent 会话、用量和分页历史持久化
- 文件读写、Shell、任务、数据库、Skill 脚本和人工确认等 12 个内置工具
- PPTX、XLSX、PDF 和普通文本提取
- 有界自动续写、上下文压缩失败退避和 CJK token 估算
- PyGAMD AB 两嵌段共聚物 DPD 工作流、物理一致性分析和 OVITO 渲染

## 环境要求

- Node.js 18 或更高版本（推荐 Node.js 22）
- npm
- 执行 PyGAMD 工作流时需要 Python、可用的 CUDA/Numba 环境及 OVITO；H1 检查可安装缺失依赖

## 安装与启动

```powershell
Copy-Item .env.example .env
npm install
```

启动 Gateway：

```powershell
npm run server
```

另开终端启动前端：

```powershell
npm run dev
```

默认地址：

- 前端：`http://localhost:5174`
- Gateway：`http://localhost:8787`
- WebSocket：`ws://localhost:8787/ws`

默认演示账号为 `demo / demo`。

## 配置

主要环境变量：

| 变量 | 默认值 | 说明 |
|---|---:|---|
| `PORT` | `8787` | Gateway 端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `CHEMCODE_DATA_DIR` | `./data` | 用户、会话、知识库和用量数据目录 |
| `AUTH_TOKEN_SECRET` | 开发默认值 | Token 签名密钥，生产环境必须替换 |
| `AUTH_TOKEN_TTL` | `86400` | Token 有效期（秒） |
| `VITE_USE_MOCK` | `false` | 是否使用前端 Mock Agent |

LLM 模型和 API Key 可在前端“设置 → 模型管理”中配置。支持 OpenAI-compatible `/v1/chat/completions` 流式接口。

## PyGAMD 人工确认工作流

内置 `pygamd-skill-v4`（v0.4.1）要求 Agent 严格按 H1–H7 顺序执行：

1. H1 环境与依赖确认
2. H2 科学问题和模拟方案确认
3. H3 参数与输入文件确认
4. H4 最小可行模拟结果确认
5. H5 平衡阶段结果确认
6. H6 生产模拟启动确认
7. H7 分析、物理一致性和 OVITO 产物确认

这些节点由 `human_checkpoint` 工具强制执行，不会被 Full Access 或工具白名单绕过。若 H1 缺少依赖，Agent 必须运行环境脚本的安装模式并重新导入验证后才能继续。

## 质量检查

```powershell
npm test
npm run build
```

单独检查 PyGAMD 环境：

```powershell
python data/skills/pygamd-skill-v4/scripts/check_environment.py --json
```

缺少依赖时：

```powershell
python data/skills/pygamd-skill-v4/scripts/check_environment.py --install-missing --json
```

## 目录结构

```text
chemcode/
├─ src/                 前端应用
├─ server/src/          Gateway、Agent、工具和 API
├─ tests/               Agent 与事件关联测试
├─ data/skills/         已安装 Skills
├─ demos/               示例输入
└─ scripts/             文件处理辅助脚本
```

运行时 Agent 笔记保存在工作目录的 `.chemcode-memory/` 中，该目录不应提交到仓库。

## 版本说明

`v2.0.0` 是品牌和命名空间的破坏性更新。包名、Web Components 标签、localStorage 键、环境变量和运行时目录均使用 Chemcode 命名；v1 浏览器本地状态不会自动迁移。完整记录见 [CHANGELOG.md](CHANGELOG.md)。

## License

MIT
