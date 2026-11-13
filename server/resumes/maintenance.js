import { Candidate, Resume, UploadBatch, recordAudit } from './models.js';
import { enqueue, queueId } from './queue.js';
import { MatchingResult, MatchingVector } from '../matching/models.js';
import { Referral } from '../referrals/models.js';

const cleanup = { $unset: { storageKey: 1, nextCleanupAt: 1, lease: 1, leaseUntil: 1 } };

async function recoverQueue(config, queue) {
  const now = new Date();
  const pending = await Resume.find({ nextDispatchAt: { $not: { $gt: now } }, $or: [{ parsingStatus: 'pending' },
    { parsingStatus: 'processing', leaseUntil: { $lte: now } }] }).sort({ nextDispatchAt: 1, updatedAt: 1 }).limit(250)
    .select('organization generation attempts parsingStatus leaseUntil');
  for (const resume of pending) {
    const current = await queue.getJob(queueId(resume));
    const state = current && await current.getState();
    const scope = { _id: resume._id, organization: resume.organization, generation: resume.generation,
      parsingStatus: resume.parsingStatus, ...(resume.leaseUntil && { leaseUntil: resume.leaseUntil }) };
    if (state && !['failed', 'completed', 'unknown'].includes(state)) {
      await Resume.updateOne(scope, { $set: { nextDispatchAt: new Date(Date.now() + 60_000) } }, { timestamps: false });
      continue;
    }
    if (resume.attempts >= config.attempts) {
      await Resume.updateOne(scope, { $set: { parsingStatus: 'failed', errorDetails: 'Processing did not complete. Retry this file.' },
        $unset: { lease: 1, leaseUntil: 1 } });
      continue;
    }
    if (!current) {
      await enqueue(queue, config, resume);
      await Resume.updateOne(scope, { $set: { nextDispatchAt: new Date(Date.now() + 60_000) } }, { timestamps: false });
      continue;
    }
    const recovered = await Resume.findOneAndUpdate(scope, { $inc: { generation: 1 },
      $set: { parsingStatus: 'pending' }, $unset: { lease: 1, leaseUntil: 1 } }, { returnDocument: 'after' });
    if (recovered) await enqueue(queue, config, recovered);
  }
}

async function clearExpiredUploads(storage) {
  const now = new Date();
  await Resume.updateMany({ parsingStatus: 'uploading', leaseUntil: { $lte: now } }, {
    $set: { parsingStatus: 'upload_failed', errorDetails: 'Upload interrupted. Select the original file to retry.', nextCleanupAt: now },
    $unset: { lease: 1, leaseUntil: 1 }
  });
  const expired = await Resume.find({ parsingStatus: { $in: ['upload_failed', 'duplicate'] },
    nextCleanupAt: { $lte: now }, storageKey: { $exists: true } }).select('+storageKey').limit(100);
  for (const row of expired) {
    try {
      await storage.remove(row.storageKey);
      await Resume.updateOne({ _id: row._id, storageKey: row.storageKey, parsingStatus: row.parsingStatus }, cleanup);
    } catch { /* Keep the recorded key so the next sweep can retry. */ }
  }
}

async function clearDeleted(storage) {
  const rows = await Resume.find({ parsingStatus: 'deleting' }).select('+storageKey').limit(100);
  for (const row of rows) {
    try {
      if (row.storageKey) await storage.remove(row.storageKey);
      await Candidate.updateMany({ organization: row.organization, versionOf: row._id }, { $unset: { versionOf: 1 } });
      await Resume.updateMany({ organization: row.organization, duplicateOf: row._id },
        { $unset: { duplicateOf: 1, sha256: 1 } });
      await Candidate.deleteOne({ _id: row._id, organization: row.organization });
      await MatchingResult.deleteMany({ organization: row.organization, resume: row._id });
      await MatchingVector.deleteMany({ organization: row.organization, candidate: row._id });
      await Referral.updateMany({ organization: row.organization, resume: row._id },
        { $set: { purgedAt: new Date(), active: false, 'history.$[].comment': '' } });
      await UploadBatch.updateOne({ _id: row.batch, organization: row.organization },
        { $set: { ['files.' + row.slot + '.name']: 'Deleted resume' } });
      await Resume.updateOne({ _id: row._id, parsingStatus: 'deleting' }, {
        $set: { parsingStatus: 'deleted', originalFilename: 'Deleted resume' },
        $unset: { ...cleanup.$unset, extractedText: 1, extractedData: 1, extractionEvidence: 1,
          candidateId: 1, sha256: 1, uniqueHash: 1, errorDetails: 1, duplicateOf: 1 }
      });
    } catch { /* A failed deletion remains eligible for the next sweep. */ }
  }
}

export async function maintainResumes(config, queue, storage) {
  await clearExpiredUploads(storage);
  if (config.retentionDays) {
    const cutoff = new Date(Date.now() - config.retentionDays * 86_400_000);
    const rows = await Resume.find({ createdAt: { $lte: cutoff },
      parsingStatus: { $in: ['parsed', 'failed', 'ocr_required', 'duplicate', 'upload_failed'] } })
      .limit(100).select('organization parsingStatus');
    for (const row of rows) {
      const changed = await Resume.updateOne({ _id: row._id, parsingStatus: row.parsingStatus }, { $set: { parsingStatus: 'deleting' } });
      if (changed.modifiedCount) await recordAudit(row.organization, 'retention_delete', { resume: row._id });
    }
    // Expired manifests can contain filenames for uploads that never started.
    await UploadBatch.updateMany({ createdAt: { $lte: cutoff }, expiresAt: { $lte: new Date() }, filenamesRedacted: { $ne: true } }, {
      $set: { 'files.$[].name': 'Expired resume', filenamesRedacted: true }
    });
  }
  await clearDeleted(storage);
  await recoverQueue(config, queue);
}
