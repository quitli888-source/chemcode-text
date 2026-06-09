// ====== Storage Directories ======

import fs from 'node:fs';
import path from 'node:path';

export function dataDir(): string {
  return process.env.CHEMYCODE_DATA_DIR
    || path.join(process.cwd(), 'data');
}

export async function ensureDataDirs(): Promise<void> {
  const dirs = [
    dataDir(),
    path.join(dataDir(), 'users'),
    path.join(dataDir(), 'uploads'),
  ];
  for (const d of dirs) {
    try { fs.mkdirSync(d, { recursive: true }); } catch {}
  }
}
