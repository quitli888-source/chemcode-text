// ====== Uploads Routes ======

import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { ah, requireAuth, sendOk, sendErr } from '../middleware.js';
import { dataDir } from '../storage.js';

const uploadRoot = path.join(dataDir(), 'uploads');
fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, `${Date.now().toString(36)}-${safe}`);
  },
});

const upload = multer({ storage });

export function uploadsRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post('/', upload.single('file'), ah(async (req, res) => {
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) return sendErr(res, 'INVALID_INPUT', 'file required', 400);
    return sendOk(res, {
      fileId: file.filename,
      filename: file.originalname,
      size: file.size,
      mimeType: file.mimetype || 'application/octet-stream',
      url: `/api/uploads/${file.filename}`,
    }, 201);
  }));

  r.get('/:fileId', ah(async (req, res) => {
    const safe = path.basename(req.params.fileId);
    const full = path.join(uploadRoot, safe);
    if (!full.startsWith(uploadRoot)) return sendErr(res, 'BAD_REQUEST', 'Invalid path', 400);
    if (!fs.existsSync(full)) return sendErr(res, 'NOT_FOUND', 'File not found', 404);
    res.sendFile(full);
  }));

  return r;
}
