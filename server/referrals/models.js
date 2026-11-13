import mongoose from 'mongoose';
import { statuses } from './policy.js';
const { Schema, model } = mongoose;
const id = ref => ({ type: Schema.Types.ObjectId, ref, required: true });
const entry = new Schema({ status: { type: String, enum: statuses }, actor: id('User'), at: Date, comment: String });
const referral = new Schema({
  organization: id('Organization'), candidate: id('Candidate'), resume: id('Resume'), job: id('Job'),
  run: id('MatchingRun'), referrer: id('User'), reviewer: Schema.Types.ObjectId,
  status: { type: String, enum: statuses, required: true }, active: Boolean, independent: Boolean,
  history: [entry], notifiedEvents: { type: Number, default: 0 }, submittedAt: Date, completedAt: Date, purgedAt: Date
}, { timestamps: true });
referral.index({ organization: 1, candidate: 1, job: 1 }, { unique: true, partialFilterExpression: { active: true } });
referral.index({ organization: 1, updatedAt: -1 });
referral.index({ organization: 1, referrer: 1, updatedAt: -1 });
referral.index({ organization: 1, job: 1, createdAt: -1 });
const policy = new Schema({ organization: { ...id('Organization'), unique: true }, independent: { type: Boolean, default: true },
  updatedBy: id('User') }, { timestamps: true });
const notice = new Schema({
  organization: id('Organization'), user: id('User'), key: String, message: String,
  path: String, readAt: Date, delivery: { type: String, default: 'pending' },
  attempts: { type: Number, default: 0 }, nextAt: Date, lease: String
}, { timestamps: true });
notice.index({ organization: 1, user: 1, key: 1 }, { unique: true });
notice.index({ organization: 1, user: 1, createdAt: -1 });
notice.index({ delivery: 1, nextAt: 1 });
const preference = new Schema({ organization: id('Organization'), user: id('User'), email: Boolean });
preference.index({ organization: 1, user: 1 }, { unique: true });
export const Referral = model('Referral', referral);
export const ReferralPolicy = model('ReferralPolicy', policy);
export const Notification = model('Notification', notice);
export const NotificationPreference = model('NotificationPreference', preference);
