// The service receives only selected requirement and qualification fragments.
export const cleanText = value => String(value).slice(0, 900)
  .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, ' ')
  .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
  .replace(/(?:\+?\d[ ().-]*){8,15}/g, ' ')
  .replace(/\b(?:age|date of birth|gender|sex|race|ethnicity|nationality|religion|marital status|disability|pronouns)\s*:.*$/gi, ' ')
  .replace(/\s+/g, ' ').trim();

export const cosine = (a, b) => a && b ? Math.max(0, Math.min(1, a.reduce((sum, value, i) => sum + value * b[i], 0))) : 0;

export function embeddingClient(config) {
  const cache = new Map();
  let model;
  return {
    get model() { return model; },
    vector(text) { return cache.get(cleanText(text)); },
    async load(texts) {
      const missing = [...new Set(texts.map(cleanText).filter(text => text && !cache.has(text)))];
      for (let i = 0; i < missing.length; i += 64) {
        const batch = missing.slice(i, i + 64);
        const response = await fetch(config.ai + '/embed', {
          method: 'POST', headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts: batch }), signal: AbortSignal.timeout(90_000), redirect: 'error'
        });
        if (!response.ok) throw new Error('Embedding service unavailable.');
        const result = await response.json();
        const size = result.vectors?.[0]?.length;
        if (typeof result.model !== 'string' || !/^[a-f0-9]{40}$/.test(result.revision) ||
          !Number.isInteger(size) || size < 1 || size > 4096 || result.vectors.length !== batch.length ||
          result.vectors.some(vector => !Array.isArray(vector) || vector.length !== size ||
            vector.some(value => !Number.isFinite(value)) ||
            Math.abs(vector.reduce((sum, value) => sum + value ** 2, 0) - 1) > 0.01)) {
          throw new Error('Embedding response failed validation.');
        }
        const version = { name: result.model, revision: result.revision, dimensions: size };
        if (model && JSON.stringify(model) !== JSON.stringify(version)) throw new Error('Model changed during the run.');
        model = version;
        batch.forEach((text, index) => cache.set(text, result.vectors[index]));
      }
    },
    release(texts) {
      const keep = new Set(texts.map(cleanText));
      for (const key of cache.keys()) if (!keep.has(key)) cache.delete(key);
    }
  };
}
