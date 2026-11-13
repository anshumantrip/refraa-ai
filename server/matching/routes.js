import express, { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Job } from '../job-model.js';
import { organizationAccess, requireRole } from '../organization-access.js';
import { fail, rateLimit, read } from '../http.js';
import { objectId } from '../validation.js';
import { MatchingRun, MatchingResult, MatchingVector } from './models.js';
import { matchingConfig } from './config.js';
import { matchingSnapshot } from './snapshot.js';
import { embeddingClient } from './embeddings.js';
import { MAX_REFERRALS } from '../../shared/jobs.js';

const pageSchema = z.coerce.number().int().min(1).max(10000).default(1);
const fields = '-lease -leaseUntil -completedAttempt -dispatchAt';
const csv = value => {
  const text = String(value ?? '');
  return '"' + (/^[\s\uFEFF]*[=+\-@\t\r\n]/.test(text) ? "'" : '') + text.replaceAll('"', '""') + '"';
};

export function matchingRoutes(authConfig, config = matchingConfig()) {
  const router = Router({ mergeParams: true });
  router.use(organizationAccess, requireRole('recruiter', 'company_admin'), express.json({ limit: '16kb' }));
  const org = req => req.organization._id;
  async function jobFor(req) {
    const job = await Job.findOne({ organization: org(req), _id: read(objectId, req.params.jobId) }).lean();
    if (!job) fail(404, 'Job not found.', 'NOT_FOUND');
    return job;
  }
  async function runFor(req) {
    const run = await MatchingRun.findOne({ organization: org(req), _id: read(objectId, req.params.runId) }).lean();
    if (!run) fail(404, 'Matching run not found.', 'NOT_FOUND');
    return run;
  }
  async function start(req, res, job) {
    if (!config.ai || !config.redis) fail(503, 'Matching is blocked until Redis and the AI service are configured.', 'MATCH_BLOCKED');
    if (job.status === 'archived') fail(409, 'Archived jobs cannot start a matching run.', 'JOB_ARCHIVED');
    await rateLimit(authConfig, 'matching-start', String(org(req)), 12, 3600_000);
    const run = await MatchingRun.create({ organization: org(req), job: job._id, createdBy: req.user._id,
      snapshot: matchingSnapshot(job, config) });
    res.status(202).json({ id: run.id, status: run.status });
  }
  async function visible(run, selection = {}, extra = []) {
    if (run.status !== 'completed') return [];
    return MatchingResult.aggregate([
      { $match: { organization: run.organization, run: run._id, attempt: run.completedAttempt, ...selection } },
      { $lookup: { from: 'resumes', localField: 'resume', foreignField: '_id', pipeline: [
        { $match: { organization: run.organization, parsingStatus: 'parsed' } }, { $project: { _id: 1 } }
      ], as: 'original' } },
      { $match: { 'original.0': { $exists: true } } },
      { $lookup: { from: 'candidates', localField: 'candidate', foreignField: '_id', pipeline: [
        { $match: { organization: run.organization, extractionStatus: 'parsed' } }, { $project: { name: 1 } }
      ], as: 'profile' } },
      { $unwind: '$profile' }, { $unset: ['original', 'attempt', 'generation'] }, ...extra
    ]);
  }
  const ordered = run => [{ $addFields: { position: { $indexOfArray: [run.shortlist, '$candidate'] } } }, { $sort: { position: 1 } }];
  const shortlisted = run => visible(run, { candidate: { $in: run.shortlist } }, ordered(run));

  router.get('/jobs/:jobId/runs', async (req, res) => {
    const job = await jobFor(req);
    const page = read(pageSchema, req.query.page);
    const scope = { organization: org(req), job: job._id };
    const [items, total] = await Promise.all([
      MatchingRun.find(scope).select('-snapshot -shortlist ' + fields).sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * 20).limit(20).lean(),
      MatchingRun.countDocuments(scope)
    ]);
    res.json({ items, page, pages: Math.ceil(total / 20) });
  });
  router.post('/jobs/:jobId/runs', async (req, res) => start(req, res, await jobFor(req)));
  router.post('/runs/:runId/rerun', async (req, res) => {
    const run = await runFor(req);
    const job = await Job.findOne({ organization: org(req), _id: run.job }).lean();
    if (!job) fail(404, 'Job not found.', 'NOT_FOUND');
    await start(req, res, job);
  });
  router.put('/jobs/:jobId/count', async (req, res) => {
    const job = await jobFor(req);
    const body = read(z.strictObject({ count: z.number().int().min(1).max(MAX_REFERRALS),
      revision: z.number().int().nonnegative() }), req.body);
    const changed = await Job.findOneAndUpdate({ organization: org(req), _id: job._id,
      status: { $ne: 'archived' }, revision: body.revision },
    { $set: { referralCount: body.count }, $inc: { revision: 1 } }, { returnDocument: 'after' }).lean();
    if (!changed) fail(409, 'Job changed or is archived. Refresh and try again.', 'JOB_CONFLICT');
    res.json({ count: changed.referralCount, revision: changed.revision, message: 'Shortlist count saved. Rerun to apply it.' });
  });
  router.get('/runs/:runId', async (req, res) => {
    const run = await runFor(req);
    const { lease, leaseUntil, dispatchAt, completedAttempt, shortlist, ...item } = run;
    void lease; void leaseUntil; void dispatchAt; void completedAttempt;
    const rows = await shortlisted(run);
    const current = await Job.findOne({ organization: org(req), _id: run.job }).select('revision referralCount status').lean();
    res.json({ item, current, originalShortlistSize: shortlist.length, results: rows.map(row => ({
      ...row, saved: row.savedBy.some(id => id.equals(req.user._id)), savedBy: undefined
    })) });
  });
  router.get('/runs/:runId/explanations', async (req, res) => {
    const run = await runFor(req);
    const page = read(pageSchema, req.query.page);
    const candidate = req.query.candidate && read(objectId, req.query.candidate);
    const selection = candidate ? { candidate: new mongoose.Types.ObjectId(candidate) } : {};
    const items = await visible(run, selection, [
      { $sort: { 'assessment.score': -1, candidate: 1 } }, { $skip: (page - 1) * 20 }, { $limit: 21 },
      { $unset: 'savedBy' }
    ]);
    res.json({ items: items.slice(0, 20), hasNext: items.length > 20, page });
  });
  router.post('/runs/:runId/compare', async (req, res) => {
    const run = await runFor(req);
    const { candidates } = read(z.strictObject({ candidates: z.array(objectId).min(2).max(4)
      .refine(ids => new Set(ids).size === ids.length, 'Choose distinct candidates.') }), req.body);
    const items = await visible(run, { candidate: { $in: run.shortlist.filter(id => candidates.includes(String(id))) } },
      [...ordered(run), { $unset: 'savedBy' }]);
    if (items.length !== candidates.length) fail(404, 'One or more shortlisted profiles are unavailable.', 'NOT_FOUND');
    res.json({ items });
  });
  router.post('/runs/:runId/candidates/:candidateId/:action', async (req, res) => {
    const run = await runFor(req);
    const id = read(objectId, req.params.candidateId);
    const action = read(z.enum(['save', 'approve']), req.params.action);
    const [row] = await visible(run, { candidate: { $in: run.shortlist.filter(candidate => String(candidate) === id) } });
    if (!row) fail(404, 'Shortlisted candidate is unavailable.', 'NOT_FOUND');
    const scope = { _id: row._id, organization: org(req), run: run._id };
    if (action === 'save') await MatchingResult.updateOne(scope, { $addToSet: { savedBy: req.user._id } });
    else await MatchingResult.updateOne({ ...scope, approvedAt: null }, { $set: { approvedBy: req.user._id, approvedAt: new Date() } });
    res.json({ message: action === 'save' ? 'Candidate saved.' : 'Human approval recorded for this run.' });
  });
  router.get('/runs/:runId/export', async (req, res) => {
    const run = await runFor(req);
    if (run.status !== 'completed') fail(409, 'Matching must finish before export.', 'MATCH_INCOMPLETE');
    const rows = await shortlisted(run);
    res.attachment('refraa-shortlist.csv').type('text/csv').send(
      [['Rank', 'Candidate', 'Score', 'Explanation', 'Human approval'],
        ...rows.map(row => [row.position + 1, row.profile.name || 'Unknown', row.assessment.score,
          row.assessment.explanation, row.approvedAt ? 'Recorded' : 'Pending'])].map(row => row.map(csv).join(',')).join('\r\n'));
  });
  router.get('/runs/:runId/related-projects', async (req, res) => {
    const run = await runFor(req);
    if (!config.atlas || !config.ai || run.status !== 'completed') fail(503, 'Atlas project search is unavailable.', 'MATCH_BLOCKED');
    await rateLimit(authConfig, 'matching-atlas', req.user.id, 30, 3600_000);
    const q = read(z.string().trim().min(1).max(400), req.query.q);
    const service = embeddingClient(config);
    try { await service.load([q]); } catch { fail(503, 'Embedding service unavailable.', 'MATCH_BLOCKED'); }
    if (!service.vector(q) || service.model.revision !== run.model?.revision || service.model.name !== run.model?.name) {
      fail(409, 'The current model differs from the run or the search text is unavailable.', 'MODEL_CHANGED');
    }
    const matches = await MatchingVector.aggregate([{ $vectorSearch: {
      index: config.atlas, path: 'embedding', queryVector: service.vector(q), exact: true, limit: 25,
      filter: { organization: run.organization, run: run._id, attempt: run.completedAttempt }
    } }, { $project: { candidate: 1, similarity: { $meta: 'vectorSearchScore' } } }]).catch(() =>
      fail(503, 'Atlas project search is unavailable.', 'MATCH_BLOCKED'));
    const allowed = await visible(run, { candidate: { $in: matches.map(row => row.candidate) } }, [{ $project: { candidate: 1 } }]);
    const ids = new Set(allowed.map(row => String(row.candidate)));
    res.json({ items: matches.filter(row => ids.has(String(row.candidate))) });
  });
  return router;
}
