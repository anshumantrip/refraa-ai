import { z } from 'zod';
import mongoose from 'mongoose';
import { read, fail } from '../http.js';
import { objectId } from '../validation.js';
import { Job } from '../job-model.js';
import { Resume, Candidate } from '../resumes/models.js';
import { MatchingRun } from '../matching/models.js';
import { Referral } from './models.js';
import { csv, statuses } from './policy.js';

export async function analytics(req, res) {
  const { job, from, to, format } = read(z.strictObject({ job: objectId.optional(), from: z.iso.date().optional(),
    to: z.iso.date().optional(), format: z.literal('csv').optional() }), req.query);
  if (from && to && from > to) fail(400, 'The start date must precede the end date.', 'DATE_RANGE');
  const organization = req.organization._id;
  const jobId = job && new mongoose.Types.ObjectId(job);
  if (jobId && !await Job.exists({ _id: jobId, organization })) fail(404, 'Job not found.', 'NOT_FOUND');
  const date = from || to ? { createdAt: {
    ...(from && { $gte: new Date(from) }), ...(to && { $lt: new Date(Date.parse(to) + 86400000) })
  } } : {};
  const base = { organization, ...date };
  const scope = { ...base, ...(jobId && { job: jobId }) };
  const [resumes, candidates, jobs, runs, outcomes, byJob, trend, recent, shortlisted] = await Promise.all([
    Resume.countDocuments({ ...scope, storedAt: { $exists: true }, parsingStatus: { $nin: ['deleted', 'deleting'] } }),
    jobId ? Resume.distinct('candidateId', { ...scope, parsingStatus: 'parsed' }).then(ids => ids.length) :
      Candidate.countDocuments({ ...base, extractionStatus: 'parsed' }),
    Job.countDocuments({ ...base, status: 'published', ...(jobId && { _id: jobId }) }),
    MatchingRun.countDocuments(scope),
    Referral.aggregate([{ $match: scope }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Referral.aggregate([{ $match: { ...scope, status: { $ne: 'recommended' } } }, { $group: { _id: '$job', requests: { $sum: 1 },
      completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } }, { $sort: { requests: -1, _id: 1 } }, { $limit: 50 },
      { $lookup: { from: 'jobs', localField: '_id', foreignField: '_id', pipeline: [
        { $match: { organization } }, { $project: { title: 1 } } ], as: 'job' } },
      { $project: { requests: 1, completed: 1, title: { $first: '$job.title' } } }]),
    Referral.aggregate([{ $match: { ...scope, status: { $ne: 'recommended' } } }, { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d' } },
      count: { $sum: 1 } } }, { $sort: { _id: -1 } }, { $limit: 90 }]),
    Referral.find(scope).sort({ updatedAt: -1, _id: -1 }).select('status updatedAt purgedAt').limit(10).lean(),
    MatchingRun.aggregate([{ $match: { ...scope, status: 'completed' } }, { $unwind: '$shortlist' },
      { $group: { _id: '$shortlist' } }, { $count: 'count' }])
  ]);
  const distribution = Object.fromEntries(statuses.map(status => [status, outcomes.find(row => row._id === status)?.count || 0]));
  const requests = Object.values(distribution).reduce((a, b) => a + b, 0) - distribution.recommended;
  const conversion = requests ? distribution.completed / requests : null;
  if (format) return res.attachment('refraa-analytics.csv').type('text/csv').send(csv([
    ['Metric', 'Value'], ...Object.entries({ resumes, candidates, jobs, runs, shortlisted: shortlisted[0]?.count || 0, requests, conversion, ...distribution }),
    [], ['Job', 'Referral records', 'Completed'], ...byJob.map(row => [row.title || 'Unknown', row.requests, row.completed]),
    [], ['Date (UTC)', 'Referral records'], ...trend.map(row => [row._id, row.count])
  ]));
  res.json({ resumes, candidates, jobs, runs, shortlisted: shortlisted[0]?.count || 0, requests, conversion,
    distribution, byJob, trend: trend.reverse(), recent });
}
