import { Router } from 'express';
import mongoose from 'mongoose';
import { Job } from './job-model.js';
import { organizationAccess, requireRole } from './organization-access.js';

// Read-only counters. MongoDB returns zero for collections with no records or yet to be created.
const counters = {
  resumesUploaded: ['resumes', {}],
  candidatesProcessed: ['candidates', { status: 'processed' }],
  shortlistedCandidates: ['candidates', { status: 'shortlisted' }],
  pendingApprovals: ['referrals', { status: 'pending_approval' }],
  completedReferrals: ['referrals', { status: 'completed' }]
};

export function recruitingDashboardRoutes() {
  const router = Router({ mergeParams: true });
  router.get('/', organizationAccess, requireRole('company_admin', 'recruiter'), async (req, res) => {
    const organization = req.organization._id;
    const counts = Object.entries(counters).map(async ([key, [collection, state]]) => [
      key, await mongoose.connection.collection(collection).countDocuments({ organization, ...state })
    ]);
    const [metrics, activeJobs, recentJobs, activity] = await Promise.all([
      Promise.all(counts),
      Job.countDocuments({ organization, status: 'published' }),
      Job.find({ organization }).select('title department status updatedAt').sort({ updatedAt: -1, _id: -1 }).limit(5).lean(),
      Job.aggregate([
        { $match: { organization } }, { $sort: { updatedAt: -1, _id: -1 } }, { $limit: 8 },
        { $unwind: '$activity' }, { $sort: { 'activity.at': -1, _id: -1 } }, { $limit: 8 },
        { $project: { title: 1, kind: '$activity.kind', at: '$activity.at' } }
      ])
    ]);
    res.json({ metrics: { ...Object.fromEntries(metrics), activeJobs }, recentJobs, activity });
  });
  return router;
}
