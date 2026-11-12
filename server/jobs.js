import { Router } from 'express';
import { z } from 'zod';
import { Job } from './job-model.js';
import { organizationAccess, requireRole } from './organization-access.js';
import { fail, read } from './http.js';
import { objectId } from './validation.js';
import { jobConfigSchema, jobStatuses, skillKey } from '../shared/jobs.js';
import { scoringConfiguration } from '../shared/scoring.js';

const filters = z.strictObject({
  q: z.string().trim().max(120).default(''), status: z.enum(jobStatuses).optional(),
  department: z.string().trim().max(120).default(''),
  page: z.coerce.number().int().min(1).max(1000).default(1)
});
const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
const writeInput = z.strictObject({
  configuration: z.record(z.string(), z.unknown()), publish: z.boolean().default(false)
});
const editInput = writeInput.extend({ revision: revisionSchema });
const archiveInput = z.strictObject({ revision: revisionSchema });
const listingFields = 'title department location employmentType referralCount status createdAt updatedAt revision';
const sortRecent = { updatedAt: -1, _id: -1 };
const event = kind => ({ kind, at: new Date() });
const withDepartment = configuration => ({ ...configuration, departmentKey: skillKey(configuration.department) });
const escapePattern = value => value.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&');

function jobView(job) {
  const { activity, departmentKey, ...item } = job.toObject();
  // Exclude internal activity and the department lookup key from detail payloads.
  void activity;
  void departmentKey;
  return { ...item, scoring: scoringConfiguration(item) };
}

async function findJob(scope) {
  const job = await Job.findOne(scope);
  if (!job) fail(404, 'Job not found in this organization.', 'JOB_NOT_FOUND');
  return job;
}

function storedCriteria(input, current) {
  const values = { ...input };
  for (const key of ['experienceCriteria', 'cgpaCriteria']) {
    const criterion = values[key];
    if (criterion === undefined || (criterion && typeof criterion === 'object' && !Array.isArray(criterion))) {
      values[key] = { ...current[key].toObject(), ...criterion };
    }
  }
  return values;
}

export function jobRoutes() {
  const router = Router({ mergeParams: true });
  router.use(organizationAccess, requireRole('company_admin', 'recruiter'));
  const organizationOf = req => req.organization._id;
  const scopeOf = req => ({ organization: organizationOf(req), _id: read(objectId, req.params.jobId) });

  router.get('/', async (req, res) => {
    const { q, department, page, status } = read(filters, req.query);
    const organization = organizationOf(req);
    const filter = { organization };
    if (q) filter.title = { $regex: escapePattern(q), $options: 'i' };
    if (department) filter.departmentKey = skillKey(department);
    if (status) filter.status = status;
    const limit = 12;
    const [items, total, departments] = await Promise.all([
      Job.find(filter).select(listingFields).sort(sortRecent).skip((page - 1) * limit).limit(limit).lean(),
      Job.countDocuments(filter),
      Job.aggregate([
        { $match: { organization, departmentKey: { $gt: '' } } },
        { $sort: sortRecent }, { $group: { _id: '$departmentKey', label: { $first: '$department' } } },
        { $sort: { label: 1 } }, { $limit: 250 }
      ])
    ]);
    res.json({ items, total, page, pages: Math.ceil(total / limit), departments: departments.map(row => row.label) });
  });

  router.post('/', async (req, res) => {
    const { configuration, publish } = read(writeInput, req.body);
    const job = await Job.create({
      ...withDepartment(read(jobConfigSchema, configuration)),
      organization: organizationOf(req), createdBy: req.user.id, status: publish ? 'published' : 'draft',
      activity: [event(publish ? 'published' : 'drafted')]
    });
    res.status(201).json({ item: jobView(job), message: publish ? 'Job published.' : 'Draft saved.' });
  });

  router.get('/:jobId', async (req, res) => {
    const job = await findJob(scopeOf(req));
    res.json({ item: jobView(job) });
  });

  router.put('/:jobId', async (req, res) => {
    const scope = scopeOf(req);
    const { configuration, publish, revision } = read(editInput, req.body);
    const current = await findJob(scope);
    if (current.status === 'archived') fail(409, 'Archived jobs cannot be edited.', 'JOB_ARCHIVED');
    const values = withDepartment(read(jobConfigSchema, storedCriteria(configuration, current)));
    const status = publish ? 'published' : current.status;
    const kind = current.status !== status ? 'published' : status === 'draft' ? 'drafted' : 'updated';
    const updated = await Job.findOneAndUpdate({ ...scope, revision, status: current.status }, {
      $set: { ...values, status }, $inc: { revision: 1 },
      $push: { activity: { $each: [event(kind)], $slice: -12 } }
    }, { returnDocument: 'after', runValidators: true });
    if (!updated) fail(409, 'This job changed. Reopen it before saving again.', 'JOB_CONFLICT');
    res.json({ item: jobView(updated), message: kind === 'published' ? 'Job published.' : status === 'draft' ? 'Draft saved.' : 'Changes saved.' });
  });

  router.post('/:jobId/archive', async (req, res) => {
    const scope = scopeOf(req);
    const { revision } = read(archiveInput, req.body);
    const job = await findJob(scope);
    if (job.status === 'archived') return res.json({ item: jobView(job), message: 'Job is already archived.' });
    const updated = await Job.findOneAndUpdate({ ...scope, revision, status: { $in: ['draft', 'published'] } }, {
      $set: { status: 'archived' }, $inc: { revision: 1 },
      $push: { activity: { $each: [event('archived')], $slice: -12 } }
    }, { returnDocument: 'after', runValidators: true });
    if (!updated) fail(409, 'This job changed. Reopen it before archiving.', 'JOB_CONFLICT');
    res.json({ item: jobView(updated), message: 'Job archived.' });
  });
  return router;
}
