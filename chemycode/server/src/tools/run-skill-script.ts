// ====== run_skill_script Tool ======
// Execute Python scripts from installed skills.
// Bridges the skill system with the agent's tool execution.

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { toolRegistry } from './registry.js';
import { dataDir } from '../storage.js';

const skillsDir = path.join(dataDir(), 'skills');

toolRegistry.register(
  {
    name: 'run_skill_script',
    title: 'Run Skill Script',
    description:
      'Execute a Python script from an installed skill. Use this to run computational chemistry simulations, data analysis, or any skill-provided script. ' +
      'The script runs in the skill\'s directory with access to its resources. ' +
      'Available skills and their scripts are listed in the system prompt.',
    parameters: {
      type: 'object',
      properties: {
        skill: {
          type: 'string',
          description: 'Skill directory name (e.g. "pygamd-skill-v4").',
        },
        script: {
          type: 'string',
          description: 'Script filename relative to the skill\'s scripts/ directory (e.g. "example_dpd_simulation.py").',
        },
        args: {
          type: 'string',
          description: 'Command-line arguments to pass to the script (e.g. "--n_chains 50 --steps 10000").',
        },
        python: {
          type: 'string',
          description: 'Python interpreter path (default: "python3" on Linux, "python" on Windows).',
        },
      },
      required: ['skill', 'script'],
    },
    dangerous: false,
  },
  async (params, ctx) => {
    const skillName = String(params.skill);
    const scriptName = String(params.script);
    const args = params.args ? String(params.args).split(/\s+/).filter(Boolean) : [];
    const isWin = process.platform === 'win32';
    const python = params.python ? String(params.python) : isWin ? 'python' : 'python3';

    // Resolve script path (with traversal guard).
    const skillDir = path.resolve(skillsDir, skillName);
    if (!skillDir.startsWith(path.resolve(skillsDir))) {
      return { content: `Invalid skill name: ${skillName}`, success: false };
    }
    const scriptPath = path.resolve(skillDir, 'scripts', scriptName);
    if (!scriptPath.startsWith(path.resolve(skillDir, 'scripts'))) {
      return { content: `Invalid script name: ${scriptName}`, success: false };
    }

    if (!fs.existsSync(skillDir)) {
      return {
        content: `Skill "${skillName}" not found. Available skills: ${fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir).filter((d) => fs.statSync(path.join(skillsDir, d)).isDirectory()).join(', ') : '(none)'}`,
        success: false,
      };
    }

    if (!fs.existsSync(scriptPath)) {
      const scriptsDir = path.join(skillDir, 'scripts');
      const available = fs.existsSync(scriptsDir)
        ? fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.py') || f.endsWith('.sh'))
        : [];
      return {
        content: `Script "${scriptName}" not found in ${skillName}/scripts/. Available: ${available.join(', ') || '(none)'}`,
        success: false,
      };
    }

    // Execute the script.
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      const fullArgs = [scriptPath, ...args];
      const child = spawn(python, fullArgs, {
        cwd: skillDir,
        env: {
          ...process.env,
          SKILL_DIR: skillDir,
          SKILL_NAME: skillName,
          TERM: 'dumb',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Forward abort signal.
      if (ctx.signal) {
        if (ctx.signal.aborted) {
          try { child.kill('SIGKILL'); } catch { child.kill(); }
        } else {
          ctx.signal.addEventListener('abort', () => {
            try { child.kill('SIGKILL'); } catch { child.kill(); }
          }, { once: true });
        }
      }

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString('utf-8');
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf-8');
      });

      child.on('close', (code) => {
        const exitCode = code ?? -1;
        const success = exitCode === 0;

        let output = '';
        if (stdout) output += stdout;
        if (stderr) output += (output ? '\n' : '') + stderr;

        // No output limit — full content sent to LLM.
        // Context overflow handled by agent loop compaction.

        resolve({
          content: output || `(no output, exit code: ${exitCode})`,
          success,
          details: {
            exitCode,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
            skill: skillName,
            script: scriptName,
            args: args.join(' '),
            workdir: skillDir,
          },
        });
      });

      child.on('error', (e) => {
        resolve({
          content: `Failed to execute ${skillName}/${scriptName}: ${e.message}`,
          success: false,
          details: { error: e.message, skill: skillName, script: scriptName },
        });
      });
    });
  },
);
