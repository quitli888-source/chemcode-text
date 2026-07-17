// ====== file_read Tool ======
// Read file contents from the local filesystem.
// Follows OpenClaw's read tool pattern (pi-tools.read.ts).
// No size limit — for large files, use offset/limit to read in chunks.

import fs from 'node:fs';
import path from 'node:path';
import { toolRegistry } from './registry.js';

toolRegistry.register(
  {
    name: 'file_read',
    title: 'Read File',
    description: 'Read the contents of a file at the given path. Returns the text content. For large files, use offset/limit to read in chunks.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or relative path to the file to read.',
        },
        encoding: {
          type: 'string',
          description: 'Text encoding (default: utf-8).',
          enum: ['utf-8', 'ascii', 'base64'],
        },
        offset: {
          type: 'number',
          description: 'Line number to start reading from (1-indexed, optional).',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read (optional).',
        },
      },
      required: ['path'],
    },
  },
  async (params, ctx) => {
    const filePath = path.resolve(ctx.workdir, String(params.path));
    const encoding = (String(params.encoding || 'utf-8')) as BufferEncoding;

    // Security: reject paths that escape the workdir.
    const resolvedWorkdir = path.resolve(ctx.workdir);
    const isAbsolute = path.isAbsolute(String(params.path));
    if (!isAbsolute && !filePath.startsWith(resolvedWorkdir + path.sep) && filePath !== resolvedWorkdir) {
      return {
        content: `Access denied: path "${params.path}" escapes the working directory.`,
        success: false,
      };
    }

    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(filePath, { withFileTypes: true });
        const listing = entries.map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n');
        return { content: `Directory: ${filePath}\n${listing}`, success: true };
      }

      let content = fs.readFileSync(filePath, encoding);

      // Apply line offset/limit if specified.
      const offset = params.offset ? Number(params.offset) : undefined;
      const limit = params.limit ? Number(params.limit) : undefined;
      if (offset !== undefined || limit !== undefined) {
        const lines = content.split('\n');
        const start = (offset || 1) - 1; // 1-indexed to 0-indexed
        const sliced = lines.slice(start, limit !== undefined ? start + limit : undefined);
        content = sliced.join('\n');
      }

      return {
        content,
        success: true,
        details: { path: filePath, size: stat.size, encoding },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: `Failed to read "${filePath}": ${msg}`, success: false };
    }
  },
);
