import express, { Router } from 'express';
import { z } from 'zod';
import { organizationAccess, requireRole } from '../organization-access.js';
import { fail, read, rateLimit } from '../http.js';
import { objectId } from '../validation.js';
import { Job } from '../job-model.js';
import { Candidate, Resume } from '../resumes/models.js';
import { MatchingRun, MatchingResult } from '../matching/models.js';
import { Referral, ReferralPolicy, Notification, NotificationPreference } from './models.js';
import { statuses, permitted, csv } from './policy.js';
import { analytics } from './analytics.js';
import { resumeStorage } from '../resumes/storage.js';
import { resumeConfig } from '../resumes/config.js';
import { pipeline } from 'node:stream/promises';

const pagination = z.coerce.number().int().min(1).max(5000).default(1);
const literal = text => text.replace(/[.*+?^\u0024{}()|[\]\\]/g, '\\$&');
const active = ['recommended', 'pending_review', 'approved', 'submitted'];

export function referralRoutes(config, storage = resumeStorage(resumeConfig())) {
  const router = Router({ mergeParams: true });
  router.use(organizationAccess, requireRole('company_admin', 'recruiter', 'employee'), express.json({ limit: '16kb' }));
  const org = req => req.organization._id;
  const user = req => req.user._id;
  const manager = req => ['company_admin', 'recruiter'].includes(req.membership.role);
  const ownership = req => manager(req) ? {} : { referrer: user(req) };
  const settings = async req => (await ReferralPolicy.findOne({ organization: org(req) }).lean())?.independent ?? true;
  const scope = req => ({ organization: org(req), ...ownership(req), purgedAt: null, _id: read(objectId, req.params.referralId) });

  async function shortlist(req, runId, candidateId) {
    const run = await MatchingRun.findOne({ _id: runId, organization: org(req), status: 'completed', shortlist: candidateId }).lean();
    if (!run) fail(404, 'Shortlisted candidate unavailable.', 'NOT_FOUND');
    const [job, assessment, candidate] = await Promise.all([
      Job.findOne({ _id: run.job, organization: org(req), ...(!manager(req) && { status: 'published' }) }).lean(),
      MatchingResult.findOne({ organization: org(req), run: run._id, candidate: candidateId,
        attempt: run.completedAttempt, 'assessment.eligible': true }).select('assessment resume').lean(),
      Candidate.findOne({ organization: org(req), _id: candidateId, extractionStatus: 'parsed' }).lean()
    ]);
    const resume = assessment && await Resume.findOne({ organization: org(req), _id: assessment.resume,
      candidateId, parsingStatus: 'parsed' }).select('originalFilename scanPassed malwareScanned').lean();
    if (!job || !assessment || !candidate || !resume) fail(404, 'Shortlisted candidate unavailable.', 'NOT_FOUND');
    return { run, job, assessment, candidate, resume };
  }

  router.get('/opportunities', async (req, res) => {
    const page = read(pagination, req.query.page);
    const filter = { organization: org(req), status: 'published' };
    const [jobs, total] = await Promise.all([
      Job.find(filter).select('title department location').sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20).lean(),
      Job.countDocuments(filter)
    ]);
    res.json({ jobs, pages: Math.ceil(total / 20) });
  });
  router.get('/opportunities/:jobId', async (req, res) => {
    const job = await Job.findOne({ organization: org(req), _id: read(objectId, req.params.jobId), status: 'published' })
      .select('title department location description').lean();
    if (!job) fail(404, 'Published opportunity unavailable.', 'NOT_FOUND');
    const run = await MatchingRun.findOne({ organization: org(req), job: job._id, status: 'completed' }).sort({ createdAt: -1, _id: -1 }).lean();
    const items = [];
    if (run) {
      const profiles = await Candidate.find({ organization: org(req), _id: { $in: run.shortlist }, extractionStatus: 'parsed' })
        .select('name skills').lean();
      const documents = await Resume.distinct('candidateId', { organization: org(req), candidateId: { $in: run.shortlist }, parsingStatus: 'parsed' });
      const available = new Set(documents.map(String));
      const profilesById = new Map(profiles.map(row => [String(row._id), row]));
      for (const id of run.shortlist) {
        const profile = profilesById.get(String(id));
        if (profile && available.has(String(id))) items.push(profile);
      }
    }
    res.json({ job, runId: run?._id, items });
  });

  router.get('/profiles/:runId/:candidateId', async (req, res) => {
    const data = await shortlist(req, read(objectId, req.params.runId), read(objectId, req.params.candidateId));
    const { name, email, phone, education, skills, experience, internships, projects, certifications } = data.candidate;
    const history = await Referral.find({ organization: org(req), candidate: data.candidate._id, job: data.job._id,
      ...ownership(req), purgedAt: null }).select('status createdAt updatedAt').sort({ createdAt: -1 }).limit(20).lean();
    // Detailed evidence and contact data stay in the recruiting roles.
    res.json({ candidate: { name, skills, ...(manager(req) && { email, phone, education, experience, internships, projects, certifications }) },
      job: { id: data.job._id, title: data.run.snapshot.criteria.title, criteria: data.run.snapshot.criteria, currentStatus: data.job.status },
      assessment: manager(req) ? data.assessment.assessment : { score: data.assessment.assessment.score, eligible: true },
      resume: manager(req) ? data.resume : null, history });
  });

  router.get('/profiles/:runId/:candidateId/original', requireRole('company_admin', 'recruiter'), async (req, res) => {
    const data = await shortlist(req, read(objectId, req.params.runId), read(objectId, req.params.candidateId));
    res.redirect(303, '/api/organizations/' + org(req) + '/resumes/' + data.resume._id + '/original');
  });

  router.get('/policy', requireRole('company_admin', 'recruiter'), async (req, res) => res.json({ independent: await settings(req) }));
  router.put('/policy', requireRole('company_admin', 'recruiter'), async (req, res) => {
    const body = read(z.strictObject({ independent: z.boolean() }), req.body);
    await ReferralPolicy.updateOne({ organization: org(req) }, { $set: { ...body, updatedBy: user(req) } }, { upsert: true });
    res.json(body);
  });
  router.get('/notifications', async (req, res) => {
    const page = read(pagination, req.query.page);
    const identity = { organization: org(req), user: user(req) };
    const [items, unread, total, preference] = await Promise.all([
      Notification.find(identity).select('message path readAt delivery createdAt').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20).lean(),
      Notification.countDocuments({ ...identity, readAt: null }), Notification.countDocuments(identity),
      NotificationPreference.findOne(identity).lean()
    ]);
    res.json({ items, unread, pages: Math.ceil(total / 20), email: preference?.email ?? false });
  });
  router.get('/notifications/count', async (req, res) => {
    res.json({ unread: await Notification.countDocuments({ organization: org(req), user: user(req), readAt: null }) });
  });
  router.put('/notifications/preferences', async (req, res) => {
    const body = read(z.strictObject({ email: z.boolean() }), req.body);
    await NotificationPreference.updateOne({ organization: org(req), user: user(req) }, { $set: body }, { upsert: true });
    res.json(body);
  });
  router.post('/notifications/:noticeId/read', async (req, res) => {
    const changed = await Notification.updateOne({ organization: org(req), user: user(req),
      _id: read(objectId, req.params.noticeId) }, { $min: { readAt: new Date() } });
    if (!changed.matchedCount) fail(404, 'Notification not found.', 'NOT_FOUND');
    res.status(204).end();
  });

  router.get('/analytics', requireRole('company_admin', 'recruiter'), analytics);
  router.get('/', async (req, res) => {
    const { page, q, status, referrer } = read(z.strictObject({ page: pagination, q: z.string().trim().max(100).default(''),
      status: z.enum(statuses).optional(), referrer: z.string().trim().max(100).optional() }), req.query);
    if (referrer && !manager(req)) fail(403, 'Referrer filtering requires recruiting access.', 'FORBIDDEN');
    const filter = { organization: org(req), ...ownership(req), purgedAt: null, ...(status && { status }) };
    const search = value => ({ $regex: literal(value), $options: 'i' });
    const stages = [{ $match: filter },
      ...[['jobs', 'job', 'title'], ['candidates', 'candidate', 'name'], ['users', 'referrer', 'name']].map(([from, localField, field]) =>
        ({ $lookup: { from, localField, foreignField: '_id', pipeline: [
          ...((from !== 'users') ? [{ $match: { organization: org(req) } }] : []), { $project: { [field]: 1 } }
        ], as: localField + 'Info' } })),
      ...(q ? [{ $match: { $or: [{ 'jobInfo.title': search(q) }, { 'candidateInfo.name': search(q) }] } }] : []),
      ...(referrer ? [{ $match: { 'referrerInfo.name': search(referrer) } }] : []),
      { $facet: { items: [{ $sort: { updatedAt: -1, _id: -1 } }, { $skip: (page - 1) * 20 }, { $limit: 20 },
        { $project: { status: 1, updatedAt: 1, job: 1, candidate: 1, run: 1,
          title: { $first: '$jobInfo.title' }, name: { $first: '$candidateInfo.name' }, referrerName: { $first: '$referrerInfo.name' } } }],
      total: [{ $count: 'count' }] } }];
    const [result] = await Referral.aggregate(stages);
    res.json({ items: result.items, pages: Math.ceil((result.total[0]?.count || 0) / 20) });
  });

  router.post('/', async (req, res) => {
    const body = read(z.strictObject({ run: objectId, candidate: objectId, prepare: z.boolean().default(false) }), req.body);
    await rateLimit(config, 'referral-create', req.user.id, 50, 3600_000);
    const { run, job, resume, candidate } = await shortlist(req, body.run, body.candidate);
    if (job.status !== 'published') fail(409, 'Publish the job before creating referrals.', 'JOB_UNAVAILABLE');
    const status = body.prepare ? 'recommended' : 'pending_review';
    const time = new Date();
    const history = [{ status: 'recommended', actor: user(req), at: time }];
    if (!body.prepare) history.push({ status, actor: user(req), at: time });
    try {
      const item = await Referral.create({ organization: org(req), run: run._id, job: job._id, resume: resume._id,
        candidate: candidate._id, referrer: user(req), status, active: true, history, independent: await settings(req) });
      res.status(201).json({ id: item.id, status });
    } catch (error) {
      if (error.code === 11000) fail(409, 'An active referral already exists for this candidate and job.', 'REFERRAL_EXISTS');
      throw error;
    }
  });

  router.get('/:referralId', async (req, res) => {
    const item = await Referral.findOne(scope(req)).lean();
    if (!item) fail(404, 'Referral not found.', 'NOT_FOUND');
    const [job, candidate, independent] = await Promise.all([
      Job.findOne({ organization: org(req), _id: item.job }).select('title').lean(),
      Candidate.findOne({ organization: org(req), _id: item.candidate }).select('name').lean(), settings(req)
    ]);
    res.json({ item: manager(req) ? item : { ...item, reviewer: undefined,
      history: item.history.map(event => ({ ...event, actor: undefined, comment: undefined })) },
      title: job?.title, name: candidate?.name, manager: manager(req),
      actions: statuses.filter(next => permitted({ status: item.status, next, manager: manager(req),
        owner: item.referrer.equals(user(req)), independent: independent || item.independent !== false })) });
  });

  router.post('/:referralId/status', async (req, res) => {
    const filter = scope(req);
    const { status, comment, confirmed } = read(z.strictObject({ status: z.enum(statuses),
      comment: z.string().trim().max(1000).default(''), confirmed: z.boolean().default(false) }), req.body);
    const item = await Referral.findOne(filter);
    if (!item) fail(404, 'Referral not found.', 'NOT_FOUND');
    if (item.status === status && item.history.at(-1)?.actor.equals(user(req))) return res.json({ status });
    const independent = await settings(req) || item.independent !== false;
    if (!permitted({ status: item.status, next: status, owner: item.referrer.equals(user(req)), manager: manager(req), independent })) {
      fail(403, 'This status transition is not allowed.', 'TRANSITION_DENIED');
    }
    if (['approved', 'rejected', 'submitted', 'completed'].includes(status) && !confirmed) {
      fail(400, 'Confirm the human decision before continuing.', 'CONFIRMATION_REQUIRED');
    }
    if (status === 'submitted' && !item.history.some(event => event.status === 'approved' && event.actor)) {
      fail(409, 'A human approval is required before submission.', 'APPROVAL_REQUIRED');
    }
    if (!await Resume.exists({ organization: org(req), _id: item.resume, parsingStatus: 'parsed' })) {
      fail(409, 'The original candidate record is unavailable.', 'CANDIDATE_UNAVAILABLE');
    }
    const at = new Date();
    const changed = await Referral.updateOne({ ...filter, status: item.status }, {
      $set: { status, active: active.includes(status), ...(['approved', 'rejected'].includes(status) && { reviewer: user(req) }),
        ...(status === 'submitted' && { submittedAt: at }), ...(status === 'completed' && { completedAt: at }) },
      $push: { history: { status, actor: user(req), at, comment } }
    });
    if (!changed.modifiedCount && !await Referral.exists({ ...filter, status, history: { $elemMatch: { status, actor: user(req) } } })) {
      fail(409, 'Referral changed. Refresh and try again.', 'REFERRAL_CONFLICT');
    }
    res.json({ status, message: 'Referral status updated.' });
  });

  router.get('/:referralId/export', requireRole('company_admin', 'recruiter'), async (req, res) => {
    const item = await Referral.findOne(scope(req)).lean();
    if (!item) fail(404, 'Referral not found.', 'NOT_FOUND');
    if (!['approved', 'submitted', 'completed'].includes(item.status) || !item.history.some(event => event.status === 'approved')) {
      fail(409, 'Human approval is required for application export.', 'APPROVAL_REQUIRED');
    }
    const data = await shortlist(req, item.run, item.candidate);
    const { candidate, job, assessment } = data;
    res.attachment('referral-application.csv').type('text/csv').send(csv([
      ['Field', 'Value'], ['Job', job.title], ['Candidate', candidate.name], ['Email', candidate.email],
      ['Phone', candidate.phone], ['Skills', candidate.skills.join(', ')], ['Score', assessment.assessment.score],
      ['Explanation', assessment.assessment.explanation], ['Resume', data.resume.originalFilename]
    ]));
  });
  router.get('/:referralId/original', requireRole('company_admin', 'recruiter'), async (req, res) => {
    const item = await Referral.findOne(scope(req)).lean();
    if (!item || !storage) fail(404, 'Original unavailable.', 'NOT_FOUND');
    const data = await shortlist(req, item.run, item.candidate);
    const row = await Resume.findOne({ _id: data.resume._id, organization: org(req), parsingStatus: 'parsed',
      scanPassed: true, ...(resumeConfig().requireScan && { malwareScanned: true }) }).select('+storageKey');
    if (!row?.storageKey) fail(404, 'Original unavailable.', 'NOT_FOUND');
    const object = await storage.get(row.storageKey);
    res.attachment(row.originalFilename).type('application/octet-stream');
    await pipeline(object.Body, res);
  });
  return router;
}
