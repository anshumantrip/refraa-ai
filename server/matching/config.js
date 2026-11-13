export function matchingConfig(env = process.env) {
  const number = (key, fallback, min, max) => {
    const value = Number(env[key] || fallback);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error('Invalid ' + key);
    return value;
  };
  const ai = env.MATCH_AI_URL && new URL(env.MATCH_AI_URL);
  if (ai && (!['http:', 'https:'].includes(ai.protocol) || ai.username || ai.password || ai.origin !== env.MATCH_AI_URL)) {
    throw new Error('MATCH_AI_URL must be a bare HTTP(S) origin.');
  }
  if (ai && (env.MATCH_AI_TOKEN || '').length < 32) throw new Error('Set MATCH_AI_TOKEN to at least 32 characters.');
  return {
    ai: ai?.origin, token: env.MATCH_AI_TOKEN, redis: env.RESUME_REDIS_URL,
    queue: env.MATCH_QUEUE_NAME || 'refraa-matching', atlas: env.MATCH_ATLAS_INDEX,
    similarity: number('MATCH_SIMILARITY', 0.65, 0.1, 1),
    minimumScore: number('MATCH_MIN_SCORE', 35, 0, 100),
    limit: Math.floor(number('MATCH_MAX_CANDIDATES', 10000, 1000, 50000))
  };
}
