// ====== System Routes ======

import { Router } from 'express';
import { ah, requireAuth, sendOk } from '../middleware.js';
import { store } from '../store.js';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const startedAt = Date.now();

/** 检测是否在 WSL 中运行 */
function isWSL(): boolean {
  try {
    return os.release().toLowerCase().includes('microsoft') || os.platform() === 'linux';
  } catch {
    return false;
  }
}

/** 获取 Windows 驱动器列表（WSL 下从 /mnt/ 读取） */
function getWindowsDrives(): Array<{ name: string; path: string }> {
  if (!isWSL()) return [];
  try {
    const mntEntries = fs.readdirSync('/mnt', { withFileTypes: true });
    return mntEntries
      .filter((e) => e.isDirectory() && e.name.length === 1 && /[a-z]/.test(e.name))
      .map((e) => ({
        name: `${e.name.toUpperCase()}:`,
        path: `/mnt/${e.name}`,
      }));
  } catch {
    return [];
  }
}

/** 将 WSL 路径转换为 Windows 路径 */
function toWindowsPath(wslPath: string): string {
  // /mnt/c/Users/... → C:\Users\...
  const match = wslPath.match(/^\/mnt\/([a-z])\/?(.*)/);
  if (match) {
    const drive = match[1].toUpperCase();
    const rest = match[2].replace(/\//g, '\\');
    return rest ? `${drive}:\\${rest}` : `${drive}:`;
  }
  return wslPath;
}

/** 将 Windows 路径转换为 WSL 路径 */
function toWSLPath(winPath: string): string {
  // C:\Users\... → /mnt/c/Users/...
  const match = winPath.match(/^([A-Za-z]):\\?(.*)/);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2].replace(/\\/g, '/');
    return rest ? `/mnt/${drive}/${rest}` : `/mnt/${drive}`;
  }
  return winPath;
}

export function systemRouter(): Router {
  const r = Router();

  r.get('/health', ah(async (_req, res) => {
    res.status(200).json({ ok: true, ts: Date.now() });
  }));

  r.get('/status', requireAuth, ah(async (req, res) => {
    const data = store.data(req.userId!);
    const { toolRegistry } = await import('../tools/index.js');
    return sendOk(res, {
      version: '2.0.0',
      buildTime: '2026-07-17',
      activeAgent: 'default',
      activeModel: data.configuredModels.find((m) => m.isDefault)?.name,
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      toolCount: toolRegistry.list().length,
      skillCount: data.skills.filter((s) => s.installed).length,
      hostname: os.hostname(),
      platform: process.platform,
      nodeVersion: process.version,
      isWSL: isWSL(),
    });
  }));

  /** GET /api/system/browse?path=... — 列出目录下的子目录
   *  支持 Windows 路径（C:\Users\...）和 WSL 路径（/mnt/c/...）
   *  无参数时返回 Windows 驱动器列表（WSL）或根目录
   */
  r.get('/browse', requireAuth, ah(async (req, res) => {
    const rawPath = (req.query.path as string) || '';

    // 无参数：返回驱动器列表
    if (!rawPath) {
      let drives: Array<{ name: string; path: string }> = [];
      if (isWSL()) {
        // WSL：从 /mnt/ 读取 Windows 驱动器
        drives = getWindowsDrives();
      } else if (process.platform === 'win32') {
        // 原生 Windows：检测所有可用驱动器
        for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
          const drivePath = `${letter}:\\`;
          try {
            fs.accessSync(drivePath, fs.constants.R_OK);
            drives.push({ name: `${letter}:`, path: drivePath });
          } catch { /* drive not available */ }
        }
      } else {
        // Linux/macOS：返回根目录
        drives = [{ name: '/', path: '/' }];
      }
      return sendOk(res, {
        current: '',
        currentDisplay: '此电脑',
        parent: null,
        directories: drives,
      });
    }

    // 路径处理：WSL 下转换路径，原生 Windows 直接用
    const readPath = isWSL() ? toWSLPath(rawPath) : rawPath;
    const displayPath = rawPath;

    try {
      const entries = fs.readdirSync(readPath, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => {
          const childRead = path.join(readPath, e.name);
          const childDisplay = isWSL() ? toWindowsPath(childRead) : childRead;
          return {
            name: e.name,
            path: childDisplay,
          };
        })
        .slice(0, 100);

      const parentRead = path.dirname(readPath);
      const parentDisplay = parentRead !== readPath
        ? (isWSL() ? toWindowsPath(parentRead) : parentRead)
        : null;

      return sendOk(res, {
        current: displayPath,
        currentDisplay: displayPath,
        parent: parentDisplay,
        directories: dirs,
      });
    } catch (e: any) {
      return sendOk(res, {
        current: displayPath,
        currentDisplay: displayPath,
        parent: null,
        directories: [],
        error: e.message,
      });
    }
  }));

  return r;
}
