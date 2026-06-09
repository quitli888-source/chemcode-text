// ====== Skills Routes ======
// Full skill management: list, install, uninstall, import (with extraction).

import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { ah, requireAuth, sendOk, sendErr } from '../middleware.js';
import { store } from '../store.js';
import { dataDir } from '../storage.js';
import { loadSingleSkill, unloadSkillTools } from '../skills/loader.js';
import { toolRegistry } from '../tools/registry.js';
import type { SkillEntry } from '../types.js';

const upload = multer({ storage: multer.memoryStorage() });

function rid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

const skillsDir = path.join(dataDir(), 'skills');

/**
 * Import a single skill from an extracted directory.
 * Returns the created SkillEntry.
 */
async function importSingleSkill(
  skillDir: string,
  found: { manifestPath: string; skillDir: string } | null,
  baseName: string,
  originalName: string,
  userId: string,
): Promise<SkillEntry> {
  let skillName = baseName;
  let skillDesc = `Imported from ${originalName}`;
  let skillVersion = '0.1.0';
  let skillAuthor = 'Local';

  if (found) {
    try {
      const raw = fs.readFileSync(found.manifestPath, 'utf-8');
      const manifest = JSON.parse(raw);
      skillName = manifest.name || baseName;
      skillDesc = manifest.description || skillDesc;
      skillVersion = manifest.version || skillVersion;
      skillAuthor = manifest.author || skillAuthor;

      // If the manifest is in a subdirectory, move contents up.
      if (found.skillDir !== skillDir) {
        const subEntries = fs.readdirSync(found.skillDir);
        for (const subEntry of subEntries) {
          const src = path.join(found.skillDir, subEntry);
          const dst = path.join(skillDir, subEntry);
          if (!fs.existsSync(dst)) {
            fs.renameSync(src, dst);
          }
        }
        try { fs.rmdirSync(found.skillDir); } catch { /* ignore */ }
      }
    } catch (e) {
      console.warn('[skills] failed to read manifest:', e);
    }
  }

  // Create manifest.json if none exists.
  const finalManifestPath = path.join(skillDir, 'manifest.json');
  if (!fs.existsSync(finalManifestPath)) {
    fs.writeFileSync(finalManifestPath, JSON.stringify({
      name: skillName, description: skillDesc, version: skillVersion,
      author: skillAuthor, tools: [],
    }, null, 2), 'utf-8');
  }

  const skillDirName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');

  const s: SkillEntry = {
    id: rid('S'),
    name: skillName,
    description: skillDesc,
    version: skillVersion,
    installed: true,
    author: skillAuthor,
    downloads: 0,
    toolCount: 0,
    toolNames: [],
  };

  // Register in store.
  const data = store.data(userId);
  data.skills.push(s);
  store.commit(userId);

  // Hot-load tools.
  try {
    const tc = await loadSingleSkill(skillDirName);
    const manifestRaw = fs.readFileSync(finalManifestPath, 'utf-8');
    const manifest = JSON.parse(manifestRaw);
    s.toolCount = tc;
    s.toolNames = (manifest.tools || []).map((t: { name: string }) => t.name);
  } catch (e) {
    console.warn(`[skills] failed to register tools for ${skillName}:`, e);
  }

  return s;
}

/**
 * Extract a zip buffer to a target directory.
 * Uses the system `unzip` command (Linux/macOS) or PowerShell (Windows).
 */
async function extractZip(buffer: Buffer, targetDir: string): Promise<void> {
  fs.mkdirSync(targetDir, { recursive: true });

  const isWin = process.platform === 'win32';
  const tmpZipPath = path.join(targetDir, '__import_tmp.zip');

  // Write buffer to temp file.
  fs.writeFileSync(tmpZipPath, buffer);

  try {
    const { execSync } = await import('node:child_process');

    if (isWin) {
      // PowerShell Expand-Archive
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -Path '${tmpZipPath}' -DestinationPath '${targetDir}' -Force"`,
        { stdio: 'pipe' },
      );
    } else {
      execSync(`unzip -o "${tmpZipPath}" -d "${targetDir}"`, { stdio: 'pipe' });
    }
  } finally {
    // Clean up temp zip file.
    try { fs.unlinkSync(tmpZipPath); } catch { /* ignore */ }
  }
}

/**
 * Try to read manifest.json from the extracted skill directory.
 * Handles the case where the zip contains a subdirectory.
 */
function findManifest(dir: string): { manifestPath: string; skillDir: string } | null {
  // Check direct manifest.json
  const direct = path.join(dir, 'manifest.json');
  if (fs.existsSync(direct)) return { manifestPath: direct, skillDir: dir };

  // Check for a single subdirectory containing manifest.json
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const sub = path.join(dir, entry.name);
      const subManifest = path.join(sub, 'manifest.json');
      if (fs.existsSync(subManifest)) return { manifestPath: subManifest, skillDir: sub };
    }
  }

  return null;
}

/**
 * Recursively find ALL manifest.json files in a directory tree.
 * Used to detect zips containing multiple skills.
 */
function findAllManifests(dir: string): Array<{ manifestPath: string; skillDir: string }> {
  const results: Array<{ manifestPath: string; skillDir: string }> = [];

  function walk(currentDir: string) {
    const manifestPath = path.join(currentDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      results.push({ manifestPath, skillDir: currentDir });
      return; // Don't descend into a skill directory.
    }
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          walk(path.join(currentDir, entry.name));
        }
      }
    } catch { /* ignore */ }
  }

  walk(dir);
  return results;
}

export function skillsRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/', ah(async (req, res) => {
    const data = store.data(req.userId!);
    const existingNames = new Set(data.skills.map(s => s.name));

    // Scan disk for skills not in store and add them.
    try {
      if (fs.existsSync(skillsDir)) {
        const diskEntries = fs.readdirSync(skillsDir, { withFileTypes: true });
        for (const entry of diskEntries) {
          if (!entry.isDirectory()) continue;
          const manifestPath = path.join(skillsDir, entry.name, 'manifest.json');
          if (!fs.existsSync(manifestPath)) continue;
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            if (manifest.name && !existingNames.has(manifest.name)) {
              const tools = manifest.tools || [];
              data.skills.push({
                id: `S-${entry.name}`,
                name: manifest.name,
                description: manifest.description || '',
                version: manifest.version || '0.1.0',
                installed: true,
                author: manifest.author || 'Local',
                downloads: 0,
                toolCount: tools.length,
                toolNames: tools.map((t: { name: string }) => t.name),
              });
            }
          } catch { /* skip bad manifest */ }
        }
        store.commit(req.userId!);
      }
    } catch { /* ignore */ }

    // Enrich with tool + script info.
    const enriched = data.skills.map((s) => {
      try {
        const skillDirName = s.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const manifestPath = path.join(skillsDir, skillDirName, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          const tools = manifest.tools || [];
          const scripts = manifest.scripts || [];
          return {
            ...s,
            toolCount: tools.length,
            toolNames: tools.map((t: { name: string }) => t.name),
            scriptCount: scripts.length,
            scripts: scripts.map((sc: { name: string; description?: string }) => ({
              name: sc.name,
              description: sc.description || '',
            })),
            skillDirName,
          };
        }
      } catch { /* ignore */ }
      return { ...s, toolCount: 0, toolNames: [], scriptCount: 0, scripts: [] };
    });
    return sendOk(res, enriched);
  }));

  r.post('/:id/install', ah(async (req, res) => {
    const data = store.data(req.userId!);
    const s = data.skills.find((x) => x.id === req.params.id);
    if (!s) return sendErr(res, 'NOT_FOUND', 'Skill not found', 404);
    s.installed = true;

    // Hot-load: register tools from disk.
    const skillDirName = s.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    try {
      const toolCount = await loadSingleSkill(skillDirName);
      // Read tool names from manifest.
      const manifestPath = path.join(skillsDir, skillDirName, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        s.toolCount = toolCount;
        s.toolNames = (manifest.tools || []).map((t: { name: string }) => t.name);
      }
    } catch (e) {
      console.warn(`[skills] install: failed to load tools for ${s.name}:`, e);
    }

    store.commit(req.userId!);
    return sendOk(res, s);
  }));

  r.post('/:id/uninstall', ah(async (req, res) => {
    const data = store.data(req.userId!);
    const s = data.skills.find((x) => x.id === req.params.id);
    if (!s) return sendErr(res, 'NOT_FOUND', 'Skill not found', 404);
    s.installed = false;
    store.commit(req.userId!);

    // Unregister tools from the registry.
    const skillDirName = s.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const manifestPath = path.join(skillsDir, skillDirName, 'manifest.json');
    try {
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const toolNames = (manifest.tools || []).map((t: { name: string }) => t.name);
        unloadSkillTools(toolNames);
      }
    } catch (e) {
      console.warn(`[skills] uninstall: failed to unload tools for ${s.name}:`, e);
    }

    return sendOk(res, undefined);
  }));

  r.delete('/:id', ah(async (req, res) => {
    const data = store.data(req.userId!);
    const idx = data.skills.findIndex((x) => x.id === req.params.id);
    if (idx === -1) return sendErr(res, 'NOT_FOUND', 'Skill not found', 404);
    const s = data.skills[idx];

    // Unregister tools first.
    const skillDirName = s.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const manifestPath = path.join(skillsDir, skillDirName, 'manifest.json');
    try {
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const toolNames = (manifest.tools || []).map((t: { name: string }) => t.name);
        unloadSkillTools(toolNames);
      }
    } catch { /* ignore */ }

    // Delete skill files from disk.
    const skillDir = path.join(skillsDir, skillDirName);
    try { fs.rmSync(skillDir, { recursive: true, force: true }); } catch { /* ignore */ }

    // Remove from store.
    data.skills.splice(idx, 1);
    store.commit(req.userId!);

    return sendOk(res, undefined);
  }));

  r.post('/import', requireAuth, upload.single('file'), ah(async (req, res) => {
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) return sendErr(res, 'INVALID_INPUT', 'file required', 400);

    // Determine skill name from filename.
    const baseName = file.originalname.replace(/\.(zip|tar|tar\.gz|tgz|skill)$/i, '');
    const skillDirName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const skillDir = path.join(skillsDir, skillDirName);

    try {
      // Extract the zip to the skills directory.
      await extractZip(file.buffer, skillDir);

      // Detect if this zip contains multiple skills.
      const allManifests = findAllManifests(skillDir);

      if (allManifests.length <= 1) {
        // ── Single skill ──
        const found = allManifests[0] || findManifest(skillDir);
        const result = await importSingleSkill(skillDir, found, baseName, file.originalname, req.userId!);
        return sendOk(res, result, 201);
      }

      // ── Multiple skills in one zip ──
      const data = store.data(req.userId!);
      const imported: SkillEntry[] = [];

      for (const m of allManifests) {
        try {
          const raw = fs.readFileSync(m.manifestPath, 'utf-8');
          const manifest = JSON.parse(raw);
          const skillName = manifest.name || path.basename(m.skillDir);
          const skillDirNameInner = skillName.replace(/[^a-zA-Z0-9_-]/g, '_');

          // If the skill is in a subdirectory, create a proper skill dir for it.
          let finalSkillDir = m.skillDir;
          if (m.skillDir !== skillDir) {
            // Move to skills root as a separate skill directory.
            const targetDir = path.join(skillsDir, skillDirNameInner);
            if (!fs.existsSync(targetDir)) {
              fs.renameSync(m.skillDir, targetDir);
            }
            finalSkillDir = targetDir;
          }

          // Remove existing skill with the same name to prevent duplicates.
          const existingIdx = data.skills.findIndex((s) => s.name === skillName);
          if (existingIdx !== -1) {
            data.skills.splice(existingIdx, 1);
          }

          const s: SkillEntry = {
            id: rid('S'),
            name: skillName,
            description: manifest.description || `Imported from ${file.originalname}`,
            version: manifest.version || '0.1.0',
            installed: true,
            author: manifest.author || 'Local',
            downloads: 0,
            toolCount: 0,
            toolNames: [],
          };

          // Register tools.
          try {
            const tc = await loadSingleSkill(skillDirNameInner);
            s.toolCount = tc;
            s.toolNames = (manifest.tools || []).map((t: { name: string }) => t.name);
          } catch (e) {
            console.warn(`[skills] failed to register tools for ${skillName}:`, e);
          }

          data.skills.push(s);
          imported.push(s);
        } catch (e) {
          console.warn(`[skills] failed to import skill from ${m.skillDir}:`, e);
        }
      }

      // Clean up the original extraction directory if it's now empty.
      try {
        const remaining = fs.readdirSync(skillDir);
        if (remaining.length === 0) fs.rmdirSync(skillDir);
      } catch { /* ignore */ }

      store.commit(req.userId!);
      console.log(`[skills] imported ${imported.length} skills from ${file.originalname}`);
      return sendOk(res, imported, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[skills] import failed:', msg);
      try { fs.rmSync(skillDir, { recursive: true, force: true }); } catch { /* ignore */ }
      return sendErr(res, 'IMPORT_FAILED', `导入失败: ${msg}`, 500);
    }
  }));

  return r;
}
