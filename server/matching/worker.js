import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { ensureIndexes, Organization } from '../models.js';
import { Candidate, Resume } from '../resumes/models.js';
import { redisOptions } from '../resumes/queue.js';
import { matchingConfig } from './config.js';
import { MatchingRun, MatchingResult, MatchingVector } from './models.js';
import { embeddingClient, cosine } from './embeddings.js';
import { evaluate, evidenceRows, rank, uniqueVersions } from './evaluate.js';

const attempts = 4;
const leaseDuration = 120_000;
const leaseDate = () => new Date(Date.now() + leaseDuration);
const queryTexts = criteria => [
  criteria.title + ' ' + criteria.description, ...criteria.requiredSkills.map(item => item.name),
  ...criteria.preferredSkills.map(item => item.name), ...criteria.additionalCriteria.map(item => item.description)
];
const jobId = run => String(run._id) + '-' + run.generation;
const paused = message => Object.assign(new Error(message), { report: true });

export function matchingProcessor(config) {
  return async job => {
    const scope = { _id: job.data.id, organization: job.data.organization, generation: job.data.generation };
    const lease = randomUUID();
    const run = await MatchingRun.findOneAndUpdate({ ...scope, attempts: { $lt: attempts }, $or: [
      { status: 'pending' }, { status: 'processing', leaseUntil: { $lte: new Date() } }
    ] }, { $set: { status: 'processing', lease, leaseUntil: leaseDate(), evaluated: 0 },
      $inc: { attempts: 1 }, $unset: { error: 1 } }, { returnDocument: 'after' }).lean();
    if (!run) return;
    const own = { ...scope, status: 'processing', lease };
    let lost = false;
    let renewal;
    const heartbeat = setInterval(() => {
      if (renewal) return;
      renewal = MatchingRun.updateOne(own, { $set: { leaseUntil: leaseDate() } })
        .then(result => { if (!result.matchedCount) lost = true; })
        .catch(() => { lost = true; }).finally(() => { renewal = null; });
    }, 20_000);
    try {
      const org = await Organization.findOne({ _id: run.organization, active: true }).populate('company', 'status').lean();
      if (org?.company?.status !== 'verified') throw paused('Organization access is unavailable.');
      const base = { organization: run.organization };
      const pool = { ...base, parsingStatus: 'parsed', $or: [{ job: run.job }, { job: null }] };
      const resumes = await Resume.find({ ...pool, candidateId: { $exists: true } })
        .select('_id candidateId').sort({ _id: 1 }).limit(config.limit + 1).lean();
      if (resumes.length > config.limit) throw paused('This organization exceeds the configured matching capacity.');
      const byCandidate = new Map(resumes.map(item => [String(item.candidateId), item._id]));
      const candidates = await Candidate.find({ ...base, _id: { $in: resumes.map(item => item.candidateId) },
        extractionStatus: 'parsed' }).select('_id versionOf createdAt').lean();
      const candidateRows = uniqueVersions(candidates);
      const results = [];
      const embed = embeddingClient(config);
      const queries = queryTexts(run.snapshot.criteria);
      await embed.load(queries);
      for (let offset = 0; offset < candidateRows.length; offset += 24) {
        if (lost) throw new Error('Matching lease was lost.');
        const chunk = candidateRows.slice(offset, offset + 24);
        const docs = await Resume.find({ ...pool,
          _id: { $in: chunk.map(candidate => byCandidate.get(String(candidate._id))) } })
          .select('_id candidateId extractedData extractionEvidence').lean();
        const entries = docs.map(doc => ({
          doc, rows: evidenceRows(doc, { experience: run.snapshot.criteria.experienceCriteria, cgpa: run.snapshot.criteria.cgpaCriteria })
        }));
        const texts = entries.flatMap(({ rows }) => rows.filter(row => row.grounded && row.section !== 'education').map(row => row.text));
        await embed.load(texts);
        const insert = [];
        const vectors = [];
        for (const { doc, rows } of entries) {
          const assessment = evaluate(run.snapshot, rows, (a, b) => cosine(embed.vector(a), embed.vector(b)));
          const candidate = doc.candidateId;
          insert.push({ ...base, run: run._id, attempt: lease, generation: run.generation, candidate, resume: doc._id, assessment });
          results.push({ candidate, eligible: assessment.eligible, score: assessment.score });
          if (config.atlas) {
            const related = rows.filter(row => row.grounded && row.section === 'projects')
              .map(row => embed.vector(row.text)).filter(Boolean);
            const best = related.sort((a, b) => cosine(embed.vector(queries[0]), b) - cosine(embed.vector(queries[0]), a))[0];
            if (best) vectors.push({ ...base, run: run._id, attempt: lease, candidate, embedding: best,
              expiresAt: new Date(Date.now() + 7 * 86400000) });
          }
        }
        if (insert.length) await MatchingResult.insertMany(insert);
        if (vectors.length) await MatchingVector.insertMany(vectors);
        await MatchingRun.updateOne(own, { $set: { evaluated: results.length } });
        embed.release(queries);
      }
      if (lost) throw new Error('Matching lease was lost.');
      const shortlist = rank(results, run.snapshot.criteria.referralCount).map(row => row.candidate);
      await MatchingRun.updateOne(own, { $set: { status: 'completed', model: embed.model,
        eligible: results.filter(row => row.eligible).length, evaluated: results.length, shortlist, completedAttempt: lease },
        $unset: { lease: 1, leaseUntil: 1 } });
    } catch (error) {
      const terminal = error.report || run.attempts >= attempts;
      await MatchingRun.updateOne(own, { $set: { status: terminal ? 'blocked' : 'pending',
        error: error.report ? error.message : terminal ? 'Matching service unavailable after retries. Rerun when available.' :
          'Matching interrupted. Retry scheduled.' }, $unset: { lease: 1, leaseUntil: 1 } });
      if (!terminal) throw new Error('Retryable matching service failure.');
    } finally {
      clearInterval(heartbeat);
      await renewal;
    }
  };
}

async function recover(queue) {
  const runs = await MatchingRun.find({ $or: [{ status: 'pending' },
    { status: 'processing', leaseUntil: { $lte: new Date() } }] }).sort({ dispatchAt: 1, createdAt: 1 }).limit(100);
  for (const run of runs) {
    const queued = await queue.getJob(jobId(run));
    const state = queued && await queued.getState();
    if (state && !['completed', 'failed', 'unknown'].includes(state)) {
      await MatchingRun.updateOne({ _id: run._id }, { $set: { dispatchAt: new Date() } }, { timestamps: false });
      continue;
    }
    const scope = { _id: run._id, generation: run.generation, status: run.status, leaseUntil: run.leaseUntil ?? null };
    if (run.attempts >= attempts) {
      await MatchingRun.updateOne(scope, { $set: { status: 'blocked', error: 'Matching stopped before completion. Rerun to retry.' },
        $unset: { lease: 1, leaseUntil: 1 } });
      continue;
    }
    const next = queued ? await MatchingRun.findOneAndUpdate(scope, { $inc: { generation: 1 }, $set: { status: 'pending' },
      $unset: { lease: 1, leaseUntil: 1 } }, { returnDocument: 'after' }) : run;
    if (next) await queue.add('match', { id: String(next._id), organization: String(next.organization), generation: next.generation },
      { jobId: jobId(next), attempts, backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 86400 }, removeOnFail: { age: 604800 } });
  }
}

async function main() {
  const config = matchingConfig();
  if (!config.ai || !config.redis || !process.env.MONGODB_URI) throw new Error('Matching needs MongoDB, Redis, and the embedding service.');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await ensureIndexes();
  const connection = redisOptions(config.redis, true);
  const queue = new Queue(config.queue, { connection });
  const worker = new Worker(config.queue, matchingProcessor(config), { connection, concurrency: 1, maxStalledCount: 2 });
  let loggedAt = 0;
  const log = error => {
    if (Date.now() - loggedAt > 5000) { loggedAt = Date.now(); console.error('Matching worker error:', error.name); }
  };
  worker.on('error', log);
  queue.on('error', log);
  let busy;
  const tick = () => { busy ||= recover(queue).catch(log).finally(() => { busy = null; }); };
  const timer = setInterval(tick, 3000);
  tick();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    clearInterval(timer);
    await worker.close();
    await queue.close();
    await busy;
    await mongoose.disconnect();
  });
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  await main().catch(async error => { console.error('Matching startup failed:', error.name); await mongoose.disconnect(); process.exitCode = 1; });
}
