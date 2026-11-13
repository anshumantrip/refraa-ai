import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newJob } from '../shared/jobs.js';
import { evaluate, evidenceRows, rank, uniqueVersions, coveredMonths } from '../server/matching/evaluate.js';
import { matchingSnapshot } from '../server/matching/snapshot.js';
import { cleanText } from '../server/matching/embeddings.js';

const policy = { minimumScore: 0, similarity: 0.6 };
const job = { ...newJob(), title: 'Platform Engineer', description: 'Build reliable services',
  requiredSkills: [{ name: 'JavaScript' }], preferredSkills: [{ name: 'PostgreSQL' }] };
function rows(data, enabled = {}, unverified = []) {
  return evidenceRows({ extractedData: data, extractionEvidence: Object.fromEntries(Object.entries(data).map(([key, entries]) =>
    [key, entries.map((entry, i) => unverified.includes(key) ? null :
      { method: 'deterministic', line: i + 1, excerpt: entry.text || entry })])) }, enabled);
}
const none = () => 0;

test('synonyms satisfy skills while similarity alone never satisfies mandatory gates', () => {
  const snapshot = matchingSnapshot(job, policy);
  const confirmed = evaluate(snapshot, rows({ skills: ['JS', 'Postgres'] }), none);
  assert.equal(confirmed.eligible, true);
  assert.equal(confirmed.required[0].state, 'match');
  assert.equal(confirmed.preferred[0].state, 'match');
  const uncertain = evaluate(snapshot, rows({ skills: ['Java'] }), () => 0.95);
  assert.equal(uncertain.eligible, false);
  assert.equal(uncertain.required[0].state, 'uncertain');
  assert.equal(uncertain.required[0].score, 0);
  assert.equal(uncertain.preferred[0].score, 0.95);
  assert.equal(evaluate(snapshot, rows({ skills: ['Java'] }), none).required[0].state, 'missing');
  assert.equal(evaluate(snapshot, rows({ skills: ['JS'] }, {}, ['skills']), none).required[0].state, 'uncertain');
});

test('experience periods merge and four toggle combinations exclude inactive rules', () => {
  const experienceCriteria = { enabled: true, minimumYears: 2, maximumYears: 3,
    experienceTypes: ['Combined'], relevantOnly: false, includeFreshers: false };
  const cgpaCriteria = { enabled: true, minimumCGPA: 3, maximumCGPA: 4, scale: '4',
    educationLevel: 'Undergraduate', allowUnavailable: false };
  const data = {
    skills: ['JavaScript'], experience: [{ text: 'Engineer full-time Jan 2020 to Dec 2021', startDate: 'Jan 2020', endDate: 'Dec 2021' }],
    internships: [{ text: 'Intern Jan 2021 to Dec 2022', startDate: 'Jan 2021', endDate: 'Dec 2022' }],
    education: [{ text: 'Bachelor CGPA 3.7/4', degree: 'Bachelor', scale: 4, cgpa: 3.7 }]
  };
  assert.equal(coveredMonths([[0, 24], [12, 36], [40, 42]]), 38);
  for (const exp of [true, false]) for (const cgpa of [true, false]) {
    const snapshot = matchingSnapshot({ ...job, experienceCriteria: { ...experienceCriteria, enabled: exp },
      cgpaCriteria: { ...cgpaCriteria, enabled: cgpa } }, policy);
    const result = evaluate(snapshot, rows(data, { experience: exp, cgpa }), none);
    assert.equal(Object.values(snapshot.weights).reduce((a, b) => a + b), 10000);
    assert.equal(Object.hasOwn(result, 'experience'), exp);
    assert.equal(Object.hasOwn(result, 'cgpa'), cgpa);
    if (exp) assert.equal(result.experience.months, 36);
    if (cgpa) assert.equal(result.cgpa.state, 'match');
    assert.equal(result.eligible, true);
  }
  const unknown = evaluate(matchingSnapshot({ ...job, cgpaCriteria: { ...cgpaCriteria, allowUnavailable: true } }, policy),
    rows({ ...data, education: [{ text: 'Bachelor CGPA 9/10', degree: 'Bachelor', scale: 10, cgpa: 9 }] }, { cgpa: true }), none);
  assert.equal(unknown.cgpa.state, 'uncertain');
  assert.equal(unknown.eligible, true);
});

test('mandatory additional requirements gate eligibility and evidence is sanitized for inference', () => {
  const requirement = { type: 'Certifications', description: 'AWS Certified Developer', priority: 'Mandatory' };
  const snapshot = matchingSnapshot({ ...job, additionalCriteria: [requirement] }, policy);
  const result = evaluate(snapshot, rows({ skills: ['JS'], certifications: ['Cloud certification'] }), () => 0.9);
  assert.equal(result.additional[0].state, 'uncertain');
  assert.equal(result.eligible, false);
  assert.equal(cleanText('API design user@fixture.example https://fixture.example Gender: private'), 'API design');
});

test('ranks arbitrary Top N, breaks ties by ID, and preserves only the latest linked version', () => {
  const candidates = Array.from({ length: 1000 }, (_, index) => ({ candidate: String(index).padStart(4, '0'),
    score: index === 999 ? 100 : 60, eligible: index !== 999 }));
  for (const n of [3, 5, 10, 63]) {
    assert.deepEqual(rank(candidates.reverse(), n).map(row => row.candidate), Array.from({ length: n }, (_, i) => String(i).padStart(4, '0')));
  }
  assert.equal(rank(candidates.slice(0, 2), 10).length, 2);
  const createdAt = new Date();
  assert.deepEqual(uniqueVersions([{ _id: 'a', createdAt }, { _id: 'b', versionOf: 'a', createdAt },
    { _id: 'c', createdAt }]).map(row => row._id), ['b', 'c']);
});
