import { Router } from 'express';
import { z } from 'zod';
import { Company, Organization, Membership, Invitation, User } from './models.js';
import { fail, isDuplicate, rateLimit, read } from './http.js';
import { visibleCompany } from './companies.js';
import { digest, emailDomain, roles, selectableRole, selectableRoles, allows, token } from './security.js';
import { objectId, rawToken, workEmail } from './validation.js';
import { organizationAccess, requireRole } from './organization-access.js';

const view = (entry) => entry && ({
  id: entry.id, organization: entry.organization, status: entry.status,
  method: entry.method, grant: entry.grant, role: entry.role
});

async function pendingMembership(user, organization) {
  const query = { user, organization };
  try {
    return await Membership.findOneAndUpdate(query, { $setOnInsert: { status: 'pending' } },
      { upsert: true, returnDocument: 'after' });
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    return Membership.findOne(query);
  }
}

export function onboardingRoutes(config, mailer) {
  const routes = Router();
  const invitationHash = (raw) => digest(config.secret, 'invitation', raw);

  routes.get('/memberships', async (req, res) => {
    const entries = await Membership.find({ user: req.user.id }).sort({ updatedAt: -1 })
      .populate({ path: 'organization', select: 'company active', populate: { path: 'company', select: 'name status' } });
    res.json({ items: entries.filter(entry => entry.organization?.company).map(view) });
  });

  routes.post('/company', async (req, res) => {
    await rateLimit(config, 'onboarding:select', req.user.id, 20, 60 * 60_000);
    const { companyId } = read(z.object({ companyId: objectId }).strict(), req.body);
    const company = await Company.findOne({ _id: companyId, ...visibleCompany(req.user) });
    if (!company) fail(404, 'Company not found.', 'NOT_FOUND');
    const query = { company: company.id };
    let organization;
    try {
      organization = await Organization.findOneAndUpdate(query, { $setOnInsert: { active: false } },
        { upsert: true, returnDocument: 'after' });
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      organization = await Organization.findOne(query);
    }
    const membership = await pendingMembership(req.user.id, organization.id);
    res.json({ organization: organization.id, company: { id: company.id, name: company.name }, membership: view(membership) });
  });

  routes.get('/company/:id', async (req, res) => {
    const id = read(objectId, req.params.id);
    const membership = await Membership.findOne({ user: req.user.id, organization: id });
    if (!membership) fail(404, 'Membership request not found.', 'NOT_FOUND');
    const org = await Organization.findById(id).populate('company', 'name');
    if (!org?.company) fail(404, 'Company not found.', 'NOT_FOUND');
    res.json({ organization: id, company: { id: org.company.id, name: org.company.name },
      membership: view(membership) });
  });

  routes.post('/company/:id/verify', async (req, res) => {
    await rateLimit(config, 'membership:verify', req.user.id, 15, 60 * 60_000);
    const id = read(objectId, req.params.id);
    const { invitation } = read(z.object({ invitation: rawToken.optional() }).strict(), req.body);
    const membership = await Membership.findOne({ user: req.user.id, organization: id });
    if (!membership) fail(404, 'Membership request not found.', 'NOT_FOUND');
    if (membership.status === 'denied') fail(403, 'Your membership request was declined.', 'MEMBERSHIP_DENIED');
    if (membership.status === 'verified') return res.json({ membership: view(membership) });
    const org = await Organization.findOne({ _id: id, active: true }).populate('company', 'status');
    if (!org || org.company?.status !== 'verified') {
      if (invitation) fail(400, 'This organization cannot accept invitations yet.', 'ORG_PENDING');
      return res.json({ membership: view(membership) });
    }
    let proof;
    if (invitation) {
      const now = new Date();
      const invite = await Invitation.findOneAndUpdate({
        organization: id, email: req.user.email, hash: invitationHash(invitation), expiresAt: { $gt: now },
        $or: [{ acceptedBy: { $exists: false } }, { acceptedBy: req.user.id }]
      }, { $set: { acceptedBy: req.user.id, acceptedAt: now } }, { returnDocument: 'after' });
      if (!invite) fail(400, 'This invitation is invalid, expired, or belongs to another account.', 'INVITATION_INVALID');
      proof = { method: 'invitation', grant: invite.role };
    } else if (org.domains.includes(emailDomain(req.user.email))) {
      proof = { method: 'domain', grant: 'employee' };
    }
    if (!proof) return res.json({ membership: view(membership) });
    const changed = await Membership.findOneAndUpdate({ _id: membership.id, status: 'pending' },
      { $set: { ...proof, status: 'verified' } }, { returnDocument: 'after' });
    res.json({ membership: view(changed || await Membership.findById(membership.id)) });
  });

  routes.post('/company/:id/role', organizationAccess, async (req, res) => {
    const { role } = read(z.object({ role: z.enum(roles) }).strict(), req.body);
    const member = req.membership;
    if (!selectableRole(member.grant, role)) fail(403, 'This account type requires authorization.', 'ROLE_NOT_GRANTED');
    const updated = await Membership.findOneAndUpdate({ _id: member.id, status: 'verified', grant: member.grant },
      { $set: { role } }, { returnDocument: 'after' });
    if (!updated) fail(409, 'Your authorization changed. Refresh and try again.', 'ROLE_CHANGED');
    res.json({ membership: view(updated) });
  });

  routes.get('/organizations/:id/dashboard', organizationAccess,
    requireRole('company_admin', 'recruiter', 'employee'), (req, res) =>
      res.json({ organization: { id: req.organization.id, name: req.organization.company.name }, membership: view(req.membership) }));

  routes.get('/organizations/:id/requests', organizationAccess, requireRole('company_admin'), async (req, res) => {
    const items = await Membership.find({ organization: req.organization.id, status: 'pending' })
      .sort({ createdAt: 1 }).limit(100).populate('user', 'name email');
    res.json({ items: items.map(item => ({ id: item.id, name: item.user?.name, email: item.user?.email })) });
  });

  routes.post('/organizations/:id/requests/:membershipId', organizationAccess, requireRole('company_admin'), async (req, res) => {
    const _id = read(objectId, req.params.membershipId);
    const { decision, role } = read(z.object({ decision: z.enum(['approve', 'deny']),
      role: z.enum(selectableRoles).default('employee') }).strict(), req.body);
    const outcome = decision === 'approve' ? { status: 'verified', grant: role, method: 'approval' } : { status: 'denied' };
    const item = await Membership.findOneAndUpdate({ _id, organization: req.organization.id, status: 'pending' },
      { $set: { ...outcome, reviewedBy: req.user.id } }, { returnDocument: 'after' });
    if (!item) fail(404, 'Pending request not found in this organization.', 'NOT_FOUND');
    res.json({ membership: view(item) });
  });

  routes.post('/organizations/:id/invitations', organizationAccess, requireRole('company_admin'), async (req, res) => {
    const { email, role } = read(z.object({ email: workEmail, role: z.enum(selectableRoles) }).strict(), req.body);
    await rateLimit(config, 'invitation', req.organization.id, 30, 60 * 60_000);
    mailer.requireDelivery();
    const raw = token();
    const invite = await Invitation.create({ organization: req.organization.id, email,
      hash: invitationHash(raw), role, issuedBy: req.user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000) });
    try {
      await mailer.send(email, 'Your refraaAI invitation', 'Select ' + req.organization.company.name +
        ' after verifying your work email. Enter this invitation code within seven days: ' + raw);
    } catch (error) {
      await Invitation.deleteOne({ _id: invite.id, acceptedBy: { $exists: false } });
      throw error;
    }
    res.status(201).json({ message: 'Invitation sent.' });
  });

  routes.get('/platform', async (req, res) => {
    if (!allows(req.user.systemRole, 'super_admin')) fail(403, 'Platform administrator access is required.', 'FORBIDDEN');
    const [pending, organizations, accounts] = await Promise.all([
      Company.countDocuments({ status: 'pending' }), Organization.countDocuments({ active: true }),
      User.countDocuments({ verifiedAt: { $ne: null } })
    ]);
    res.json({ pending, organizations, accounts });
  });
  return routes;
}
