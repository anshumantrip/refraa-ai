import { Router } from 'express';
import mongoose from 'mongoose';
import { Job } from './job-model.js';
import { MatchingRun } from './matching/models.js';
import { organizationAccess, requireRole } from './organization-access.js';

// Read-only counters. MongoDB returns zero for collections with no records or yet to be created.
const counters = {
  resumesUploaded: ['resumes', { parsingStatus: { $nin: ['uploading', 'upload_failed', 'deleting', 'deleted'] } }],
  candidatesProcessed: ['candidates', { status: { $in: ['processed', 'shortlisted'] } }],
  pendingApprovals: ['referrals', { status: { $in: ['pending_review', 'pending_approval'] }, purgedAt: null }],
  completedReferrals: ['referrals', { status: 'completed' }]
};

export function recruitingDashboardRoutes() {
  const router = Router({ mergeParams: true });
  router.get('/', organizationAccess, requireRole('company_admin', 'recruiter'), async (req, res) => {
    const organization = req.organization._id;
    const counts = Object.entries(counters).map(async ([key, [collection, state]]) => [
      key, await mongoose.connection.collection(collection).countDocuments({ organization, ...state })
    ]);
    const [metrics, activeJobs, recentJobs, activity, shortlisted] = await Promise.all([
      Promise.all(counts),
      Job.countDocuments({ organization, status: 'published' }),
      Job.find({ organization }).select('title department status updatedAt').sort({ updatedAt: -1, _id: -1 }).limit(5).lean(),
      Job.aggregate([
        { $match: { organization } }, { $sort: { updatedAt: -1, _id: -1 } }, { $limit: 8 },
        { $unwind: '$activity' }, { $sort: { 'activity.at': -1, _id: -1 } }, { $limit: 8 },
        { $project: { title: 1, kind: '$activity.kind', at: '$activity.at' } }
      ]),
      MatchingRun.aggregate([
        { $match: { organization, status: 'completed' } },
        { $unwind: '$shortlist' },
        { $project: { _id: '$shortlist' } },
        { $unionWith: { coll: 'candidates', pipeline: [
          { $match: { organization, status: 'shortlisted' } }, { $project: { _id: 1 } }
        ] } },
        { $group: { _id: '$_id' } },
        { $lookup: { from: 'candidates', localField: '_id', foreignField: '_id',
          pipeline: [{ $match: { organization } }, { $project: { _id: 1 } }], as: 'candidate' } },
        { $match: { 'candidate.0': { $exists: true } } },
        { $count: 'count' }
      ])
    ]);
    res.json({ metrics: { ...Object.fromEntries(metrics), activeJobs,
      shortlistedCandidates: shortlisted[0]?.count ?? 0 }, recentJobs, activity });
  });
  return router;
}
