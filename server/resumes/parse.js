const headings = new Map([
  ['education', 'education'], ['academic background', 'education'], ['technical skills', 'skills'],
  ['skills', 'skills'], ['technologies', 'skills'], ['experience', 'experience'],
  ['work experience', 'experience'], ['professional experience', 'experience'], ['employment history', 'experience'],
  ['internships', 'internships'], ['internship experience', 'internships'], ['projects', 'projects'],
  ['personal projects', 'projects'], ['academic projects', 'projects'], ['certifications', 'certifications'],
  ['licenses and certifications', 'certifications'], ['summary', 'other'], ['profile', 'other'],
  ['objective', 'other'], ['interests', 'other'], ['awards', 'other'], ['languages', 'other'],
  ['contact', 'other'], ['references', 'other']
]);
const datePart = '(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?\\s+)?(?:19|20)\\d{2}';
const dateRange = new RegExp('\\b(' + datePart + ')\\s*(?:–|—|-|to)\\s*(' + datePart + '|present|current)\\b', 'i');

function education(line) {
  const score = line.match(/\b(?:CGPA|GPA)\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)\s*(?:(?:\/|out of)\s*(\d{1,3}(?:\.\d+)?))?/i);
  const degree = line.match(/\b(?:Bachelor(?:'s)?|Master(?:'s)?|Doctor(?:ate)?|Diploma|B\.?Tech|M\.?Tech|B\.?Sc|M\.?Sc|B\.?E|M\.?E|MBA|Ph\.?D|BCA|MCA)\b(?:\s+(?:of|in)\s+[^,|;–—]{1,90})?/i);
  const institution = line.split(/[,|;–—]/).map(part => part.trim()).find(part =>
    /\b(?:university|college|institute|school|polytechnic)\b/i.test(part) && !degree?.[0].includes(part));
  const percentage = line.match(/\b(\d{1,3}(?:\.\d+)?)\s*%/)?.[1];
  return { text: line, degree: degree?.[0] ?? null, institution: institution ?? null,
    cgpa: score ? Number(score[1]) : null, scale: score?.[2] ? Number(score[2]) : null,
    percentage: percentage === undefined ? null : Number(percentage),
    dateRange: line.match(dateRange)?.[0] ?? null };
}

function item(line) {
  const dates = line.match(dateRange);
  const duration = line.match(/\b\d+(?:\.\d+)?\s*(?:years?|months?|weeks?)(?:\s+\d+\s*months?)?\b/i);
  const separator = line.match(/\s+[–—-]\s+|:\s+/);
  return { text: line, title: separator ? line.slice(0, separator.index).trim() : null,
    description: separator ? line.slice(separator.index + separator[0].length).trim() || null : null,
    startDate: dates?.[1] ?? null, endDate: dates?.[2] ?? null, duration: duration?.[0] ?? null };
}

export function parseResume(text) {
  const lines = text.split(/\r?\n/u).map(line => line.trim().replace(/^[•●▪]\s*/u, ''));
  const data = { name: null, email: null, phone: null, education: [], skills: [], experience: [],
    internships: [], projects: [], certifications: [] };
  const evidence = {};
  const add = (field, value, line, index) => {
    const source = { line: index + 1, excerpt: line, method: 'deterministic' };
    if (Array.isArray(data[field])) {
      if (data[field].length >= 100) return;
      data[field].push(value);
      (evidence[field] ||= []).push(source);
    } else if (data[field] === null) {
      data[field] = value;
      evidence[field] = source;
    }
  };
  let section;
  let hasHeader = false;
  const skills = new Set();
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    if (!line || line.length > 600) continue;
    const split = line.indexOf(':');
    const label = (split === -1 ? line : line.slice(0, split)).trim().toLowerCase();
    if (headings.has(label)) {
      section = headings.get(label);
      line = split === -1 ? '' : line.slice(split + 1).trim();
      if (!line) continue;
    }
    if (!section || label === 'contact') {
      const email = line.match(/\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
      if (email) add('email', email.toLowerCase(), lines[index], index);
      const phone = line.match(/(?:^|[\s:|])((?:\+\d[ .-]?)?(?:\(\d{2,4}\)|\d)[\d ().-]{6,20}\d)(?=$|[\s|])/u)?.[1];
      const digits = phone?.replace(/\D/g, '');
      if (digits?.length >= 8 && digits.length <= 15 && (phone.startsWith('+') || digits.length >= 10)) {
        add('phone', (phone.startsWith('+') ? '+' : '') + digits, lines[index], index);
      }
      const labeledName = line.match(/^name\s*:\s*(.+)$/i)?.[1];
      const possible = labeledName || (!hasHeader ? line : '');
      if (possible && /^[\p{L}\p{M}][\p{L}\p{M} .'’-]{2,79}$/u.test(possible) &&
          possible.trim().split(/\s+/).length >= 2 && !/resume|curriculum vitae|engineer|developer|consultant|designer|analyst|manager|specialist/i.test(possible)) {
        add('name', possible, lines[index], index);
      }
      hasHeader = true;
    }
    if (section === 'education') add(section, education(line), lines[index], index);
    if (section === 'skills') {
      for (const value of line.split(/[,;|•]/u).map(part => part.trim()).filter(part => part && part.length <= 100)) {
        const key = value.toLowerCase();
        if (!skills.has(key)) add(section, value, lines[index], index);
        skills.add(key);
      }
    }
    if (['experience', 'internships', 'projects', 'certifications'].includes(section)) add(section, item(line), lines[index], index);
  }
  return { data, evidence };
}
