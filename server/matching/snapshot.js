import { scoringConfiguration } from '../../shared/scoring.js';

export function matchingSnapshot(job, config, now = new Date()) {
  const scoring = scoringConfiguration(job);
  const criteria = {
    title: job.title, description: job.description, requiredSkills: job.requiredSkills,
    preferredSkills: job.preferredSkills, additionalCriteria: job.additionalCriteria, referralCount: job.referralCount,
    ...(scoring.eligibilityCriteria.experience && { experienceCriteria: scoring.eligibilityCriteria.experience }),
    ...(scoring.eligibilityCriteria.cgpa && { cgpaCriteria: scoring.eligibilityCriteria.cgpa })
  };
  return { criteria, weights: scoring.basisPoints, jobRevision: job.revision,
    thresholds: { similarity: config.similarity, minimumScore: config.minimumScore },
    asOf: now.getUTCFullYear() * 12 + now.getUTCMonth() + 1, scoringVersion: '1' };
}
