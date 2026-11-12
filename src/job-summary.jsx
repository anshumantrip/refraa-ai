import { cgpaScales } from '../shared/jobs.js';
import { scoringConfiguration, weightLabels } from '../shared/scoring.js';

export const stepNames = ['Job details', 'Skills', 'Experience', 'CGPA', 'Additional criteria', 'Referral count', 'Review'];
const yesNo = value => value ? 'Yes' : 'No';

function SummarySection({ title, edit, children }) {
  return <section className="panel job-summary-section">
    <div><h2>{title}</h2>{edit && <button className="text-button" type="button" onClick={edit} aria-label={'Edit ' + title}>Edit</button>}</div>
    {children}
  </section>;
}

function SkillList({ label, items }) {
  return <div className="summary-skill-group"><h3>{label}</h3>
    {items.length ? <ul>{items.map(item => <li key={item.name}><strong>{item.name}</strong>
      {item.proficiency && <span> · {item.proficiency}</span>}
      {item.evidence && <small>{item.evidence}</small>}
    </li>)}</ul> : <p className="muted">None specified.</p>}
  </div>;
}

export function JobSummary({ job, onEdit }) {
  const experience = job.experienceCriteria;
  const cgpa = job.cgpaCriteria;
  const scoring = job.scoring || scoringConfiguration(job);
  const editing = index => onEdit && (() => onEdit(index));
  return <div className="job-summary">
    <SummarySection title={stepNames[0]} edit={editing(0)}>
      <dl>{[['Job title', job.title], ['Department', job.department], ['Location', job.location],
        ['Employment type', job.employmentType], ['Education', job.education], ['Application deadline', job.deadline]].map(([label, value]) =>
        <div key={label}><dt>{label}</dt><dd>{value || 'Unspecified'}</dd></div>)}</dl>
      <p className="job-description">{job.description}</p>
    </SummarySection>
    <SummarySection title={stepNames[1]} edit={editing(1)}>
      <SkillList label="Required skills" items={job.requiredSkills} /><SkillList label="Preferred skills" items={job.preferredSkills} />
    </SummarySection>
    <SummarySection title={stepNames[2]} edit={editing(2)}>
      <p className="criterion-state">Experience {experience.enabled ? 'ON' : 'OFF'}</p>
      {experience.enabled ? <dl>
        <div><dt>Years</dt><dd>{experience.minimumYears ?? 'Unspecified'} to {experience.maximumYears ?? 'no maximum'}</dd></div>
        <div><dt>Types</dt><dd>{experience.experienceTypes.join(', ')}</dd></div>
        <div><dt>Include freshers</dt><dd>{yesNo(experience.includeFreshers)}</dd></div>
        <div><dt>Relevant only</dt><dd>{yesNo(experience.relevantOnly)}</dd></div>
      </dl> : <p className="muted">Excluded from eligibility and scoring. Saved values are retained.</p>}
    </SummarySection>
    <SummarySection title={stepNames[3]} edit={editing(3)}>
      <p className="criterion-state">CGPA {cgpa.enabled ? 'ON' : 'OFF'}</p>
      {cgpa.enabled ? <dl>
        <div><dt>Range</dt><dd>{cgpa.minimumCGPA ?? 'Unspecified'} to {cgpa.maximumCGPA ?? 'no maximum'} on a {cgpaScales[cgpa.scale]} point scale</dd></div>
        <div><dt>Education level</dt><dd>{cgpa.educationLevel}</dd></div>
        <div><dt>Allow unavailable</dt><dd>{yesNo(cgpa.allowUnavailable)}</dd></div>
      </dl> : <p className="muted">Excluded from eligibility and scoring. Saved values are retained.</p>}
    </SummarySection>
    <SummarySection title={stepNames[4]} edit={editing(4)}>
      {job.additionalCriteria.length ? <ul className="criteria-summary">{job.additionalCriteria.map((entry, index) =>
        <li key={index}><strong>{entry.type} · {entry.priority}</strong><p>{entry.description}</p></li>)}</ul> : <p className="muted">None specified.</p>}
    </SummarySection>
    <SummarySection title={stepNames[5]} edit={editing(5)}>
      <p>refraaAI will shortlist up to {job.referralCount} suitable candidates.</p>
    </SummarySection>
    <SummarySection title="Scoring weights">
      <dl>{Object.entries(scoring.basisPoints).map(([key, points]) =>
        <div key={key}><dt>{weightLabels[key]}</dt><dd>{points / 100}%</dd></div>)}
        <div><dt>Total</dt><dd>{scoring.totalBasisPoints / 100}%</dd></div>
      </dl>
    </SummarySection>
  </div>;
}
