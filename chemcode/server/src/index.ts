// ====== Chemcode Gateway Server ======
// A lightweight, OpenClaw-compatible gateway that fronts the chat experience.
//
// Surface area:
//   REST  /api/auth/{login,logout,me}
//         /api/sessions[/:id]
//         /api/sessions/:id/{history,messages,cancel}
//         /api/tasks[/:id]
//         /api/skills[/:id/{install,uninstall}]
//         /api/skills/import
//         /api/knowledge[/:id]
//         /api/knowledge/search
//         /api/models[/:id]
//         /api/models/:id/{test,default}
//         /api/uploads
//         /api/system/{status,health}
//   WS    /ws
//
// The server is intentionally self-contained: in-memory stores, a tiny mock
// LLM that produces the same streaming protocol the frontend expects. This
// keeps the dev loop fast — no OpenClaw runtime required.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';

import { authRouter } from './routes/auth.js';
import { sessionsRouter } from './routes/sessions.js';
import { tasksRouter } from './routes/tasks.js';
import { skillsRouter } from './routes/skills.js';
import { knowledgeRouter } from './routes/knowledge.js';
import { modelsRouter } from './routes/models.js';
import { uploadsRouter } from './routes/uploads.js';
import { systemRouter } from './routes/system.js';
import { usageRouter } from './routes/usage.js';
import { databaseRouter } from './routes/database.js';
import { testConnection, preloadCache } from './db/qdrant.js';
import { attachWebSocket } from './ws.js';
import './tools/index.js';  // Register all tools (file_read, file_write, bash_exec)
import { loadSkills } from './skills/loader.js';
import { errorHandler, notFound } from './middleware.js';
import { ensureDataDirs } from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';

await ensureDataDirs();

// Load all skills from disk and register their tools.
// On startup, load everything. Install/uninstall routes manage the registry at runtime.
const skillToolCount = await loadSkills();
if (skillToolCount > 0) {
  console.log(`[skills] loaded ${skillToolCount} tool(s) from skills`);
}

const app = express();
// CORS: restrict to allowed origins from environment variable.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174,http://localhost:8787')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    // Allow same-origin / no-origin (curl, server-side) requests.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Health probe (no auth)
app.get('/api/system/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Routers
app.use('/api/auth', authRouter());
app.use('/api/sessions', sessionsRouter());
app.use('/api/tasks', tasksRouter());
app.use('/api/skills', skillsRouter());
app.use('/api/knowledge', knowledgeRouter());
app.use('/api/models', modelsRouter());
app.use('/api/uploads', uploadsRouter());
app.use('/api/system', systemRouter());
app.use('/api/usage', usageRouter());
app.use('/api/database', databaseRouter());

app.use(notFound);
app.use(errorHandler);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
attachWebSocket(wss);

// ---- Qdrant 数据库自动连接 ----
// SSH 连接参数在 db/qdrant.ts 中从环境变量读取，启动时自动测试连接

server.listen(PORT, HOST, async () => {
  console.log(`[chemcode-gateway] listening on http://${HOST}:${PORT}`);
  console.log(`[chemcode-gateway] WebSocket: ws://${HOST}:${PORT}/ws`);

  // 启动时自动测试数据库连接（SSH → Qdrant）
  try {
    const ok = await testConnection();
    console.log(`[qdrant] SSH connection: ${ok ? '✅ connected' : '❌ failed'}`);
    if (ok) {
      // 预加载全部 points 到内存，后续检索毫秒级
      await preloadCache();
    }
  } catch (e: any) {
    console.log(`[qdrant] connection failed: ${e.message}`);
  }
});

export { app, server };
