# Chemcode

Chemcode 是一个面向计算化学、分子动力学和量子化学任务的 LLM Agent 平台。

当前版本：`v2.0.0`

应用源码位于 [`chemcode/`](chemcode/)。安装、配置、测试和 PyGAMD 工作流说明请查看 [`chemcode/README.md`](chemcode/README.md)。

## 快速开始

```powershell
cd chemcode
Copy-Item .env.example .env
npm install
npm run server
```

另开一个终端运行：

```powershell
cd chemcode
npm run dev
```

默认地址：前端 `http://localhost:5174`，Gateway `http://localhost:8787`。
