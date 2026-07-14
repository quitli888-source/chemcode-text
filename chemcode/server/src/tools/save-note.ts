// ====== save_note Tool ======
// Allows the LLM to record test history and notes to the workspace's
// .chemcode-memory/ folder. This persists across the session so the
// user can see what was tested.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { toolRegistry } from './registry.js';

toolRegistry.register(
  {
    name: 'save_note',
    title: 'Save Note to Memory',
    description:
      'Record a note or test result to the workspace\'s .chemcode-memory/ folder. ' +
      'Use this to document what you tested, what worked, what failed, and any observations. ' +
      'The note is appended to .chemcode-memory/notes.md and also logged in history.log. ' +
      'Use this after completing each test or significant step.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short title for the note (e.g. "DPD AB diblock test 1").',
        },
        content: {
          type: 'string',
          description: 'The note content — describe what was tested, results, observations.',
        },
        category: {
          type: 'string',
          description: 'Category: "test", "result", "error", "observation", or "summary".',
        },
      },
      required: ['content'],
    },
    dangerous: false,
  },
  async (params, ctx) => {
    const workdir = ctx.workdir;
    if (!workdir) {
      return { content: 'Error: no workdir set for this session', success: false };
    }
    const memoryDir = path.join(workdir, '.chemcode-memory');
    try {
      // Ensure memory folder exists.
      if (!fs.existsSync(memoryDir)) {
        fs.mkdirSync(memoryDir, { recursive: true });
      }

      const now = new Date().toISOString();
      const title = String(params.title || 'Untitled note');
      const content = String(params.content);
      const category = String(params.category || 'note');

      // Append to notes.md
      const notesPath = path.join(memoryDir, 'notes.md');
      const noteEntry = `\n## [${now}] ${title}\n*Category: ${category}*\n\n${content}\n---\n`;
      fs.appendFileSync(notesPath, noteEntry, 'utf-8');

      // Append to history.log
      const historyPath = path.join(memoryDir, 'history.log');
      const logEntry = `[${now}] [${category}] ${title}: ${content.slice(0, 200).replace(/\n/g, ' ')}\n`;
      fs.appendFileSync(historyPath, logEntry, 'utf-8');

      return {
        content: `✅ Note saved to ${path.relative(workdir, notesPath)} (${content.length} chars)`,
        success: true,
        details: { notesPath, title, category, contentLength: content.length, timestamp: now },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: `Error saving note: ${msg}`, success: false };
    }
  },
);
