// ====== bash_exec Tool ======
// Execute shell commands on the local machine.
// Follows OpenClaw's exec tool pattern (bash-tools.schemas.ts + bash-tools.exec.ts).
//
// Safety measures:
//   - Working directory isolation
//   - Abort signal support
// No timeout — runs until command completes or abort signal fires.
// No output size limit — full stdout/stderr returned.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { toolRegistry } from './registry.js';

toolRegistry.register(
  {
    name: 'bash_exec',
    title: 'Execute Shell Command',
    description: 'Execute a shell command and return stdout/stderr. Use for file operations, running scripts, installing packages, etc.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute.',
        },
        workdir: {
          type: 'string',
          description: 'Working directory (defaults to session workdir).',
        },
        shell: {
          type: 'string',
          description: 'Shell to use (default: /bin/bash on Linux, cmd on Windows).',
        },
      },
      required: ['command'],
    },
    dangerous: false,
  },
  async (params, ctx) => {
    const command = String(params.command);
    const workdir = params.workdir
      ? path.resolve(ctx.workdir, String(params.workdir))
      : ctx.workdir;

    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const shell = params.shell
        ? String(params.shell)
        : isWin ? 'powershell' : '/bin/bash';
      const shellArgs = isWin
        ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]
        : ['-c', command];

      let stdout = '';
      let stderr = '';

      const child = spawn(shell, shellArgs, {
        cwd: workdir,
        env: { ...process.env, TERM: 'dumb' },
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
            command,
            workdir,
          },
        });
      });

      child.on('error', (e) => {
        resolve({
          content: `Failed to execute command: ${e.message}`,
          success: false,
          details: { error: e.message, command },
        });
      });
    });
  },
);
