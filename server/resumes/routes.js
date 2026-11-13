import express, { Router } from 'express';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { organizationAccess, requireRole } from '../organization-access.js';
import { fail, rateLimit, read } from '../http.js';
import { objectId } from '../validation.js';
import { Job } from '../job-model.js';
import { Candidate, Resume, UploadBatch, recordAudit, resumeStatuses } from './models.js';
import { safeFilename } from './file.js';
import { resumeConfig } from './config.js';
import { resumeStorage } from './storage.js';
import { uploadHandler } from './upload.js';

const fileInput = z.strictObject({ name: z.string().min(1).max(255), size: z.number().int().positive() });
const batchInput = z.strictObject({ jobId: objectId.optional(), files: z.array(fileInput).min(1).max(1000) });
const pageSchema = z.coerce.number().int().min(1).max(5000).default(1);
const libraryQuery = z.strictObject({ page: pageSchema, q: z.string().trim().max(100).default(''),
  status: z.enum(resumeStatuses).optional() });
const completed = ['parsed', 'failed', 'ocr_required', 'duplicate', 'deleted', 'deleting', 'upload_failed'];
const validOriginal = ['parsed', 'failed', 'ocr_required'];
const listed = 'originalFilename mimeType fileSize parsingStatus duplicateOf exactReview candidateId errorDetails job batch slot createdAt updatedAt';
const safeSearch = value => value.replace(/[.*+?^\u0024{}()|[\]\\]/g, '\\$&');
const batchHours = 24;

function summary(batch, files) {
  const statuses = Object.fromEntries(resumeStatuses.map(status => [status, 0]));
  for (const item of files) statuses[item.parsingStatus]++;
  const unstarted = batch.files.length - files.length;
  const closed = Boolean(batch.cancelledAt) || batch.expiresAt <= new Date();
  const unfinishedUploads = statuses.uploading + (closed ? 0 : unstarted);
  const done = completed.reduce((sum, status) => sum + statuses[status], 0) + (closed ? unstarted : 0);
  return {
    total: batch.files.length, uploaded: files.filter(item => item.storedAt || item.duplicateOf || item.parsingStatus === 'duplicate').length,
    pending: statuses.pending + unfinishedUploads, processing: statuses.processing,
    parsed: statuses.parsed, failed: statuses.failed + statuses.upload_failed + statuses.ocr_required + (closed ? unstarted : 0),
    duplicates: statuses.duplicate, removed: statuses.deleted + statuses.deleting,
    progress: Math.floor(done / batch.files.length * 100)
  };
}

export function resumeRoutes(authConfig, config = resumeConfig(), storage = resumeStorage(config)) {
  const routes = Router({ mergeParams: true });
  routes.use(organizationAccess, requireRole('company_admin', 'recruiter'));
  routes.use(express.json({ limit: '900kb' }));
  const org = req => req.organization._id;
  const actor = req => ({ actor: req.user._id });
  const rowFilter = req => ({ _id: read(objectId, req.params.resumeId), organization: org(req) });
  async function findBatch(req) {
    const batch = await UploadBatch.findOne({ _id: read(objectId, req.params.batchId), organization: org(req) }).lean();
    if (!batch) fail(404, 'Upload batch not found.', 'NOT_FOUND');
    return batch;
  }

  routes.get('/limits', (req, res) => res.json({ maxFile: config.maxFile, maxBatch: config.maxBatch, maxFiles: 1000,
    configured: Boolean(storage && config.redisUrl && (!config.requireScan || config.clamHost)) }));

  routes.post('/batches', async (req, res) => {
    if (!storage || !config.redisUrl || (config.requireScan && !config.clamHost)) {
      fail(503, 'Configure private storage, Redis, and any required scanner before uploading.', 'RESUME_UNAVAILABLE');
    }
    await rateLimit(authConfig, 'resume-batch', req.user.id, 20, 60 * 60_000);
    const { jobId, files } = read(batchInput, req.body);
    if (jobId && !await Job.exists({ _id: jobId, organization: org(req), status: { $ne: 'archived' } })) {
      fail(404, 'Job not found or archived.', 'JOB_NOT_FOUND');
    }
    const manifest = files.map(({ name, size }) => ({ name: safeFilename(name), size }));
    if (manifest.some(file => !/\.(pdf|docx)$/i.test(file.name) || file.size > config.maxFile)) {
      fail(400, 'Each file must be a PDF or DOCX within the configured size limit.', 'FILE_LIMIT');
    }
    const totalBytes = manifest.reduce((total, item) => total + item.size, 0);
    if (totalBytes > config.maxBatch) fail(400, 'The batch exceeds the configured total size limit.', 'BATCH_LIMIT');
    const batch = await UploadBatch.create({ organization: org(req), createdBy: req.user._id, job: jobId,
      files: manifest, totalBytes, expiresAt: new Date(Date.now() + batchHours * 3600_000) });
    await recordAudit(org(req), 'batch_created', { ...actor(req), batch: batch._id });
    res.status(201).json({ id: batch.id, expiresAt: batch.expiresAt });
  });

  routes.get('/batches', async (req, res) => {
    const page = read(pageSchema, req.query.page);
    const scope = { organization: org(req) };
    const [items, total] = await Promise.all([
      UploadBatch.find(scope).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20)
        .select('job createdAt expiresAt cancelledAt totalBytes').lean(),
      UploadBatch.countDocuments(scope)
    ]);
    res.json({ items, total, page, pages: Math.ceil(total / 20) });
  });

  routes.get('/batches/:batchId', async (req, res) => {
    const batch = await findBatch(req);
    const records = await Resume.find({ organization: org(req), batch: batch._id }).select(listed + ' storedAt').sort({ slot: 1 }).lean();
    const lookup = new Map(records.map(row => [row.slot, row]));
    res.json({ ...batch, counts: summary(batch, records), files: batch.files.map((file, slot) => ({ ...file, slot, ...lookup.get(slot) })) });
  });

  routes.post('/batches/:batchId/cancel', async (req, res) => {
    const batch = await findBatch(req);
    if (!batch.createdBy.equals(req.user._id) && req.membership.role !== 'company_admin') fail(403, 'Only the uploader or an administrator can cancel this batch.', 'FORBIDDEN');
    const changed = await UploadBatch.updateOne({ _id: batch._id, organization: org(req), cancelledAt: null }, { $set: { cancelledAt: new Date() } });
    if (changed.modifiedCount) await recordAudit(org(req), 'batch_cancelled', { ...actor(req), batch: batch._id });
    res.status(204).end();
  });

  routes.post('/batches/:batchId/files/:slot', async (req, res, next) => {
    const batch = await findBatch(req);
    const slot = read(z.coerce.number().int().min(0).max(batch.files.length - 1), req.params.slot);
    if (!batch.createdBy.equals(req.user._id)) fail(403, 'Only the uploader can submit batch files.', 'FORBIDDEN');
    if (batch.cancelledAt || batch.expiresAt <= new Date()) fail(409, 'This upload batch is closed.', 'BATCH_CLOSED');
    req.upload = { organization: org(req), batch, slot };
    next();
  }, uploadHandler(config, authConfig, storage));

  routes.get('/', async (req, res) => {
    const { q, status, page } = read(libraryQuery, req.query);
    const filter = { organization: org(req), parsingStatus: status || { $nin: ['deleted', 'deleting'] } };
    if (q) filter.originalFilename = { $regex: safeSearch(q), $options: 'i' };
    const [items, total] = await Promise.all([
      Resume.find(filter).select(listed).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 25).limit(25).lean(),
      Resume.countDocuments(filter)
    ]);
    res.json({ items, total, page, pages: Math.ceil(total / 25) });
  });

  routes.get('/:resumeId', async (req, res) => {
    const item = await Resume.findOne({ ...rowFilter(req), parsingStatus: { $nin: ['deleted', 'deleting'] } })
      .select(listed + ' extractedData extractionEvidence scanPassed malwareScanned').lean();
    if (!item) fail(404, 'Resume not found.', 'NOT_FOUND');
    if (config.requireScan && !item.malwareScanned) item.scanPassed = false;
    const profile = item.candidateId && await Candidate.findOne({ _id: item.candidateId, organization: org(req) }).lean();
    let potentialDuplicates = [];
    if (profile && !profile.duplicateReview) {
      const identifiers = ['email', 'phone'].filter(key => profile[key]).map(key => ({ [key]: profile[key] }));
      if (identifiers.length) potentialDuplicates = await Candidate.find({ organization: org(req),
        _id: { $ne: profile._id }, $or: identifiers }).select('name email phone resumeIds createdAt').sort({ createdAt: 1, _id: 1 }).limit(25).lean();
    }
    await recordAudit(org(req), 'resume_view', { ...actor(req), resume: item._id });
    res.json({ item, profile, potentialDuplicates });
  });

  routes.post('/:resumeId/retry', async (req, res) => {
    await rateLimit(authConfig, 'resume-retry', req.user.id, 1000, 60 * 60_000);
    const scope = rowFilter(req);
    const row = await Resume.findOneAndUpdate({ ...scope, parsingStatus: 'failed', manualRetries: { $lt: 5 },
      storageKey: { $exists: true } }, { $set: { parsingStatus: 'pending', attempts: 0 },
      $inc: { generation: 1, manualRetries: 1 }, $unset: { errorDetails: 1, nextDispatchAt: 1 } }, { returnDocument: 'after' });
    if (!row) fail(409, 'This resume cannot be retried or has reached its retry limit.', 'RETRY_UNAVAILABLE');
    await recordAudit(org(req), 'processing_retry', { ...actor(req), resume: row._id });
    res.json({ status: row.parsingStatus });
  });

  routes.post('/:resumeId/review', async (req, res) => {
    const scope = rowFilter(req);
    const body = read(z.strictObject({ action: z.enum(['dismiss_exact', 'distinct', 'link_version']), candidateId: objectId.optional() }), req.body);
    if (body.action === 'dismiss_exact') {
      const changed = await Resume.updateOne({ ...scope, parsingStatus: 'duplicate' }, { $set: { exactReview: 'dismissed' } });
      if (!changed.matchedCount) fail(404, 'Exact duplicate not found.', 'NOT_FOUND');
    } else {
      const item = await Resume.findOne({ ...scope, parsingStatus: 'parsed' }).select('candidateId');
      const profile = item && await Candidate.findOne({ _id: item.candidateId, organization: org(req) });
      if (!profile) fail(404, 'Candidate profile not found.', 'NOT_FOUND');
      const update = { $set: { duplicateReview: body.action === 'distinct' ? 'distinct' : 'linked' } };
      if (body.action === 'link_version') {
        const matching = ['email', 'phone'].filter(key => profile[key]).map(key => ({ [key]: profile[key] }));
        const older = { $or: [{ createdAt: { $lt: profile.createdAt } },
          { createdAt: profile.createdAt, _id: { $lt: profile._id } }] };
        const target = body.candidateId && matching.length && await Candidate.findOne({
          _id: body.candidateId, organization: org(req), $and: [{ $or: matching }, older]
        }).select('_id');
        if (!target || !await Resume.exists({ _id: target._id, organization: org(req), parsingStatus: 'parsed' })) {
          fail(400, 'Select an older profile with a shared identifier in this organization.', 'INVALID_VERSION');
        }
        update.$set.versionOf = target._id;
      } else update.$unset = { versionOf: 1 };
      await Candidate.updateOne({ _id: profile._id, organization: org(req) }, update);
    }
    await recordAudit(org(req), body.action, { ...actor(req), resume: scope._id });
    res.status(204).end();
  });

  routes.get('/:resumeId/original', async (req, res) => {
    if (!storage) fail(503, 'Private resume storage is not configured.', 'RESUME_UNAVAILABLE');
    const row = await Resume.findOne({ ...rowFilter(req), parsingStatus: { $in: validOriginal },
      scanPassed: true, ...(config.requireScan && { malwareScanned: true }),
      storageKey: { $exists: true } }).select('+storageKey');
    if (!row) fail(404, 'Original is unavailable or has not cleared processing checks.', 'NOT_FOUND');
    await recordAudit(org(req), 'resume_download', { ...actor(req), resume: row._id });
    const abort = new AbortController();
    res.once('close', () => abort.abort());
    let object;
    try { object = await storage.get(row.storageKey, AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)])); }
    catch { fail(503, 'Original could not be retrieved from storage.', 'STORAGE_UNAVAILABLE'); }
    res.attachment(row.originalFilename);
    res.type('application/octet-stream');
    res.set('Content-Length', String(row.fileSize));
    await pipeline(object.Body, res);
  });

  routes.delete('/:resumeId', requireRole('company_admin'), async (req, res) => {
    const scope = rowFilter(req);
    const updated = await Resume.updateOne({ ...scope, parsingStatus: { $in: ['parsed', 'failed', 'ocr_required', 'duplicate', 'upload_failed'] } },
      { $set: { parsingStatus: 'deleting' } });
    if (!updated.modifiedCount) fail(409, 'Resume is unavailable or still processing.', 'DELETE_UNAVAILABLE');
    await recordAudit(org(req), 'deletion_requested', { ...actor(req), resume: scope._id });
    res.status(202).json({ status: 'deleting' });
  });
  return routes;
}
