// ====== Knowledge Routes ======
// Full CRUD + LLM-powered "learn" endpoint for the user's personal knowledge base.
// Knowledge entries are stored in data/knowledge/{userId}.jsonl (separate from core code).
// Supports file upload learning: PDF, Word, MD, HTML, TXT, CSV, etc.

import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { ah, requireAuth, sendOk, sendErr } from '../middleware.js';
import { store } from '../store.js';
import { apiKeyStorage, MASKED_KEY } from '../apikeys.js';
import {
  getRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  searchRecords,
  getTreeStructure,
  countRecords,
} from '../knowledge-store.js';
import { dataDir } from '../storage.js';
import { extractTextFromFile } from '../file-extractor.js';
import type { LLMClientConfig } from '../llm/client.js';
import { streamChatCompletion } from '../llm/client.js';
import type { LLMMessage } from '../llm/types.js';
import { buildExtraBody } from '../models/provider-config.js';

// ---------------------------------------------------------------------------
// Chunked LLM learning utilities
// ---------------------------------------------------------------------------
// When the extracted text is very long (e.g. a 200-page PDF → 100k+ chars),
// feeding it to the LLM in a single message will exceed the model's context
// window and fail with a 400 error.
//
// Strategy (map-reduce):
// 1. Split text into ~8000-char chunks at paragraph boundaries.
// 2. MAP: For each chunk, ask the LLM to extract knowledge independently.
// 3. REDUCE: Merge all chunk summaries into one final structured entry.
// 4. If only 1 chunk, skip the reduce step.
// ---------------------------------------------------------------------------

/** Maximum chars per chunk for the map phase. ~8000 chars ≈ ~2000 tokens. */
const CHUNK_SIZE = 8000;

/** Split text into chunks at paragraph boundaries, each ≤ CHUNK_SIZE chars. */
function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];

  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    // If a single paragraph is longer than CHUNK_SIZE, split it at sentence
    // boundaries or hard-wrap it.
    if (para.length > CHUNK_SIZE) {
      // Flush current chunk first.
      if (current.trim()) { chunks.push(current); current = ''; }
      // Split long paragraph into sentence-sized pieces.
      const sentences = para.match(/[^.!?。！？]+[.!?。！？]*/g) || [para];
      let sChunk = '';
      for (const s of sentences) {
        if (sChunk.length + s.length > CHUNK_SIZE) {
          if (sChunk) chunks.push(sChunk);
          // If a single sentence exceeds CHUNK_SIZE, hard-wrap it.
          if (s.length > CHUNK_SIZE) {
            for (let i = 0; i < s.length; i += CHUNK_SIZE) {
              chunks.push(s.slice(i, i + CHUNK_SIZE));
            }
            sChunk = '';
          } else {
            sChunk = s;
          }
        } else {
          sChunk += s;
        }
      }
      if (sChunk) { current = sChunk; }
      continue;
    }

    if (current.length + para.length + 2 > CHUNK_SIZE) {
      if (current.trim()) chunks.push(current);
      current = para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

const LEARN_SYSTEM_PROMPT = `You are a knowledge extraction assistant. The user provides raw material (text extracted from a document, notes, conversation, etc).
You must analyze the content and produce a structured knowledge entry in JSON format.

Output format (JSON only, no markdown, no explanation):
{
  "title": "A concise, descriptive title (max 80 chars)",
  "category": "One of: Chemistry, Simulation, Methodology, Workflow, Tool, Reference, General",
  "tags": ["relevant", "keywords"],
  "summary": "A 2-3 sentence summary of the key knowledge",
  "content": "The well-organized knowledge content in Markdown format. Include key points, formulas, steps, or references. Preserve important details but remove noise."
}

Rules:
- Extract the CORE knowledge, not the conversation wrapper or file metadata
- Use Markdown formatting for readability
- Preserve technical details (parameters, values, code snippets, formulas) intact
- Tags should be lowercase English keywords
- The content should be self-contained — someone reading it later should understand without the original file
- If the content is a paper/research, extract the methodology, results, and conclusions
- If the content is a manual/guide, extract the instructions and key parameters`;

const REDUCE_SYSTEM_PROMPT = `You are a knowledge synthesis assistant. The user has extracted knowledge from multiple sections of a large document. You must merge these partial extractions into a single coherent knowledge entry.

Output format (JSON only, no markdown, no explanation):
{
  "title": "A concise, descriptive title for the overall knowledge (max 80 chars)",
  "category": "One of: Chemistry, Simulation, Methodology, Workflow, Tool, Reference, General",
  "tags": ["relevant", "keywords"],
  "summary": "A 2-3 sentence summary of the overall key knowledge",
  "content": "The well-organized, consolidated knowledge content in Markdown format. Merge overlapping points, remove duplicates, and preserve all unique technical details."
}

Rules:
- Merge and deduplicate the knowledge from all sections
- Organize the content logically (not in the order of the sections)
- Preserve all technical details, formulas, parameters, and code snippets
- Tags should be lowercase English keywords
- The final content should be self-contained and coherent`;

/**
 * Learn from a long text using map-reduce chunking.
 *
 * - Short text (≤ 1 chunk): single LLM call, same as before.
 * - Long text (> 1 chunk): MAP each chunk → REDUCE all summaries into one entry.
 *
 * Returns the parsed JSON object (or throws on failure).
 */
async function learnWithLLM(
  llmConfig: LLMClientConfig,
  text: string,
  label: string,
): Promise<{ title: string; category: string; tags: string[]; summary: string; content: string }> {
  const chunks = chunkText(text);
  console.log(`[knowledge] learnWithLLM: ${chunks.length} chunk(s) for "${label}" (${text.length} chars total)`);

  // ---- MAP: extract knowledge from each chunk ----
  const partialResults: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkLabel = chunks.length > 1
      ? `${label} (part ${i + 1}/${chunks.length})`
      : label;
    const messages: LLMMessage[] = [
      { role: 'system', content: LEARN_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Please learn the following material and create a knowledge entry:\n\n--- ${chunkLabel} ---\n${chunks[i]}\n---`,
      },
    ];
    const result = await streamChatCompletion(llmConfig, messages, [], {}, undefined);
    const output = result.content.trim();
    if (output) {
      partialResults.push(output);
    } else {
      console.warn(`[knowledge] chunk ${i + 1}/${chunks.length} returned empty output`);
    }
  }

  // If only one chunk (or all chunks but only one had content), return it directly.
  if (partialResults.length <= 1) {
    const raw = partialResults[0] || '';
    return parseLearnOutput(raw, text);
  }

  // ---- REDUCE: merge all partial results into one ----
  console.log(`[knowledge] learnWithLLM: reducing ${partialResults.length} partial results`);
  const reduceMessages: LLMMessage[] = [
    { role: 'system', content: REDUCE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Below are ${partialResults.length} knowledge extractions from different sections of a large document. Please merge them into a single coherent knowledge entry:\n\n${partialResults.map((p, i) => `--- Section ${i + 1} ---\n${p}`).join('\n\n')}\n---`,
    },
  ];
  const reduceResult = await streamChatCompletion(llmConfig, reduceMessages, [], {}, undefined);
  return parseLearnOutput(reduceResult.content.trim(), text);
}

/** Parse the LLM JSON output, with fallback. */
function parseLearnOutput(llmOutput: string, fallbackText: string): {
  title: string; category: string; tags: string[]; summary: string; content: string;
} {
  let parsed: any;
  try {
    const cleaned = llmOutput.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    // Not valid JSON — wrap raw output as content.
    parsed = { title: '', category: 'General', tags: [], summary: '', content: llmOutput };
  }
  return {
    title: parsed.title || '',
    category: parsed.category || 'General',
    tags: parsed.tags || [],
    summary: parsed.summary || '',
    content: parsed.content || parsed.summary || llmOutput || fallbackText.slice(0, 5000),
  };
}


export function knowledgeRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  // Multer config for file upload learning
  const knowledgeUploadDir = path.join(dataDir(), 'uploads', 'knowledge');
  fs.mkdirSync(knowledgeUploadDir, { recursive: true });
  const knowledgeStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, knowledgeUploadDir),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
      cb(null, `${Date.now().toString(36)}-${safe}`);
    },
  });
  const upload = multer({
    storage: knowledgeStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  });

  // GET / — list all knowledge entries (with optional pagination + tree meta)
  // Query: ?offset=0&limit=0 (limit=0 means all) &parentPath=...&importance=0
  r.get('/', ah(async (req, res) => {
    const offset = parseInt((req.query.offset as string) || '0', 10) || 0;
    const limit = parseInt((req.query.limit as string) || '0', 10) || 0;
    const parentPath = (req.query.parentPath as string) || undefined;
    const importanceRaw = req.query.importance as string | undefined;
    const importance = importanceRaw !== undefined ? parseInt(importanceRaw, 10) : undefined;

    // Load all records once (cached after first load)
    const all = getRecords(req.userId!);

    // Apply hierarchical filter if requested
    let records = all;
    if (parentPath) {
      const pp = parentPath.toLowerCase();
      records = records.filter((r) => (r.parentPath || '').toLowerCase().startsWith(pp));
    }
    if (importance !== undefined) {
      records = records.filter((r) => (r.importance || 0) >= importance);
    }

    // Apply pagination
    const paged = limit > 0 ? records.slice(offset, offset + limit) : (offset > 0 ? records.slice(offset) : records);

    return sendOk(res, {
      records: paged,
      total: records.length,
      tree: getTreeStructure(req.userId!),
    });
  }));

  // GET /tree — get hierarchical tree structure of knowledge entries
  r.get('/tree', ah(async (req, res) => {
    const tree = getTreeStructure(req.userId!);
    return sendOk(res, tree);
  }));

  // GET /search?q=... — search knowledge entries
  // Query: ?q=...&parentPath=...&importance=0
  r.get('/search', ah(async (req, res) => {
    const q = ((req.query.q as string) || '').trim();
    const parentPath = (req.query.parentPath as string) || undefined;
    const importanceRaw = req.query.importance as string | undefined;
    const importance = importanceRaw !== undefined ? parseInt(importanceRaw, 10) : undefined;
    const records = searchRecords(req.userId!, q, 20, {
      ...(parentPath ? { parentPath } : {}),
      ...(importance !== undefined ? { importance } : {}),
    });
    return sendOk(res, records);
  }));

  // GET /:id — get a single entry
  r.get('/:id', ah(async (req, res) => {
    const records = getRecords(req.userId!);
    const e = records.find((x) => x.id === req.params.id);
    if (!e) return sendErr(res, 'NOT_FOUND', 'Knowledge entry not found', 404);
    return sendOk(res, e);
  }));

  // POST / — create a knowledge entry manually
  // Body: { title, category?, content, tags?, parentPath?, importance? }
  r.post('/', ah(async (req, res) => {
    const { title, category, content, tags, parentPath, importance } = req.body || {};
    if (!title || !content) {
      return sendErr(res, 'BAD_REQUEST', 'title and content are required', 400);
    }
    const record = createRecord(req.userId!, {
      title,
      category: category || 'General',
      content,
      tags: tags || [],
      source: 'manual',
      learned: true,
      ...(parentPath !== undefined ? { parentPath } : {}),
      ...(importance !== undefined ? { importance: Number(importance) } : {}),
    });
    return sendOk(res, record);
  }));

  // POST /learn — Learn raw material into a knowledge entry using LLM
  // Body: { content: string, source?: 'upload'|'chat', title?: string, parentPath?: string, importance?: number }
  // The LLM analyzes the content and generates a structured knowledge entry.
  r.post('/learn', ah(async (req, res) => {
    const { content: rawContent, source, title: hintTitle, parentPath, importance } = req.body || {};
    if (!rawContent || rawContent.trim().length < 10) {
      return sendErr(res, 'BAD_REQUEST', 'Content too short to learn (min 10 chars)', 400);
    }

    // Resolve LLM config from user's configured models.
    const llmConfig = resolveLLM(req.userId!);
    if (!llmConfig) {
      // No model configured — store as-is without LLM processing.
      const record = createRecord(req.userId!, {
        title: hintTitle || rawContent.slice(0, 50) + '...',
        category: 'Unprocessed',
        content: rawContent,
        tags: ['unprocessed'],
        source: source || 'upload',
        rawContent,
        learned: false,
        ...(parentPath !== undefined ? { parentPath } : {}),
        ...(importance !== undefined ? { importance: Number(importance) } : {}),
      });
      return sendOk(res, { record, learned: false, message: 'No model configured — saved raw content without LLM processing.' });
    }

    try {
      // Learn from the content using map-reduce chunking (handles long texts).
      const learned = await learnWithLLM(llmConfig, rawContent, hintTitle || 'pasted text');

      const record = createRecord(req.userId!, {
        title: learned.title || hintTitle || 'Untitled',
        category: learned.category || 'General',
        content: learned.content,
        tags: learned.tags,
        source: source || 'upload',
        rawContent,
        learned: true,
        ...(parentPath !== undefined ? { parentPath } : {}),
        ...(importance !== undefined ? { importance: Number(importance) } : {}),
      });

      return sendOk(res, { record, learned: true, message: 'Knowledge learned successfully.' });
    } catch (e: any) {
      console.error('[knowledge] learn failed:', e.message);
      // On LLM failure, store raw content
      const record = createRecord(req.userId!, {
        title: hintTitle || rawContent.slice(0, 50) + '...',
        category: 'Error',
        content: rawContent,
        tags: ['learn-failed'],
        source: source || 'upload',
        rawContent,
        learned: false,
        ...(parentPath !== undefined ? { parentPath } : {}),
        ...(importance !== undefined ? { importance: Number(importance) } : {}),
      });
      return sendOk(res, { record, learned: false, message: `LLM learning failed: ${e.message}. Saved raw content.` });
    }
  }));

  // POST /learn-chat — Learn from a completed chat session
  // Body: { sessionId: string, messages: Array<{role, content}>, parentPath?: string, importance?: number }
  r.post('/learn-chat', ah(async (req, res) => {
    const { sessionId, messages, parentPath, importance } = req.body || {};
    if (!messages || !Array.isArray(messages) || messages.length < 2) {
      return sendErr(res, 'BAD_REQUEST', 'At least 2 messages are required', 400);
    }

    // Build conversation transcript for LLM
    const transcript = messages
      .map((m: any) => `[${m.role === 'user' ? '用户' : '助手'}]: ${m.content || ''}`)
      .join('\n\n');

    // Delegate to the same learn logic
    const llmConfig = resolveLLM(req.userId!);
    if (!llmConfig) {
      const record = createRecord(req.userId!, {
        title: `对话记录 ${sessionId.slice(-8)}`,
        category: 'Chat',
        content: transcript,
        tags: ['chat', 'unprocessed'],
        source: 'chat',
        rawContent: transcript,
        learned: false,
        ...(parentPath !== undefined ? { parentPath } : {}),
        ...(importance !== undefined ? { importance: Number(importance) } : {}),
      });
      return sendOk(res, { record, learned: false, message: 'No model — saved raw transcript.' });
    }

    try {
      // Learn from the conversation transcript using map-reduce chunking.
      const learned = await learnWithLLM(llmConfig, transcript, `对话记录 ${sessionId.slice(-8)}`);

      if (!learned.content || learned.content.trim() === '') {
        return sendOk(res, { record: null, learned: true, message: 'Conversation contained no significant knowledge to extract.' });
      }

      const record = createRecord(req.userId!, {
        title: learned.title || `对话记录 ${sessionId.slice(-8)}`,
        category: learned.category || 'Chat',
        content: learned.content,
        tags: learned.tags.length > 0 ? learned.tags : ['chat'],
        source: 'chat',
        rawContent: transcript,
        learned: true,
        ...(parentPath !== undefined ? { parentPath } : {}),
        ...(importance !== undefined ? { importance: Number(importance) } : {}),
      });

      return sendOk(res, { record, learned: true, message: 'Chat learned to knowledge base.' });
    } catch (e: any) {
      console.error('[knowledge] learn-chat failed:', e.message);
      const record = createRecord(req.userId!, {
        title: `对话记录 ${sessionId.slice(-8)}`,
        category: 'Chat',
        content: transcript,
        tags: ['chat', 'learn-failed'],
        source: 'chat',
        rawContent: transcript,
        learned: false,
        ...(parentPath !== undefined ? { parentPath } : {}),
        ...(importance !== undefined ? { importance: Number(importance) } : {}),
      });
      return sendOk(res, { record, learned: false, message: `Learning failed: ${e.message}` });
    }
  }));

  // PUT /:id — update a knowledge entry
  // Body: { title?, category?, content?, tags?, parentPath?, importance? }
  r.put('/:id', ah(async (req, res) => {
    const { title, category, content, tags, parentPath, importance } = req.body || {};
    const updated = updateRecord(req.userId!, req.params.id, {
      ...(title !== undefined ? { title } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(parentPath !== undefined ? { parentPath } : {}),
      ...(importance !== undefined ? { importance: Number(importance) } : {}),
    });
    if (!updated) return sendErr(res, 'NOT_FOUND', 'Knowledge entry not found', 404);
    return sendOk(res, updated);
  }));

  // DELETE /:id — delete a knowledge entry
  r.delete('/:id', ah(async (req, res) => {
    const ok = deleteRecord(req.userId!, req.params.id);
    if (!ok) return sendErr(res, 'NOT_FOUND', 'Knowledge entry not found', 404);
    return sendOk(res, { deleted: true });
  }));

  // POST /learn-file — Upload a file and learn from it
  // Accepts multipart/form-data with a file field
  // Supported: .txt, .md, .html, .htm, .csv, .json, .xml, .yaml, .yml,
  //            .pdf, .docx, .doc, .pptx, .xlsx, .tex, .rtf, .log, .py, .js, .ts, etc.
  r.post('/learn-file', upload.single('file'), ah(async (req, res) => {
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) {
      return sendErr(res, 'BAD_REQUEST', 'No file uploaded. Use multipart/form-data with a "file" field.', 400);
    }

    const hintTitle = (req.body.title as string) || file.originalname.replace(/\.[^.]+$/, '');
    const parentPath = (req.body.parentPath as string) || undefined;
    const importanceRaw = req.body.importance as string | undefined;
    const importance = importanceRaw !== undefined ? Number(importanceRaw) : undefined;
    const ext = path.extname(file.originalname).toLowerCase();

    // Extract text content from the file based on its type.
    // (PDFs are extracted locally via PyMuPDF — no external LLM involved.)
    let extractedText: string;
    try {
      extractedText = await extractTextFromFile(file.path, ext, file.mimetype);
    } catch (e: any) {
      // Clean up uploaded file on error
      try { fs.unlinkSync(file.path); } catch {}
      return sendErr(res, 'UNSUPPORTED_FILE', `Failed to extract text from ${file.originalname}: ${e.message}`, 400);
    }

    // Clean up: delete the uploaded file after extraction (we only keep text)
    try { fs.unlinkSync(file.path); } catch {}

    if (extractedText.trim().length < 10) {
      return sendErr(res, 'BAD_REQUEST', `Extracted text from ${file.originalname} is too short (min 10 chars). The file might be empty, scanned (needs OCR), or in a binary format.`, 400);
    }

    // Now learn from the extracted text (reuse the learn logic)
    const llmConfig = resolveLLM(req.userId!);
    if (!llmConfig) {
      const record = createRecord(req.userId!, {
        title: hintTitle,
        category: 'Unprocessed',
        content: extractedText,
        tags: ['unprocessed', ext.slice(1)],
        source: 'upload',
        rawContent: extractedText,
        learned: false,
        ...(parentPath !== undefined ? { parentPath } : {}),
        ...(importance !== undefined ? { importance } : {}),
      });
      return sendOk(res, { record, learned: false, message: `No model configured — saved extracted text from ${file.originalname} without LLM processing.` });
    }

    try {
      // Learn from the extracted text using map-reduce chunking (handles long documents).
      const learned = await learnWithLLM(llmConfig, extractedText, file.originalname);

      const record = createRecord(req.userId!, {
        title: learned.title || hintTitle,
        category: learned.category || 'General',
        content: learned.content,
        tags: learned.tags.length > 0 ? learned.tags : [ext.slice(1)],
        source: 'upload',
        rawContent: extractedText,
        learned: true,
        ...(parentPath !== undefined ? { parentPath } : {}),
        ...(importance !== undefined ? { importance } : {}),
      });

      return sendOk(res, { record, learned: true, message: `Successfully learned from ${file.originalname}.` });
    } catch (e: any) {
      console.error('[knowledge] learn-file failed:', e.message);
      const record = createRecord(req.userId!, {
        title: hintTitle,
        category: 'Error',
        content: extractedText,
        tags: ['learn-failed', ext.slice(1)],
        source: 'upload',
        rawContent: extractedText,
        learned: false,
        ...(parentPath !== undefined ? { parentPath } : {}),
        ...(importance !== undefined ? { importance } : {}),
      });
      return sendOk(res, { record, learned: false, message: `LLM learning failed: ${e.message}. Saved extracted text.` });
    }
  }));

  return r;
}

/** Resolve LLM config for knowledge learning (uses user's default model). */
function resolveLLM(userId: string): LLMClientConfig | undefined {
  const data = store.data(userId);
  const models = data.configuredModels;
  if (models.length === 0) return undefined;

  const model = models.find((m) => m.isDefault) || models[0];
  const realKey = apiKeyStorage.get(userId, model.id);
  if (!realKey || realKey === MASKED_KEY) return undefined;

  const config: LLMClientConfig = {
    apiUrl: model.apiUrl,
    apiKey: realKey,
    model: model.name,
    provider: model.provider || '',
    temperature: 0.3, // Lower temperature for structured extraction
    ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
  };

  const extraBody = buildExtraBody(model.provider || '', false);
  if (extraBody) config.extraBody = extraBody;

  return config;
}
