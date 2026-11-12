import { Router } from 'express';
import { Company } from './models.js';
import { fail, isDuplicate, rateLimit, read } from './http.js';
import { companyKey, websiteHost } from './security.js';
import { companyInput, directoryQuery, objectId } from './validation.js';

const companyFields = 'name industry website headquarters description careers logo source status';
export const visibleCompany = (user) => ({
  $or: [{ status: { $in: ['listed', 'verified'] } }, { submittedBy: user.id },
    ...(user.systemRole === 'super_admin' ? [{ status: 'pending' }] : [])]
});

export function companyRoutes(config) {
  const routes = Router();
  routes.get('/', async (req, res) => {
    const { q, industry, page } = read(directoryQuery, req.query);
    const query = visibleCompany(req.user);
    if (industry) query.industry = industry;
    if (q) query.name = { $regex: q.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const limit = 12;
    const [items, total] = await Promise.all([
      Company.find(query).select(companyFields).sort({ name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit),
      Company.countDocuments(query)
    ]);
    res.json({ items, total, page, pages: Math.ceil(total / limit) });
  });
  routes.get('/:id', async (req, res) => {
    const item = await Company.findOne({ _id: read(objectId, req.params.id), ...visibleCompany(req.user) }).select(companyFields);
    if (!item) fail(404, 'Company not found.', 'NOT_FOUND');
    res.json({ item });
  });
  routes.post('/', async (req, res) => {
    await rateLimit(config, 'company:create', req.user.id, 8, 60 * 60_000);
    const { name, website, industry } = read(companyInput, req.body);
    const key = companyKey(name);
    if (key.length < 2) fail(400, 'Enter a recognizable company name.', 'INVALID_INPUT');
    try {
      const company = await Company.create({ name, key, website, host: websiteHost(website), industry,
        submittedBy: req.user.id });
      res.status(201).json({ item: { _id: company.id, name, website, industry, status: company.status } });
    } catch (error) {
      if (isDuplicate(error)) fail(409, 'A company already uses that name or website.', 'COMPANY_EXISTS');
      throw error;
    }
  });
  return routes;
}
