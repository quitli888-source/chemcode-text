// ====== file_write Tool ======
// Write content to a file on the local filesystem.
// Follows OpenClaw's write tool pattern (pi-tools.read.ts createSandboxedWriteTool).
// No size limit — write as much as needed.

import fs from 'node:fs';
import path from 'node:path';
import { toolRegistry } from './registry.js';

toolRegistry.register(
  {
    name: 'file_write',
    title: 'Write File',
    description: 'Write content to a file. Creates parent directories if needed.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or relative path to the file to write.',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file.',
        },
        encoding: {
          type: 'string',
          description: 'Text encoding (default: utf-8).',
          enum: ['utf-8', 'ascii', 'base64'],
        },
        append: {
          type: 'boolean',
          description: 'If true, append to the file instead of overwriting.',
          default: false,
        },
      },
      required: ['path', 'content'],
    },
    dangerous: false,
  },
  async (params, ctx) => {
    const filePath = path.resolve(ctx.workdir, String(params.path));
    const content = String(params.content);
    const encoding = (String(params.encoding || 'utf-8')) as BufferEncoding;
    const append = params.append === true || params.append === 'true';

    try {
      // Create parent directories if they don't exist.
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });

      if (append) {
        fs.appendFileSync(filePath, content, encoding);
      } else {
        fs.writeFileSync(filePath, content, encoding);
      }

      const stat = fs.statSync(filePath);
      return {
        content: `File written: ${filePath} (${stat.size} bytes)`,
        success: true,
        details: { path: filePath, size: stat.size, append },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: `Failed to write "${filePath}": ${msg}`, success: false };
    }
  },
);
