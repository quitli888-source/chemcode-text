import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { extractTextFromFile } from './file-extractor.js';

const tempFiles: string[] = [];

afterEach(() => {
  for (const file of tempFiles.splice(0)) {
    try { fs.unlinkSync(file); } catch { /* best effort */ }
  }
});

async function writeZip(ext: string, entries: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  const file = path.join(os.tmpdir(), `chemycode-extractor-${Date.now()}-${Math.random()}${ext}`);
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
  tempFiles.push(file);
  return file;
}

describe('Office archive extraction', () => {
  it('extracts text from compressed PPTX slide XML', async () => {
    const file = await writeZip('.pptx', {
      'ppt/slides/slide1.xml': '<p:sld xmlns:p="p" xmlns:a="a"><a:t>Hello compressed slide</a:t></p:sld>',
    });
    await expect(extractTextFromFile(file, '.pptx')).resolves.toContain('Hello compressed slide');
  });

  it('resolves XLSX shared strings through worksheet cells', async () => {
    const file = await writeZip('.xlsx', {
      'xl/sharedStrings.xml': '<sst><si><t>Hello spreadsheet</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="s"><v>0</v></c></row></sheetData></worksheet>',
    });
    await expect(extractTextFromFile(file, '.xlsx')).resolves.toContain('Hello spreadsheet');
  });
});
