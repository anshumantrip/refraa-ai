import mongoose from 'mongoose';
import { industries, roles, OTP_ATTEMPTS } from './security.js';

const { Schema, model } = mongoose;
const id = (ref, extra = {}) => ({ type: Schema.Types.ObjectId, ref, required: true, ...extra });
const challenge = new Schema({
  hash: String, expiresAt: Number, nextSendAt: Number,
  attempts: { type: Number, default: 0, max: OTP_ATTEMPTS }
}, { _id: false });
const user = new Schema({
  name: { type: String, required: true }, email: { type: String, required: true, unique: true },
  password: { type: String, required: true, select: false }, verifiedAt: Date,
  systemRole: { type: String, enum: ['super_admin'] },
  sessionVersion: { type: Number, default: 0 }, verification: { type: challenge, select: false },
  reset: { type: challenge, select: false }
}, { timestamps: true });
user.index({ 'reset.hash': 1 }, { sparse: true });

const company = new Schema({
  name: { type: String, required: true }, key: { type: String, required: true, unique: true },
  industry: { type: String, required: true, enum: industries },
  website: { type: String, required: true }, host: { type: String, required: true, unique: true },
  headquarters: String, description: String, careers: String, logo: String, source: String,
  status: { type: String, enum: ['listed', 'pending', 'verified'], default: 'pending', index: true },
  submittedBy: id('User', { required: false })
}, { timestamps: true });
company.index({ industry: 1, name: 1 });

const organization = new Schema({
  company: id('Company', { unique: true }), domains: { type: [String], default: [] },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const membership = new Schema({
  user: id('User'), organization: id('Organization'),
  status: { type: String, enum: ['pending', 'verified', 'denied'], default: 'pending' },
  grant: { type: String, enum: roles.filter(role => role !== 'super_admin') },
  role: { type: String, enum: roles.filter(role => role !== 'super_admin') },
  method: { type: String, enum: ['domain', 'invitation', 'approval'] },
  reviewedBy: id('User', { required: false })
}, { timestamps: true });
membership.index({ user: 1, organization: 1 }, { unique: true });
membership.index({ organization: 1, status: 1 });

const invitation = new Schema({
  organization: id('Organization'), email: { type: String, required: true },
  hash: { type: String, required: true, unique: true }, role: { type: String, enum: ['employee', 'recruiter'], required: true },
  issuedBy: id('User'), acceptedBy: id('User', { required: false }), acceptedAt: Date,
  expiresAt: { type: Date, required: true }
}, { timestamps: true });
invitation.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const session = new Schema({
  hash: { type: String, required: true, unique: true }, user: id('User'),
  version: { type: Number, required: true }, expiresAt: { type: Date, required: true }
});
session.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const rate = new Schema({ _id: String, count: Number, expiresAt: Date });
rate.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const User = model('User', user);
export const Company = model('Company', company);
export const Organization = model('Organization', organization);
export const Membership = model('Membership', membership);
export const Invitation = model('Invitation', invitation);
export const Session = model('Session', session);
export const Rate = model('Rate', rate);
export const ensureIndexes = () => Promise.all(Object.values(mongoose.models).map(entry => entry.createIndexes()));
