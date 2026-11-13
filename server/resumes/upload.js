import { createHash, randomUUID } from 'node:crypto';
import multer from 'multer';
import { fail, isDuplicate, rateLimit } from '../http.js';
import { Resume, UploadBatch, recordAudit } from './models.js';
import { inspectFile } from './file.js';
import { DocumentError } from './errors.js';

export function uploadHandler(config, authConfig, storage) {
  const receive = multer({ storage: multer.memoryStorage(),
    limits: { files: 1, fields: 0, parts: 2, fileSize: config.maxFile + 1 } }).single('file');
  let inFlight = 0;

  return async (req, res) => {
    const { organization, batch, slot } = req.upload;
    if (!storage || !config.redisUrl || (config.requireScan && !config.clamHost)) {
      fail(503, 'Configure private storage, Redis, and any required scanner before uploading.', 'RESUME_UNAVAILABLE');
    }
    if (inFlight >= config.uploads) fail(429, 'Upload capacity is busy. Retry shortly.', 'UPLOAD_BUSY');
    inFlight++;
    try {
      await rateLimit(authConfig, 'resume-upload', req.user.id, 4000, 60 * 60_000);
      const manifest = batch.files[slot];
      const filter = { organization, batch: batch._id, slot };
      let row = await Resume.findOne(filter).select('+storageKey');
      if (row && !['uploading', 'upload_failed', 'deleted', 'deleting'].includes(row.parsingStatus)) {
        req.resume(); // Drain retransmitted bodies without parsing them.
        return res.json({ id: row.id, status: row.parsingStatus });
      }
      const lease = randomUUID();
      const storageKey = 'resumes/' + organization + '/' + lease;
      const upload = { lease, storageKey, leaseUntil: new Date(Date.now() + 120_000), parsingStatus: 'uploading' };
      if (!row) {
        try {
          row = await Resume.create({ ...filter, ...upload, job: batch.job, originalFilename: manifest.name, fileSize: manifest.size });
        } catch (error) {
          if (isDuplicate(error)) fail(409, 'This file is already being uploaded. Retry shortly.', 'UPLOAD_IN_PROGRESS');
          throw error;
        }
      } else {
        if (row.parsingStatus !== 'upload_failed' || row.storageKey) {
          fail(409, 'This upload is unavailable or still being cleaned up. Retry shortly.', 'UPLOAD_IN_PROGRESS');
        }
        row = await Resume.findOneAndUpdate({ ...filter, parsingStatus: 'upload_failed', storageKey: { $exists: false } },
          { $set: upload, $unset: { errorDetails: 1 } }, { returnDocument: 'after' });
        if (!row) fail(409, 'Another upload is already in progress.', 'UPLOAD_IN_PROGRESS');
      }
      const own = { ...filter, _id: row._id, lease, parsingStatus: 'uploading' };
      let attemptedStorage = false;
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { req.destroy(); abort(); }, 65_000);
          const abort = () => { clearTimeout(timer); reject(new Error('Upload interrupted.')); };
          req.once('aborted', abort);
          receive(req, res, error => {
            clearTimeout(timer);
            req.off('aborted', abort);
            if (error) reject(error);
            else resolve();
          });
        });
        if (!req.file || req.file.size !== manifest.size) throw new DocumentError('File size does not match the batch manifest.');
        const bytes = req.file.buffer;
        const mimeType = await inspectFile(bytes, manifest.name);
        if (!await UploadBatch.exists({ _id: batch._id, organization, cancelledAt: null, expiresAt: { $gt: new Date() } })) {
          throw new DocumentError('This batch was cancelled or expired.');
        }
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        let existing = await Resume.findOne({ organization, uniqueHash: sha256 }).select('_id').lean();
        const now = new Date();
        const details = { mimeType, sha256 };
        if (!existing) {
          attemptedStorage = true;
          await storage.put(storageKey, bytes, mimeType);
          try {
            const updated = await Resume.updateOne(own, { $set: {
              ...details, uniqueHash: sha256, storedAt: now, parsingStatus: 'pending'
            }, $unset: { lease: 1, leaseUntil: 1 } });
            if (!updated.modifiedCount) throw new Error('Upload lease was lost.');
          } catch (error) {
            if (!isDuplicate(error)) throw error;
            existing = await Resume.findOne({ organization, uniqueHash: sha256 }).select('_id').lean();
            if (!existing) throw new Error('Duplicate state changed.');
          }
        }
        if (existing) {
          const updated = await Resume.updateOne(own, { $set: { ...details, duplicateOf: existing._id, parsingStatus: 'duplicate',
            ...(attemptedStorage && { nextCleanupAt: now }) },
            $unset: { lease: 1, leaseUntil: 1, ...(!attemptedStorage && { storageKey: 1 }) } });
          if (!updated.modifiedCount) throw new Error('Upload lease was lost.');
        }
        await recordAudit(organization, existing ? 'exact_duplicate' : 'upload', { actor: req.user._id, resume: row._id, batch: batch._id });
        res.status(201).json({ id: row.id, status: existing ? 'duplicate' : 'pending' });
      } catch (error) {
        const invalid = error instanceof DocumentError || error instanceof multer.MulterError;
        const message = error instanceof DocumentError ? error.message : error instanceof multer.MulterError ?
          'Upload must contain one file within the configured size limit.' : 'Upload interrupted or storage unavailable. Retry this file.';
        const changed = await Resume.updateOne(own, { $set: { parsingStatus: 'upload_failed', errorDetails: message,
          ...(attemptedStorage && { nextCleanupAt: new Date() }) },
          $unset: { lease: 1, leaseUntil: 1, ...(!attemptedStorage && { storageKey: 1 }) } });
        if (changed.modifiedCount && attemptedStorage) {
          try {
            await storage.remove(storageKey);
            await Resume.updateOne({ ...filter, storageKey, parsingStatus: 'upload_failed' }, { $unset: { storageKey: 1, nextCleanupAt: 1 } });
          } catch { /* Maintenance retries cleanup. */ }
        }
        fail(invalid ? 400 : 503, message, 'UPLOAD_FAILED');
      }
    } finally { inFlight--; }
  };
}
