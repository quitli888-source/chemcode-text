// ====== File Text Extractor ======
// Extracts plain text from various file formats for knowledge base learning.
// Supports: txt, md, html, csv, json, xml, yaml, pdf, docx, doc, pptx, xlsx,
//           tex, rtf, log, py, js, ts, and other text-based formats.
//
// PDF: extracted LOCALLY (no external LLM) via a Python script (scripts/pdf_extract.py)
//       built on PyMuPDF (fitz). Normal PDFs use the embedded text layer; scanned
//       pages are OCR'd with the local Tesseract binary if it is installed.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Extract text content from a file based on its extension.
 * @param filePath Absolute path to the file
 * @param ext File extension (lowercase, with dot, e.g. ".pdf")
 * @param mimeType Optional MIME type
 * @returns Extracted plain text
 */
export async function extractTextFromFile(
  filePath: string,
  ext: string,
  mimeType?: string,
): Promise<string> {
  // Text-based formats — read directly as UTF-8
  const textExts = new Set([
    '.txt', '.md', '.markdown', '.rst', '.log',
    '.csv', '.tsv',
    '.json', '.jsonl', '.ndjson',
    '.xml', '.svg', '.rss', '.atom',
    '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
    '.html', '.htm', '.xhtml',
    '.tex', '.bibtex', '.bib',
    '.rtf',
    '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.c', '.cpp', '.h', '.hpp',
    '.cs', '.go', '.rs', '.rb', '.php', '.pl', '.lua', '.r', '.m', '.jl',
    '.sh', '.bash', '.zsh', '.fish', '.bat', '.cmd', '.ps1',
    '.sql', '.graphql', '.gql',
    '.css', '.scss', '.sass', '.less',
    '.env', '.gitignore', '.dockerfile', '.makefile',
    '.f', '.f90', '.f95', '.f03',
  ]);

  if (textExts.has(ext)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return cleanText(content);
  }

  // PDF — extracted locally via scripts/pdf_extract.py (PyMuPDF), no external LLM
  if (ext === '.pdf') {
    return extractPdf(filePath);
  }

  // Word .docx — use mammoth
  if (ext === '.docx') {
    return extractDocx(filePath);
  }

  // Word .doc (legacy binary) — best effort with binary read
  if (ext === '.doc') {
    return extractLegacyDoc(filePath);
  }

  // PowerPoint .pptx — extract text from XML inside zip
  if (ext === '.pptx') {
    return extractPptx(filePath);
  }

  // Excel .xlsx — extract text from shared strings
  if (ext === '.xlsx') {
    return extractXlsx(filePath);
  }

  // RTF — basic text extraction
  if (ext === '.rtf') {
    const content = fs.readFileSync(filePath, 'utf-8');
    return cleanRtf(content);
  }

  // HTML — strip tags
  if (ext === '.html' || ext === '.htm' || ext === '.xhtml') {
    const content = fs.readFileSync(filePath, 'utf-8');
    return cleanHtml(content);
  }

  // Fallback: try reading as UTF-8 text
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Check if it looks like text (no excessive null bytes)
    const nullCount = (content.match(/\0/g) || []).length;
    if (nullCount < content.length * 0.01) {
      return cleanText(content);
    }
    throw new Error(`Binary file format (${ext}) is not supported for text extraction.`);
  } catch (e: any) {
    throw new Error(`Cannot extract text from ${ext} files: ${e.message}`);
  }
}

/** Clean up text: remove excessive whitespace, BOM, etc. */
function cleanText(text: string): string {
  return text
    .replace(/^\uFEFF/, '') // Remove BOM
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/\r/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n') // Reduce excessive blank lines
    .trim();
}

/** Extract text from HTML by stripping tags */
function cleanHtml(html: string): string {
  return html
    // Remove script and style content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Convert block elements to newlines
    .replace(/<(p|div|br|tr|h[1-6]|li|dt|dd)[^>]*>/gi, '\n')
    // Remove all tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Basic RTF text extraction */
function cleanRtf(rtf: string): string {
  return rtf
    // Remove RTF control words
    .replace(/\\[a-z]+-?\d+ ?/gi, '')
    .replace(/\\[a-z]+ ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\\\*\\[^ ]+/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract text from PDF — LOCALLY, without any external LLM.
 *
 * Delegates to scripts/pdf_extract.py (PyMuPDF). PyMuPDF reads the embedded
 * text layer for normal PDFs and OCRs scanned pages with the local Tesseract
 * binary when available. All pages are processed (no truncation).
 */
async function extractPdf(filePath: string): Promise<string> {
  try {
    const script = path.join(projectRoot(), 'scripts', 'pdf_extract.py');
    const raw = await runPythonScript(script, [filePath]);
    const text = cleanText(raw);
    if (text.length < 10) {
      throw new Error('PDF produced too little text (possibly encrypted, empty, or fully scanned without Tesseract OCR available).');
    }
    return text;
  } catch (e: any) {
    throw new Error(`PDF extraction failed (local PyMuPDF): ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Local Python helper (used for PDF extraction)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Project root: file-extractor.ts lives in <root>/server/src. */
function projectRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

/** Locate a usable Python interpreter. */
function findPython(): string | null {
  const candidates = [
    process.env.PYTHON_EXECUTABLE,
    process.env.PYTHON_PATH,
    'python3',
    'python',
    // Managed WorkBuddy binary locations (Windows)
    'C:\\Users\\cysja\\.workbuddy\\binaries\\python\\envs\\default\\Scripts\\python.exe',
    'C:\\Users\\cysja\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe',
    // Common Windows locations
    'C:\\Python313\\python.exe',
    'C:\\Python312\\python.exe',
    'C:\\Python311\\python.exe',
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const res = spawnSync(candidate, ['--version'], { timeout: 5000, windowsHide: true });
      // res.error => binary not found. status 0 + "Python" in output => usable.
      // (Windows may resolve `python` to the Microsoft Store stub, which exits
      // non-zero and is NOT a real interpreter — skip those.)
      if (res.error || res.status !== 0) continue;
      const out = `${res.stdout || ''}${res.stderr || ''}`;
      if (/Python\s+\d+\.\d+/i.test(out)) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

/** Run a Python script and return its stdout as a string. */
function runPythonScript(scriptPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const py = findPython();
    if (!py) {
      reject(new Error('Python interpreter not found. Install Python 3 or set the PYTHON_EXECUTABLE env var.'));
      return;
    }
    if (!fs.existsSync(scriptPath)) {
      reject(new Error(`PDF extractor script not found at ${scriptPath}`));
      return;
    }

    const child = spawn(py, [scriptPath, ...args], { windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`extractor exited with code ${code}: ${stderr.slice(0, 300)}`));
      }
    });
  });
}

/** Extract text from .docx using mammoth */
async function extractDocx(filePath: string): Promise<string> {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return cleanText(result.value || '');
  } catch {
    throw new Error('DOCX parsing failed. The file might be corrupted.');
  }
}

/** Best-effort extraction from legacy .doc files */
function extractLegacyDoc(filePath: string): string {
  // Legacy .doc is a complex binary format.
  // We do a best-effort extraction by reading the binary and filtering printable text.
  const buffer = fs.readFileSync(filePath);
  let text = '';
  let currentWord = '';
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    // Printable ASCII range + common whitespace
    if ((byte >= 0x20 && byte <= 0x7e) || byte === 0x0a || byte === 0x0d || byte === 0x09) {
      currentWord += String.fromCharCode(byte);
    } else {
      if (currentWord.length > 3) {
        text += currentWord + ' ';
      }
      currentWord = '';
    }
  }
  if (currentWord.length > 3) text += currentWord;
  const cleaned = cleanText(text);
  if (cleaned.length < 20) {
    throw new Error('Legacy .doc extraction yielded too little text. Please convert to .docx or .txt first.');
  }
  return cleaned;
}

/** Extract text from .pptx by reading sharedStrings and slide XML */
function extractPptx(filePath: string): string {
  // PPTX is a ZIP file containing XML slides.
  // We use a basic approach: read the ZIP as binary and extract text from XML.
  const buffer = fs.readFileSync(filePath);
  const text = buffer.toString('binary');

  // Extract <a:t> tag contents (PowerPoint text runs)
  const matches = text.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
  const extracted = matches
    .map((m) => m.replace(/<[^>]+>/g, '').trim())
    .filter((t) => t.length > 0)
    .join('\n');

  const cleaned = cleanText(decodeXmlEntities(extracted));
  if (cleaned.length < 10) {
    throw new Error('PPTX extraction yielded no text. The file might be image-only.');
  }
  return cleaned;
}

/** Extract text from .xlsx by reading shared strings */
function extractXlsx(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  const text = buffer.toString('binary');

  // Extract <t> tag contents (Excel shared strings)
  const matches = text.match(/<t[^>]*>([^<]*)<\/t>/g) || [];
  const extracted = matches
    .map((m) => m.replace(/<[^>]+>/g, '').trim())
    .filter((t) => t.length > 0)
    .join('\n');

  const cleaned = cleanText(decodeXmlEntities(extracted));
  if (cleaned.length < 10) {
    throw new Error('XLSX extraction yielded no text. The file might be empty.');
  }
  return cleaned;
}

/** Decode common XML entities */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
