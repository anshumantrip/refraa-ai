import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ref = (name, required = true) => ({ type: Schema.Types.ObjectId, ref: name, required });
const statuses = ['uploading', 'upload_failed', 'pending', 'processing', 'parsed', 'failed', 'ocr_required', 'duplicate', 'deleting', 'deleted'];
export const resumeStatuses = statuses;
const batch = new Schema({
  organization: ref('Organization'), createdBy: ref('User'), job: ref('Job', false),
  files: [{ _id: false, name: String, size: Number }], totalBytes: Number, expiresAt: Date, cancelledAt: Date,
  filenamesRedacted: Boolean
}, { timestamps: true });
batch.index({ organization: 1, createdAt: -1, _id: -1 });
batch.index({ expiresAt: 1 });

const resume = new Schema({
  organization: ref('Organization'), batch: ref('UploadBatch'), job: ref('Job', false),
  slot: { type: Number, required: true }, originalFilename: String, mimeType: String,
  fileSize: Number, sha256: String, uniqueHash: String, storageKey: { type: String, select: false },
  parsingStatus: { type: String, enum: statuses, required: true },
  duplicateOf: ref('Resume', false), exactReview: { type: String, enum: ['dismissed'] },
  candidateId: ref('Candidate', false), extractedText: { type: String, select: false },
  extractedData: Schema.Types.Mixed, extractionEvidence: Schema.Types.Mixed, errorDetails: String,
  lease: String, leaseUntil: Date, generation: { type: Number, default: 0 },
  attempts: { type: Number, default: 0 }, manualRetries: { type: Number, default: 0 },
  storedAt: Date, nextCleanupAt: Date, nextDispatchAt: Date, scanPassed: Boolean, malwareScanned: Boolean,
  notifiedStatus: String, notifiedGeneration: Number
}, { timestamps: true });
resume.index({ organization: 1, batch: 1, slot: 1 }, { unique: true });
resume.index({ organization: 1, uniqueHash: 1 }, { unique: true, partialFilterExpression: { uniqueHash: { $type: 'string' } } });
resume.index({ organization: 1, parsingStatus: 1, createdAt: -1, _id: -1 });
resume.index({ organization: 1, parsingStatus: 1, job: 1, _id: 1 });
resume.index({ organization: 1, createdAt: -1, _id: -1 });
resume.index({ parsingStatus: 1, leaseUntil: 1 });
resume.index({ parsingStatus: 1, nextDispatchAt: 1 });
resume.index({ parsingStatus: 1, nextCleanupAt: 1 });
resume.index({ storedAt: 1 });
resume.index({ parsingStatus: 1, createdAt: 1 });

const candidate = new Schema({
  organization: ref('Organization'), name: String, email: String, phone: String,
  education: [Schema.Types.Mixed], skills: [String], experience: [Schema.Types.Mixed],
  internships: [Schema.Types.Mixed], projects: [Schema.Types.Mixed], certifications: [Schema.Types.Mixed],
  resumeIds: [ref('Resume')], status: { type: String, enum: ['processed', 'shortlisted'], default: 'processed' },
  extractionStatus: { type: String, enum: ['parsed'], default: 'parsed' },
  versionOf: ref('Candidate', false), duplicateReview: { type: String, enum: ['linked', 'distinct'] }
}, { timestamps: true });
candidate.index({ organization: 1, email: 1 });
candidate.index({ organization: 1, phone: 1 });
candidate.index({ organization: 1, versionOf: 1 });

const audit = new Schema({
  organization: ref('Organization'), actor: ref('User', false), resume: ref('Resume', false),
  batch: ref('UploadBatch', false), action: { type: String, required: true }
}, { timestamps: { createdAt: true, updatedAt: false } });
audit.index({ organization: 1, createdAt: -1 });

export const UploadBatch = model('UploadBatch', batch);
export const Resume = model('Resume', resume);
export const Candidate = model('Candidate', candidate);
export const ResumeAudit = model('ResumeAudit', audit);
export const recordAudit = (organization, action, refs = {}) => ResumeAudit.create({ organization, action, ...refs });
