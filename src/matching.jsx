import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from './api.js';
import { dateTime, useRecruitingWorkspace } from './recruiting.jsx';
import { Field, Heading, Notice, ResourceState, useAction, useResource } from './ui.jsx';

const stateLabel = { pending: 'Queued', processing: 'Matching', completed: 'Complete', blocked: 'Blocked' };
const evidenceLabel = { match: 'Confirmed match', mismatch: 'Confirmed mismatch', missing: 'Missing information', uncertain: 'Uncertain evidence' };

export function MatchingHome() {
  const { home, apiBase } = useRecruitingWorkspace();
  const [page, setPage] = useState(1);
  const jobs = useResource(apiBase + '/jobs?page=' + page);
  return <><Heading title="AI Matching" description="Choose a job to evaluate the organization’s parsed resumes." />
    <ResourceState resource={jobs} />
    {jobs.data && (jobs.data.items.length ? <ul className="job-list">{jobs.data.items.map(job =>
      <li key={job._id}><Link className="job-list-row" to={home + '/ai-matching/jobs/' + job._id}>
        <strong>{job.title}</strong><span>{job.status}</span><span>Matching history →</span></Link></li>
    )}</ul> : <p className="panel muted">Create a job before starting a matching run.</p>)}
    {jobs.data?.pages > 1 && <div className="pagination"><button className="button secondary" disabled={page <= 1}
      onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {jobs.data.pages}</span>
      <button className="button secondary" disabled={page >= jobs.data.pages} onClick={() => setPage(page + 1)}>Next</button></div>}
  </>;
}

export function MatchingHistory() {
  const { jobId } = useParams();
  const { apiBase, home } = useRecruitingWorkspace();
  const [page, setPage] = useState(1);
  const base = apiBase + '/matching/jobs/' + jobId;
  const job = useResource(apiBase + '/jobs/' + jobId);
  const runs = useResource(base + '/runs?page=' + page);
  const action = useAction();
  const navigate = useNavigate();
  return <><Link className="back-link" to={home + '/ai-matching'}>← AI Matching</Link>
    <Heading title={job.data?.item.title || 'Matching history'} description="Review prior runs or evaluate candidates against the current criteria." />
    <Notice error={action.error} /><ResourceState resource={job} /><ResourceState resource={runs} />
    {job.data && <div className="quick-actions">
      <button className="button primary" disabled={action.busy || job.data.item.status === 'archived'} onClick={async () => {
        const run = await action.run(() => api(base + '/runs', { method: 'POST', body: {} }));
        if (run) navigate(home + '/ai-matching/runs/' + run.id);
      }}>Start matching</button>
      <Link className="button secondary" to={home + '/jobs/' + jobId}>View job criteria</Link>
    </div>}
    {runs.data && (runs.data.items.length ? <ul className="job-list">{runs.data.items.map(run =>
      <li key={run._id}><Link className="job-list-row" to={home + '/ai-matching/runs/' + run._id}>
        <strong>{dateTime(run.createdAt)}</strong><span>{stateLabel[run.status]}</span><span>{run.evaluated} evaluated</span></Link></li>
    )}</ul> : <p className="panel muted">No matching runs yet.</p>)}
    {runs.data?.pages > 1 && <div className="pagination"><button className="button secondary" disabled={page <= 1}
      onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {runs.data.pages}</span>
      <button className="button secondary" disabled={page >= runs.data.pages} onClick={() => setPage(page + 1)}>Next</button></div>}
  </>;
}

function Evidence({ rows = [] }) {
  if (!rows.length) return null;
  return <ul className="resume-evidence">{rows.map((row, index) => <li key={index}>
    <small>{row.section} · {row.line == null ? 'unverified line' : 'line ' + row.line}</small> {row.text}</li>)}</ul>;
}

function Checks({ label, items }) {
  if (!items.length) return null;
  return <section><h3>{label}</h3><ul>{items.map((row, index) => <li key={index}>
    <strong>{row.label}</strong> · {evidenceLabel[row.state]} {row.priority && ' · ' + row.priority}
    <Evidence rows={row.evidence} />
  </li>)}</ul></section>;
}

function Assessment({ row }) {
  const score = row.assessment;
  return <div className="matching-assessment">
    <p>{score.explanation}</p>
    {score.reasons.length > 0 && <ul>{score.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
    <Checks label="Required skills" items={score.required} />
    <Checks label="Preferred skills" items={score.preferred} />
    <Checks label="Additional criteria" items={score.additional} />
    {score.projects.length > 0 && <section><h3>Relevant projects</h3><Evidence rows={score.projects.map(item => item.evidence)} /></section>}
    {score.experience && <section><h3>Experience</h3><p>{evidenceLabel[score.experience.state]}
      {score.experience.months != null && ' · ' + score.experience.months + ' documented months'}</p><Evidence rows={score.experience.evidence} /></section>}
    {score.cgpa && <section><h3>CGPA</h3><p>{evidenceLabel[score.cgpa.state]}
      {score.cgpa.reported.length > 0 && ' · ' + score.cgpa.reported.map(item => item.value + '/' + score.cgpa.scale).join(', ')}
      {score.cgpa.allowed && score.cgpa.state !== 'match' && ' · Allowed by the job’s missing-data policy'}</p>
      <Evidence rows={score.cgpa.evidence} /></section>}
    <details><summary>Criterion scores</summary><dl>{Object.entries(score.breakdown).map(([key, value]) =>
      <div key={key}><dt>{({ requiredSkills: 'Required skills', preferredSkills: 'Preferred skills', projects: 'Projects',
        experience: 'Experience', cgpa: 'CGPA' })[key]}</dt><dd>{Math.round(value * 100)}%</dd></div>)}</dl></details>
  </div>;
}

export function MatchingRunView() {
  const { runId } = useParams();
  return <Run key={runId} runId={runId} />;
}

function Run({ runId }) {
  const { home, apiBase } = useRecruitingWorkspace();
  const path = apiBase + '/matching/runs/' + runId;
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [compare, setCompare] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState(null);
  const explanations = useResource(showAll ? path + '/explanations?page=' + page : null);
  const action = useAction();
  const navigate = useNavigate();
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function load() {
      try {
        const data = await api(path, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setResult(data); setError('');
        if (['pending', 'processing'].includes(data.item.status)) timer = setTimeout(load, 2500);
      } catch (error) { if (!controller.signal.aborted) setError(error.message); }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [path, refresh]);
  const run = result?.item;
  const n = run?.snapshot.criteria.referralCount;
  async function mutate(suffix, body = {}) {
    const response = await action.run(() => api(path + suffix, { method: 'POST', body }));
    if (response) setRefresh(value => value + 1);
    return response;
  }
  return <>
    <Link className="back-link" to={run ? home + '/ai-matching/jobs/' + run.job : home + '/ai-matching'}>← Matching history</Link>
    <Heading title={run?.status === 'completed' ? 'Your Top ' + n + ' AI-Matched Candidates' : 'Matching run'}
      description={run?.snapshot.criteria.title} />
    <Notice error={error || action.error} message={action.message} />
    {!run && !error && <p role="status" className="panel">Loading matching run…</p>}
    {error && <button className="button secondary" onClick={() => setRefresh(value => value + 1)}>Refresh status</button>}
    {run && <>
      <div className="panel matching-summary">
        <div className="quick-actions" role="status"><span className="pill">{stateLabel[run.status]}</span>
          <span>{run.evaluated} resumes evaluated</span><span>{run.eligible ?? '—'} eligible</span>
          <span>{result.results.length} shortlisted</span></div>
        <Notice error={run.error} />
        <details><summary>Job criteria and weights</summary><p>{run.snapshot.criteria.description}</p>
          <p>Required skills: {run.snapshot.criteria.requiredSkills.map(item => item.name).join(', ') || 'None configured'}</p>
          <p>Preferred skills: {run.snapshot.criteria.preferredSkills.map(item => item.name).join(', ') || 'None configured'}</p>
          <p>Additional criteria: {run.snapshot.criteria.additionalCriteria.map(item => item.description).join(', ') || 'None configured'}</p>
          <dl>{Object.entries(run.snapshot.weights).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value / 100}%</dd></div>)}</dl>
          {run.model && <p className="muted">{run.model.name} · {run.model.revision.slice(0, 12)}</p>}
        </details>
        <div className="quick-actions">
          <Link className="button secondary" to={home + '/jobs/' + run.job + '/edit'}>Edit criteria</Link>
          <button className="button secondary" disabled={action.busy || !result.current || result.current.status === 'archived' ||
            ['pending', 'processing'].includes(run.status)} onClick={async () => {
            const next = await mutate('/rerun');
            if (next) navigate(home + '/ai-matching/runs/' + next.id);
          }}>Rerun matching</button>
          {run.status === 'completed' && <a className="button secondary" href={'/api' + path + '/export'} download>Export shortlist</a>}
        </div>
        {result.current && result.current.status !== 'archived' && <form className="matching-count" key={result.current.revision}
          onSubmit={async event => {
            event.preventDefault();
            const count = Number(new FormData(event.currentTarget).get('count'));
            const saved = await action.run(() => api(apiBase + '/matching/jobs/' + run.job + '/count',
              { method: 'PUT', body: { count, revision: result.current.revision } }));
            if (saved) setRefresh(value => value + 1);
          }}><Field label="Shortlist count"><input name="count" type="number" min="1" max="100" required
            defaultValue={result.current.referralCount} /></Field>
          <button className="button secondary" disabled={action.busy}>Change N</button>
        </form>}
        {result.current && run.snapshot.jobRevision !== result.current.revision && <p className="muted">This run used earlier job settings. Rerun to apply current settings.</p>}
      </div>
      {run.status === 'completed' && <>
        {result.results.length < n && <Notice message={result.results.length ? 'Fewer than ' + n + ' suitable candidates are available.' : 'No suitable candidates are available.'} />}
        <div className="quick-actions">
          <button className="button secondary" disabled={compare.length < 2 || action.busy} onClick={async () => {
            const compared = await mutate('/compare', { candidates: compare });
            if (compared) setComparison(compared.items);
          }}>Compare candidates</button>
          <button className="button secondary" onClick={() => setShowAll(value => !value)}>{showAll ? 'Hide all evaluations' : 'Show all evaluations'}</button>
        </div>
        {comparison && <section className="panel"><h2>Candidate comparison</h2><div className="matching-comparison">{comparison.map(row =>
          <div key={row.candidate}><h3>{row.profile.name || 'Unknown candidate'} · {row.assessment.score}%</h3><Assessment row={row} /></div>
        )}</div></section>}
        {showAll && <section className="panel"><h2>All evaluations</h2><ResourceState resource={explanations} />
          {explanations.data?.items.map(row => <details key={row.candidate}><summary>{row.profile.name || 'Unknown candidate'} · {row.assessment.score}% · {row.assessment.eligible ? 'Eligible' : 'Ineligible'}</summary><Assessment row={row} /></details>)}
          <div className="pagination"><button className="button secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page}</span><button className="button secondary" disabled={!explanations.data?.hasNext} onClick={() => setPage(page + 1)}>Next</button></div>
        </section>}
        <div className="matching-results">{result.results.map(row => {
          const name = row.profile.name || 'Unknown candidate';
          const profile = home + '/resume-library/files/' + row.resume;
          return <article className="panel matching-card" key={row.candidate}>
            <header><span className="avatar" aria-hidden="true">{name.split(' ').slice(0, 2).map(word => word[0]).join('')}</span>
              <h2>{name}</h2><strong>{row.assessment.score}%</strong></header>
            <Assessment row={row} />
            <div className="quick-actions"><Link to={home + '/candidate/' + runId + '/' + row.candidate}>View profile and create referral</Link>
              <Link to={profile}>Resume details</Link>
              <a href={'/api' + apiBase + '/resumes/' + row.resume + '/original'} download>View resume</a>
              <button className="button secondary" disabled={row.saved || action.busy}
                onClick={() => mutate('/candidates/' + row.candidate + '/save')}>{row.saved ? 'Saved' : 'Save candidate'}</button>
              <button className="button secondary" disabled={Boolean(row.approvedAt) || action.busy}
                onClick={() => setConfirm(row.candidate)}>{row.approvedAt ? 'Shortlist review recorded' : 'Record shortlist review'}</button>
              <label><input type="checkbox" checked={compare.includes(row.candidate)} disabled={!compare.includes(row.candidate) && compare.length >= 4}
                onChange={event => { setComparison(null); setCompare(event.target.checked ? [...compare, row.candidate] : compare.filter(id => id !== row.candidate)); }} /> Compare</label>
            </div>
            {confirm === row.candidate && <div className="panel"><p>Record your shortlist review for {name}? Referral decisions are recorded on the referral request.</p>
              <div className="quick-actions"><button className="button secondary" onClick={() => setConfirm(null)}>Cancel</button>
                <button className="button primary" disabled={action.busy} onClick={async () => {
                  if (await mutate('/candidates/' + row.candidate + '/approve')) setConfirm(null);
                }}>Confirm shortlist review</button></div></div>}
          </article>;
        })}</div>
      </>}
    </>}
  </>;
}
