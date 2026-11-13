import mongoose from 'mongoose';
import { loadConfig } from '../config.js';
import { Membership, ensureIndexes } from '../models.js';
import { Resume, UploadBatch } from '../resumes/models.js';
import { MatchingRun } from '../matching/models.js';
import { Referral } from './models.js';
import { deliverNotifications, notify } from './notifications.js';
import { createMailer } from '../mail.js';

export async function reconcileNotifications() {
  const [referrals, resumes, runs] = await Promise.all([
    Referral.find({ purgedAt: null, $expr: { $gt: [{ $size: { $ifNull: ['$history', []] } }, { $ifNull: ['$notifiedEvents', 0] }] } })
      .sort({ updatedAt: 1 }).limit(50).lean(),
    Resume.find({ parsingStatus: { $in: ['parsed', 'failed', 'ocr_required', 'upload_failed'] },
      $expr: { $or: [{ $ne: ['$parsingStatus', { $ifNull: ['$notifiedStatus', ''] }] },
        { $ne: ['$generation', { $ifNull: ['$notifiedGeneration', -1] }] }] } }).limit(50).lean(),
    MatchingRun.find({ status: { $in: ['completed', 'blocked'] }, notified: { $ne: true } }).limit(50).lean()
  ]);
  for (const item of referrals) {
    const path = '/referrals/' + item._id;
    for (const event of item.history.slice(item.notifiedEvents || 0)) {
      if (event.status === 'recommended') continue;
      const key = 'referral-' + event._id;
      await notify(item.organization, item.referrer, key, 'Referral status: ' + event.status.replaceAll('_', ' ') + '.', path);
      if (event.status === 'pending_review') {
        const reviewers = Membership.find({ organization: item.organization, status: 'verified',
          role: { $in: ['company_admin', 'recruiter'] }, user: { $ne: item.referrer } }).select('user').cursor();
        for await (const reviewer of reviewers) await notify(item.organization, reviewer.user, key, 'A referral is ready for review.', path);
      }
    }
    await Referral.updateOne({ _id: item._id, purgedAt: null }, { $max: { notifiedEvents: item.history.length } }, { timestamps: false });
  }
  for (const row of resumes) {
    const batch = await UploadBatch.findOne({ _id: row.batch, organization: row.organization }).select('createdBy').lean();
    await notify(row.organization, batch?.createdBy, ['resume', row._id, row.generation, row.parsingStatus].join('-'),
      row.parsingStatus === 'parsed' ? 'Resume processing completed.' : 'A resume needs attention.', '/resume-library/batches/' + row.batch);
    await Resume.updateOne({ _id: row._id, generation: row.generation, parsingStatus: row.parsingStatus },
      { $set: { notifiedStatus: row.parsingStatus, notifiedGeneration: row.generation } }, { timestamps: false });
  }
  for (const run of runs) {
    const path = '/ai-matching/runs/' + run._id;
    await notify(run.organization, run.createdBy, 'matching-' + run._id, run.status === 'completed' ?
      'AI matching completed.' : 'AI matching needs attention.', path);
    if (run.shortlist.length) await notify(run.organization, run.createdBy, 'shortlist-' + run._id,
      run.shortlist.length + ' candidates were shortlisted.', path);
    await MatchingRun.updateOne({ _id: run._id, status: run.status }, { $set: { notified: true } }, { timestamps: false });
  }
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  await mongoose.connect(config.mongo, { serverSelectionTimeoutMS: 5000 });
  await ensureIndexes();
  const mailer = createMailer(config);
  let running;
  const tick = () => { running ||= reconcileNotifications().then(() => deliverNotifications(config, mailer))
    .catch(error => console.error('Notification worker error:', error.name)).finally(() => { running = null; }); };
  const timer = setInterval(tick, 5000);
  tick();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    clearInterval(timer);
    await running;
    await mongoose.disconnect();
  });
}
