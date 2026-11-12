import mongoose from 'mongoose';
import { companies } from './catalog.js';
import { Company, ensureIndexes } from './models.js';
import { companyKey, websiteHost } from './security.js';

export async function seedCompanies() {
  const keys = companies.map(({ name }) => companyKey(name));
  const hosts = companies.map(({ website }) => websiteHost(website));
  if (companies.length !== 100 || new Set(keys).size !== 100 || new Set(hosts).size !== 100) {
    throw new Error('The seed requires 100 distinct companies.');
  }
  return Company.bulkWrite(companies.map((entry, index) => ({
    updateOne: {
      filter: { $or: [{ key: keys[index] }, { host: hosts[index] }] },
      update: { $setOnInsert: { ...entry, key: keys[index], host: hosts[index], status: 'listed' } },
      upsert: true
    }
  })));
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI.');
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    await ensureIndexes();
    const result = await seedCompanies();
    console.log('Companies inserted:', result.upsertedCount, '| existing:', result.matchedCount);
  } catch (error) {
    console.error('Directory seed failed:', error.name === 'Error' ? error.message : error.name);
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
}
