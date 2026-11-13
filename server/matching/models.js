import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const id = ref => ({ type: Schema.Types.ObjectId, ref, required: true });
const run = new Schema({
  organization: id('Organization'), job: id('Job'), createdBy: id('User'),
  status: { type: String, enum: ['pending', 'processing', 'completed', 'blocked'], default: 'pending' },
  snapshot: Schema.Types.Mixed, model: Schema.Types.Mixed, generation: { type: Number, default: 0 },
  attempts: { type: Number, default: 0 }, evaluated: { type: Number, default: 0 }, eligible: Number,
  shortlist: [id('Candidate')], lease: String, leaseUntil: Date, dispatchAt: Date, completedAttempt: String, error: String, notified: Boolean
}, { timestamps: true });
run.index({ organization: 1, job: 1, createdAt: -1 });
run.index({ status: 1, leaseUntil: 1 });

const result = new Schema({
  organization: id('Organization'), run: id('MatchingRun'), candidate: id('Candidate'), resume: id('Resume'),
  generation: Number, attempt: String, assessment: Schema.Types.Mixed,
  savedBy: [id('User')], approvedBy: { type: Schema.Types.ObjectId, ref: 'User' }, approvedAt: Date
}, { timestamps: true });
result.index({ organization: 1, run: 1, attempt: 1, candidate: 1 }, { unique: true });

const vector = new Schema({
  organization: id('Organization'), run: id('MatchingRun'), attempt: String, candidate: id('Candidate'),
  embedding: [Number], expiresAt: Date
}, { timestamps: false });
vector.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const MatchingRun = model('MatchingRun', run);
export const MatchingResult = model('MatchingResult', result);
export const MatchingVector = model('MatchingVector', vector);
