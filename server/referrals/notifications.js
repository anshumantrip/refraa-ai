import { randomUUID } from 'node:crypto';
import { Membership, User, Organization } from '../models.js';
import { Notification, NotificationPreference } from './models.js';

export async function notify(organization, user, key, message, path) {
  if (!user) return;
  try {
    await Notification.updateOne({ organization, user, key }, {
      $setOnInsert: { message, path, nextAt: new Date(), createdAt: new Date(), updatedAt: new Date() }
    }, { upsert: true, timestamps: false });
  } catch (error) { if (error.code !== 11000) throw error; }
}

export async function deliverNotifications(config, mailer) {
  for (let index = 0; index < 25; index++) {
    const lease = randomUUID();
    const notice = await Notification.findOneAndUpdate({
      delivery: { $in: ['pending', 'sending'] }, nextAt: { $lte: new Date() }
    }, { $set: { delivery: 'sending', lease, nextAt: new Date(Date.now() + 60_000) }, $inc: { attempts: 1 } },
    { sort: { nextAt: 1 }, returnDocument: 'after' });
    if (!notice) break;
    const scope = { _id: notice._id, lease };
    const identity = { organization: notice.organization, user: notice.user };
    const [pref, membership, user, org] = await Promise.all([
      NotificationPreference.findOne(identity), Membership.exists({ ...identity, status: 'verified' }),
      User.findOne({ _id: notice.user, verifiedAt: { $ne: null } }).select('email'),
      Organization.findOne({ _id: notice.organization, active: true }).populate('company', 'status')
    ]);
    let delivery = 'skipped';
    if (pref?.email && membership && user && org?.company?.status === 'verified') {
      if (notice.attempts > 4) delivery = 'failed';
      else try {
        await mailer.send(user.email, 'refraaAI workspace update', 'You have a new workspace update. Open ' + config.origin + '/dashboard/' + notice.organization + '/notifications');
        delivery = 'accepted';
      } catch { delivery = notice.attempts >= 4 ? 'failed' : 'pending'; }
    }
    await Notification.updateOne(scope, { $set: { delivery, nextAt: new Date(Date.now() + 30_000 * 2 ** Math.min(notice.attempts, 4)) }, $unset: { lease: 1 } });
  }
}
