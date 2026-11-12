import mongoose from 'mongoose';
import { cgpaScales, criterionPriorities, criterionTypes, educationLevels, employmentTypes, experienceTypes,
  jobStatuses, MAX_CRITERIA, MAX_REFERRALS, MAX_SKILLS } from '../shared/jobs.js';

const { Schema } = mongoose;
const nested = (fields) => new Schema(fields, { _id: false });
const bounded = (maximum) => ({ type: Number, min: 0, max: maximum, default: null });
const skill = nested({ name: { type: String, required: true, maxlength: 60 },
  proficiency: { type: String, maxlength: 120 }, evidence: { type: String, maxlength: 240 } });
const experience = nested({
  enabled: { type: Boolean, required: true }, minimumYears: bounded(60), maximumYears: bounded(60),
  experienceTypes: [{ type: String, enum: experienceTypes }], includeFreshers: Boolean, relevantOnly: Boolean
});
const cgpa = nested({
  enabled: { type: Boolean, required: true }, minimumCGPA: bounded(100), maximumCGPA: bounded(100),
  scale: { type: String, enum: Object.keys(cgpaScales) },
  educationLevel: { type: String, enum: educationLevels }, allowUnavailable: Boolean
});
const criterion = nested({ type: { type: String, enum: criterionTypes, required: true },
  priority: { type: String, enum: criterionPriorities, required: true },
  description: { type: String, required: true, maxlength: 400 } });
const activity = nested({
  kind: { type: String, enum: ['drafted', 'published', 'updated', 'archived'], required: true },
  at: { type: Date, required: true }
});
const limited = (schema, max) => ({ type: [schema], validate: values => values.length <= max });
const ref = model => ({ type: Schema.Types.ObjectId, ref: model, required: true, immutable: true });

const job = new Schema({
  organization: ref('Organization'), createdBy: ref('User'),
  title: { type: String, required: true, maxlength: 120 },
  description: { type: String, required: true, maxlength: 5000 },
  department: { type: String, maxlength: 120 }, departmentKey: String,
  location: { type: String, maxlength: 120 }, employmentType: { type: String, enum: ['', ...employmentTypes] },
  education: { type: String, maxlength: 500 }, deadline: String,
  requiredSkills: limited(skill, MAX_SKILLS), preferredSkills: limited(skill, MAX_SKILLS),
  experienceCriteria: { type: experience, required: true }, cgpaCriteria: { type: cgpa, required: true },
  additionalCriteria: limited(criterion, MAX_CRITERIA),
  referralCount: { type: Number, min: 1, max: MAX_REFERRALS, validate: Number.isInteger, required: true },
  status: { type: String, enum: jobStatuses, required: true },
  revision: { type: Number, required: true, default: 0 },
  activity: [activity]
}, { timestamps: true, versionKey: false });

job.index({ organization: 1, updatedAt: -1, _id: -1 });
job.index({ organization: 1, status: 1, updatedAt: -1, _id: -1 });
job.index({ organization: 1, departmentKey: 1, updatedAt: -1, _id: -1 });

export const Job = mongoose.model('Job', job);
