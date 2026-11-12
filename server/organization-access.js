import { Organization, Membership } from './models.js';
import { allows } from './security.js';
import { fail, read } from './http.js';
import { objectId } from './validation.js';

export async function organizationAccess(req, res, next) {
  const id = read(objectId, req.params.id);
  const organization = await Organization.findOne({ _id: id, active: true }).populate('company', 'name status');
  if (!organization || organization.company?.status !== 'verified') fail(404, 'Organization not found.', 'NOT_FOUND');
  req.organization = organization;
  req.membership = await Membership.findOne({ user: req.user.id, organization: id, status: 'verified' });
  if (!req.membership) fail(403, 'Verified membership is required.', 'MEMBERSHIP_REQUIRED');
  next();
}

export function requireRole(...permitted) {
  return (req, res, next) => {
    if (!allows(req.membership.role, ...permitted)) fail(403, 'Your account type cannot perform this action.', 'FORBIDDEN');
    next();
  };
}
