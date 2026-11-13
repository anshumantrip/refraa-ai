import { Worker as Thread } from 'node:worker_threads';
import { createHash, randomUUID } from 'node:crypto';
import { Candidate, Resume } from './models.js';
import { scanResume } from './scanner.js';
import { DocumentError } from './errors.js';
import { profileResult } from './profile-schema.js';

const leaseMs = 120_000;

function extractInThread(bytes, mime) {
  return new Promise((resolve, reject) => {
    const thread = new Thread(new URL('./extract-thread.js', import.meta.url), {
      workerData: { bytes, mime }, resourceLimits: { maxOldGenerationSizeMb: 192 }
    });
    const timer = setTimeout(() => {
      reject(new DocumentError('Document exceeded the extraction time limit.'));
      void thread.terminate();
    }, 30_000);
    thread.once('message', result => {
      if (result.error) reject(new DocumentError(result.error, result.status));
      else resolve(result);
    });
    thread.once('error', () => reject(new DocumentError('Document exceeded safe extraction limits or could not be read.')));
    thread.once('exit', () => {
      clearTimeout(timer);
      reject(new DocumentError('Document extraction stopped before completion.'));
    });
  });
}

export function resumeProcessor(config, storage) {
  return async job => {
    const { id, organization, generation } = job.data;
    const scope = { _id: id, organization, generation };
    const lease = randomUUID();
    const now = new Date();
    const resume = await Resume.findOneAndUpdate({ ...scope, attempts: { $lt: config.attempts }, $or: [
      { parsingStatus: 'pending' }, { parsingStatus: 'processing', leaseUntil: { $lte: now } }
    ] }, { $set: { parsingStatus: 'processing', lease, leaseUntil: new Date(Date.now() + leaseMs) },
      $inc: { attempts: 1 } }, { returnDocument: 'after' }).select('+storageKey');
    if (!resume) return;
    const own = { ...scope, lease, parsingStatus: 'processing' };
    let scanPassed = false;
    try {
      const object = await storage.get(resume.storageKey);
      if (object.ContentLength !== resume.fileSize || object.ContentLength > config.maxFile) {
        object.Body?.destroy?.();
        throw new DocumentError('Stored document size does not match upload metadata.');
      }
      const bytes = Buffer.from(await object.Body.transformToByteArray());
      if (bytes.length !== resume.fileSize) throw new DocumentError('Stored document size does not match upload metadata.');
      if (createHash('sha256').update(bytes).digest('hex') !== resume.sha256) throw new DocumentError('Stored document integrity check failed.');
      await scanResume(bytes, config);
      scanPassed = true;
      const result = profileResult.safeParse(await extractInThread(bytes, resume.mimeType));
      if (!result.success) throw new DocumentError('Extracted data did not pass validation.');
      const { text, data, evidence } = result.data;
      // Upsert on the resume ID so replay after a worker stop cannot create a second profile.
      await Candidate.updateOne({ _id: resume._id, organization }, {
        $setOnInsert: { ...data, resumeIds: [resume._id], status: 'processed', extractionStatus: 'parsed' }
      }, { upsert: true, setDefaultsOnInsert: false });
      await Resume.updateOne(own, { $set: { parsingStatus: 'parsed', candidateId: resume._id,
        extractedText: text, extractedData: data, extractionEvidence: evidence, scanPassed, malwareScanned: Boolean(config.clamHost) },
      $unset: { lease: 1, leaseUntil: 1, errorDetails: 1 } });
    } catch (error) {
      const permanent = error instanceof DocumentError;
      const exhausted = resume.attempts >= config.attempts;
      const terminal = permanent || exhausted;
      await Resume.updateOne(own, {
        $set: { parsingStatus: terminal ? (permanent ? error.status : 'failed') : 'pending', scanPassed,
          malwareScanned: scanPassed && Boolean(config.clamHost),
          errorDetails: permanent ? error.message : 'Processing service unavailable. ' + (terminal ? 'Retry this file.' : 'Retry scheduled.') },
        $unset: { lease: 1, leaseUntil: 1 }
      });
      if (!terminal) throw new Error('Retryable resume processing failure.');
    }
  };
}
