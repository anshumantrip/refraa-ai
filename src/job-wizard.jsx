import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from './api.js';
import { Field, Heading, Notice, ResourceState, useAction, useResource } from './ui.jsx';
import { JobSummary, stepNames } from './job-summary.jsx';
import { useRecruitingWorkspace } from './recruiting.jsx';
import { cgpaScales, criterionPriorities, criterionTypes, educationLevels, employmentTypes, experienceTypes,
  jobConfigSchema, jobSteps, MAX_CRITERIA, MAX_REFERRALS, MAX_SKILLS, newJob, skillKey } from '../shared/jobs.js';

const skillSuggestions = ['Accessibility', 'Accounting', 'AWS', 'Azure', 'Business analysis', 'C++', 'CSS',
  'Data analysis', 'Docker', 'Excel', 'Financial modeling', 'Go', 'Java', 'JavaScript', 'Kubernetes', 'Leadership',
  'MongoDB', 'Node.js', 'Product management', 'Python', 'React', 'Rust', 'Salesforce', 'SQL', 'Tailwind CSS',
  'TypeScript', 'UX research'];

function TextField({ label, value, onChange, ...props }) {
  return <Field label={label}><input value={value} onChange={event => onChange(event.target.value)} {...props} /></Field>;
}

function NumericField({ label, value, onChange, ...props }) {
  return <Field label={label}><input type="number" value={value ?? ''} onChange={event => {
    onChange(event.target.value === '' ? null : event.target.valueAsNumber);
  }} {...props} /></Field>;
}

function Choice({ label, value, options, onChange, placeholder }) {
  return <Field label={label}><select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
    {placeholder && <option value="">{placeholder}</option>}
    {options.map(option => <option key={option}>{option}</option>)}
  </select></Field>;
}

function Check({ label, checked, onChange }) {
  return <label className="job-check"><input type="checkbox" checked={checked}
    onChange={event => onChange(event.target.checked)} />{label}</label>;
}

function Toggle({ label, enabled, onChange }) {
  return <div className="job-toggle"><div><strong>{label}</strong>
    <p className="muted">Include this criterion in eligibility and scoring.</p></div>
    <button type="button" role="switch" aria-label={label} aria-checked={enabled}
      className="job-switch" onClick={() => onChange(!enabled)}>{enabled ? 'ON' : 'OFF'}</button>
  </div>;
}

function Details({ job, set }) {
  return <div className="job-fields">
    <TextField label="Job title (required)" value={job.title} onChange={value => set('title', value)} maxLength={120} required />
    <TextField label="Department" value={job.department} onChange={value => set('department', value)} maxLength={120} />
    <div className="job-field-wide"><Field label="Job description (required)"><textarea value={job.description}
      onChange={event => set('description', event.target.value)} maxLength={5000} rows={6} required /></Field></div>
    <TextField label="Location" value={job.location} onChange={value => set('location', value)} maxLength={120} />
    <Choice label="Employment type" value={job.employmentType} options={employmentTypes}
      placeholder="Select employment type" onChange={value => set('employmentType', value)} />
    <TextField label="Education requirements" value={job.education} onChange={value => set('education', value)} maxLength={500} />
    <TextField label="Application deadline" value={job.deadline} onChange={value => set('deadline', value)} type="date" />
  </div>;
}

function SkillEditor({ label, items, all, onChange }) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const listId = label.toLowerCase().replace(' ', '-') + '-options';
  function add() {
    const name = query.trim().replace(/\s+/gu, ' ');
    if (!name) return setError('Enter a skill to add.');
    if (items.length >= MAX_SKILLS) return setError('This list has reached its skill limit.');
    if (all.some(skill => skillKey(skill.name) === skillKey(name))) return setError('That skill is already on this job.');
    onChange([...items, { name, proficiency: '', evidence: '' }]);
    setQuery('');
    setError('');
  }
  return <fieldset className="skill-editor"><legend>{label}</legend>
    <Notice error={error} />
    <div className="skill-search"><Field label={'Search or add ' + label.toLowerCase()}><input value={query}
      list={listId} maxLength={60} placeholder="Type a skill" onChange={event => { setQuery(event.target.value); setError(''); }}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} /></Field>
      <datalist id={listId}>{skillSuggestions.filter(name => !all.some(item => skillKey(item.name) === skillKey(name)))
        .map(name => <option value={name} key={name} />)}</datalist>
      <button className="button secondary" type="button" onClick={add} aria-label={'Add ' + label.toLowerCase().replace('skills', 'skill')}>Add skill</button>
    </div>
    {items.length ? <ul className="skill-tags">{items.map((item, index) => <li key={skillKey(item.name)}>
      <details><summary>{item.name}{(item.proficiency || item.evidence) && <span aria-hidden="true"> ·</span>}</summary>
        <div className="job-fields">
          <TextField label={'Proficiency for ' + item.name} value={item.proficiency} maxLength={120} onChange={value =>
            onChange(items.map((skill, position) => position === index ? { ...skill, proficiency: value } : skill))} />
          <TextField label={'Evidence for ' + item.name} value={item.evidence} maxLength={240} onChange={value =>
            onChange(items.map((skill, position) => position === index ? { ...skill, evidence: value } : skill))} />
        </div>
      </details>
      <button className="text-button" type="button" aria-label={'Remove ' + item.name}
        onClick={() => onChange(items.filter((_, position) => position !== index))}>×</button>
    </li>)}</ul> : <p className="muted">No skills added.</p>}
  </fieldset>;
}

function Experience({ value, onChange }) {
  const set = (key, next) => onChange({ ...value, [key]: next });
  return <>
    <Toggle label="Experience" enabled={value.enabled} onChange={enabled => set('enabled', enabled)} />
    {value.enabled && <div className="job-fields">
      <NumericField label="Minimum years" value={value.minimumYears} onChange={next => set('minimumYears', next)} min={0} max={60} step="any" required />
      <NumericField label="Maximum years" value={value.maximumYears} onChange={next => set('maximumYears', next)} min={0} max={60} step="any" />
      <fieldset className="job-field-wide job-checks"><legend>Experience types</legend>
        {experienceTypes.map(type => <Check key={type} label={type} checked={value.experienceTypes.includes(type)}
          onChange={checked => set('experienceTypes', checked ? [...value.experienceTypes, type] : value.experienceTypes.filter(item => item !== type))} />)}
      </fieldset>
      <Check label="Include freshers" checked={value.includeFreshers} onChange={next => set('includeFreshers', next)} />
      <Check label="Relevant experience only" checked={value.relevantOnly} onChange={next => set('relevantOnly', next)} />
    </div>}
  </>;
}

function Cgpa({ value, onChange }) {
  const set = (key, next) => onChange({ ...value, [key]: next });
  return <>
    <Toggle label="CGPA" enabled={value.enabled} onChange={enabled => set('enabled', enabled)} />
    {value.enabled && <div className="job-fields">
      <Field label="CGPA scale"><select aria-label="CGPA scale" value={value.scale} onChange={event => set('scale', event.target.value)}>
        <option value="4">4-point</option><option value="10">10-point</option><option value="percentage">Percentage</option>
      </select></Field>
      <Choice label="Applicable education level" value={value.educationLevel} options={educationLevels}
        onChange={next => set('educationLevel', next)} />
      <NumericField label="Minimum CGPA" value={value.minimumCGPA} onChange={next => set('minimumCGPA', next)}
        min={0} max={cgpaScales[value.scale]} step="any" required />
      <NumericField label="Maximum CGPA" value={value.maximumCGPA} onChange={next => set('maximumCGPA', next)}
        min={0} max={cgpaScales[value.scale]} step="any" />
      <Check label="Allow unavailable CGPA" checked={value.allowUnavailable} onChange={next => set('allowUnavailable', next)} />
    </div>}
  </>;
}

function Additional({ items, onChange }) {
  const update = (index, key, value) => onChange(items.map((entry, position) => position === index ? { ...entry, [key]: value } : entry));
  return <div className="additional-criteria">
    {items.length === 0 && <p className="muted">No additional criteria added.</p>}
    {items.map((entry, index) => <fieldset className="job-fields" key={index}><legend>Criterion {index + 1}</legend>
      <Choice label="Criterion type" value={entry.type} options={criterionTypes} onChange={value => update(index, 'type', value)} />
      <Choice label="Priority" value={entry.priority} options={criterionPriorities} onChange={value => update(index, 'priority', value)} />
      <TextField label="Criterion description" value={entry.description} maxLength={400} required
        onChange={value => update(index, 'description', value)} />
      <button className="button secondary" type="button" onClick={() => onChange(items.filter((_, position) => position !== index))}>Remove criterion {index + 1}</button>
    </fieldset>)}
    <button className="button secondary" type="button" disabled={items.length >= MAX_CRITERIA}
      onClick={() => onChange([...items, { type: criterionTypes[0], priority: criterionPriorities[1], description: '' }])}>Add criterion</button>
  </div>;
}

function WizardForm({ item }) {
  const { home, apiBase } = useRecruitingWorkspace();
  const navigate = useNavigate();
  const action = useAction();
  const [job, setJob] = useState(() => {
    const initial = newJob();
    return item ? Object.fromEntries(Object.keys(initial).map(key => [key, item[key] ?? initial[key]])) : initial;
  });
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const stepHeading = useRef(null);
  const editingPublished = item?.status === 'published';
  const set = (key, value) => setJob(previous => ({ ...previous, [key]: value }));
  useEffect(() => { if (step > 0 || reviewing) stepHeading.current?.focus(); }, [step, reviewing]);

  function go(target) {
    setError('');
    setFurthest(previous => Math.max(previous, target));
    setStep(target);
  }

  function stepValid(index) {
    const schema = jobSteps[index];
    if (!schema) return true;
    const result = schema.safeParse(job);
    if (result.success) return true;
    setError(result.error.issues[0].message);
    return false;
  }

  function advance() {
    if (stepValid(step)) go(reviewing ? 6 : step + 1);
  }

  async function save(publish) {
    const result = jobConfigSchema.safeParse(job);
    if (!result.success) {
      const issue = result.error.issues[0];
      const target = jobSteps.findIndex(schema => Object.hasOwn(schema.shape, issue.path[0]));
      if (target >= 0) go(target);
      setError(issue.message);
      return;
    }
    const response = await action.run(() => api(apiBase + '/jobs' + (item ? '/' + item._id : ''), {
      method: item ? 'PUT' : 'POST', body: { configuration: result.data, publish, ...(item && { revision: item.revision }) }
    }));
    if (response) navigate(home + '/jobs/' + response.item._id, { replace: true, state: { message: response.message } });
  }

  const stepContents = [
    <Details job={job} set={set} />,
    <div className="job-skills">{[['Required skills', 'requiredSkills'], ['Preferred skills', 'preferredSkills']].map(([label, key]) =>
      <SkillEditor key={key} label={label} items={job[key]} all={[...job.requiredSkills, ...job.preferredSkills]}
        onChange={value => set(key, value)} />)}</div>,
    <Experience value={job.experienceCriteria} onChange={value => set('experienceCriteria', value)} />,
    <Cgpa value={job.cgpaCriteria} onChange={value => set('cgpaCriteria', value)} />,
    <Additional items={job.additionalCriteria} onChange={value => set('additionalCriteria', value)} />,
    <div className="job-referral-step"><NumericField label="Desired candidates" value={job.referralCount}
      onChange={value => set('referralCount', value)} min={1} max={MAX_REFERRALS} step={1} required />
      {Number.isInteger(job.referralCount) && job.referralCount > 0 && job.referralCount <= MAX_REFERRALS &&
        <p role="status">refraaAI will shortlist up to {job.referralCount} suitable candidates.</p>}</div>,
    <JobSummary job={job} onEdit={target => { setReviewing(true); go(target); }} />
  ];

  return <>
    <Link className="back-link" to={home + '/jobs'}>← Jobs</Link>
    <Heading title={item ? 'Edit job' : 'Create a job'} description={item?.title || 'Set the requirements for your next screening.'} />
    <ol className="wizard-steps" aria-label="Job creation steps">{stepNames.map((name, index) => <li key={name}>
      <button className={index === step ? 'current' : ''} type="button" aria-current={index === step ? 'step' : undefined}
        disabled={index > furthest || action.busy} onClick={() => { if (index <= step || stepValid(step)) { setReviewing(false); go(index); } }}>
        <span aria-hidden="true">{index + 1}</span>{name}
      </button>
    </li>)}</ol>
    <form className="wizard-form" noValidate onSubmit={event => {
      event.preventDefault();
      if (step < 6) advance();
    }}>
      <div className={step === 6 ? '' : 'panel wizard-panel'} key={step}>
        <h2 ref={stepHeading} tabIndex={-1}>{stepNames[step]}</h2>
        <Notice error={error || action.error} />
        <fieldset className="wizard-fields" disabled={action.busy}>{stepContents[step]}</fieldset>
      </div>
      <div className="wizard-actions">
        {step > 0 ? <button type="button" className="button secondary" disabled={action.busy}
          onClick={() => { setReviewing(false); go(step - 1); }}>Back</button> : <Link className="button secondary" to={home + '/jobs'}>Cancel</Link>}
        <div>
          <button type="button" className={editingPublished && step === 6 ? 'button primary' : 'button secondary'}
            disabled={action.busy} onClick={() => save(false)}>{action.busy ? 'Saving…' : editingPublished ? 'Save changes' : 'Save draft'}</button>
          {step < 6 && <button type="submit" className="button primary" disabled={action.busy}>{reviewing ? 'Return to review' : 'Continue'}</button>}
          {step === 6 && !editingPublished && <button type="button" className="button primary" disabled={action.busy}
            onClick={() => save(true)}>Publish job</button>}
        </div>
      </div>
    </form>
  </>;
}

export function JobWizard() {
  const { jobId } = useParams();
  const { apiBase } = useRecruitingWorkspace();
  const resource = useResource(jobId ? apiBase + '/jobs/' + jobId : null);
  if (!jobId) return <WizardForm key="new" />;
  return <><ResourceState resource={resource} />
    {resource.data?.item.status === 'archived' ? <Notice error="Archived jobs cannot be edited." /> :
      resource.data?.item && <WizardForm key={jobId} item={resource.data.item} />}</>;
}
