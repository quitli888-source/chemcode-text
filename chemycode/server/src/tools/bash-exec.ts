// ====== bash_exec Tool ======
// Execute shell commands on the local machine.
// Follows OpenClaw's exec tool pattern (bash-tools.schemas.ts + bash-tools.exec.ts).
//
// Safety measures:
//   - Working directory isolation
//   - Abort signal support
// No timeout — runs until command completes or abort signal fires.
// No output size limit — full stdout/stderr returned.
//
// ⚠️ SECURITY WARNING: This tool executes arbitrary shell commands with the
// same privileges as the Gateway process. There is NO sandboxing. Only deploy
// this server in a trusted environment. Do NOT expose the Gateway port to the
// public internet without additional isolation (container, VM, or dedicated
// low-privilege user).

import { spawn } from 'node:child_process';
import path from 'node:path';
import { toolRegistry } from './registry.js';

/**
 * Deduplicate repeated error blocks in stderr output.
 * Python's numba/CUDA cleanup can produce 60+ identical Traceback+CudaAPIError
 * blocks, turning a 2KB error into 134KB. This collapses them.
 */
function dedupRepeatedBlocks(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;
  let dedupCount = 0;

  while (i < lines.length) {
    // Detect start of a repeated block (Traceback, CudaAPIError, or similar)
    if (/^(Traceback|CudaAPIError|RuntimeError|Error:)/.test(lines[i].trim())) {
      // Capture the full block (until next blank line or next Traceback)
      const blockStart = i;
      while (i < lines.length && lines[i].trim() !== '' &&
             !/^(Traceback|CudaAPIError|RuntimeError)/.test(lines[i].trim()) || i === blockStart) {
        i++;
        // Stop if we reach the next block start
        if (i > blockStart + 1 && /^(Traceback|CudaAPIError|RuntimeError)/.test(lines[i]?.trim() || '')) break;
      }
      const block = lines.slice(blockStart, i).join('\n');

      // Check if this block was just added (i.e. it's a repeat)
      const prevContent = result.join('\n');
      if (prevContent.endsWith(block)) {
        // Duplicate block - skip and count
        dedupCount++;
        continue;
      }

      // Check if the last N lines of result match this block
      const blockLines = block.split('\n');
      const lastN = result.slice(-blockLines.length).join('\n');
      if (lastN === block) {
        dedupCount++;
        continue;
      }

      result.push(block);
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  if (dedupCount > 0) {
    result.push(`\n--- [${dedupCount} repeated error block(s) omitted] ---`);
  }

  return result.join('\n');
}

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
    dangerous: true,
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

        // Deduplicate repeated error blocks (e.g. numba CUDA cleanup loops
        // that produce 60+ identical Traceback/CudaAPIError blocks).
        // Strategy: split into lines, detect consecutive identical blocks
        // starting with "Traceback" or "CudaAPIError", keep first + last,
        // insert a summary marker for omitted repetitions.
        if (stderr.length > 5000) {
          stderr = dedupRepeatedBlocks(stderr);
        }

        let output = '';
        if (stdout) output += stdout;
        if (stderr) output += (output ? '\n' : '') + stderr;

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
