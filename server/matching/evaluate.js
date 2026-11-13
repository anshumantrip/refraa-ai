const aliases = new Map(Object.entries({
  js: 'javascript', ts: 'typescript', 'node.js': 'nodejs', 'node js': 'nodejs',
  'react.js': 'react', reactjs: 'react', 'postgres': 'postgresql', k8s: 'kubernetes',
  'amazon web services': 'aws', 'ci/cd': 'continuous integration and delivery'
}));
const norm = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const skillKey = value => aliases.get(norm(value)) || norm(value);
const contains = (source, phrase) => {
  const words = norm(phrase);
  if (!words) return false;
  const text = norm(source);
  let offset = text.indexOf(words);
  while (offset >= 0) {
    if (!/[\p{L}\p{N}_]/u.test(text[offset - 1] || '') && !/[\p{L}\p{N}_]/u.test(text[offset + words.length] || '')) return true;
    offset = text.indexOf(words, offset + 1);
  }
  return false;
};

export const criterionSections = {
  'Relevant projects': ['projects'], Internships: ['internships'], Certifications: ['certifications'],
  'Domain knowledge': ['projects', 'skills'], 'Technical proficiency': ['skills', 'projects'],
  'Job-specific requirements': ['skills', 'projects', 'certifications', 'internships']
};
const sensitive = /\b(?:age|date of birth|gender|sex|race|ethnicity|nationality|religion|marital status|disability|pronouns)\s*:/i;
const protectedRequirement = /\b(?:gender|nationality|ethnicity|marital status|religion|disability|date of birth|pronouns)\b/i;
const entryText = value => typeof value === 'string' ? value : value?.text;
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function month(value, end, asOf) {
  const text = norm(value);
  if (end && ['present', 'current'].includes(text)) return asOf;
  const match = text.match(/^([a-z]+)\.?\s+((?:19|20)\d\d)$/);
  if (!match) return null;
  const index = months.indexOf(match[1].slice(0, 3));
  return index < 0 ? null : Number(match[2]) * 12 + index + Number(end);
}

export function coveredMonths(periods) {
  let total = 0;
  let end = -Infinity;
  for (const [left, right] of [...periods].sort((a, b) => a[0] - b[0])) {
    total += Math.max(0, right - Math.max(left, end));
    end = Math.max(end, right);
  }
  return total;
}

export function assessExperience(rule, rows, relevant, asOf) {
  const sources = rule.experienceTypes.includes('Combined') ? ['experience', 'internships', 'projects'] :
    rule.experienceTypes.map(type => ({ 'Full-time': 'experience', Internship: 'internships', Projects: 'projects' })[type]);
  const confirmed = [];
  let uncertain = false;
  for (const row of rows.filter(item => sources.includes(item.section))) {
    if (row.section === 'experience' && !/\bfull[\s-]*time\b/i.test(row.text)) { uncertain = true; continue; }
    if (rule.relevantOnly && !relevant(row)) { uncertain = true; continue; }
    const start = month(row.value.startDate, false, asOf);
    const end = month(row.value.endDate, true, asOf);
    if (start === null || end === null || end <= start || end > asOf) { uncertain = true; continue; }
    confirmed.push({ start, end, evidence: row.evidence });
  }
  const explicitFresher = rows.find(row => ['experience', 'internships'].includes(row.section) &&
    /^(?:fresher|no (?:professional |work )?experience)[.!]?$/i.test(row.text));
  const duration = coveredMonths(confirmed.map(row => [row.start, row.end]));
  let state = 'missing';
  if (!duration && explicitFresher && !confirmed.length && !rows.some(row =>
    sources.includes(row.section) && row !== explicitFresher)) state = rule.includeFreshers ? 'match' : 'mismatch';
  else if (duration > (rule.maximumYears ?? Infinity) * 12) state = 'mismatch';
  else if (duration && duration >= rule.minimumYears * 12 && (rule.maximumYears == null || !uncertain)) state = 'match';
  else if (uncertain) state = 'uncertain';
  else if (duration) state = 'mismatch';
  return { state, months: duration || (explicitFresher ? 0 : null),
    evidence: confirmed.map(row => row.evidence).concat(explicitFresher ? [explicitFresher.evidence] : []) };
}

const degree = {
  Secondary: /\b(?:secondary|high school)\b/i, Diploma: /\bdiploma\b/i,
  Undergraduate: /\b(?:bachelor|b\.?tech|b\.?sc|bca|b\.?e)\b/i,
  Postgraduate: /\b(?:master|m\.?tech|m\.?sc|mba|mca|m\.?e)\b/i, Doctorate: /\b(?:ph\.?d|doctorate)\b/i
};

export function assessCgpa(rule, rows) {
  const scale = rule.scale === 'percentage' ? 100 : Number(rule.scale);
  const reported = rows.filter(row => row.section === 'education' && (row.value.cgpa != null || row.value.percentage != null));
  const compatible = reported.flatMap(row => {
    if (rule.educationLevel !== 'Any level' && !degree[rule.educationLevel]?.test(row.value.degree || row.text)) return [];
    const value = scale === 100 ? row.value.percentage : row.value.scale === scale ? row.value.cgpa : null;
    return Number.isFinite(value) && value >= 0 && value <= scale ? [{ value, evidence: row.evidence }] : [];
  });
  const meets = compatible.some(row => row.value >= rule.minimumCGPA && row.value <= (rule.maximumCGPA ?? scale));
  const state = meets ? 'match' : compatible.length ? 'mismatch' : reported.length ? 'uncertain' : 'missing';
  return { state, scale, reported: compatible, evidence: reported.map(row => row.evidence),
    allowed: state === 'match' || (rule.allowUnavailable && ['missing', 'uncertain'].includes(state)) };
}

export function evidenceRows(resume, active) {
  const rows = [];
  const sections = ['skills', 'projects', 'certifications', 'internships',
    ...(active.experience ? ['experience'] : []), ...(active.cgpa ? ['education'] : [])];
  for (const section of sections) {
    const values = resume.extractedData?.[section] || [];
    for (const [index, value] of values.entries()) {
      const text = entryText(value);
      const source = resume.extractionEvidence?.[section]?.[index];
      if (typeof text !== 'string' || !text.trim() || sensitive.test(text)) continue;
      const grounded = source?.method === 'deterministic' && Number.isInteger(source.line) && source.line > 0 && contains(source.excerpt, text);
      rows.push({ section, value, text, grounded, evidence: { section, line: grounded ? source.line : null, text } });
    }
  }
  return rows;
}

const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
export function evaluate(snapshot, rows, similarity) {
  const { criteria, weights, thresholds } = snapshot;
  const grounded = rows.filter(row => row.grounded);
  const similarityOf = (query, row) => similarity(query, row.text) || 0;
  function skill(requirement, mandatory) {
    if (protectedRequirement.test([requirement.name, requirement.proficiency, requirement.evidence].join(' '))) {
      return { label: 'Unsupported requirement', state: 'uncertain', score: 0, evidence: [] };
    }
    const direct = grounded.filter(row => row.section === 'skills' ?
      skillKey(row.text) === skillKey(requirement.name) :
      row.section === 'projects' && contains(row.text, requirement.name));
    const checks = [requirement.proficiency, requirement.evidence].filter(Boolean);
    const verified = direct.find(row => checks.every(check => contains(row.text, check)));
    const relevant = grounded.filter(row => ['skills', 'projects'].includes(row.section))
      .map(row => ({ row, score: similarityOf(requirement.name, row) })).sort((a, b) => b.score - a.score)[0];
    const semantic = relevant?.score >= thresholds.similarity;
    const state = verified ? 'match' : direct.length || semantic || rows.some(row =>
      !row.grounded && (skillKey(row.text) === skillKey(requirement.name) || contains(row.text, requirement.name))) ? 'uncertain' : 'missing';
    return { label: requirement.name, state, score: verified ? 1 : !mandatory && semantic ? relevant.score : 0,
      evidence: verified ? [verified.evidence] : direct.length ? direct.slice(0, 3).map(row => row.evidence) :
        semantic ? [relevant.row.evidence] : [] };
  }
  const required = criteria.requiredSkills.map(requirement => skill(requirement, true));
  const preferred = criteria.preferredSkills.map(requirement => skill(requirement, false));
  const additional = criteria.additionalCriteria.map(requirement => {
    if (protectedRequirement.test(requirement.description)) {
      return { label: 'Unsupported requirement', type: requirement.type, priority: requirement.priority,
        state: 'uncertain', score: 0, evidence: [] };
    }
    const pool = grounded.filter(row => criterionSections[requirement.type]?.includes(row.section));
    const explicit = pool.find(row => contains(row.text, requirement.description));
    const nearest = pool.map(row => ({ row, score: similarityOf(requirement.description, row) })).sort((a, b) => b.score - a.score)[0];
    const related = nearest?.score >= thresholds.similarity;
    return { label: requirement.description, type: requirement.type, priority: requirement.priority,
      state: explicit ? 'match' : related ? 'uncertain' : 'missing',
      score: explicit ? 1 : related && requirement.priority === 'Preferred' ? nearest.score : 0,
      evidence: explicit ? [explicit.evidence] : related ? [nearest.row.evidence] : [] };
  });
  const projectQuery = criteria.title + ' ' + criteria.description;
  const projects = grounded.filter(row => row.section === 'projects').map(row => ({
    similarity: similarityOf(projectQuery, row), evidence: row.evidence
  })).filter(row => row.similarity >= thresholds.similarity).sort((a, b) => b.similarity - a.similarity).slice(0, 5);
  const relevant = row => similarityOf(projectQuery, row) >= thresholds.similarity ||
    [...criteria.requiredSkills, ...criteria.preferredSkills].some(item => contains(row.text, item.name));
  const experience = criteria.experienceCriteria ? assessExperience(criteria.experienceCriteria, grounded, relevant, snapshot.asOf) : null;
  const cgpa = criteria.cgpaCriteria ? assessCgpa(criteria.cgpaCriteria, grounded) : null;
  if (experience?.state === 'missing' && rows.some(row => !row.grounded && ['experience', 'internships', 'projects'].includes(row.section))) {
    experience.state = 'uncertain';
  }
  if (cgpa?.state === 'missing' && rows.some(row => !row.grounded && row.section === 'education')) cgpa.state = 'uncertain';
  const breakdown = {
    requiredSkills: average(required.map(row => row.score)), preferredSkills: average(preferred.map(row => row.score)),
    projects: Math.max(projects[0]?.similarity || 0, average(additional.filter(row => row.priority === 'Preferred').map(row => row.score))),
    ...(experience && { experience: Number(experience.state === 'match') }),
    ...(cgpa && { cgpa: Number(cgpa.state === 'match') })
  };
  const points = Math.round(Object.entries(weights).reduce((sum, [key, weight]) => sum + weight * breakdown[key], 0));
  const reasons = [
    ...required.filter(row => row.state !== 'match').map(row => 'Required skill: ' + row.label + ' (' + row.state + ')'),
    ...additional.filter(row => row.priority === 'Mandatory' && row.state !== 'match').map(row => 'Mandatory criterion: ' + row.label + ' (' + row.state + ')'),
    ...(experience && experience.state !== 'match' ? ['Experience: ' + experience.state] : []),
    ...(cgpa && !cgpa.allowed ? ['CGPA: ' + cgpa.state] : []),
    ...(points < thresholds.minimumScore * 100 ? ['Below the suitability score threshold.'] : [])
  ];
  return { score: points / 100, eligible: reasons.length === 0, reasons, breakdown,
    required, preferred, additional, projects, ...(experience && { experience }), ...(cgpa && { cgpa }),
    explanation: required.filter(row => row.state === 'match').length + ' of ' + required.length +
      ' required skills confirmed. ' + projects.length + ' relevant projects. ' +
      (reasons.length ? 'Did not meet the suitability rules.' : 'Meets the suitability rules.') };
}

export const rank = (results, count) => results.filter(row => row.eligible).sort((a, b) =>
  b.score - a.score || (String(a.candidate) < String(b.candidate) ? -1 : String(a.candidate) > String(b.candidate) ? 1 : 0)).slice(0, count);

export function uniqueVersions(rows) {
  const parent = new Map(rows.map(row => [String(row._id), row.versionOf && String(row.versionOf)]));
  const groups = new Map();
  for (const row of rows) {
    let key = String(row._id);
    const seen = new Set();
    while (parent.get(key) && !seen.has(key)) { seen.add(key); key = parent.get(key); }
    const current = groups.get(key);
    if (!current || row.createdAt > current.createdAt || (+row.createdAt === +current.createdAt && String(row._id) > String(current._id))) {
      groups.set(key, row);
    }
  }
  return [...groups.values()].sort((a, b) => String(a._id).localeCompare(String(b._id)));
}
