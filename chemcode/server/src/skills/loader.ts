// ====== Skill Loader ======
// Loads skills from data/skills/ directory.
// Each skill is a folder containing:
//   manifest.json  — metadata + tool definitions
//   tools/*.js     — tool implementations (optional, for dynamic tools)
//
// manifest.json format:
// {
//   "name": "my-skill",
//   "description": "A custom skill",
//   "version": "1.0.0",
//   "author": "User",
//   "tools": [
//     {
//       "name": "my_tool",
//       "description": "Does something",
//       "parameters": { "type": "object", "properties": {...}, "required": [...] },
//       "file": "tools/my_tool.js"
//     }
//   ]
// }

import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../storage.js';
import { toolRegistry } from '../tools/registry.js';
import type { ToolExecuteFn } from '../tools/types.js';

interface SkillManifest {
  name: string;
  description: string;
  version: string;
  author?: string;
  tools?: SkillToolDef[];
}

interface SkillToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  file?: string;  // relative path to tool JS file
  /** Inline execute function as string (for simple tools). */
  code?: string;
}

const skillsDir = path.join(dataDir(), 'skills');

/**
 * Load all installed skills from disk and register their tools.
 * Called once on server startup.
 *
 * @param installedSkillNames - Set of skill names that are marked installed in the store.
 *                              If provided, only these skills are loaded.
 *                              If not provided, ALL skills are loaded (backward compat).
 */
export async function loadSkills(installedSkillNames?: Set<string>): Promise<number> {
  let toolCount = 0;

  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
    return 0;
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(skillsDir, entry.name);
    const manifestPath = path.join(skillDir, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      console.warn(`[skills] skipping ${entry.name}: no manifest.json`);
      continue;
    }

    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw) as SkillManifest;

      if (!manifest.name) {
        console.warn(`[skills] skipping ${entry.name}: missing name in manifest`);
        continue;
      }

      // Check if this skill is installed (if filter is provided).
      if (installedSkillNames && !installedSkillNames.has(manifest.name)) {
        console.log(`[skills] skipping ${manifest.name}: not installed`);
        continue;
      }

      console.log(`[skills] loading skill: ${manifest.name} v${manifest.version || '?'}`);

      // Register tools from the manifest.
      if (manifest.tools) {
        for (const toolDef of manifest.tools) {
          try {
            await registerSkillTool(skillDir, toolDef);
            toolCount++;
          } catch (e) {
            console.warn(`[skills] failed to register tool ${toolDef.name}:`, e);
          }
        }
      }
    } catch (e) {
      console.warn(`[skills] failed to load skill ${entry.name}:`, e);
    }
  }

  return toolCount;
}

/**
 * Load a single skill from disk and register its tools.
 * Used for hot-reload after import (without server restart).
 */
export async function loadSingleSkill(skillDirName: string): Promise<number> {
  let toolCount = 0;
  const skillDir = path.join(skillsDir, skillDirName);
  const manifestPath = path.join(skillDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No manifest.json found in ${skillDir}`);
  }

  const raw = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw) as SkillManifest;

  if (!manifest.name) {
    throw new Error(`Missing name in manifest`);
  }

  console.log(`[skills] hot-loading skill: ${manifest.name} v${manifest.version || '?'}`);

  if (manifest.tools) {
    for (const toolDef of manifest.tools) {
      await registerSkillTool(skillDir, toolDef);
      toolCount++;
    }
  }

  return toolCount;
}

/**
 * Unregister all tools belonging to a skill.
 * Used when uninstalling a skill.
 */
export function unloadSkillTools(toolNames: string[]): void {
  for (const name of toolNames) {
    toolRegistry.unregister(name);
    console.log(`[skills] unregistered tool: ${name}`);
  }
}

/**
 * Register a single tool from a skill.
 */
async function registerSkillTool(skillDir: string, toolDef: SkillToolDef): Promise<void> {
  let execute: ToolExecuteFn;

  if (toolDef.file) {
    // Load execute function from JS file.
    const filePath = path.resolve(skillDir, toolDef.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Tool file not found: ${filePath}`);
    }
    // Convert Windows backslashes to forward slashes for import().
    const importPath = filePath.replace(/\\/g, '/');
    const fileUrl = importPath.startsWith('/') ? `file://${importPath}` : `file:///${importPath}`;
    try {
      const mod = await import(fileUrl);
      if (typeof mod.execute === 'function') {
        execute = mod.execute;
      } else if (typeof mod.default === 'function') {
        execute = mod.default;
      } else {
        throw new Error(`Tool file ${toolDef.file} must export an execute function`);
      }
    } catch (e) {
      // Fallback: try require-style import.
      const mod = await import(filePath);
      if (typeof mod.execute === 'function') {
        execute = mod.execute;
      } else if (typeof mod.default === 'function') {
        execute = mod.default;
      } else {
        throw new Error(`Tool file ${toolDef.file} must export an execute function`);
      }
    }
  } else if (toolDef.code) {
    // Inline code — wrap in a function.
    // eslint-disable-next-line no-new-func
    execute = new Function('params', 'context', `return (async () => { ${toolDef.code} })()`) as ToolExecuteFn;
  } else {
    throw new Error(`Tool ${toolDef.name} must have either 'file' or 'code'`);
  }

  toolRegistry.register(
    {
      name: toolDef.name,
      description: toolDef.description,
      parameters: toolDef.parameters as any,
    },
    execute,
  );

  console.log(`[skills] registered tool: ${toolDef.name}`);
}
