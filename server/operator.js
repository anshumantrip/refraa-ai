import mongoose from 'mongoose';
import { domainToASCII } from 'node:url';
import { Company, Organization, Membership, User, ensureIndexes } from './models.js';
import { companyKey } from './security.js';
import { workEmail } from './validation.js';

async function run([action, companyOrEmail, administrator, ...rawDomains]) {
  if (action === 'super-admin' && companyOrEmail && !administrator) {
    const email = workEmail.parse(companyOrEmail);
    const result = await User.updateOne({ email, verifiedAt: { $type: 'date' } }, { $set: { systemRole: 'super_admin' } });
    if (!result.matchedCount) throw new Error('Register and verify the operator email first.');
    console.log('Platform administrator granted.');
    return;
  }
  if (action !== 'activate' || !companyOrEmail || !administrator) {
    throw new Error('Usage: org:configure -- activate "Company name" admin@work.example [approved-domain ...] or org:configure -- super-admin operator@work.example');
  }
  const domains = [...new Set(rawDomains.map(value => domainToASCII(value.trim().toLowerCase())))];
  for (const domain of domains) {
    if (!workEmail.safeParse('operator@' + domain).success) throw new Error('Approved domains must be valid non-public email domains.');
  }
  const admin = await User.findOne({ email: workEmail.parse(administrator), verifiedAt: { $type: 'date' } });
  if (!admin) throw new Error('Register and verify the company administrator email first.');
  const company = await Company.findOne({ key: companyKey(companyOrEmail) });
  if (!company) throw new Error('Company does not exist in the directory.');
  const organization = await Organization.findOneAndUpdate({ company: company.id },
    { $set: { domains, active: true } }, { upsert: true, returnDocument: 'after' });
  await Membership.findOneAndUpdate({ user: admin.id, organization: organization.id },
    { $set: { status: 'verified', method: 'approval', grant: 'company_admin', role: 'company_admin' } }, { upsert: true });
  await Company.updateOne({ _id: company.id }, { $set: { status: 'verified' } });
  console.log('Company verified and organization administrator granted.');
}

try {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI.');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await ensureIndexes();
  await run(process.argv.slice(2));
} catch (error) {
  console.error('Operator action failed:', error.name === 'Error' ? error.message : error.name);
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
